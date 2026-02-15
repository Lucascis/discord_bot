/**
 * Redis Event Bus
 * Handles inter-service communication via Redis pub/sub
 */

import { logger } from '@discord-bot/logger';
import type Redis from 'ioredis';

export interface EventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publish(channel: string, data: any): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe(channel: string, handler: (data: any) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}

export class RedisEventBus implements EventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private subscribers: Map<string, (data: any) => void> = new Map();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly redisClient: Redis) {
    this.publisher = redisClient;
    this.subscriber = redisClient.duplicate();

    this.subscriber.on('message', (channel: string, message: string) => {
      const handler = this.subscribers.get(channel);
      if (!handler) {
        return;
      }
      try {
        const data = JSON.parse(message);
        handler(data);
      } catch (parseError) {
        logger.error({ parseError, channel, message }, 'Failed to parse Redis message');
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async publish(channel: string, data: any): Promise<void> {
    try {
      const message = JSON.stringify(data);
      await this.publisher.publish(channel, message);

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async subscribe(channel: string, handler: (data: any) => void): Promise<void> {
    try {
      this.subscribers.set(channel, handler);

      const status = this.subscriber.status as string;
      if (status !== 'ready' && status !== 'connecting') {
        await this.subscriber.connect();
      }

      await this.subscriber.subscribe(channel);

      logger.info({ channel }, 'Subscribed to Redis channel');
    } catch (error) {
      logger.error({ error, channel }, 'Failed to subscribe to Redis channel');
      throw error;
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    try {
      await this.subscriber.unsubscribe(channel);
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

      await this.subscriber.quit();
      logger.info('Redis event bus disposed');
    } catch (error) {
      logger.error({ error }, 'Error disposing Redis event bus');
      throw error;
    }
  }
}
