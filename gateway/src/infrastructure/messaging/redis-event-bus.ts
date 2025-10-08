/**
 * Redis Event Bus
 * Handles inter-service communication via Redis pub/sub
 */

import { logger } from '@discord-bot/logger';

export interface EventBus {
  publish(channel: string, data: any): Promise<void>;
  subscribe(channel: string, handler: (data: any) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}

export class RedisEventBus implements EventBus {
  private subscribers: Map<string, (data: any) => void> = new Map();

  constructor(private readonly redisClient: any) {}

  async publish(channel: string, data: any): Promise<void> {
    try {
      const message = JSON.stringify(data);
      await this.redisClient.publish(channel, message);

      logger.debug({
        channel,
        dataType: typeof data,
        messageSize: message.length
      }, 'Published message to Redis');
    } catch (error) {
      logger.error({ error, channel }, 'Failed to publish message to Redis');
      throw error;
    }
  }

  async subscribe(channel: string, handler: (data: any) => void): Promise<void> {
    try {
      this.subscribers.set(channel, handler);

      await this.redisClient.subscribe(channel, (message: string) => {
        try {
          const data = JSON.parse(message);
          handler(data);
        } catch (parseError) {
          logger.error({ parseError, channel, message }, 'Failed to parse Redis message');
        }
      });

      logger.info({ channel }, 'Subscribed to Redis channel');
    } catch (error) {
      logger.error({ error, channel }, 'Failed to subscribe to Redis channel');
      throw error;
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    try {
      await this.redisClient.unsubscribe(channel);
      this.subscribers.delete(channel);

      logger.info({ channel }, 'Unsubscribed from Redis channel');
    } catch (error) {
      logger.error({ error, channel }, 'Failed to unsubscribe from Redis channel');
      throw error;
    }
  }

  async dispose(): Promise<void> {
    try {
      for (const channel of this.subscribers.keys()) {
        await this.unsubscribe(channel);
      }

      logger.info('Redis event bus disposed');
    } catch (error) {
      logger.error({ error }, 'Error disposing Redis event bus');
      throw error;
    }
  }
}