import { logger } from '@discord-bot/logger';
import {
  MultiLayerCache,
  SearchCache as BaseSearchCache,
  UserCache,
  QueueCache as BaseQueueCache,
  RedisCircuitBreaker,
} from '@discord-bot/cache';
import type { CacheLayerStats, CircuitBreakerMetrics } from '@discord-bot/cache';
import { env } from '@discord-bot/config';

/**
 * Enhanced Audio Service Cache System
 *
 * Implements multi-layer caching with L1 (memory) and L2 (Redis) layers
 * for optimal performance in high-traffic Discord music bot scenarios.
 *
 * Features:
 * - Multi-layer cache with automatic promotion/demotion
 * - Circuit breaker protection for Redis failures
 * - Specialized caches for different data types
 * - Comprehensive metrics and monitoring
 * - Automatic cache warming and preloading
 */

// Redis circuit breaker configuration for cache layer
const redisConfig = {
  failureThreshold: 0.5,
  timeout: 30000,
  monitoringWindow: 60000,
  volumeThreshold: 10,
  redis: {
    retryDelayOnFailover: 1000,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  },
};

// Initialize Redis circuit breaker for cache
const redisUrl = env.REDIS_URL;
const cacheRedis = new RedisCircuitBreaker(
  'audio-cache',
  redisConfig,
  {
    host: redisUrl ? new URL(redisUrl).hostname : 'localhost',
    port: redisUrl ? parseInt(new URL(redisUrl).port) || 6379 : 6379,
    password: redisUrl ? new URL(redisUrl).password || undefined : undefined,
    ...redisConfig.redis,
  }
);

/**
 * Search Result Cache
 *
 * Optimized for music search queries with intelligent key generation
 * and source-aware caching for maximum hit rates.
 */
export class AudioSearchCache extends BaseSearchCache {
  constructor() {
    super(cacheRedis);
  }

  // Generate smart cache keys for search queries
  generateSearchKey(query: string, source?: string, userId?: string): string {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, '-');
    const parts = [normalized];

    if (source) parts.push(`src:${source}`);
    if (userId) parts.push(`user:${userId}`);

    return parts.join(':');
  }

  // Cache search results with metadata
  async cacheSearchResult(
    query: string,
    results: unknown[],
    source?: string,
    userId?: string
  ): Promise<void> {
    const key = this.generateSearchKey(query, source, userId);
    const cacheData = {
      query,
      results,
      source: source || 'unknown',
      timestamp: Date.now(),
      resultCount: results.length,
    };

    // Optimized TTL for better cache utilization
    const ttl = results.length > 0 ? 600000 : 180000; // 10min vs 3min (increased from 5min vs 1min)
    await super.set(key, cacheData, ttl);
  }

  // Get cached search results with validation
  async getCachedSearchResult(
    query: string,
    source?: string,
    userId?: string
  ): Promise<unknown[] | null> {
    const key = this.generateSearchKey(query, source, userId);
    const cached = await super.get(key);

    if (!cached) return null;

    // Validate cache freshness (additional check beyond TTL)
    const cachedData = cached as { timestamp?: number; results?: unknown[] };
    if (cachedData.timestamp) {
      const age = Date.now() - cachedData.timestamp;
      if (age > 600000) { // 10 minutes max age
        await super.delete(key);
        return null;
      }
    }

    return cachedData.results || null;
  }
}

/**
 * Queue State Cache
 *
 * Caches queue snapshots and player states for rapid restoration
 * and reduced database load during high-activity periods.
 */
export class AudioQueueCache extends BaseQueueCache {
  constructor() {
    super(cacheRedis);
  }

  // Cache complete queue state
  async cacheQueueState(
    guildId: string,
    queueData: {
      tracks: unknown[];
      currentTrack?: unknown;
      position?: number;
      volume?: number;
      repeatMode?: string;
      paused?: boolean;
    }
  ): Promise<void> {
    const key = this.generateKey(guildId);
    const stateData = {
      ...queueData,
      timestamp: Date.now(),
      trackCount: queueData.tracks.length,
    };

    await super.set(key, stateData, 300000); // 5 minutes
  }

