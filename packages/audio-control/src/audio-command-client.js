import { redisStreams, RedisStreamsManager } from '@discord-bot/cache';
import { logger } from '@discord-bot/logger';
export class AudioCommandClient {
    constructor(options = {}) {
        this.options = options;
        this.responseHandlers = new Map();
        this.isInitialized = false;
        this.consumerName = `${options.consumerNamePrefix ?? 'audio-client'}-${process.pid}-${Date.now()}`;
        this.handleResponse = this.handleResponse.bind(this);
    }
    async initialize() {
        if (this.isInitialized)
            return;
        await redisStreams.connect();
        await redisStreams.startConsumer(RedisStreamsManager.STREAMS.AUDIO_RESPONSES, RedisStreamsManager.CONSUMER_GROUPS.RESPONSE_HANDLERS, this.consumerName, this.handleResponse, {
            count: this.options.responseBatchSize ?? 10,
            block: this.options.responseBlockMs ?? 1000
        });
        this.isInitialized = true;
        logger.info({ consumerName: this.consumerName }, 'AudioCommandClient initialized successfully');
    }
    async sendQueueCommand(guildId, options = {}) {
        const { timeout = 10000, retries = 2, page = 1 } = options;
        const requestId = `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const commandData = {
            type: 'queue',
            guildId,
            requestId,
            timestamp: Date.now().toString(),
            page: page.toString()
        };
        return this.sendCommandWithResponse(commandData, timeout, retries);
    }
    async sendNowPlayingCommand(guildId, textChannelId) {
        const commandData = {
            type: 'nowplaying',
            guildId,
            requestId: `nowplaying_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now().toString(),
            ...(textChannelId ? { channelId: textChannelId } : {})
        };
        await this.sendCommandOnly(commandData);
    }
    async sendSimpleCommand(type, guildId) {
        const commandData = {
            type,
            guildId,
            requestId: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now().toString()
        };
        await this.sendCommandOnly(commandData);
    }
    async sendCommand(type, guildId, additionalData = {}, options = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) {
        const { timeout = 10000, retries = 2 } = options;
        const requestId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const commandData = {
            type,
            guildId,
            requestId,
            timestamp: Date.now().toString(),
            ...additionalData
        };
        return this.sendCommandWithResponse(commandData, timeout, retries);
    }
    async sendPlayCommand(type, guildId, voiceChannelId, textChannelId, userId, query, options = {}) {
        const { timeout = 10000, retries = 2 } = options;
        const commandData = {
            type,
            guildId,
            voiceChannelId,
            textChannelId,
            userId,
            query,
            requestId: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now().toString()
        };
        await this.sendCommandWithResponse(commandData, timeout, retries);
    }
    getStats() {
        return {
            pendingRequests: this.responseHandlers.size,
            isInitialized: this.isInitialized,
            consumerName: this.consumerName
        };
    }
    async shutdown() {
        logger.info('Shutting down AudioCommandClient...');
        for (const handler of this.responseHandlers.values()) {
            clearTimeout(handler.timeout);
            handler.reject(new Error('Service shutting down'));
        }
        this.responseHandlers.clear();
        const consumerKey = `${RedisStreamsManager.STREAMS.AUDIO_RESPONSES}:${RedisStreamsManager.CONSUMER_GROUPS.RESPONSE_HANDLERS}:${this.consumerName}`;
        redisStreams.stopConsumer(consumerKey);
        this.isInitialized = false;
        logger.info('AudioCommandClient shutdown complete');
    }
    async sendCommandOnly(commandData) {
        await redisStreams.addToStream(RedisStreamsManager.STREAMS.AUDIO_COMMANDS, commandData);
        if (this.options.monitoring?.onCommandEnqueued) {
            this.options.monitoring.onCommandEnqueued(RedisStreamsManager.STREAMS.AUDIO_COMMANDS);
        }
        logger.debug({
            type: commandData.type,
            guildId: commandData.guildId,
            requestId: commandData.requestId
        }, 'Command sent via Redis Streams (no response expected)');
    }
    async sendCommandWithResponse(commandData, timeout, maxRetries
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) {
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (this.options.monitoring?.onCommandEnqueued) {
                    this.options.monitoring.onCommandEnqueued(RedisStreamsManager.STREAMS.AUDIO_COMMANDS);
                }
                return await this.attemptCommand(commandData, timeout);
            }
            catch (error) {
                lastError = error;
                if (attempt === maxRetries) {
                    logger.error({
                        error,
                        commandData,
                        attempt: attempt + 1,
                        maxRetries: maxRetries + 1
                    }, 'Command failed after all retries');
                    throw error;
                }
                const jitter = Math.floor(Math.random() * 200);
                const delay = Math.min(Math.pow(2, attempt) * 100, 1000) + jitter;
                logger.warn({
                    error: error.message,
                    commandData,
                    attempt: attempt + 1,
                    maxRetries: maxRetries + 1,
                    delay
                }, 'Command attempt failed, retrying...');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError ?? new Error('All command attempts failed');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async attemptCommand(commandData, timeout) {
        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this.responseHandlers.delete(commandData.requestId);
                reject(new Error(`Command timeout after ${timeout}ms`));
            }, timeout);
            this.responseHandlers.set(commandData.requestId, {
                resolve,
                reject,
                timeout: timeoutHandle
            });
            redisStreams.addToStream(RedisStreamsManager.STREAMS.AUDIO_COMMANDS, commandData)
                .then(messageId => {
                logger.debug({
                    requestId: commandData.requestId,
                    messageId,
                    type: commandData.type,
                    guildId: commandData.guildId
                }, 'Command sent to audio service');
            })
                .catch(error => {
                const handler = this.responseHandlers.get(commandData.requestId);
                if (handler) {
                    clearTimeout(handler.timeout);
                    this.responseHandlers.delete(commandData.requestId);
                }
                reject(error);
            });
        });
    }
    async handleResponse(message) {
        try {
            const responseData = message.data;
            const { requestId, data } = responseData;
            const handler = this.responseHandlers.get(requestId);
            if (!handler) {
                if (requestId && !requestId.startsWith('init_') && !requestId.startsWith('test_')) {
                    logger.debug({ requestId, messageId: message.id }, 'Response received but handler already processed or timed out');
                }
                return;
            }
            clearTimeout(handler.timeout);
            this.responseHandlers.delete(requestId);
            try {
                const parsedData = JSON.parse(data);
                handler.resolve(parsedData);
            }
            catch (parseError) {
                handler.reject(new Error(`Failed to parse response data: ${parseError}`));
            }
        }
        catch (error) {
            logger.error({
                error,
                messageId: message.id,
                messageData: message.data
            }, 'Failed to handle response message');
        }
    }
}
