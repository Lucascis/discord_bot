import { redisStreams, RedisStreamsManager, StreamMessage, StreamCommandData, StreamResponseData, gatewayStreamsMonitoring } from '@discord-bot/cache';
import { logger } from '@discord-bot/logger';

export interface AudioCommandOptions {
  timeout?: number;
  retries?: number;
}

export interface QueueCommandResult {
  items: Array<{
    title: string;
    uri?: string;
  }>;
}

/**
 * Audio Command Service using Redis Streams
 * Provides reliable command-response communication with the Audio service
 */
export class AudioCommandService {
  private responseHandlers = new Map<string, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolve: (value: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }>();

  private consumerName = `gateway-${process.pid}-${Date.now()}`;
  private isInitialized = false;

  constructor() {
    // Bind methods to preserve context
    this.handleResponse = this.handleResponse.bind(this);
  }

  /**
   * Initialize the service and start response consumer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Ensure Redis Streams is connected
      await redisStreams.connect();

      // Start response consumer
      await redisStreams.startConsumer(
        RedisStreamsManager.STREAMS.AUDIO_RESPONSES,
        RedisStreamsManager.CONSUMER_GROUPS.RESPONSE_HANDLERS,
        this.consumerName,
        this.handleResponse,
        { count: 10, block: 1000 }
      );

      this.isInitialized = true;
      logger.info({ consumerName: this.consumerName }, 'AudioCommandService initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize AudioCommandService');
      throw error;
    }
  }

  /**
   * Send a queue command to the Audio service
   */
  async sendQueueCommand(guildId: string, options: AudioCommandOptions & { page?: number } = {}): Promise<QueueCommandResult> {
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

  /**
   * Send a simple command to the Audio service (no response expected)
   */
  async sendSimpleCommand(
    type: 'skip' | 'pause' | 'resume' | 'toggle' | 'stop' | 'shuffle' | 'clear',
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

  /**
   * Send a play-related command to the Audio service
   */
  async sendPlayCommand(
    type: 'play' | 'playnow' | 'playnext',
    guildId: string,
    voiceChannelId: string,
    textChannelId: string,
    userId: string,
    query: string,
    options: AudioCommandOptions = {}
  ): Promise<void> {
    const commandData: StreamCommandData = {
      type,
      guildId,
      voiceChannelId,
      textChannelId,
      userId,
      query,
      requestId: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now().toString()
    };

    await this.sendCommandOnly(commandData);
  }

  /**
   * Send a nowplaying command to the Audio service
   */
  async sendNowPlayingCommand(
    guildId: string,
    channelId?: string,
    options: AudioCommandOptions = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const { timeout = 5000, retries = 2 } = options;
    const requestId = `nowplaying_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const commandData: StreamCommandData = {
      type: 'nowplaying',
      guildId,
      channelId,
      requestId,
      timestamp: Date.now().toString()
    };

    return this.sendCommandWithResponse(commandData, timeout, retries);
  }

  /**
   * Send a generic command to the Audio service
   */
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

  /**
   * Send command without waiting for response (fire-and-forget)
   */
  private async sendCommandOnly(commandData: StreamCommandData): Promise<void> {
    try {
      await redisStreams.addToStream(RedisStreamsManager.STREAMS.AUDIO_COMMANDS, commandData);

      // Record metric for monitoring
      gatewayStreamsMonitoring.recordMessageAdded(RedisStreamsManager.STREAMS.AUDIO_COMMANDS);

      logger.debug({
        type: commandData.type,
        guildId: commandData.guildId,
        requestId: commandData.requestId
      }, 'Command sent via Redis Streams (no response expected)');
    } catch (error) {
      logger.error({
        error,
        commandData
      }, 'Failed to send command via Redis Streams');
      throw error;
    }
  }

  /**
   * Send command and wait for response with retry logic
   */
  private async sendCommandWithResponse(
    commandData: StreamCommandData,
    timeout: number,
    maxRetries: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
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

        // Exponential backoff with jitter
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

    throw lastError || new Error('All command attempts failed');
  }

  /**
   * Single attempt to send command and receive response
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async attemptCommand(commandData: StreamCommandData, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.responseHandlers.delete(commandData.requestId);
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      // Store response handler
      this.responseHandlers.set(commandData.requestId, {
        resolve,
        reject,
        timeout: timeoutHandle
      });

      // Send command to stream
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
          // Clean up handler on send failure
          const handler = this.responseHandlers.get(commandData.requestId);
          if (handler) {
            clearTimeout(handler.timeout);
            this.responseHandlers.delete(commandData.requestId);
          }
          reject(error);
        });
    });
  }

  /**
   * Handle response messages from Audio service
   */
  private async handleResponse(message: StreamMessage): Promise<void> {
    try {
      const responseData: StreamResponseData = message.data as StreamResponseData;
      const { requestId, data } = responseData;

      logger.debug({
        requestId,
        messageId: message.id,
        hasData: !!data
      }, 'Received response from audio service');

      // Find waiting handler
      const handler = this.responseHandlers.get(requestId);
      if (!handler) {
        // Only log if this appears to be a real request (not initialization/test messages)
        // Initialization messages have timestamps very close to service start
        if (requestId && !requestId.startsWith('init_') && !requestId.startsWith('test_')) {
          logger.debug({ requestId, messageId: message.id }, 'Response received but handler already processed or timed out');
        }
        return;
      }

      // Clean up handler
      clearTimeout(handler.timeout);
      this.responseHandlers.delete(requestId);

      // Parse and resolve response
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

  /**
   * Get service statistics for monitoring
   */
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

  /**
   * Shutdown the service and clean up resources
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down AudioCommandService...');

    // Clean up pending requests
    for (const handler of this.responseHandlers.values()) {
      clearTimeout(handler.timeout);
      handler.reject(new Error('Service shutting down'));
    }
    this.responseHandlers.clear();

    // Stop consumer
    const consumerKey = `${RedisStreamsManager.STREAMS.AUDIO_RESPONSES}:${RedisStreamsManager.CONSUMER_GROUPS.RESPONSE_HANDLERS}:${this.consumerName}`;
    redisStreams.stopConsumer(consumerKey);

    this.isInitialized = false;
    logger.info('AudioCommandService shutdown complete');
  }
}

// Export singleton instance
export const audioCommandService = new AudioCommandService();