import { createClient } from 'redis';
import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';
/**
 * Redis Streams Configuration for Microservices Communication
 * Provides reliable message delivery with at-least-once semantics
 */
export class RedisStreamsManager {
    constructor() {
        this.isConnected = false;
        this.consumers = new Map();
        this.client = createClient({
            url: env.REDIS_URL,
            socket: {
                connectTimeout: 5000,
                keepAlive: true,
                noDelay: true,
                // Stream-specific optimizations
                reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
            }
        });
        this.client.on('error', (error) => {
            logger.error({ error }, 'Redis Streams client error');
        });
        this.client.on('connect', () => {
            logger.info('Redis Streams client connected');
            this.isConnected = true;
        });
        this.client.on('disconnect', () => {
            logger.warn('Redis Streams client disconnected');
            this.isConnected = false;
        });
    }
    /**
     * Connect to Redis and initialize streams and consumer groups
     */
    async connect() {
        try {
            await this.client.connect();
            await this.initializeStreamsAndGroups();
            logger.info('Redis Streams manager initialized successfully');
        }
        catch (error) {
            logger.error({ error }, 'Failed to connect Redis Streams manager');
            throw error;
        }
    }
    /**
     * Initialize streams and consumer groups
     * Creates streams and groups if they don't exist
     */
    async initializeStreamsAndGroups() {
        const streams = Object.values(RedisStreamsManager.STREAMS);
        const groups = Object.values(RedisStreamsManager.CONSUMER_GROUPS);
        for (const stream of streams) {
            try {
                // Create stream by adding a dummy message if it doesn't exist
                await this.client.xAdd(stream, '*', {
                    type: 'SYSTEM_INITIALIZATION',
                    initialized: Date.now().toString()
                });
                // Create consumer groups for this stream
                for (const group of groups) {
                    try {
                        await this.client.xGroupCreate(stream, group, '0', { MKSTREAM: true });
                        logger.debug({ stream, group }, 'Created consumer group');
                    }
                    catch (error) {
                        // Group might already exist - that's ok
                        if (!error.message.includes('BUSYGROUP')) {
                            logger.warn({ error, stream, group }, 'Failed to create consumer group');
                        }
                    }
                }
            }
            catch (error) {
                logger.error({ error, stream }, 'Failed to initialize stream');
            }
        }
    }
    /**
     * Add a message to a stream
     */
    async addToStream(streamName, data) {
        if (!this.isConnected) {
            throw new Error('Redis Streams client not connected');
        }
        try {
            const messageId = await this.client.xAdd(streamName, '*', data);
            logger.debug({ streamName, messageId, dataKeys: Object.keys(data) }, 'Added message to stream');
            return messageId;
        }
        catch (error) {
            logger.error({ error, streamName, data }, 'Failed to add message to stream');
            throw error;
        }
    }
    /**
     * Read messages from a stream using consumer group
     */
    async readFromStreamGroup(streamName, groupName, consumerName, options = {}) {
        if (!this.isConnected) {
            throw new Error('Redis Streams client not connected');
        }
        try {
            const { count = 10, block = 5000 } = options;
            const result = await this.client.xReadGroup(groupName, consumerName, [{ key: streamName, id: '>' }], { COUNT: count, BLOCK: block });
            if (!result || result.length === 0) {
                return [];
            }
            const messages = [];
            for (const stream of result) {
                for (const message of stream.messages) {
                    messages.push({
                        id: message.id,
                        data: message.message
                    });
                }
            }
            return messages;
        }
        catch (error) {
            logger.error({ error, streamName, groupName, consumerName }, 'Failed to read from stream group');
            throw error;
        }
    }
    /**
     * Acknowledge message processing
     */
    async acknowledgeMessage(streamName, groupName, messageId) {
        if (!this.isConnected) {
            throw new Error('Redis Streams client not connected');
        }
        try {
            await this.client.xAck(streamName, groupName, messageId);
            logger.debug({ streamName, groupName, messageId }, 'Acknowledged message');
        }
        catch (error) {
            logger.error({ error, streamName, groupName, messageId }, 'Failed to acknowledge message');
            throw error;
        }
    }
    /**
     * Get stream information for monitoring
     */
    async getStreamInfo(streamName) {
        if (!this.isConnected) {
            throw new Error('Redis Streams client not connected');
        }
        try {
            return await this.client.xInfoStream(streamName);
        }
        catch (error) {
            logger.error({ error, streamName }, 'Failed to get stream info');
            throw error;
        }
    }
    /**
     * Get consumer group information for monitoring
     */
    async getGroupInfo(streamName) {
        if (!this.isConnected) {
            throw new Error('Redis Streams client not connected');
        }
        try {
            return await this.client.xInfoGroups(streamName);
        }
        catch (error) {
            logger.error({ error, streamName }, 'Failed to get group info');
            throw error;
        }
    }
    /**
     * Get pending messages for a consumer group
     */
    async getPendingMessages(streamName, groupName) {
        if (!this.isConnected) {
            throw new Error('Redis Streams client not connected');
        }
        try {
            return await this.client.xPending(streamName, groupName);
        }
        catch (error) {
            logger.error({ error, streamName, groupName }, 'Failed to get pending messages');
            throw error;
        }
    }
    /**
     * Start a consumer for continuous message processing
     */
    async startConsumer(streamName, groupName, consumerName, processor, options = {}) {
        const consumerKey = `${streamName}:${groupName}:${consumerName}`;
        // Stop existing consumer if any
        if (this.consumers.has(consumerKey)) {
            this.stopConsumer(consumerKey);
        }
        const abortController = new AbortController();
        this.consumers.set(consumerKey, abortController);
        logger.info({ streamName, groupName, consumerName }, 'Starting Redis Streams consumer');
        const processMessages = async () => {
            while (!abortController.signal.aborted) {
                try {
                    const messages = await this.readFromStreamGroup(streamName, groupName, consumerName, options);
                    for (const message of messages) {
                        if (abortController.signal.aborted)
                            break;
                        try {
                            await processor(message);
                            await this.acknowledgeMessage(streamName, groupName, message.id);
                        }
                        catch (error) {
                            logger.error({ error, messageId: message.id, streamName }, 'Failed to process message');
                            // Message will remain in pending list for retry
                        }
                    }
                }
                catch (error) {
                    if (!abortController.signal.aborted) {
                        logger.error({ error, streamName, groupName, consumerName }, 'Consumer error, retrying...');
                        // Wait before retrying
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
        };
        processMessages().catch(error => {
            logger.error({ error, streamName, groupName, consumerName }, 'Consumer terminated with error');
        });
    }
    /**
     * Stop a consumer
     */
    stopConsumer(consumerKey) {
        const controller = this.consumers.get(consumerKey);
        if (controller) {
            controller.abort();
            this.consumers.delete(consumerKey);
            logger.info({ consumerKey }, 'Stopped Redis Streams consumer');
        }
    }
    /**
     * Stop all consumers and disconnect
     */
    async disconnect() {
        // Stop all consumers
        for (const [_key, controller] of this.consumers) {
            controller.abort();
        }
        this.consumers.clear();
        // Disconnect client
        if (this.isConnected) {
            await this.client.disconnect();
            this.isConnected = false;
            logger.info('Redis Streams manager disconnected');
        }
    }
    /**
     * Get consumer group information for monitoring
     */
    async getConsumerGroupInfo(streamName, groupName) {
        if (!this.isConnected) {
            throw new Error('Redis Streams client not connected');
        }
        try {
            const groups = await this.client.xInfoGroups(streamName);
            return groups.find((group) => group.name === groupName) || null;
        }
        catch (error) {
            logger.debug({ error, streamName, groupName }, 'Failed to get consumer group info - group may not exist');
            return null;
        }
    }
    /**
     * Get the underlying Redis client for advanced operations
     */
    getClient() {
        return this.client;
    }
}
// Stream names
RedisStreamsManager.STREAMS = {
    AUDIO_COMMANDS: 'discord-bot:audio-commands',
    AUDIO_RESPONSES: 'discord-bot:audio-responses',
    GATEWAY_COMMANDS: 'discord-bot:gateway-commands',
    GATEWAY_RESPONSES: 'discord-bot:gateway-responses'
};
// Consumer group names
RedisStreamsManager.CONSUMER_GROUPS = {
    AUDIO_PROCESSORS: 'audio-processors',
    GATEWAY_PROCESSORS: 'gateway-processors',
    RESPONSE_HANDLERS: 'response-handlers'
};
// Export singleton instance
export const redisStreams = new RedisStreamsManager();