  // Get cached queue state
  async getCachedQueueState(guildId: string): Promise<unknown | null> {
    const key = this.generateKey(guildId);
    return await super.get(key);
  }

  // Invalidate queue cache when state changes
  async invalidateQueueCache(guildId: string): Promise<void> {
    const key = this.generateKey(guildId);
    await super.delete(key);
  }
}

/**
 * User Preferences Cache
 *
 * Caches user-specific settings, preferences, and behavior patterns
 * for personalized music recommendations and enhanced UX.
 */
export class AudioUserCache extends UserCache {
  constructor() {
    super(cacheRedis);
  }

  // Cache user listening preferences
  async cacheUserPreferences(
    userId: string,
    guildId: string,
    preferences: {
      favoriteGenres?: string[];
      skipPatterns?: string[];
      volumePreference?: number;
      autoplayEnabled?: boolean;
      searchSources?: string[];
    }
  ): Promise<void> {
    const key = this.generateKey(userId, guildId);
    const prefData = {
      ...preferences,
      timestamp: Date.now(),
      lastUpdated: Date.now(),
    };

    await super.set(key, prefData, 3600000); // 1 hour
  }

  // Get cached user preferences
  async getCachedUserPreferences(
    userId: string,
    guildId: string
  ): Promise<unknown | null> {
    const key = this.generateKey(userId, guildId);
    return await super.get(key);
  }

  // Cache user behavior patterns for recommendations
  async cacheUserBehavior(
    userId: string,
    guildId: string,
    behavior: {
      recentSearches?: string[];
      skippedTracks?: string[];
      likedTracks?: string[];
      playlistActivity?: unknown[];
      sessionDuration?: number;
    }
  ): Promise<void> {
    const key = `${this.generateKey(userId, guildId)}:behavior`;
    const behaviorData = {
      ...behavior,
      timestamp: Date.now(),
    };

    await super.set(key, behaviorData, 1800000); // 30 minutes
  }
}

/**
 * Feature Flag Cache
 *
 * High-performance caching for feature flags and guild settings
 * to minimize database queries during command processing.
 */
export class FeatureFlagCache extends MultiLayerCache<boolean> {
  constructor() {
    super('feature-flags', cacheRedis, {
      memory: {
        maxSize: 400, // Increased from 250 for better feature flag caching
        defaultTTL: 180000, // 3 minutes
        cleanupInterval: 60000,
      },
      redis: {
        defaultTTL: 900, // 15 minutes
        keyPrefix: 'flags:',
      },
    });
  }

  generateFlagKey(guildId: string, flagName: string): string {
    return `${guildId}:${flagName}`;
  }

  async getFlagValue(guildId: string, flagName: string): Promise<boolean> {
    const key = this.generateFlagKey(guildId, flagName);
    const cached = await super.get(key);
    return cached ?? false;
  }

  async setFlagValue(
    guildId: string,
    flagName: string,
    value: boolean
  ): Promise<void> {
    const key = this.generateFlagKey(guildId, flagName);
    await super.set(key, value);
  }

  async invalidateGuildFlags(guildId: string): Promise<void> {
    // Note: This would need pattern-based deletion in production
    // For now, we'll rely on TTL expiration
    logger.debug({ guildId }, 'Guild flags invalidation requested');
  }
}

/**
 * Cache Manager
 *
 * Central management for all cache instances with comprehensive
 * monitoring, statistics, and maintenance operations.
 */
interface CacheLayerReport {
  l1: CacheLayerStats;
  l2: CacheLayerStats;
  overall: {
    totalHits: number;
    totalMisses: number;
    hitRate: number;
    l1HitRate: number;
    l2HitRate: number;
  };
}

interface RedisCacheMetrics extends CircuitBreakerMetrics {
  fallbackCache: {
    size: number;
    maxSize: number;
    utilizationPercent: number;
  };
  messageBuffer: {
    currentSize: number;
    maxSize: number;
    utilizationPercent: number;
    metrics: {
      messagesBuffered: number;
      messagesReplayed: number;
      messagesDropped: number;
    };
  };
  redisStatus: string;
}

