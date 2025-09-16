import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { logger } from '@discord-bot/logger';

describe('Monitoring Endpoints Integration Tests', () => {
  const baseUrl = 'http://localhost:3002'; // Audio service port
  let serverAvailable = false;

  beforeAll(async () => {
    logger.info('Monitoring endpoints tests started');

    // Check if audio service is running
    try {
      const response = await fetch(`${baseUrl}/health`);
      serverAvailable = response.ok;
      logger.info({ serverAvailable }, 'Audio service availability checked');
    } catch (error) {
      logger.warn({ error }, 'Audio service not available for endpoint testing');
    }
  });

  afterAll(() => {
    logger.info('Monitoring endpoints tests completed');
  });

  describe('Health Check Endpoints', () => {
    it('should respond to basic health check', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);

      const healthData = await response.json();
      expect(healthData).toHaveProperty('service');
      expect(healthData).toHaveProperty('status');
      expect(healthData).toHaveProperty('version');
      expect(healthData).toHaveProperty('timestamp');
      expect(healthData.service).toBe('audio');
    });

    it('should provide advanced health metrics', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/health/advanced`);
      expect(response.status).toBe(200);

      const healthData = await response.json();
      expect(healthData).toHaveProperty('service');
      expect(healthData).toHaveProperty('status');
      expect(healthData).toHaveProperty('components');
      expect(healthData).toHaveProperty('timestamp');

      // Should have component health checks
      expect(Array.isArray(healthData.components)).toBe(true);
    });

    it('should provide health trends', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/health/trends`);
      expect(response.status).toBe(200);

      const trendsData = await response.json();
      expect(typeof trendsData).toBe('object');
    });
  });

  describe('Performance Monitoring Endpoints', () => {
    it('should provide comprehensive performance metrics', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/performance`);
      expect(response.status).toBe(200);

      const perfData = await response.json();
      expect(perfData).toHaveProperty('performance');
      expect(perfData).toHaveProperty('search');
      expect(perfData).toHaveProperty('memory');
      expect(perfData).toHaveProperty('cache');
      expect(perfData).toHaveProperty('business');
      expect(perfData).toHaveProperty('timestamp');

      // Validate cache metrics structure
      expect(perfData.cache).toHaveProperty('search');
      expect(perfData.cache).toHaveProperty('queue');
      expect(perfData.cache).toHaveProperty('user');
      expect(perfData.cache).toHaveProperty('featureFlags');
      expect(perfData.cache).toHaveProperty('overall');

      // Validate business metrics structure
      expect(perfData.business).toHaveProperty('engagement');
      expect(perfData.business).toHaveProperty('usage');
      expect(perfData.business).toHaveProperty('technical');
    });

    it('should provide Prometheus metrics', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/metrics`);
      expect(response.status).toBe(200);

      const metricsText = await response.text();
      expect(typeof metricsText).toBe('string');
      expect(metricsText.length).toBeGreaterThan(0);

      // Should contain Prometheus format metrics
      expect(metricsText).toContain('# HELP');
      expect(metricsText).toContain('# TYPE');
    });
  });

  describe('Business Metrics Endpoints', () => {
    it('should provide business insights', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/metrics/business`);
      expect(response.status).toBe(200);

      const businessData = await response.json();
      expect(businessData).toHaveProperty('engagement');
      expect(businessData).toHaveProperty('usage');
      expect(businessData).toHaveProperty('performance');
      expect(businessData).toHaveProperty('guilds');
      expect(businessData).toHaveProperty('technical');
      expect(businessData).toHaveProperty('timestamp');

      // Validate engagement metrics
      if (businessData.engagement) {
        expect(businessData.engagement).toHaveProperty('dau');
        expect(businessData.engagement).toHaveProperty('mau');
      }

      // Validate technical metrics
      expect(businessData.technical).toHaveProperty('cachePerformance');
      expect(businessData.technical).toHaveProperty('redis');
    });
  });

  describe('Cache Statistics Endpoints', () => {
    it('should provide cache statistics', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/cache/stats`);
      expect(response.status).toBe(200);

      const cacheData = await response.json();
      expect(cacheData).toHaveProperty('stats');
      expect(cacheData).toHaveProperty('sizes');
      expect(cacheData).toHaveProperty('timestamp');

      // Validate stats structure
      expect(cacheData.stats).toHaveProperty('search');
      expect(cacheData.stats).toHaveProperty('queue');
      expect(cacheData.stats).toHaveProperty('user');
      expect(cacheData.stats).toHaveProperty('featureFlags');
      expect(cacheData.stats).toHaveProperty('overall');

      // Validate sizes structure
      expect(cacheData.sizes).toHaveProperty('search');
      expect(cacheData.sizes).toHaveProperty('queue');
      expect(cacheData.sizes).toHaveProperty('user');
      expect(cacheData.sizes).toHaveProperty('featureFlags');

      // Each cache size should have required fields
      Object.values(cacheData.sizes).forEach((sizeInfo: any) => {
        expect(sizeInfo).toHaveProperty('l1Size');
        expect(sizeInfo).toHaveProperty('l1MaxSize');
        expect(sizeInfo).toHaveProperty('l1UsagePercent');
        expect(sizeInfo).toHaveProperty('estimatedMemoryMB');
      });
    });
  });

  describe('Player Status Endpoints', () => {
    it('should provide player information', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/players`);
      expect(response.status).toBe(200);

      const playersData = await response.json();
      expect(playersData).toHaveProperty('players');
      expect(playersData).toHaveProperty('count');

      expect(Array.isArray(playersData.players)).toBe(true);
      expect(typeof playersData.count).toBe('number');

      // If there are players, validate structure
      if (playersData.players.length > 0) {
        const player = playersData.players[0];
        expect(player).toHaveProperty('guildId');
        expect(player).toHaveProperty('connected');
        expect(player).toHaveProperty('playing');
        expect(player).toHaveProperty('paused');
        expect(player).toHaveProperty('queueSize');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent endpoints gracefully', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/non-existent-endpoint`);
      expect(response.status).toBe(404);
    });

    it('should provide proper error responses', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      // Test an endpoint that might fail under certain conditions
      const response = await fetch(`${baseUrl}/health`);

      // Should either succeed or provide proper error structure
      if (!response.ok) {
        const errorData = await response.json();
        expect(errorData).toHaveProperty('service');
        expect(errorData).toHaveProperty('status');
        expect(errorData).toHaveProperty('error');
      }
    });
  });

  describe('Response Format Validation', () => {
    it('should return JSON with proper content-type headers', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const endpoints = [
        '/health',
        '/performance',
        '/metrics/business',
        '/cache/stats',
        '/players'
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`);

        if (response.ok) {
          const contentType = response.headers.get('content-type');
          expect(contentType).toContain('application/json');

          const data = await response.json();
          expect(typeof data).toBe('object');
        }
      }
    });

    it('should return Prometheus format for metrics endpoint', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const response = await fetch(`${baseUrl}/metrics`);

      if (response.ok) {
        const contentType = response.headers.get('content-type');
        expect(contentType).toMatch(/text\/plain|application\/openmetrics-text/);

        const text = await response.text();
        expect(typeof text).toBe('string');
      }
    });

    it('should include timestamps in time-sensitive endpoints', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const timestampEndpoints = [
        '/performance',
        '/metrics/business',
        '/cache/stats'
      ];

      for (const endpoint of timestampEndpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`);

        if (response.ok) {
          const data = await response.json();
          expect(data).toHaveProperty('timestamp');

          // Validate timestamp format
          const timestamp = new Date(data.timestamp);
          expect(timestamp.toString()).not.toBe('Invalid Date');
        }
      }
    });
  });

  describe('Performance and Load', () => {
    it('should respond to health checks quickly', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const startTime = Date.now();
      const response = await fetch(`${baseUrl}/health`);
      const endTime = Date.now();

      const responseTime = endTime - startTime;

      if (response.ok) {
        // Health checks should be fast (under 1 second)
        expect(responseTime).toBeLessThan(1000);
      }
    });

    it('should handle concurrent requests', async () => {
      if (!serverAvailable) {
        logger.info('Skipping endpoint test - server not available');
        return;
      }

      const concurrentRequests = 10;
      const promises = Array(concurrentRequests).fill(null).map(() =>
        fetch(`${baseUrl}/health`)
      );

      const responses = await Promise.all(promises);

      // Most or all requests should succeed
      const successfulResponses = responses.filter(r => r.ok);
      expect(successfulResponses.length).toBeGreaterThan(concurrentRequests * 0.8);
    });
  });
});

// Utility function to test if audio service is running
export async function isAudioServiceRunning(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:3002/health', {
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}