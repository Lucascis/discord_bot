/**
 * Shared Redis Connection for Worker Service
 *
 * Centralized Redis client configuration for BullMQ and pub/sub
 * Following existing architecture patterns from other services
 */

import Redis from 'ioredis';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';

/**
 * Redis connection options
 */
// Parse Redis URL for connection options
const redisUrl = new URL(env.REDIS_URL);

const redisOptions = {
  host: redisUrl.hostname || 'localhost',
  port: parseInt(redisUrl.port) || 6379,
  db: 0,
  maxRetriesPerRequest: null, // Required by BullMQ
  retryDelayOnFailover: 100,
  lazyConnect: true,
  enableReadyCheck: true,
  maxLoadingTimeout: 5000,
};

/**
 * Main Redis client for BullMQ
 */
export const redisClient = new Redis(redisOptions);

/**
 * Separate Redis client for pub/sub operations
 * BullMQ recommends separate connections for different operations
 */
export const redisPubSub = new Redis(redisOptions);

/**
 * Redis client for blocking operations
 */
export const redisBlocking = new Redis(redisOptions);

/**
 * Connection event handlers
 */
redisClient.on('connect', () => {
  logger.info('[Worker] Redis client connected');
});

redisClient.on('ready', () => {
  logger.info('[Worker] Redis client ready');
});

redisClient.on('error', (error) => {
  logger.error({ error: error.message }, '[Worker] Redis client error');
});

redisClient.on('close', () => {
  logger.warn('[Worker] Redis client connection closed');
});

redisClient.on('reconnecting', () => {
  logger.info('[Worker] Redis client reconnecting');
});

redisPubSub.on('connect', () => {
  logger.info('[Worker] Redis pub/sub client connected');
});

redisPubSub.on('error', (error) => {
  logger.error({ error: error.message }, '[Worker] Redis pub/sub client error');
});

redisBlocking.on('connect', () => {
  logger.info('[Worker] Redis blocking client connected');
});

redisBlocking.on('error', (error) => {
  logger.error({ error: error.message }, '[Worker] Redis blocking client error');
});

/**
 * Initialize Redis connections
 */
export async function initializeRedis(): Promise<void> {
  try {
    // Check if already connected before attempting connection
    const connectionPromises = [];

    if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
      connectionPromises.push(redisClient.connect());
    }

    if (redisPubSub.status !== 'ready' && redisPubSub.status !== 'connecting') {
      connectionPromises.push(redisPubSub.connect());
    }

    if (redisBlocking.status !== 'ready' && redisBlocking.status !== 'connecting') {
      connectionPromises.push(redisBlocking.connect());
    }

    if (connectionPromises.length > 0) {
      await Promise.all(connectionPromises);
    }

    logger.info('[Worker] All Redis connections initialized successfully');
  } catch (error) {
    logger.error({ error }, '[Worker] Failed to initialize Redis connections');
    throw error;
  }
}

/**
 * Gracefully close Redis connections
 */
export async function closeRedis(): Promise<void> {
  try {
    await Promise.all([
      redisClient.quit(),
      redisPubSub.quit(),
      redisBlocking.quit()
    ]);

    logger.info('[Worker] All Redis connections closed gracefully');
  } catch (error) {
    logger.error({ error }, '[Worker] Error closing Redis connections');
    throw error;
  }
}

/**
 * Health check for Redis connections
 */
export async function checkRedisHealth(): Promise<{
  healthy: boolean;
  details: Record<string, unknown>;
}> {
  try {
    const results = await Promise.allSettled([
      redisClient.ping(),
      redisPubSub.ping(),
      redisBlocking.ping()
    ]);

    const mainStatus = results[0].status === 'fulfilled';
    const pubSubStatus = results[1].status === 'fulfilled';
    const blockingStatus = results[2].status === 'fulfilled';

    const healthy = mainStatus && pubSubStatus && blockingStatus;

    return {
      healthy,
      details: {
        main: mainStatus ? 'connected' : 'disconnected',
        pubSub: pubSubStatus ? 'connected' : 'disconnected',
        blocking: blockingStatus ? 'connected' : 'disconnected',
        errors: results
          .filter(result => result.status === 'rejected')
          .map(result => (result as PromiseRejectedResult).reason)
      }
    };
  } catch (error) {
    logger.error({ error }, '[Worker] Redis health check failed');
    return {
      healthy: false,
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

/**
 * Get Redis info for monitoring
 */
export async function getRedisInfo(): Promise<Record<string, unknown>> {
  try {
    const info = await redisClient.info();
    const memory = await redisClient.info('memory');
    const stats = await redisClient.info('stats');

    return {
      server: info,
      memory,
      stats,
      keyspace: await redisClient.info('keyspace')
    };
  } catch (error) {
    logger.error({ error }, '[Worker] Failed to get Redis info');
    return { error: error instanceof Error ? error.message : String(error) };
  }
}