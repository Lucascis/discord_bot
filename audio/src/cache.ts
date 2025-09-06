import { logger } from '@discord-bot/logger';

/**
 * High-Performance Memory Cache with TTL and Statistics
 * 
 * This class implements an intelligent in-memory caching system with sophisticated
 * features for performance optimization and memory management.
 * 
 * Key Features:
 * - Time-To-Live (TTL) expiration for automatic data freshness
 * - LRU-like eviction when reaching capacity limits
 * - Hit rate tracking for cache effectiveness monitoring
 * - Automatic cleanup of expired entries
 * - Generic type support for type-safe caching
 * 
 * Performance Characteristics:
 * - O(1) get/set operations using Map
 * - Automatic memory management to prevent leaks
 * - Configurable size limits to control memory usage
 * - Background cleanup to maintain performance
 * 
 * Use Cases:
 * - Search result caching (reduces API calls)
 * - Feature flag caching (reduces database queries)
 * - Queue state caching (improves response times)
 * - User preference caching (enhanced UX)
 */
export class MemoryCache<T> {
  // Core cache storage with metadata for each entry
  private cache = new Map<string, { value: T; expires: number; hits: number }>();
  private maxSize: number;
  private defaultTtl: number;
  
  constructor(maxSize = 1000, defaultTtl = 300000) { // 5 minutes default TTL
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtl;
    
    // Background cleanup task runs every 5 minutes to remove expired entries
    // This prevents memory leaks and maintains optimal performance
    setInterval(() => this.cleanup(), 300000);
  }
  
  set(key: string, value: T, ttl?: number): void {
    const expires = Date.now() + (ttl ?? this.defaultTtl);
    
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, { value, expires, hits: 0 });
  }
  
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    
    entry.hits++;
    return entry.value;
  }
  
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug({ cleaned, remaining: this.cache.size }, 'Cache cleanup completed');
    }
  }
  
  getStats(): { size: number; maxSize: number; hitRate: number } {
    let totalHits = 0;
    let totalAccesses = 0;
    
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
      totalAccesses += entry.hits + 1; // +1 for initial set
    }
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalAccesses > 0 ? totalHits / totalAccesses : 0
    };
  }
}

// Global caches for audio system
export const searchCache = new MemoryCache<any>(2000, 600000); // 10 minutes for search results
export const automixCache = new MemoryCache<boolean>(500, 300000); // 5 minutes for automix flags
export const queueCache = new MemoryCache<any>(200, 60000); // 1 minute for queue snapshots