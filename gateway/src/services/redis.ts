import { createClient } from 'redis';
import { Counter } from 'prom-client';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';

export interface RedisServiceContext {
  redisPub: ReturnType<typeof createClient>;
  redisSub: ReturnType<typeof createClient>;
  redisPubCounter: Counter<string>;
}

export function createRedisClients(): {
  redisPub: ReturnType<typeof createClient>;
  redisSub: ReturnType<typeof createClient>;
} {
  const redisPub = createClient({
    url: env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
    },
  });

  const redisSub = createClient({
    url: env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
    },
  });

  redisPub.on('error', (err) => {
    logger.error({ error: err }, 'Redis publish client error');
  });

  redisSub.on('error', (err) => {
    logger.error({ error: err }, 'Redis subscribe client error');
  });

  redisPub.on('connect', () => {
    logger.info('Redis publish client connected');
  });

  redisSub.on('connect', () => {
    logger.info('Redis subscribe client connected');
  });

  return { redisPub, redisSub };
}

export function createRedisPubCounter(): Counter<string> {
  return new Counter({
    name: 'redis_pub_messages_total',
    help: 'Total number of Redis publish messages',
    labelNames: ['channel'],
  });
}

export async function connectRedis(): Promise<RedisServiceContext> {
  const { redisPub, redisSub } = createRedisClients();
  const redisPubCounter = createRedisPubCounter();

  try {
    await Promise.all([
      redisPub.connect(),
      redisSub.connect(),
    ]);

    logger.info('Redis clients connected successfully');

    return {
      redisPub,
      redisSub,
      redisPubCounter,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to connect to Redis');
    throw error;
  }
}

export async function disconnectRedis(context: RedisServiceContext): Promise<void> {
  try {
    await Promise.all([
      context.redisPub.quit(),
      context.redisSub.quit(),
    ]);
    logger.info('Redis clients disconnected');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting Redis clients');
  }
}