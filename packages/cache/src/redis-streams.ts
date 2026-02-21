import Redis from 'ioredis';
import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';

export interface StreamMessage {
  id: string;
  data: Record<string, string>;
}

export interface StreamCommandData {
  type: string;
  guildId: string;
  requestId: string;
  timestamp: string;
  [key: string]: string;
}

export interface StreamResponseData {
  requestId: string;
  data: string;
  timestamp: string;
  [key: string]: string;
}

/**
 * Redis Streams Configuration for Microservices Communication
 * Provides reliable message delivery with at-least-once semantics
 */
export class RedisStreamsManager {
  private client: Redis;
  private isConnected = false;
  private consumers = new Map<string, AbortController>();

  // Stream names
  public static readonly STREAMS = {
    AUDIO_COMMANDS: 'discord-bot:audio-commands',
    AUDIO_CONTROLS: 'discord-bot:audio-controls',
    AUDIO_REALTIME_CONTROLS: 'discord-bot:audio-controls-realtime',
    VOICE_EVENTS: 'discord-bot:voice-events-stream',
    AUDIO_RESPONSES: 'discord-bot:audio-responses',
    GATEWAY_COMMANDS: 'discord-bot:gateway-commands',
    GATEWAY_RESPONSES: 'discord-bot:gateway-responses'
  } as const;

  // Consumer group names
  public static readonly CONSUMER_GROUPS = {
    AUDIO_PROCESSORS: 'audio-processors',
    AUDIO_CONTROLS_PROCESSORS: 'audio-controls-processors',
    AUDIO_REALTIME_CONTROLS_PROCESSORS: 'audio-realtime-controls-processors',
    VOICE_EVENT_PROCESSORS: 'voice-event-processors',
    GATEWAY_PROCESSORS: 'gateway-processors',
    RESPONSE_HANDLERS: 'response-handlers'
  } as const;

  constructor() {
    this.client = new Redis(env.REDIS_URL, {
      connectTimeout: 5000,
      keepAlive: 5000,
      noDelay: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(times * 100, 3000)
    });

    this.client.on('error', (error) => {
      logger.error({ error }, 'Redis Streams client error');
    });

    this.client.on('ready', () => {
      logger.info('Redis Streams client connected');
      this.isConnected = true;
    });

    this.client.on('end', () => {
      logger.warn('Redis Streams client disconnected');
      this.isConnected = false;
    });
  }

  /**
   * Connect to Redis and initialize streams and consumer groups
   */
  async connect(): Promise<void> {
    const status = this.client.status as string;
    if (this.isConnected || status === 'ready') {
      logger.debug('Redis Streams manager already connected');
      return;
    }

    try {
      if (status !== 'ready' && status !== 'connecting') {
        await this.client.connect();
      }
      await this.initializeStreamsAndGroups();
      logger.info('Redis Streams manager initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to connect Redis Streams manager');
      throw error;
    }
  }

  /**
   * Initialize streams and consumer groups
   * Creates streams and groups if they don't exist
   */
  private async initializeStreamsAndGroups(): Promise<void> {
    const streams = Object.values(RedisStreamsManager.STREAMS);
    const groups = Object.values(RedisStreamsManager.CONSUMER_GROUPS);

    for (const stream of streams) {
      try {
        // Create stream by adding a dummy message if it doesn't exist
        await this.client.xadd(
          stream,
          '*',
          'type',
          'SYSTEM_INITIALIZATION',
          'initialized',
          Date.now().toString()
        );

        // Create consumer groups for this stream
        for (const group of groups) {
          try {
            await this.client.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
            logger.debug({ stream, group }, 'Created consumer group');
          } catch (error) {
            // Group might already exist - that's ok
            if (!(error as Error).message.includes('BUSYGROUP')) {
              logger.warn({ error, stream, group }, 'Failed to create consumer group');
            }
          }
        }
      } catch (error) {
        logger.error({ error, stream }, 'Failed to initialize stream');
      }
    }
  }

  /**
   * Add a message to a stream
   */
  async addToStream(streamName: string, data: Record<string, string>): Promise<string> {
    if (!this.isConnected) {
      throw new Error('Redis Streams client not connected');
    }

    try {
      const fields = Object.entries(data).flatMap(([key, value]) => [key, value]);
      const messageId = await this.client.xadd(streamName, '*', ...fields);
      if (!messageId) {
        throw new Error('Failed to add message to stream');
      }
      logger.debug({ streamName, messageId, dataKeys: Object.keys(data) }, 'Added message to stream');
      return messageId;
    } catch (error) {
      logger.error({ error, streamName, data }, 'Failed to add message to stream');
      throw error;
    }
  }

