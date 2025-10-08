import Redis from 'ioredis';
import { logger } from '@discord-bot/logger';
import { CircuitBreaker, CircuitBreakerManager, type CircuitBreakerConfig } from './circuit-breaker.js';

export interface RedisCircuitBreakerConfig extends CircuitBreakerConfig {
  redis: {
    retryDelayOnFailover: number;
    maxRetriesPerRequest: number;
    enableReadyCheck: boolean;
    lazyConnect: boolean;
  };
  fallbackCache?: {
    maxSize: number;
    cleanupIntervalMs: number;
  };
}

interface FallbackCacheEntry {
  value: unknown;
  expiry: number;
  lastAccessed: number;
}

export class RedisCircuitBreaker {
  private circuitBreaker: CircuitBreaker;
  private redis: Redis;
  private fallbackCache = new Map<string, FallbackCacheEntry>();
  private fallbackTTL = 300000; // 5 minutes
  private readonly fallbackCacheMaxSize: number;
  private readonly cleanupIntervalMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly name: string,
    private readonly config: RedisCircuitBreakerConfig,
    redisOptions: Record<string, unknown>
  ) {
    this.circuitBreaker = CircuitBreakerManager.getInstance().getCircuit(
      `redis-${name}`,
      config
    );

    // Initialize fallback cache configuration
    this.fallbackCacheMaxSize = config.fallbackCache?.maxSize ?? 100;
    this.cleanupIntervalMs = config.fallbackCache?.cleanupIntervalMs ?? 300000; // 5 minutes

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.redis = new Redis(redisOptions as any);

    this.redis.on('error', (error: Error) => {
      logger.error({
        circuit: this.name,
        error: error.message
      }, 'Redis connection error');
    });

    this.redis.on('connect', () => {
      logger.info({ circuit: this.name }, 'Redis connected');
    });

    this.redis.on('reconnecting', () => {
      logger.warn({ circuit: this.name }, 'Redis reconnecting');
    });

    // Setup periodic cleanup for fallback cache
    this.setupPeriodicCleanup();
  }

  async get(key: string): Promise<string | null> {
    return this.circuitBreaker.execute(
      async () => {
        const result = await this.redis.get(key);
        return result;
      },
      () => this.getFallback(key)
    );
  }

  async set(key: string, value: string, mode?: 'EX', duration?: number): Promise<'OK' | null> {
    return this.circuitBreaker.execute(
      async () => {
        if (mode && duration) {
          return await this.redis.set(key, value, mode, duration);
        }
        return await this.redis.set(key, value);
      },
      () => this.setFallback(key, value, duration)
    );
  }

  async incr(key: string): Promise<number> {
    return this.circuitBreaker.execute(
      async () => {
        return await this.redis.incr(key);
      },
      () => this.incrFallback(key)
    );
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.circuitBreaker.execute(
      async () => {
        return await this.redis.expire(key, seconds);
      },
      () => this.expireFallback(key, seconds)
    );
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.circuitBreaker.execute(
      async () => {
        return await this.redis.publish(channel, message);
      },
      () => {
        logger.warn({
          circuit: this.name,
          channel,
          messageLength: message.length
        }, 'Redis publish failed, message dropped (no fallback available)');
        return 0;
      }
    );
  }

  async ping(): Promise<string> {
    return this.circuitBreaker.execute(
      async () => {
        return await this.redis.ping();
      },
      () => {
        logger.warn({
          circuit: this.name
        }, 'Redis ping failed, returning fallback');
        return 'PONG'; // Fake healthy response for fallback
      }
    );
  }

  async subscribe(channel: string): Promise<void> {
    return this.circuitBreaker.execute(
      async () => {
        await this.redis.subscribe(channel);
      },
      () => {
        logger.warn({
          circuit: this.name,
          channel
        }, 'Redis subscribe failed, no fallback available');
        throw new Error(`Cannot subscribe to ${channel} - Redis circuit breaker is open`);
      }
    );
  }

  private getFallback(key: string): string | null {
    const cached = this.fallbackCache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expiry) {
      this.fallbackCache.delete(key);
      logger.debug({
        circuit: this.name,
        key,
        reason: 'expired'
      }, 'Removed expired entry from fallback cache');
      return null;
    }

    // Update last accessed time for LRU tracking
    cached.lastAccessed = Date.now();

    logger.debug({
      circuit: this.name,
      key,
      source: 'fallback-cache'
    }, 'Using fallback cache value');

    return cached.value as string;
  }

  private setFallback(key: string, value: string, ttlSeconds?: number): 'OK' {
    const now = Date.now();
    const expiry = now + (ttlSeconds ? ttlSeconds * 1000 : this.fallbackTTL);

    // Check if we need to evict entries before adding new one
    if (this.fallbackCache.size >= this.fallbackCacheMaxSize && !this.fallbackCache.has(key)) {
      this.evictLRUEntries(1);
    }

    this.fallbackCache.set(key, {
      value: value as unknown,
      expiry,
      lastAccessed: now
    });

    logger.debug({
      circuit: this.name,
      key,
      ttl: ttlSeconds,
      cacheSize: this.fallbackCache.size,
      maxSize: this.fallbackCacheMaxSize
    }, 'Stored value in fallback cache');

    return 'OK';
  }

  private incrFallback(key: string): number {
    const current = this.getFallback(key);
    const newValue = (current ? parseInt(current, 10) : 0) + 1;
    this.setFallback(key, newValue.toString());
    return newValue;
  }

  private expireFallback(key: string, seconds: number): number {
    const cached = this.fallbackCache.get(key);
    if (!cached) return 0;

    cached.expiry = Date.now() + (seconds * 1000);
    return 1;
  }

  private setupPeriodicCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, this.cleanupIntervalMs);

    logger.debug({
      circuit: this.name,
      intervalMs: this.cleanupIntervalMs
    }, 'Setup periodic fallback cache cleanup');
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let removed = 0;
    const initialSize = this.fallbackCache.size;

    for (const [key, cached] of this.fallbackCache.entries()) {
      if (now > cached.expiry) {
        this.fallbackCache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info({
        circuit: this.name,
        removed,
        initialSize,
        remaining: this.fallbackCache.size,
        operation: 'expired-cleanup'
      }, 'Cleaned up expired fallback cache entries');
    }
  }

  private evictLRUEntries(count: number): void {
    if (this.fallbackCache.size === 0) return;

    // Convert to array and sort by lastAccessed (oldest first)
    const entries = Array.from(this.fallbackCache.entries())
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    let evicted = 0;
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const [key] = entries[i];
      this.fallbackCache.delete(key);
      evicted++;
    }

    if (evicted > 0) {
      logger.info({
        circuit: this.name,
        evicted,
        remaining: this.fallbackCache.size,
        maxSize: this.fallbackCacheMaxSize,
        operation: 'lru-eviction'
      }, 'Evicted LRU entries from fallback cache');
    }
  }

  getMetrics() {
    return {
      ...this.circuitBreaker.getMetrics(),
      fallbackCache: {
        size: this.fallbackCache.size,
        maxSize: this.fallbackCacheMaxSize,
        utilizationPercent: (this.fallbackCache.size / this.fallbackCacheMaxSize) * 100
      },
      redisStatus: this.redis.status
    };
  }

  async disconnect(): Promise<void> {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    await this.redis.disconnect();

    const cacheSize = this.fallbackCache.size;
    this.fallbackCache.clear();

    logger.info({
      circuit: this.name,
      clearedCacheEntries: cacheSize
    }, 'Redis circuit breaker disconnected');
  }
}