// Simple per-guild mutex to serialize queue/player mutations.
// Design: a Map<guildId, Promise<void>> acts as a chain. Each run() attaches
// a new promise to the end of the chain ensuring FIFO execution.

import Redis from 'ioredis';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';

export type GuildMutexTask<T> = () => Promise<T> | T;

class GuildMutex {
  private chains = new Map<string, Promise<void>>();
  private readonly redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 100, 1000)
  });

  private readonly lockPrefix = 'discord-bot:guild-mutex:';
  private readonly defaultLockTtlMs = 30000;
  private readonly maxAcquireAttempts = 8;

  constructor() {
    this.redis.on('error', (error) => {
      logger.warn({ error }, 'guildMutex: distributed lock redis error, using local lock fallback');
    });
  }

  // Method to clear all state - useful for testing
  public clearAll(): void {
    this.chains.clear();
  }

  private async acquireDistributedLock(guildId: string): Promise<{ key: string; token: string } | null> {
    const key = `${this.lockPrefix}${guildId}`;
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    try {
      if (this.redis.status !== 'ready' && this.redis.status !== 'connecting') {
        await this.redis.connect();
      }
    } catch (error) {
      logger.warn({ error, guildId }, 'guildMutex: could not connect to redis lock backend');
      return null;
    }

    for (let attempt = 1; attempt <= this.maxAcquireAttempts; attempt += 1) {
      try {
        const acquired = await this.redis.set(key, token, 'PX', this.defaultLockTtlMs, 'NX');
        if (acquired === 'OK') {
          return { key, token };
        }
      } catch (error) {
        logger.warn({ error, guildId, attempt }, 'guildMutex: distributed lock acquisition attempt failed');
        return null;
      }
      // Small jitter to reduce lock contention under multi-node load.
      const backoff = Math.min(500, 25 * attempt) + Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    logger.warn({ guildId }, 'guildMutex: lock contention detected, executing with local-only lock');
    return null;
  }

  private async releaseDistributedLock(lock: { key: string; token: string } | null): Promise<void> {
    if (!lock) return;
    const releaseScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    try {
      await this.redis.eval(releaseScript, 1, lock.key, lock.token);
    } catch (error) {
      logger.warn({ error, lockKey: lock.key }, 'guildMutex: failed to release distributed lock');
    }
  }

  async run<T>(guildId: string, task: GuildMutexTask<T>): Promise<T> {
    // Get the current chain promise for this guild
    const previousPromise = this.chains.get(guildId) || Promise.resolve();

    // Create a promise for this task that will resolve when the task completes
    let resolveThisTask: () => void;
    const thisTaskPromise = new Promise<void>((resolve) => {
      resolveThisTask = resolve;
    });

    // Chain this task promise after the previous one
    this.chains.set(guildId, previousPromise.then(() => thisTaskPromise));

    // Wait for the previous task to complete, then run our task
    const distributedLock = await this.acquireDistributedLock(guildId);
    try {
      await previousPromise;
      const result = await task();
      return result;
    } finally {
      await this.releaseDistributedLock(distributedLock);
      // Mark this task as complete so the next one can run
      resolveThisTask!();
    }
  }
}

export const guildMutex = new GuildMutex();