  /**
   * Read messages from a stream using consumer group
   */
  async readFromStreamGroup(
    streamName: string,
    groupName: string,
    consumerName: string,
    options: {
      count?: number;
      block?: number;
    } = {}
  ): Promise<StreamMessage[]> {
    if (!this.isConnected) {
      throw new Error('Redis Streams client not connected');
    }

    try {
      const { count = 10, block = 5000 } = options;

      const result = await this.client.xreadgroup(
        'GROUP',
        groupName,
        consumerName,
        'COUNT',
        count,
        'BLOCK',
        block,
        'STREAMS',
        streamName,
        '>'
      );

      if (!result || result.length === 0) {
        return [];
      }

      const messages: StreamMessage[] = [];
      for (const [_stream, entries] of result as Array<[string, Array<[string, Array<string | null>]>]>) {
        for (const [id, fields] of entries) {
          const data: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            const key = fields[i];
            if (!key) {
              continue;
            }
            data[String(key)] = fields[i + 1] ?? '';
          }
          messages.push({
            id,
            data
          });
        }
      }

      return messages;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NOGROUP') || message.includes('no such key')) {
        logger.warn({ streamName, groupName, consumerName }, 'Consumer group missing during read; recreating group');
        await this.ensureConsumerGroup(streamName, groupName);
        return [];
      }
      logger.error({ error, streamName, groupName, consumerName }, 'Failed to read from stream group');
      throw error;
    }
  }

  private async ensureConsumerGroup(streamName: string, groupName: string): Promise<void> {
    try {
      await this.client.xgroup('CREATE', streamName, groupName, '0', 'MKSTREAM');
      logger.info({ streamName, groupName }, 'Recreated missing consumer group');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('BUSYGROUP')) {
        logger.error({ error, streamName, groupName }, 'Failed to recreate consumer group');
      }
    }
  }

  /**
   * Acknowledge message processing
   */
  async acknowledgeMessage(streamName: string, groupName: string, messageId: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Redis Streams client not connected');
    }

    try {
      await this.client.xack(streamName, groupName, messageId);
      logger.debug({ streamName, groupName, messageId }, 'Acknowledged message');
    } catch (error) {
      logger.error({ error, streamName, groupName, messageId }, 'Failed to acknowledge message');
      throw error;
    }
  }

  /**
   * Get stream information for monitoring
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getStreamInfo(streamName: string): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Redis Streams client not connected');
    }

    try {
      return await this.client.xinfo('STREAM', streamName);
    } catch (error) {
      logger.error({ error, streamName }, 'Failed to get stream info');
      throw error;
    }
  }

  /**
   * Get consumer group information for monitoring
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getGroupInfo(streamName: string): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Redis Streams client not connected');
    }

    try {
      return await this.client.xinfo('GROUPS', streamName);
    } catch (error) {
      logger.error({ error, streamName }, 'Failed to get group info');
      throw error;
    }
  }

  /**
   * Get pending messages for a consumer group
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPendingMessages(streamName: string, groupName: string): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Redis Streams client not connected');
    }

    try {
      return await this.client.xpending(streamName, groupName);
    } catch (error) {
      logger.error({ error, streamName, groupName }, 'Failed to get pending messages');
      throw error;
    }
  }

  /**
   * Start a consumer for continuous message processing
   */
  async startConsumer(
    streamName: string,
    groupName: string,
    consumerName: string,
    processor: (message: StreamMessage) => Promise<void>,
    options: { count?: number; block?: number } = {}
  ): Promise<void> {
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
            if (abortController.signal.aborted) break;

            try {
              await processor(message);
              await this.acknowledgeMessage(streamName, groupName, message.id);
            } catch (error) {
              logger.error({ error, messageId: message.id, streamName }, 'Failed to process message');
              // Message will remain in pending list for retry
            }
          }
        } catch (error) {
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
  stopConsumer(consumerKey: string): void {
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
  async disconnect(): Promise<void> {
    // Stop all consumers
    for (const [_key, controller] of this.consumers) {
      controller.abort();
    }
    this.consumers.clear();

    // Disconnect client
    if (this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis Streams manager disconnected');
    }
  }

  /**
   * Get consumer group information for monitoring
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getConsumerGroupInfo(streamName: string, groupName: string): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Redis Streams client not connected');
    }

    try {
      const groups = await this.client.xinfo('GROUPS', streamName);
      if (!groups) {
        return null;
      }
      const parsedGroups = (groups as Array<Array<unknown>>).map((group) => {
        const groupData: Record<string, unknown> = {};
        for (let i = 0; i < group.length; i += 2) {
          groupData[String(group[i])] = group[i + 1];
        }
        return groupData;
      });
      return parsedGroups.find((group) => group.name === groupName) || null;
    } catch (error) {
      logger.debug({ error, streamName, groupName }, 'Failed to get consumer group info - group may not exist');
      return null;
    }
  }

  /**
   * Get the underlying Redis client for advanced operations
   */
  getClient(): Redis {
    return this.client;
  }
}

// Export singleton instance
export const redisStreams = new RedisStreamsManager();
