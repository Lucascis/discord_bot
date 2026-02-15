import { redisStreams, RedisStreamsManager, type StreamMessage, type StreamCommandData, type StreamResponseData } from '@discord-bot/cache';
import { logger } from '@discord-bot/logger';

export interface AudioCommandClientOptions {
  consumerNamePrefix?: string;
  monitoring?: {
    onCommandEnqueued?: (stream: string) => void;
  };
  responseBatchSize?: number;
  responseBlockMs?: number;
}

export interface AudioCommandOptions {
  timeout?: number;
  retries?: number;
  requestId?: string;
}

export interface QueueCommandResult {
  items: Array<{
    title: string;
    uri?: string;
  }>;
  page: number;
  totalPages: number;
  totalTracks: number;
}

interface PendingResponseHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (value: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout;
}

export class AudioCommandClient {
  private responseHandlers = new Map<string, PendingResponseHandler>();
  private consumerName: string;
  private isInitialized = false;

  constructor(private readonly options: AudioCommandClientOptions = {}) {
    this.consumerName = `${options.consumerNamePrefix ?? 'audio-client'}-${process.pid}-${Date.now()}`;
    this.handleResponse = this.handleResponse.bind(this);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await redisStreams.connect();
    await redisStreams.startConsumer(
      RedisStreamsManager.STREAMS.AUDIO_RESPONSES,
      RedisStreamsManager.CONSUMER_GROUPS.RESPONSE_HANDLERS,
      this.consumerName,
      this.handleResponse,
      {
        count: this.options.responseBatchSize ?? 10,
        block: this.options.responseBlockMs ?? 1000
      }
    );

    this.isInitialized = true;
    logger.info({ consumerName: this.consumerName }, 'AudioCommandClient initialized successfully');
  }

  async sendQueueCommand(
    guildId: string,
    options: AudioCommandOptions & { page?: number } = {}
  ): Promise<QueueCommandResult> {
    const { timeout = 10000, retries = 2, page = 1 } = options;
    const requestId = `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const commandData: StreamCommandData = {
      type: 'queue',
      guildId,
      requestId,
      timestamp: Date.now().toString(),
      page: page.toString()
    };

    return this.sendCommandWithResponse(commandData, timeout, retries);
  }

  async sendNowPlayingCommand(guildId: string, textChannelId?: string): Promise<void> {
    const commandData: StreamCommandData = {
      type: 'nowplaying',
      guildId,
      requestId: `nowplaying_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now().toString(),
      ...(textChannelId ? { channelId: textChannelId } : {})
    };

    await this.sendCommandOnly(commandData);
  }

  async sendSimpleCommand(
    type: 'skip' | 'pause' | 'resume' | 'toggle' | 'stop' | 'shuffle' | 'clear' | 'previous' | 'mute',
    guildId: string
  ): Promise<void> {
    const commandData: StreamCommandData = {
      type,
      guildId,
      requestId: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now().toString()
    };

    await this.sendCommandOnly(commandData);
  }

  async sendCommand(
    type: string,
    guildId: string,
    additionalData: Record<string, string> = {},
    options: AudioCommandOptions = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const { timeout = 10000, retries = 2 } = options;
    const requestId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const commandData: StreamCommandData = {
      type,
      guildId,
      requestId,
      timestamp: Date.now().toString(),
      ...additionalData
    };

    return this.sendCommandWithResponse(commandData, timeout, retries);
  }

  async sendPlayCommand(
    type: 'play' | 'playnow' | 'playnext',
    guildId: string,
    voiceChannelId: string,
    textChannelId: string,
    userId: string,
    query: string,
    options: AudioCommandOptions = {}
  ): Promise<void> {
    const { timeout: _timeout = 10000, retries: _retries = 2, requestId } = options;

    const commandData: StreamCommandData = {
      type,
      guildId,
      voiceChannelId,
      textChannelId,
      userId,
      query,
      requestId: requestId || `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now().toString()
    };

    // Play commands are fire-and-forget for lower latency; audio service forwards
    // the Redis Stream entry to the pub/sub pipeline and handles delivery.
    await this.sendCommandOnly(commandData);
  }

  getStats(): {
    pendingRequests: number;
    isInitialized: boolean;
    consumerName: string;
  } {
    return {
      pendingRequests: this.responseHandlers.size,
      isInitialized: this.isInitialized,
      consumerName: this.consumerName
    };
  }

  async shutdown(): Promise<void> {
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

  private async sendCommandOnly(commandData: StreamCommandData): Promise<void> {
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

  private async sendCommandWithResponse(
    commandData: StreamCommandData,
    timeout: number,
    maxRetries: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (this.options.monitoring?.onCommandEnqueued) {
          this.options.monitoring.onCommandEnqueued(RedisStreamsManager.STREAMS.AUDIO_COMMANDS);
        }
        return await this.attemptCommand(commandData, timeout);
      } catch (error) {
        lastError = error as Error;

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
          error: (error as Error).message,
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
  private async attemptCommand(commandData: StreamCommandData, timeout: number): Promise<any> {
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

  private async handleResponse(message: StreamMessage): Promise<void> {
    try {
      const responseData: StreamResponseData = message.data as StreamResponseData;
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
      } catch (parseError) {
        handler.reject(new Error(`Failed to parse response data: ${parseError}`));
      }
    } catch (error) {
      logger.error({
        error,
        messageId: message.id,
        messageData: message.data
      }, 'Failed to handle response message');
    }
  }
}
