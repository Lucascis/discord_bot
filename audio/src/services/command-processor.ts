import { redisStreams, RedisStreamsManager, StreamMessage, StreamCommandData, StreamResponseData, audioStreamsMonitoring } from '@discord-bot/cache';
import { logger } from '@discord-bot/logger';

export interface CommandProcessorOptions {
  concurrency?: number;
  retryAttempts?: number;
}

/**
 * Command Processor Service using Redis Streams
 * Processes commands from Gateway service and sends responses back
 */
export class CommandProcessor {
  private consumerName = `audio-${process.pid}-${Date.now()}`;
  private isInitialized = false;
  private commandHandlers = new Map<string, (data: StreamCommandData) => Promise<any>>();

  constructor(private options: CommandProcessorOptions = {}) {
    // Bind methods to preserve context
    this.handleCommand = this.handleCommand.bind(this);
  }

  /**
   * Initialize the service and start command consumer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Ensure Redis Streams is connected
      await redisStreams.connect();

      // Start command consumer
      await redisStreams.startConsumer(
        RedisStreamsManager.STREAMS.AUDIO_COMMANDS,
        RedisStreamsManager.CONSUMER_GROUPS.AUDIO_PROCESSORS,
        this.consumerName,
        this.handleCommand,
        { count: this.options.concurrency || 5, block: 1000 }
      );

      this.isInitialized = true;
      logger.info({ consumerName: this.consumerName }, 'CommandProcessor initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize CommandProcessor');
      throw error;
    }
  }

  /**
   * Register a command handler
   */
  registerHandler(commandType: string, handler: (data: StreamCommandData) => Promise<any>): void {
    this.commandHandlers.set(commandType, handler);
    logger.debug({ commandType }, 'Registered command handler');
  }

  /**
   * Handle incoming command messages from Redis Streams
   */
  private async handleCommand(message: StreamMessage): Promise<void> {
    try {
      const commandData: StreamCommandData = message.data as StreamCommandData;
      const { type, requestId, guildId } = commandData;

      // Validate command data - ensure type field exists
      if (!type) {
        logger.warn({
          messageId: message.id,
          messageData: message.data,
          type,
          requestId
        }, 'Invalid command: missing type field');
        if (requestId) {
          await this.sendErrorResponse(requestId, `Invalid command: missing type field`);
        }
        return;
      }

      // Skip system initialization messages (used only for stream creation)
      if (type === 'SYSTEM_INITIALIZATION') {
        logger.debug({ messageId: message.id, type }, 'Skipping system initialization message');
        return;
      }

      logger.debug({
        messageId: message.id,
        type,
        requestId,
        guildId
      }, 'Processing command from stream');

      // Find command handler
      const handler = this.commandHandlers.get(type);
      if (!handler) {
        logger.warn({ type, requestId }, 'No handler found for command type');
        await this.sendErrorResponse(requestId, `Unknown command type: ${type}`);
        return;
      }

      // Record processing start time
      const startTime = Date.now();

      try {
        // Execute command handler
        const result = await handler(commandData);

        // Record successful processing metrics
        const durationSeconds = (Date.now() - startTime) / 1000;
        audioStreamsMonitoring.recordCommandProcessingTime(type, 'success', durationSeconds);

        // Send success response
        await this.sendResponse(requestId, result);

        logger.debug({
          type,
          requestId,
          guildId,
          messageId: message.id,
          durationMs: Date.now() - startTime
        }, 'Command processed successfully');

      } catch (handlerError) {
        // Record error processing metrics
        const durationSeconds = (Date.now() - startTime) / 1000;
        audioStreamsMonitoring.recordCommandProcessingTime(type, 'error', durationSeconds);
        audioStreamsMonitoring.recordConsumerError(
          RedisStreamsManager.STREAMS.AUDIO_COMMANDS,
          RedisStreamsManager.CONSUMER_GROUPS.AUDIO_PROCESSORS,
          'handler_error'
        );

        logger.error({
          error: handlerError,
          type,
          requestId,
          guildId,
          messageId: message.id,
          durationMs: Date.now() - startTime
        }, 'Command handler failed');

        await this.sendErrorResponse(requestId, `Command failed: ${(handlerError as Error).message}`);
      }

    } catch (error) {
      logger.error({
        error,
        messageId: message.id,
        messageData: message.data
      }, 'Failed to process command message');
    }
  }

  /**
   * Send successful response back to Gateway
   */
  private async sendResponse(requestId: string, data: any): Promise<void> {
    try {
      const responseData: StreamResponseData = {
        requestId,
        data: JSON.stringify(data),
        timestamp: Date.now().toString()
      };

      await redisStreams.addToStream(RedisStreamsManager.STREAMS.AUDIO_RESPONSES, responseData);

      // Record message added to stream
      audioStreamsMonitoring.recordMessageAdded(RedisStreamsManager.STREAMS.AUDIO_RESPONSES);

      logger.debug({ requestId }, 'Response sent successfully');
    } catch (error) {
      logger.error({ error, requestId }, 'Failed to send response');
    }
  }

  /**
   * Send error response back to Gateway
   */
  private async sendErrorResponse(requestId: string, errorMessage: string): Promise<void> {
    try {
      const responseData: StreamResponseData = {
        requestId,
        data: JSON.stringify({ error: errorMessage }),
        timestamp: Date.now().toString()
      };

      await redisStreams.addToStream(RedisStreamsManager.STREAMS.AUDIO_RESPONSES, responseData);

      logger.debug({ requestId, errorMessage }, 'Error response sent');
    } catch (error) {
      logger.error({ error, requestId, errorMessage }, 'Failed to send error response');
    }
  }

  /**
   * Get service statistics for monitoring
   */
  getStats(): {
    registeredHandlers: number;
    isInitialized: boolean;
    consumerName: string;
  } {
    return {
      registeredHandlers: this.commandHandlers.size,
      isInitialized: this.isInitialized,
      consumerName: this.consumerName
    };
  }

  /**
   * Shutdown the service and clean up resources
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down CommandProcessor...');

    // Clear handlers
    this.commandHandlers.clear();

    // Stop consumer
    const consumerKey = `${RedisStreamsManager.STREAMS.AUDIO_COMMANDS}:${RedisStreamsManager.CONSUMER_GROUPS.AUDIO_PROCESSORS}:${this.consumerName}`;
    redisStreams.stopConsumer(consumerKey);

    this.isInitialized = false;
    logger.info('CommandProcessor shutdown complete');
  }
}

// Export singleton instance
export const commandProcessor = new CommandProcessor();