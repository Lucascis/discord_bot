export interface TTLMapEntry<V> {
    value: V;
    expiry: number;
}
export interface TTLMapOptions {
    maxSize?: number;
    defaultTTL?: number;
    cleanupInterval?: number;
}
/**
 * TTL (Time To Live) Map with automatic cleanup and size limits
 *
 * Features:
 * - Automatic expiration of entries based on TTL
 * - Maximum size limit with LRU eviction
 * - Periodic cleanup of expired entries
 * - Memory leak prevention
 */
export declare class TTLMap<K, V> {
    private data;
    private readonly maxSize;
    private readonly defaultTTL;
    private cleanupTimer?;
    private accessOrder;
    private accessCounter;
    constructor(options?: TTLMapOptions);
    /**
     * Set a key-value pair with optional TTL
     */
    set(key: K, value: V, ttl?: number): void;
    /**
     * Get a value by key (returns undefined if expired or not found)
     */
    get(key: K): V | undefined;
    /**
     * Check if key exists and is not expired
     */
    has(key: K): boolean;
    /**
     * Delete a key
     */
    delete(key: K): boolean;
    /**
     * Clear all entries
     */
    clear(): void;
    /**
     * Get current size
     */
    get size(): number;
    /**
     * Get all keys (non-expired only)
     */
    keys(): IterableIterator<K>;
    /**
     * Get all values (non-expired only)
     */
    values(): IterableIterator<V>;
    /**
     * Get all entries (non-expired only)
     */
    entries(): IterableIterator<[K, V]>;
    /**
     * Iterate over non-expired entries
     */
    forEach(callback: (value: V, key: K, map: this) => void): void;
    /**
     * Make TTLMap iterable (compatible with Map interface)
     */
    [Symbol.iterator](): IterableIterator<[K, V]>;
    /**
     * Clean up expired entries
     */
    private cleanup;
    /**
     * Evict least recently used entry when at capacity
     */
    private evictLRU;
    /**
     * Get statistics about the TTL map
     */
    getStats(): {
        size: number;
        maxSize: number;
        expired: number;
        memoryUsageEstimate: string;
    };
    /**
     * Set TTL for an existing key
     */
    touch(key: K, ttl?: number): boolean;
    /**
     * Get remaining TTL for a key in milliseconds
     */
    getTTL(key: K): number;
    /**
     * Destroy the TTL map and cleanup resources
     */
    destroy(): void;
}
//# sourceMappingURL=ttl-map.d.ts.map