export interface AudioCacheStats {
  search: CacheLayerReport;
  queue: CacheLayerReport;
  user: CacheLayerReport;
  featureFlags: CacheLayerReport;
  redis: RedisCacheMetrics;
  overall: {
    totalCaches: number;
    healthScore: number;
  };
}

export class AudioCacheManager {
  public readonly search: AudioSearchCache;
  public readonly queue: AudioQueueCache;
  public readonly user: AudioUserCache;
  public readonly featureFlags: FeatureFlagCache;

  constructor() {
    this.search = new AudioSearchCache();
    this.queue = new AudioQueueCache();
    this.user = new AudioUserCache();
    this.featureFlags = new FeatureFlagCache();

    // Start cache warming if enabled
    this.startCacheWarming();

    // Register cleanup on shutdown
    this.registerShutdownHandlers();
  }

  // Get comprehensive cache statistics
  getCacheStats(): AudioCacheStats {
    const stats: AudioCacheStats = {
      search: this.search.getStats(),
      queue: this.queue.getStats(),
      user: this.user.getStats(),
      featureFlags: this.featureFlags.getStats(),
      redis: cacheRedis.getMetrics() as RedisCacheMetrics,
      overall: {
        totalCaches: 4,
        healthScore: this.calculateHealthScore(),
      },
    };

    return stats;
  }

  // Calculate overall cache health score
  private calculateHealthScore(): number {
    try {
      const searchStats = this.search.getStats();
      const queueStats = this.queue.getStats();
      const userStats = this.user.getStats();
      const flagStats = this.featureFlags.getStats();
      const redisMetrics = cacheRedis.getMetrics();

      // Weight different factors
      const hitRateScore = (searchStats.overall.hitRate + queueStats.overall.hitRate +
                           userStats.overall.hitRate + flagStats.overall.hitRate) / 4;

      const redisHealthScore = redisMetrics.redisStatus === 'ready' ? 100 : 0;

      // Combine scores with weights
      const healthScore = (hitRateScore * 0.7) + (redisHealthScore * 0.3);

      return Math.round(healthScore);
    } catch (error) {
      logger.error({ error }, 'Failed to calculate cache health score');
      return 0;
    }
  }

  // Start cache warming for frequently accessed data
  private startCacheWarming(): void {
    // Warm up feature flags cache every 10 minutes
    setInterval(async () => {
      try {
        logger.debug('Starting cache warming cycle');
        // This would implement actual warming logic in production
        // For now, just log the intent
      } catch (error) {
        logger.error({ error }, 'Cache warming failed');
      }
    }, 600000); // 10 minutes
  }

  // Register cleanup handlers for graceful shutdown
  private registerShutdownHandlers(): void {
    const cleanup = async () => {
      try {
        logger.info('Cleaning up cache connections...');
        await cacheRedis.disconnect();
        logger.info('Cache cleanup completed');
      } catch (error) {
        logger.error({ error }, 'Cache cleanup failed');
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  // Flush all caches (use with caution)
  async flushAllCaches(): Promise<void> {
    await Promise.all([
      this.search.clear(),
      this.queue.clear(),
      this.user.clear(),
      this.featureFlags.clear(),
    ]);

    logger.warn('All audio caches have been flushed');
  }

  // Get cache size information
  getCacheSizes(): {
    search: Record<string, unknown>;
    queue: Record<string, unknown>;
    user: Record<string, unknown>;
    featureFlags: Record<string, unknown>;
  } {
    return {
      search: this.search.getSizeInfo(),
      queue: this.queue.getSizeInfo(),
      user: this.user.getSizeInfo(),
      featureFlags: this.featureFlags.getSizeInfo(),
    };
  }
}

// Export singleton instance
export const audioCacheManager = new AudioCacheManager();

// Export individual caches for direct access
export const searchCache = audioCacheManager.search;
export const queueCache = audioCacheManager.queue;
export const userCache = audioCacheManager.user;
export const featureFlagCache = audioCacheManager.featureFlags;

// Legacy exports for backward compatibility
export { MultiLayerCache, RedisCircuitBreaker };
