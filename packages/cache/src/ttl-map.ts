import { logger } from '@discord-bot/logger';

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
export class TTLMap<K, V> {
  private data = new Map<K, TTLMapEntry<V>>();
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private cleanupTimer?: NodeJS.Timeout;
  private accessOrder = new Map<K, number>(); // For LRU tracking
  private accessCounter = 0;

  constructor(options: TTLMapOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTTL = options.defaultTTL ?? 300000; // 5 minutes default

    const cleanupInterval = options.cleanupInterval ?? 60000; // 1 minute default

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);
  }

  /**
   * Set a key-value pair with optional TTL
   */
  set(key: K, value: V, ttl?: number): void {
    const expiry = Date.now() + (ttl ?? this.defaultTTL);

    // Update access order for LRU
    this.accessOrder.set(key, ++this.accessCounter);

    // Check if we need to evict due to size limit
    if (this.data.size >= this.maxSize && !this.data.has(key)) {
      this.evictLRU();
    }

    this.data.set(key, { value, expiry });

    logger.debug({
      key: typeof key === 'string' ? key : String(key),
      ttl: ttl ?? this.defaultTTL,
      size: this.data.size,
      maxSize: this.maxSize
    }, 'TTLMap entry set');
  }

  /**
   * Get a value by key (returns undefined if expired or not found)
   */
  get(key: K): V | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiry) {
      // Entry expired, remove it
      this.data.delete(key);
      this.accessOrder.delete(key);

      logger.debug({
        key: typeof key === 'string' ? key : String(key)
      }, 'TTLMap entry expired and removed');

      return undefined;
    }

    // Update access order for LRU
    this.accessOrder.set(key, ++this.accessCounter);

    return entry.value;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.data.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiry) {
      this.data.delete(key);
      this.accessOrder.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key
   */
  delete(key: K): boolean {
    this.accessOrder.delete(key);
    return this.data.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.data.clear();
    this.accessOrder.clear();
    this.accessCounter = 0;
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.data.size;
  }

  /**
   * Get all keys (non-expired only)
   */
  keys(): IterableIterator<K> {
    this.cleanup(); // Ensure we don't return expired keys
    return this.data.keys();
  }

  /**
   * Get all values (non-expired only)
   */
  values(): IterableIterator<V> {
    this.cleanup(); // Ensure we don't return expired values
    return Array.from(this.data.values()).map(entry => entry.value).values();
  }

  /**
   * Get all entries (non-expired only)
   */
  entries(): IterableIterator<[K, V]> {
    this.cleanup(); // Ensure we don't return expired entries
    const entries: [K, V][] = [];
    for (const [key, entry] of this.data.entries()) {
      entries.push([key, entry.value]);
    }
    return entries.values();
  }

  /**
   * Iterate over non-expired entries
   */
  forEach(callback: (value: V, key: K, map: this) => void): void {
    this.cleanup();
    for (const [key, entry] of this.data.entries()) {
      callback(entry.value, key, this);
    }
  }

  /**
   * Make TTLMap iterable (compatible with Map interface)
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.data.entries()) {
      if (now > entry.expiry) {
        this.data.delete(key);
        this.accessOrder.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug({
        removed,
        remaining: this.data.size,
        maxSize: this.maxSize
      }, 'TTLMap cleanup completed');
    }
  }

  /**
   * Evict least recently used entry when at capacity
   */
  private evictLRU(): void {
    if (this.accessOrder.size === 0) return;

    // Find the key with the smallest access counter (least recently used)
    let lruKey: K | undefined;
    let minAccess = Infinity;

    for (const [key, accessTime] of this.accessOrder.entries()) {
      if (accessTime < minAccess) {
        minAccess = accessTime;
        lruKey = key;
      }
    }

    if (lruKey !== undefined) {
      this.data.delete(lruKey);
      this.accessOrder.delete(lruKey);

      logger.debug({
        evictedKey: typeof lruKey === 'string' ? lruKey : String(lruKey),
        size: this.data.size,
        maxSize: this.maxSize
      }, 'TTLMap LRU eviction');
    }
  }

  /**
   * Get statistics about the TTL map
   */
  getStats(): {
    size: number;
    maxSize: number;
    expired: number;
    memoryUsageEstimate: string;
  } {
    const now = Date.now();
    let expired = 0;

    for (const entry of this.data.values()) {
      if (now > entry.expiry) {
        expired++;
      }
    }

    // Rough memory estimate (not precise, but useful for monitoring)
    const avgEntrySize = 100; // Estimated bytes per entry
    const memoryBytes = this.data.size * avgEntrySize;
    const memoryMB = (memoryBytes / 1024 / 1024).toFixed(2);

    return {
      size: this.data.size,
      maxSize: this.maxSize,
      expired,
      memoryUsageEstimate: `${memoryMB}MB`
    };
  }

  /**
   * Set TTL for an existing key
   */
  touch(key: K, ttl?: number): boolean {
    const entry = this.data.get(key);
    if (!entry) return false;

    entry.expiry = Date.now() + (ttl ?? this.defaultTTL);
    this.accessOrder.set(key, ++this.accessCounter);

    return true;
  }

  /**
   * Get remaining TTL for a key in milliseconds
   */
  getTTL(key: K): number {
    const entry = this.data.get(key);
    if (!entry) return -1;

    const remaining = entry.expiry - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Destroy the TTL map and cleanup resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();

    logger.debug('TTLMap destroyed');
  }
}