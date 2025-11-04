/**
 * Distributed locks using Redlock algorithm for preventing race conditions
 */

import Redlock, { Lock, Settings } from 'redlock';
import { Cluster } from 'ioredis';
import { logger } from '@discord-bot/logger';
import { Counter, Histogram } from 'prom-client';

const lockAcquisitionsTotal = new Counter({
  name: 'cluster_lock_acquisitions_total',
  help: 'Total number of lock acquisition attempts',
  labelNames: ['resource', 'status']
});

const lockDurationSeconds = new Histogram({
  name: 'cluster_lock_duration_seconds',
  help: 'Duration of held locks',
  labelNames: ['resource'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

const lockWaitTimeSeconds = new Histogram({
  name: 'cluster_lock_wait_time_seconds',
  help: 'Time spent waiting to acquire locks',
  labelNames: ['resource'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]
});

export interface DistributedLockConfig {
  ttl: number; // Lock TTL in milliseconds
  retryDelay: number; // Delay between retry attempts
  retryCount: number; // Number of retries before giving up
  driftFactor?: number; // Clock drift factor (default: 0.01)
  retryJitter?: number; // Random jitter to prevent thundering herd (default: 200ms)
}

/**
 * Distributed lock manager using Redlock algorithm
 */
export class DistributedLockManager {
  private redlock: Redlock;
  private config: Required<DistributedLockConfig>;

  constructor(redisCluster: Cluster, config: DistributedLockConfig) {
    this.config = {
      ...config,
      driftFactor: config.driftFactor ?? 0.01,
      retryJitter: config.retryJitter ?? 200
    };

    const settings: Partial<Settings> = {
      driftFactor: this.config.driftFactor,
      retryCount: this.config.retryCount,
      retryDelay: this.config.retryDelay,
      retryJitter: this.config.retryJitter,
      automaticExtensionThreshold: 500 // Auto-extend if less than 500ms remaining
    };

    this.redlock = new Redlock([redisCluster], settings);

    this.redlock.on('error', (error: Error) => {
      logger.error({ error, component: 'DistributedLockManager' }, 'Redlock error');
    });
  }

  /**
   * Acquire a lock for a resource
   */
  async acquire(resource: string, ttl?: number): Promise<Lock> {
    const lockTTL = ttl ?? this.config.ttl;
    const startTime = Date.now();

    try {
      const lock = await this.redlock.acquire([resource], lockTTL);

      const waitTime = (Date.now() - startTime) / 1000;
      lockWaitTimeSeconds.labels(resource).observe(waitTime);
      lockAcquisitionsTotal.labels(resource, 'success').inc();

      logger.debug(
        { resource, ttl: lockTTL, waitTime },
        'Lock acquired'
      );

      return lock;
    } catch (error) {
      lockAcquisitionsTotal.labels(resource, 'failure').inc();
      logger.warn(
        { error, resource, ttl: lockTTL },
        'Failed to acquire lock'
      );
      throw error;
    }
  }

  /**
   * Try to acquire a lock without retrying
   */
  async tryAcquire(resource: string, ttl?: number): Promise<Lock | null> {
    const lockTTL = ttl ?? this.config.ttl;

    try {
      const lock = await this.redlock.acquire([resource], lockTTL, {
        retryCount: 0
      });

      lockAcquisitionsTotal.labels(resource, 'success').inc();
      return lock;
    } catch (error) {
      lockAcquisitionsTotal.labels(resource, 'failure').inc();
      return null;
    }
  }

  /**
   * Release a lock
   */
  async release(lock: Lock): Promise<void> {
    const startTime = Date.now();

    try {
      await lock.release();

      const duration = (Date.now() - startTime) / 1000;
      lockDurationSeconds.labels(lock.resources[0]).observe(duration);

      logger.debug(
        { resource: lock.resources[0], duration },
        'Lock released'
      );
    } catch (error) {
      logger.warn(
        { error, resource: lock.resources[0] },
        'Failed to release lock'
      );
      throw error;
    }
  }

  /**
   * Extend a lock's TTL
   */
  async extend(lock: Lock, ttl: number): Promise<Lock> {
    try {
      const extendedLock = await lock.extend(ttl);

      logger.debug(
        { resource: lock.resources[0], ttl },
        'Lock extended'
      );

      return extendedLock;
    } catch (error) {
      logger.warn(
        { error, resource: lock.resources[0], ttl },
        'Failed to extend lock'
      );
      throw error;
    }
  }

  /**
   * Execute a function with a lock
   */
  async withLock<T>(
    resource: string,
    fn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const lock = await this.acquire(resource, ttl);

    try {
      const result = await fn();
      return result;
    } finally {
      await this.release(lock);
    }
  }

  /**
   * Execute a function with a lock, return null if lock cannot be acquired
   */
  async tryWithLock<T>(
    resource: string,
    fn: () => Promise<T>,
    ttl?: number
  ): Promise<T | null> {
    const lock = await this.tryAcquire(resource, ttl);
    if (!lock) {
      return null;
    }

    try {
      const result = await fn();
      return result;
    } finally {
      await this.release(lock);
    }
  }

  /**
   * Quit the lock manager
   */
  async quit(): Promise<void> {
    await this.redlock.quit();
    logger.info('DistributedLockManager shut down');
  }
}

/**
 * Helper function to create lock resources with consistent naming
 */
export const createLockResource = {
  guild: (guildId: string) => `lock:guild:${guildId}`,
  instance: (instanceId: string) => `lock:instance:${instanceId}`,
  migration: (guildId: string) => `lock:migration:${guildId}`,
  rebalance: () => 'lock:rebalance',
  assignment: () => 'lock:assignment'
};
