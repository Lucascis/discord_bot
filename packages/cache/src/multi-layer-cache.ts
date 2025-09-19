import { logger } from '@discord-bot/logger';
import { RedisCircuitBreaker } from './redis-circuit-breaker.js';
import { TTLMap } from './ttl-map.js';

export interface CacheLayerStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
  avgResponseTime: number;
}

export interface MultiLayerCacheConfig {
  memory: {
    maxSize: number;
    defaultTTL: number;
    cleanupInterval: number;
  };
  redis: {
    defaultTTL: number;
    keyPrefix: string;
  };
  preload?: {
    enabled: boolean;
    patterns: string[];
    interval: number;
  };
  compression?: {
    enabled: boolean;
    threshold: number; // Compress if value size > threshold bytes
  };
}

export interface CacheEntry<T> {
  value: T;
  metadata: {
    createdAt: number;
    accessCount: number;
    lastAccessedAt: number;
    size: number;
    compressed: boolean;
  };
}

/**
 * High-performance multi-layer cache with L1 (memory) and L2 (Redis) layers
 * Implements cache-aside pattern with write-through and read-through strategies
 */
export class MultiLayerCache<T = unknown> {
  private readonly l1Cache: TTLMap<string, CacheEntry<T>>;
  private readonly l2Cache: RedisCircuitBreaker;
  private readonly stats = {
    l1: { hits: 0, misses: 0, sets: 0, deletes: 0, responseTimes: [] as number[] },
    l2: { hits: 0, misses: 0, sets: 0, deletes: 0, responseTimes: [] as number[] }
  };
  private readonly config: MultiLayerCacheConfig;
  private preloadTimer?: NodeJS.Timeout;

  constructor(
    name: string,
    l2Cache: RedisCircuitBreaker,
    config: Partial<MultiLayerCacheConfig> = {}
  ) {
    this.config = {
      memory: {
        maxSize: 1000,
        defaultTTL: 300000, // 5 minutes
        cleanupInterval: 60000, // 1 minute
        ...config.memory
      },
      redis: {
        defaultTTL: 3600, // 1 hour in seconds
        keyPrefix: `cache:${name}:`,
        ...config.redis
      },
      preload: config.preload,
      compression: config.compression
    };

    this.l1Cache = new TTLMap<string, CacheEntry<T>>({
      maxSize: this.config.memory.maxSize,
      defaultTTL: this.config.memory.defaultTTL,
      cleanupInterval: this.config.memory.cleanupInterval,
    });

    this.l2Cache = l2Cache;

    // Start preloading if configured
    if (this.config.preload?.enabled) {
      this.startPreloading();
    }

    // Periodic stats reset to prevent overflow
    setInterval(() => this.resetOldStats(), 3600000); // Every hour
  }

  /**
   * Get value from cache with multi-layer lookup
   */
  async get(key: string): Promise<T | null> {
    const startTime = Date.now();

    // L1 lookup (memory)
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry) {
      this.stats.l1.hits++;
      this.stats.l1.responseTimes.push(Date.now() - startTime);

      // Update access metadata
      l1Entry.metadata.accessCount++;
      l1Entry.metadata.lastAccessedAt = Date.now();

      logger.debug({
        key,
        layer: 'L1',
        responseTime: Date.now() - startTime,
        accessCount: l1Entry.metadata.accessCount
      }, 'Cache hit');

      return l1Entry.value;
    }

    this.stats.l1.misses++;

    // L2 lookup (Redis)
    const l2StartTime = Date.now();
    try {
      const redisKey = this.getRedisKey(key);
      const l2Value = await this.l2Cache.get(redisKey);

      if (l2Value) {
        this.stats.l2.hits++;
        this.stats.l2.responseTimes.push(Date.now() - l2StartTime);

        // Deserialize and decompress if needed
        const entry = this.deserializeEntry(l2Value);

        // Promote to L1
        this.l1Cache.set(key, entry, this.config.memory.defaultTTL);

        logger.debug({
          key,
          layer: 'L2',
          responseTime: Date.now() - startTime,
          promoted: true
        }, 'Cache hit');

        return entry.value;
      }
    } catch (error) {
      logger.error({
        key,
        error: error instanceof Error ? error.message : String(error)
      }, 'L2 cache lookup failed');
    }

