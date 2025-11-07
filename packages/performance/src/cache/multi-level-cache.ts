import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Cache Configuration
 */
export interface CacheConfig {
  // L1 Cache (Memory)
  l1: {
    maxSize: number;
    ttlMs: number;
    updateAgeOnGet: boolean;
  };

  // L2 Cache (Redis)
  l2: {
    keyPrefix: string;
    ttlMs: number;
    compressionEnabled: boolean;
  };

  // Performance
  performance: {
    batchSize: number;
    pipelineEnabled: boolean;
    retryAttempts: number;
    timeoutMs: number;
  };
}

/**
 * Cache Statistics
 */
export interface CacheStats {
  l1Hits: number;
  l2Hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  totalRequests: number;
  hitRatio: number;
  avgResponseTimeMs: number;
}

/**
 * Cache Entry with metadata
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  compressed?: boolean;
}

/**
 * Multi-Level Cache System
 * Implements L1 (memory) + L2 (Redis) caching with performance optimizations
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class MultiLevelCache<T = any> {
  private readonly l1Cache: LRUCache<string, CacheEntry<T>>;
  private readonly l2Cache: Redis;
  private readonly config: CacheConfig;
  private readonly metrics?: MetricsCollector;
  private readonly stats: CacheStats;

  constructor(
    redisClient: Redis,
    config: CacheConfig,
    metrics?: MetricsCollector
  ) {
    this.l2Cache = redisClient;
    this.config = config;
    this.metrics = metrics;

    // Initialize L1 cache (memory)
    this.l1Cache = new LRUCache<string, CacheEntry<T>>({
      max: config.l1.maxSize,
      ttl: config.l1.ttlMs,
      updateAgeOnGet: config.l1.updateAgeOnGet,
      dispose: (value, key) => {
        logger.debug('L1 cache entry disposed', { key, size: this.l1Cache.size });
      }
    });

    // Initialize statistics
    this.stats = {
      l1Hits: 0,
      l2Hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      totalRequests: 0,
      hitRatio: 0,
      avgResponseTimeMs: 0
    };

    logger.info('Multi-level cache initialized', {
      l1MaxSize: config.l1.maxSize,
      l1TtlMs: config.l1.ttlMs,
      l2KeyPrefix: config.l2.keyPrefix,
      l2TtlMs: config.l2.ttlMs
    });
  }

  /**
   * Get value from cache (checks L1 first, then L2)
   */
  async get(key: string): Promise<T | null> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      // Check L1 cache first
      const l1Entry = this.l1Cache.get(key);
      if (l1Entry && !this.isExpired(l1Entry)) {
        this.stats.l1Hits++;
        this.updateResponseTime(startTime);
        this.recordMetrics('l1_hit', key);

        logger.debug('Cache L1 hit', { key });
        return l1Entry.data;
      }

      // Check L2 cache
      const l2Key = this.buildL2Key(key);
      const l2Value = await this.l2Cache.get(l2Key);

      if (l2Value) {
        const l2Entry = this.deserialize(l2Value);

        if (l2Entry && !this.isExpired(l2Entry)) {
          // Store in L1 for faster future access
          this.l1Cache.set(key, l2Entry);

          this.stats.l2Hits++;
          this.updateResponseTime(startTime);
          this.recordMetrics('l2_hit', key);

          logger.debug('Cache L2 hit', { key });
          return l2Entry.data;
        }
      }

      // Cache miss
      this.stats.misses++;
      this.updateResponseTime(startTime);
      this.recordMetrics('miss', key);

      logger.debug('Cache miss', { key });
      return null;

    } catch (error) {
      this.stats.errors++;
      this.recordMetrics('error', key);

      logger.error('Cache get error', {
        key,
        error: error instanceof Error ? error.message : String(error)
      });

      return null;
    }
  }

  /**
   * Set value in both cache levels
   */
  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const startTime = Date.now();
    this.stats.sets++;

    try {
      const effectiveTtl = ttlMs || this.config.l1.ttlMs;
      const entry: CacheEntry<T> = {
        data: value,
        timestamp: Date.now(),
        ttl: effectiveTtl
      };

      // Set in L1 cache
      this.l1Cache.set(key, entry);

      // Set in L2 cache
      const l2Key = this.buildL2Key(key);
      const serializedValue = this.serialize(entry);

      if (this.config.performance.pipelineEnabled) {
        const pipeline = this.l2Cache.pipeline();
        pipeline.setex(l2Key, Math.ceil(effectiveTtl / 1000), serializedValue);
        await pipeline.exec();
      } else {
        await this.l2Cache.setex(l2Key, Math.ceil(effectiveTtl / 1000), serializedValue);
      }

      this.updateResponseTime(startTime);
      this.recordMetrics('set', key);

      logger.debug('Cache set completed', { key, ttlMs: effectiveTtl });

    } catch (error) {
      this.stats.errors++;
      this.recordMetrics('error', key);

      logger.error('Cache set error', {
        key,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Delete from both cache levels
   */
  async delete(key: string): Promise<void> {
    const startTime = Date.now();
    this.stats.deletes++;

    try {
      // Delete from L1
      this.l1Cache.delete(key);

      // Delete from L2
      const l2Key = this.buildL2Key(key);
      await this.l2Cache.del(l2Key);

      this.updateResponseTime(startTime);
      this.recordMetrics('delete', key);

      logger.debug('Cache delete completed', { key });

    } catch (error) {
      this.stats.errors++;
      this.recordMetrics('error', key);

      logger.error('Cache delete error', {
        key,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Get multiple keys efficiently
   */
  async mget(keys: string[]): Promise<Map<string, T | null>> {
    const result = new Map<string, T | null>();
    const l2Keys: string[] = [];
    const l2KeyMapping = new Map<string, string>();

    // Check L1 cache for all keys
    for (const key of keys) {
      const l1Entry = this.l1Cache.get(key);
      if (l1Entry && !this.isExpired(l1Entry)) {
        result.set(key, l1Entry.data);
        this.stats.l1Hits++;
      } else {
        const l2Key = this.buildL2Key(key);
        l2Keys.push(l2Key);
        l2KeyMapping.set(l2Key, key);
      }
    }

    // Batch get from L2 cache for remaining keys
    if (l2Keys.length > 0) {
      try {
        const l2Values = await this.l2Cache.mget(...l2Keys);

        for (let i = 0; i < l2Keys.length; i++) {
          const l2Key = l2Keys[i];
          const originalKey = l2KeyMapping.get(l2Key)!;
          const l2Value = l2Values[i];

          if (l2Value) {
            const l2Entry = this.deserialize(l2Value);
            if (l2Entry && !this.isExpired(l2Entry)) {
              result.set(originalKey, l2Entry.data);
              this.l1Cache.set(originalKey, l2Entry); // Promote to L1
              this.stats.l2Hits++;
            } else {
              result.set(originalKey, null);
              this.stats.misses++;
            }
          } else {
            result.set(originalKey, null);
            this.stats.misses++;
          }
        }
      } catch (error) {
        logger.error('Cache mget error', {
          keys: l2Keys,
          error: error instanceof Error ? error.message : String(error)
        });

        // Set remaining keys as null
        for (const l2Key of l2Keys) {
          const originalKey = l2KeyMapping.get(l2Key)!;
          if (!result.has(originalKey)) {
            result.set(originalKey, null);
            this.stats.errors++;
          }
        }
      }
    }

    return result;
  }

  /**
   * Set multiple keys efficiently
   */
  async mset(entries: Map<string, T>, ttlMs?: number): Promise<void> {
    const effectiveTtl = ttlMs || this.config.l1.ttlMs;
    const pipeline = this.l2Cache.pipeline();

    try {
      for (const [key, value] of entries) {
        const entry: CacheEntry<T> = {
          data: value,
          timestamp: Date.now(),
          ttl: effectiveTtl
        };

        // Set in L1
        this.l1Cache.set(key, entry);

        // Add to pipeline for L2
        const l2Key = this.buildL2Key(key);
        const serializedValue = this.serialize(entry);
        pipeline.setex(l2Key, Math.ceil(effectiveTtl / 1000), serializedValue);

        this.stats.sets++;
      }

      await pipeline.exec();

      logger.debug('Cache mset completed', {
        count: entries.size,
        ttlMs: effectiveTtl
      });

    } catch (error) {
      this.stats.errors += entries.size;

      logger.error('Cache mset error', {
        count: entries.size,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Clear both cache levels
   */
  async clear(): Promise<void> {
    try {
      // Clear L1
      this.l1Cache.clear();

      // Clear L2 (by pattern)
      const pattern = this.buildL2Key('*');
      const keys = await this.l2Cache.keys(pattern);

      if (keys.length > 0) {
        if (this.config.performance.pipelineEnabled) {
          const pipeline = this.l2Cache.pipeline();
          for (const key of keys) {
            pipeline.del(key);
          }
          await pipeline.exec();
        } else {
          await this.l2Cache.del(...keys);
        }
      }

      logger.info('Cache cleared', { l2KeysRemoved: keys.length });

    } catch (error) {
      logger.error('Cache clear error', {
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalHits = this.stats.l1Hits + this.stats.l2Hits;
    const hitRatio = this.stats.totalRequests > 0
      ? (totalHits / this.stats.totalRequests) * 100
      : 0;

    return {
      ...this.stats,
      hitRatio: Math.round(hitRatio * 100) / 100
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    Object.assign(this.stats, {
      l1Hits: 0,
      l2Hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      totalRequests: 0,
      hitRatio: 0,
      avgResponseTimeMs: 0
    });
  }

  /**
   * Get cache size information
   */
  getSize(): { l1Size: number; l1MaxSize: number } {
    return {
      l1Size: this.l1Cache.size,
      l1MaxSize: this.l1Cache.max
    };
  }

  /**
   * Warm up cache with data
   */
  async warmUp(data: Map<string, T>, ttlMs?: number): Promise<void> {
    logger.info('Starting cache warm-up', { entryCount: data.size });

    await this.mset(data, ttlMs);

    logger.info('Cache warm-up completed', { entryCount: data.size });
  }

  // Private helper methods

  private buildL2Key(key: string): string {
    return `${this.config.l2.keyPrefix}:${key}`;
  }

  private serialize(entry: CacheEntry<T>): string {
    try {
      const serialized = JSON.stringify(entry);

      // TODO: Add compression if enabled
      if (this.config.l2.compressionEnabled) {
        // Implement compression here
        return serialized;
      }

      return serialized;
    } catch (error) {
      logger.error('Serialization error', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private deserialize(value: string): CacheEntry<T> | null {
    try {
      // TODO: Add decompression if enabled
      if (this.config.l2.compressionEnabled) {
        // Implement decompression here
      }

      return JSON.parse(value) as CacheEntry<T>;
    } catch (error) {
      logger.error('Deserialization error', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() > (entry.timestamp + entry.ttl);
  }

  private updateResponseTime(startTime: number): void {
    const responseTime = Date.now() - startTime;
    this.stats.avgResponseTimeMs =
      (this.stats.avgResponseTimeMs + responseTime) / 2;
  }

  private recordMetrics(operation: string, _key: string): void {
    if (this.metrics) {
      this.metrics.recordCustomMetric(
        'cache_operations_total',
        1,
        {
          operation,
          cache_type: 'multi_level',
          key_prefix: this.config.l2.keyPrefix
        },
        'counter'
      );
    }
  }
}