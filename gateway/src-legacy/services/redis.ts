import { createClient } from 'redis';
import { Counter } from 'prom-client';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { RedisCircuitBreaker, type RedisCircuitBreakerConfig } from '@discord-bot/cache';

export interface RedisServiceContext {
  redisPub: RedisCircuitBreaker;
  redisSub: ReturnType<typeof createClient>;
  redisPubCounter: Counter<string>;
}

const redisCircuitConfig: RedisCircuitBreakerConfig = {
  failureThreshold: 0.5, // 50% failure rate
  timeout: 30000, // 30 seconds
  monitoringWindow: 60000, // 1 minute
  volumeThreshold: 10, // Minimum 10 requests before evaluation
  redis: {
    retryDelayOnFailover: 1000,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  },
};

export function createRedisClients(): {
  redisPub: RedisCircuitBreaker;
  redisSub: ReturnType<typeof createClient>;
} {
  const redisPub = new RedisCircuitBreaker(
    'gateway-pub',
    redisCircuitConfig,
    {
      host: env.REDIS_URL ? new URL(env.REDIS_URL).hostname : 'localhost',
      port: env.REDIS_URL ? parseInt(new URL(env.REDIS_URL).port) || 6379 : 6379,
      password: env.REDIS_URL ? new URL(env.REDIS_URL).password || undefined : undefined,
      retryDelayOnFailover: 1000,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    }
  );

  const redisSub = createClient({
    url: env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
    },
  });

  redisSub.on('error', (err) => {
    logger.error({ error: err }, 'Redis subscribe client error');
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
    await redisSub.connect();

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
      context.redisPub.disconnect(),
      context.redisSub.quit(),
    ]);
    logger.info('Redis clients disconnected');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting Redis clients');
  }
}