    this.stats.l2.misses++;
    return null;
  }

  /**
   * Set value in both cache layers
   */
  async set(
    key: string,
    value: T,
    ttl?: number,
    options?: { skipL1?: boolean; skipL2?: boolean }
  ): Promise<void> {
    const startTime = Date.now();
    const entry = this.createEntry(value);

    // Set in L1 (memory)
    if (!options?.skipL1) {
      this.l1Cache.set(key, entry, ttl || this.config.memory.defaultTTL);
      this.stats.l1.sets++;
    }

    // Set in L2 (Redis) - write-through
    if (!options?.skipL2) {
      try {
        const redisKey = this.getRedisKey(key);
        const serialized = this.serializeEntry(entry);
        const redisTTL = Math.ceil((ttl || this.config.memory.defaultTTL) / 1000);

        await this.l2Cache.set(
          redisKey,
          serialized,
          'EX',
          Math.max(redisTTL, this.config.redis.defaultTTL)
        );

        this.stats.l2.sets++;
      } catch (error) {
        logger.error({
          key,
          error: error instanceof Error ? error.message : String(error)
        }, 'Failed to set L2 cache');
      }
    }

    logger.debug({
      key,
      responseTime: Date.now() - startTime,
      size: entry.metadata.size,
      compressed: entry.metadata.compressed
    }, 'Cache set');
  }

  /**
   * Delete from both cache layers
   */
  async delete(key: string): Promise<void> {
    // Delete from L1
    this.l1Cache.delete(key);
    this.stats.l1.deletes++;

    // Delete from L2
    try {
      const redisKey = this.getRedisKey(key);
      await this.l2Cache.set(redisKey, '', 'EX', 1); // Expire immediately
      this.stats.l2.deletes++;
    } catch (error) {
      logger.error({
        key,
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to delete from L2 cache');
    }
  }

  /**
   * Clear all cache layers
   */
  async clear(): Promise<void> {
    this.l1Cache.clear();

    // Clear L2 by pattern (if supported by Redis)
    // Note: This is expensive in production, use with caution
    logger.warn('Multi-layer cache cleared');
  }

  /**
   * Get or set with loader function (cache-aside pattern)
   */
  async getOrSet(
    key: string,
    loader: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Try to get from cache
    let value = await this.get(key);

    if (value !== null) {
      return value;
    }

    // Load value
    const startTime = Date.now();
    try {
      value = await loader();

      logger.debug({
        key,
        loadTime: Date.now() - startTime
      }, 'Cache miss, loaded from source');

      // Cache the loaded value
      await this.set(key, value, ttl);

      return value;
    } catch (error) {
      logger.error({
        key,
        error: error instanceof Error ? error.message : String(error),
        loadTime: Date.now() - startTime
      }, 'Failed to load value for cache');

      throw error;
    }
  }

  /**
   * Batch get with optimized multi-layer lookup
   */
  async mget(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const l1Misses: string[] = [];

    // L1 batch lookup
    for (const key of keys) {
      const entry = this.l1Cache.get(key);
      if (entry) {
        result.set(key, entry.value);
        this.stats.l1.hits++;

        // Update access metadata
        entry.metadata.accessCount++;
        entry.metadata.lastAccessedAt = Date.now();
      } else {
        l1Misses.push(key);
        this.stats.l1.misses++;
      }
    }

    // L2 batch lookup for misses
    if (l1Misses.length > 0) {
      // Note: This could be optimized with Redis MGET if available
      const l2Promises = l1Misses.map(async (key) => {
        const value = await this.get(key);
        if (value !== null) {
          result.set(key, value);
        }
      });

      await Promise.all(l2Promises);
    }

    return result;
  }

  /**
   * Warm up cache by preloading frequently accessed keys
   */
  async warmup(keys: string[], loader: (key: string) => Promise<T>): Promise<void> {
    const startTime = Date.now();
    let loaded = 0;
    let failed = 0;

    const promises = keys.map(async (key) => {
      try {
        const value = await loader(key);
        await this.set(key, value);
        loaded++;
      } catch (error) {
        failed++;
        logger.error({
          key,
          error: error instanceof Error ? error.message : String(error)
        }, 'Failed to warm up cache key');
      }
    });

    await Promise.all(promises);

    logger.info({
      loaded,
      failed,
      total: keys.length,
      duration: Date.now() - startTime
    }, 'Cache warmup completed');
  }

  /**
   * Get comprehensive cache statistics
   */
  getStats(): {
    l1: CacheLayerStats;
    l2: CacheLayerStats;
    overall: {
      totalHits: number;
      totalMisses: number;
      hitRate: number;
      l1HitRate: number;
      l2HitRate: number;
    };
  } {
    const calculateLayerStats = (stats: typeof this.stats.l1): CacheLayerStats => {
      const total = stats.hits + stats.misses;
      const avgResponseTime = stats.responseTimes.length > 0
        ? stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length
        : 0;

      return {
        hits: stats.hits,
        misses: stats.misses,
        sets: stats.sets,
        deletes: stats.deletes,
        hitRate: total > 0 ? (stats.hits / total) * 100 : 0,
        avgResponseTime
      };
    };

    const l1Stats = calculateLayerStats(this.stats.l1);
    const l2Stats = calculateLayerStats(this.stats.l2);

    const totalHits = l1Stats.hits + l2Stats.hits;
    const totalMisses = this.stats.l1.misses; // Only L1 misses count as total misses
    const totalRequests = totalHits + totalMisses;

    return {
      l1: l1Stats,
      l2: l2Stats,
      overall: {
        totalHits,
        totalMisses,
        hitRate: totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0,
        l1HitRate: l1Stats.hitRate,
        l2HitRate: l2Stats.hitRate
      }
    };
  }

  /**
   * Get cache size information
   */
  getSizeInfo(): {
    l1Size: number;
    l1MaxSize: number;
    l1UsagePercent: number;
    estimatedMemoryMB: number;
  } {
    const l1Size = this.l1Cache.size;
    const l1MaxSize = this.config.memory.maxSize;

    // Estimate memory usage
    let totalBytes = 0;
    for (const [, entry] of this.l1Cache) {
      totalBytes += entry.metadata.size;
    }

    return {
      l1Size,
      l1MaxSize,
      l1UsagePercent: (l1Size / l1MaxSize) * 100,
      estimatedMemoryMB: totalBytes / (1024 * 1024)
    };
  }

  private createEntry(value: T): CacheEntry<T> {
    const serialized = JSON.stringify(value);
    const size = Buffer.byteLength(serialized, 'utf8');

    return {
      value,
      metadata: {
        createdAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
        size,
        compressed: false // Compression could be implemented here
      }
    };
  }

  private serializeEntry(entry: CacheEntry<T>): string {
    // Could implement compression here if configured
    return JSON.stringify(entry);
  }

  private deserializeEntry(data: string): CacheEntry<T> {
    try {
      return JSON.parse(data) as CacheEntry<T>;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to deserialize cache entry');

      // Return a default entry
      return this.createEntry(null as T);
    }
  }

  private getRedisKey(key: string): string {
    return `${this.config.redis.keyPrefix}${key}`;
  }

  private startPreloading(): void {
    if (!this.config.preload) return;

    this.preloadTimer = setInterval(() => {
      // Implement preloading logic based on patterns
      logger.debug('Cache preloading triggered');
    }, this.config.preload.interval);
  }

  private resetOldStats(): void {
    // Keep only recent response times to prevent memory growth
    const maxSamples = 1000;

    if (this.stats.l1.responseTimes.length > maxSamples) {
      this.stats.l1.responseTimes = this.stats.l1.responseTimes.slice(-maxSamples);
    }

    if (this.stats.l2.responseTimes.length > maxSamples) {
      this.stats.l2.responseTimes = this.stats.l2.responseTimes.slice(-maxSamples);
    }
  }

  destroy(): void {
    if (this.preloadTimer) {
      clearInterval(this.preloadTimer);
    }
    this.l1Cache.destroy();
  }
}

/**
 * Specialized cache implementations
 */
export class SearchCache extends MultiLayerCache<unknown> {
  constructor(redisCache: RedisCircuitBreaker) {
    super('search', redisCache, {
      memory: {
        maxSize: 500,
        defaultTTL: 300000, // 5 minutes
        cleanupInterval: 60000
      },
      redis: {
        defaultTTL: 1800, // 30 minutes
        keyPrefix: 'search:'
      }
    });
  }

  generateKey(query: string, source?: string): string {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, '-');
    return source ? `${source}:${normalized}` : normalized;
  }

  generateSearchKey(query: string, source: string, userId?: string): string {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, '-');
    const parts = [`src:${source}`, normalized];
    if (userId) {
      parts.push(`user:${userId}`);
    }
    return parts.join(':');
  }

  async cacheSearchResult(
    query: string,
    results: unknown,
    source: string,
    userId?: string,
    ttl?: number
  ): Promise<void> {
    const key = this.generateSearchKey(query, source, userId);
    await this.set(key, results, ttl);
  }

  async getCachedSearchResult(
    query: string,
    source: string,
    userId?: string
  ): Promise<unknown> {
    const key = this.generateSearchKey(query, source, userId);
    return this.get(key);
  }

  async invalidateSearch(query: string, source: string, userId?: string): Promise<void> {
    const key = this.generateSearchKey(query, source, userId);
    await this.delete(key);
  }
}

