import { describe, it, expect } from 'vitest';
import { logger, getBusinessMetrics } from '@discord-bot/logger';
import { TTLMap, MultiLayerCache, RedisCircuitBreaker } from '@discord-bot/cache';
import { Registry } from 'prom-client';

describe('Basic Functionality Tests', () => {
  describe('Logger Integration', () => {
    it('should export logger successfully', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should export business metrics factory', () => {
      expect(getBusinessMetrics).toBeDefined();
      expect(typeof getBusinessMetrics).toBe('function');
    });

    it('should create business metrics instance', () => {
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);

      expect(metrics).toBeDefined();
      expect(typeof metrics.trackUserActivity).toBe('function');
      expect(typeof metrics.trackSongPlay).toBe('function');
      expect(typeof metrics.getBusinessInsights).toBe('function');
    });
  });

  describe('Cache Components', () => {
    it('should export TTLMap class', () => {
      expect(TTLMap).toBeDefined();
      expect(typeof TTLMap).toBe('function');
    });

    it('should create TTLMap instance', () => {
      const map = new TTLMap<string, string>({
        maxSize: 100,
        defaultTTL: 60000
      });

      expect(map).toBeDefined();
      expect(typeof map.set).toBe('function');
      expect(typeof map.get).toBe('function');
      expect(typeof map.delete).toBe('function');
    });

    it('should export MultiLayerCache class', () => {
      expect(MultiLayerCache).toBeDefined();
      expect(typeof MultiLayerCache).toBe('function');
    });

    it('should export RedisCircuitBreaker class', () => {
      expect(RedisCircuitBreaker).toBeDefined();
      expect(typeof RedisCircuitBreaker).toBe('function');
    });
  });

  describe('TTLMap Basic Operations', () => {
    it('should set and get values', () => {
      const map = new TTLMap<string, string>({
        maxSize: 10,
        defaultTTL: 60000
      });

      map.set('key1', 'value1');
      const result = map.get('key1');

      expect(result).toBe('value1');
    });

    it('should handle cache misses', () => {
      const map = new TTLMap<string, string>({
        maxSize: 10,
        defaultTTL: 60000
      });

      const result = map.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should respect TTL', async () => {
      const map = new TTLMap<string, string>({
        maxSize: 10,
        defaultTTL: 10 // 10ms TTL
      });

      map.set('key1', 'value1');

      // Should exist immediately
      expect(map.get('key1')).toBe('value1');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      // Should be expired
      expect(map.get('key1')).toBeUndefined();
    });

    it('should provide size information', () => {
      const map = new TTLMap<string, string>({
        maxSize: 10,
        defaultTTL: 60000
      });

      expect(map.size).toBe(0);

      map.set('key1', 'value1');
      map.set('key2', 'value2');

      expect(map.size).toBe(2);
    });
  });

  describe('Business Metrics Basic Operations', () => {
    it('should track user activity without errors', () => {
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);

      expect(() => {
        metrics.trackUserActivity('user123', 'guild456');
      }).not.toThrow();
    });

    it('should track song playback without errors', () => {
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);

      const track = {
        title: 'Test Song',
        duration: 180000
      };

      expect(() => {
        metrics.trackSongPlay('guild123', track, false);
      }).not.toThrow();
    });

    it('should track commands without errors', () => {
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);

      expect(() => {
        metrics.trackCommand('play', 'guild123', 150, true);
      }).not.toThrow();
    });

    it('should generate business insights', () => {
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);

      // Generate some activity
      metrics.trackUserActivity('user1', 'guild1');
      metrics.trackSongPlay('guild1', { title: 'Song 1', duration: 180000 });

      const insights = metrics.getBusinessInsights();

      expect(insights).toBeDefined();
      expect(insights).toHaveProperty('engagement');
      expect(insights).toHaveProperty('usage');
      expect(insights).toHaveProperty('performance');
      expect(insights).toHaveProperty('guilds');
    });

    it('should export metrics in Prometheus format', async () => {
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);

      // Generate some metrics
      metrics.trackUserActivity('user1', 'guild1');
      metrics.trackCommand('play', 'guild1', 100, true);

      const prometheusOutput = await metrics.getMetrics();

      expect(typeof prometheusOutput).toBe('string');
      expect(prometheusOutput.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid business metrics data gracefully', () => {
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);

      expect(() => {
        metrics.trackUserActivity('', '');
        metrics.trackSongPlay('', { title: '', duration: 0 });
        metrics.trackCommand('', '', -1, false, 'error');
      }).not.toThrow();
    });

    it('should handle TTLMap edge cases', () => {
      const map = new TTLMap<string, string>({
        maxSize: 1, // Very small size
        defaultTTL: 1 // Very short TTL
      });

      expect(() => {
        map.set('key1', 'value1');
        map.set('key2', 'value2'); // Should evict key1
        map.get('key1');
        map.get('key2');
        map.delete('nonexistent');
        map.clear();
      }).not.toThrow();
    });
  });

  describe('Integration Smoke Tests', () => {
    it('should load all main components without errors', () => {
      expect(() => {
        // Test that all main exports work
        const registry = new Registry();
        const metrics = getBusinessMetrics(registry);
        const map = new TTLMap<string, string>();

        // Basic operations
        map.set('test', 'value');
        map.get('test');

        metrics.trackUserActivity('user', 'guild');

        logger.info('Smoke test completed successfully');
      }).not.toThrow();
    });

    it('should handle high-volume operations without crashing', () => {
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);
      const map = new TTLMap<string, number>({ maxSize: 1000 });

      expect(() => {
        // Generate high volume of operations
        for (let i = 0; i < 1000; i++) {
          map.set(`key-${i}`, i);
          metrics.trackUserActivity(`user-${i}`, `guild-${i % 10}`);

          if (i % 10 === 0) {
            metrics.trackSongPlay(`guild-${i % 10}`, {
              title: `Song ${i}`,
              duration: 180000
            });
          }
        }

        // Verify some operations worked
        expect(map.get('key-999')).toBe(999);
        expect(map.size).toBeGreaterThan(0);

        const insights = metrics.getBusinessInsights();
        expect(insights).toBeDefined();
      }).not.toThrow();
    });

    it('should provide consistent API interfaces', () => {
      // Test that our main classes have the expected interface
      const registry = new Registry();
      const metrics = getBusinessMetrics(registry);
      const map = new TTLMap<string, string>();

      // Business metrics interface
      expect(typeof metrics.trackUserActivity).toBe('function');
      expect(typeof metrics.trackSessionStart).toBe('function');
      expect(typeof metrics.trackSessionEnd).toBe('function');
      expect(typeof metrics.trackSongPlay).toBe('function');
      expect(typeof metrics.trackCommand).toBe('function');
      expect(typeof metrics.getBusinessInsights).toBe('function');
      expect(typeof metrics.getMetrics).toBe('function');

      // TTLMap interface
      expect(typeof map.set).toBe('function');
      expect(typeof map.get).toBe('function');
      expect(typeof map.has).toBe('function');
      expect(typeof map.delete).toBe('function');
      expect(typeof map.clear).toBe('function');
      expect(typeof map.size).toBe('number');

      // Logger interface
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });
  });
});