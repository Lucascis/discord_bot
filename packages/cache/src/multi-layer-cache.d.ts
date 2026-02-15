import { RedisCircuitBreaker } from './redis-circuit-breaker.js';
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
        threshold: number;
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
export declare class MultiLayerCache<T = unknown> {
    private readonly l1Cache;
    private readonly l2Cache;
    private readonly stats;
    private readonly config;
    private preloadTimer?;
    constructor(name: string, l2Cache: RedisCircuitBreaker, config?: Partial<MultiLayerCacheConfig>);
    /**
     * Get value from cache with multi-layer lookup
     */
    get(key: string): Promise<T | null>;
    /**
     * Set value in both cache layers
     */
    set(key: string, value: T, ttl?: number, options?: {
        skipL1?: boolean;
        skipL2?: boolean;
    }): Promise<void>;
    /**
     * Delete from both cache layers
     */
    delete(key: string): Promise<void>;
    /**
     * Clear all cache layers
     */
    clear(): Promise<void>;
    /**
     * Get or set with loader function (cache-aside pattern)
     */
    getOrSet(key: string, loader: () => Promise<T>, ttl?: number): Promise<T>;
    /**
     * Batch get with optimized multi-layer lookup
     */
    mget(keys: string[]): Promise<Map<string, T>>;
    /**
     * Warm up cache by preloading frequently accessed keys
     */
    warmup(keys: string[], loader: (key: string) => Promise<T>): Promise<void>;
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
    };
    /**
     * Get cache size information
     */
    getSizeInfo(): {
        l1Size: number;
        l1MaxSize: number;
        l1UsagePercent: number;
        estimatedMemoryMB: number;
    };
    private createEntry;
    private serializeEntry;
    private deserializeEntry;
    private getRedisKey;
    private startPreloading;
    private resetOldStats;
    destroy(): void;
}
/**
 * Specialized cache implementations
 */
export declare class SearchCache extends MultiLayerCache<unknown> {
    constructor(redisCache: RedisCircuitBreaker);
    generateKey(query: string, source?: string): string;
    generateSearchKey(query: string, source: string, userId?: string): string;
    /**
     * Enhanced query normalization for better cache hit rates
     */
    private normalizeQuery;
    cacheSearchResult(query: string, results: unknown, source: string, userId?: string, ttl?: number): Promise<void>;
    getCachedSearchResult(query: string, source: string, userId?: string): Promise<unknown>;
    invalidateSearch(query: string, source: string, userId?: string): Promise<void>;
}
export declare class UserCache extends MultiLayerCache<unknown> {
    constructor(redisCache: RedisCircuitBreaker);
    generateKey(userId: string, guildId: string): string;
    cacheUserPreferences(userId: string, guildId: string, preferences: unknown, ttl?: number): Promise<void>;
    getCachedUserPreferences(userId: string, guildId: string): Promise<unknown>;
    invalidateUserPreferences(userId: string, guildId: string): Promise<void>;
    cacheUserBehavior(userId: string, guildId: string, behavior: unknown, ttl?: number): Promise<void>;
}
export declare class QueueCache extends MultiLayerCache<unknown> {
    constructor(redisCache: RedisCircuitBreaker);
    generateKey(guildId: string): string;
    cacheQueueState(guildId: string, queueState: unknown, ttl?: number): Promise<void>;
    getCachedQueueState(guildId: string): Promise<unknown>;
    invalidateQueue(guildId: string): Promise<void>;
    invalidateQueueCache(guildId: string): Promise<void>;
}
export declare class SettingsCache extends MultiLayerCache<unknown> {
    constructor(redisCache: RedisCircuitBreaker);
    generateKey(guildId: string): string;
    cacheGuildSettings(guildId: string, settings: unknown, ttl?: number): Promise<void>;
    getCachedGuildSettings(guildId: string): Promise<unknown>;
    invalidateGuildSettings(guildId: string): Promise<void>;
    getOrSetGuildSettings(guildId: string, loader: () => Promise<unknown>, ttl?: number): Promise<unknown>;
}
//# sourceMappingURL=multi-layer-cache.d.ts.map