export class UserCache extends MultiLayerCache<unknown> {
  constructor(redisCache: RedisCircuitBreaker) {
    super('user', redisCache, {
      memory: {
        maxSize: 2000,
        defaultTTL: 600000, // 10 minutes
        cleanupInterval: 120000
      },
      redis: {
        defaultTTL: 3600, // 1 hour
        keyPrefix: 'user:'
      }
    });
  }

  generateKey(userId: string, guildId: string): string {
    return `${guildId}:${userId}`;
  }

  async cacheUserPreferences(
    userId: string,
    guildId: string,
    preferences: unknown,
    ttl?: number
  ): Promise<void> {
    const key = this.generateKey(userId, guildId);
    await this.set(key, preferences, ttl);
  }

  async getCachedUserPreferences(userId: string, guildId: string): Promise<unknown> {
    const key = this.generateKey(userId, guildId);
    return this.get(key);
  }

  async invalidateUserPreferences(userId: string, guildId: string): Promise<void> {
    const key = this.generateKey(userId, guildId);
    await this.delete(key);
  }

  async cacheUserBehavior(
    userId: string,
    guildId: string,
    behavior: unknown,
    ttl?: number
  ): Promise<void> {
    const key = `${this.generateKey(userId, guildId)}:behavior`;
    await this.set(key, behavior, ttl);
  }
}

export class QueueCache extends MultiLayerCache<unknown> {
  constructor(redisCache: RedisCircuitBreaker) {
    super('queue', redisCache, {
      memory: {
        maxSize: 100,
        defaultTTL: 60000, // 1 minute
        cleanupInterval: 30000
      },
      redis: {
        defaultTTL: 300, // 5 minutes
        keyPrefix: 'queue:'
      }
    });
  }

  generateKey(guildId: string): string {
    return `guild:${guildId}`;
  }

  async cacheQueueState(guildId: string, queueState: unknown, ttl?: number): Promise<void> {
    const key = this.generateKey(guildId);
    await this.set(key, queueState, ttl);
  }

  async getCachedQueueState(guildId: string): Promise<unknown> {
    const key = this.generateKey(guildId);
    return this.get(key);
  }

  async invalidateQueue(guildId: string): Promise<void> {
    const key = this.generateKey(guildId);
    await this.delete(key);
  }

  async invalidateQueueCache(guildId: string): Promise<void> {
    // Alias for invalidateQueue for test compatibility
    await this.invalidateQueue(guildId);
  }
}