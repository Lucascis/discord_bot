import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryCache } from '../src/cache.js';

describe('MemoryCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new MemoryCache<string>(100, 60000);
      
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      const cache = new MemoryCache<string>();
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      const cache = new MemoryCache<string>();
      
      cache.set('exists', 'value');
      expect(cache.has('exists')).toBe(true);
      expect(cache.has('missing')).toBe(false);
    });

    it('should delete keys', () => {
      const cache = new MemoryCache<string>();
      
      cache.set('key', 'value');
      expect(cache.has('key')).toBe(true);
      
      cache.delete('key');
      expect(cache.has('key')).toBe(false);
    });

    it('should clear all entries', () => {
      const cache = new MemoryCache<string>();
      
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(true);
      
      cache.clear();
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', () => {
      const cache = new MemoryCache<string>(100, 5000); // 5 second default TTL
      
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
      
      // Advance time past TTL
      vi.advanceTimersByTime(6000);
      expect(cache.get('key')).toBeUndefined();
    });

    it('should use custom TTL when specified', () => {
      const cache = new MemoryCache<string>(100, 60000); // 60 second default
      
      cache.set('short', 'value', 2000); // 2 second custom TTL
      cache.set('long', 'value'); // uses default 60s TTL
      
      // After 3 seconds, short should expire but long should remain
      vi.advanceTimersByTime(3000);
      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe('value');
    });

    it('should remove expired entries on get', () => {
      const cache = new MemoryCache<string>(100, 1000);
      
      cache.set('key', 'value');
      expect(cache.getStats().size).toBe(1);
      
      vi.advanceTimersByTime(1500);
      cache.get('key'); // This should trigger cleanup
      
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('size limits and eviction', () => {
    it('should evict oldest entries when at capacity', () => {
      const cache = new MemoryCache<string>(2, 60000); // Max 2 entries
      
      cache.set('first', 'value1');
      cache.set('second', 'value2');
      expect(cache.has('first')).toBe(true);
      expect(cache.has('second')).toBe(true);
      
      // Adding third entry should evict first
      cache.set('third', 'value3');
      expect(cache.has('first')).toBe(false);
      expect(cache.has('second')).toBe(true);
      expect(cache.has('third')).toBe(true);
    });

    it('should maintain size within limits', () => {
      const cache = new MemoryCache<number>(3, 60000);
      
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, i);
      }
      
      const stats = cache.getStats();
      expect(stats.size).toBeLessThanOrEqual(stats.maxSize);
      expect(stats.size).toBe(3);
    });
  });

  describe('hit tracking and statistics', () => {
    it('should track cache hits', () => {
      const cache = new MemoryCache<string>(100, 60000);
      
      cache.set('key', 'value');
      
      // Access the key multiple times
      cache.get('key');
      cache.get('key');
      cache.get('key');
      
      const stats = cache.getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('should provide accurate statistics', () => {
      const cache = new MemoryCache<string>(10, 60000);
      
      // Add some entries
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      // Access one key multiple times
      cache.get('key1');
      cache.get('key1');
      cache.get('key2');
      
      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(10);
      expect(stats.hitRate).toBe(3 / 5); // 3 hits out of 5 total accesses (2 sets + 3 gets)
    });

    it('should handle zero access case', () => {
      const cache = new MemoryCache<string>();
      const stats = cache.getStats();
      
      expect(stats.hitRate).toBe(0);
      expect(stats.size).toBe(0);
    });
  });

  describe('automatic cleanup', () => {
    it('should run cleanup automatically', () => {
      const cache = new MemoryCache<string>(100, 1000);
      
      // Add entries that will expire
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      // Advance time to expire entries
      vi.advanceTimersByTime(1500);
      
      // Trigger automatic cleanup (runs every 5 minutes)
      vi.advanceTimersByTime(300000);
      
      expect(cache.getStats().size).toBe(0);
    });

    it('should log cleanup statistics', () => {
      // Mock logger
      vi.mock('@discord-bot/logger', () => ({
        logger: {
          debug: vi.fn()
        }
      }));

      const cache = new MemoryCache<string>(100, 1000);
      
      // Add entries that will expire
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      // Expire entries
      vi.advanceTimersByTime(1500);
      
      // Manual cleanup to test logging
      cache.cleanup();
      
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle storing different data types', () => {
      const cache = new MemoryCache<unknown>();
      
      cache.set('string', 'text');
      cache.set('number', 42);
      cache.set('object', { key: 'value' });
      cache.set('array', [1, 2, 3]);
      cache.set('null', null);
      
      expect(cache.get('string')).toBe('text');
      expect(cache.get('number')).toBe(42);
      expect(cache.get('object')).toEqual({ key: 'value' });
      expect(cache.get('array')).toEqual([1, 2, 3]);
      expect(cache.get('null')).toBe(null);
    });

    it('should handle rapid set/get operations', () => {
      const cache = new MemoryCache<number>(1000, 60000);
      
      // Rapid operations
      for (let i = 0; i < 500; i++) {
        cache.set(`key${i}`, i);
      }
      
      for (let i = 0; i < 500; i++) {
        expect(cache.get(`key${i}`)).toBe(i);
      }
      
      const stats = cache.getStats();
      expect(stats.size).toBe(500);
    });

    it('should handle zero or negative TTL gracefully', () => {
      const cache = new MemoryCache<string>(100, 60000);
      
      cache.set('key', 'value', 0);
      
      // Advance time slightly to trigger expiration
      vi.advanceTimersByTime(1);
      
      // Should expire immediately
      expect(cache.get('key')).toBeUndefined();
    });

    it('should handle very large TTL values', () => {
      const cache = new MemoryCache<string>(100, 60000);
      
      cache.set('key', 'value', Number.MAX_SAFE_INTEGER);
      expect(cache.get('key')).toBe('value');
    });
  });
});