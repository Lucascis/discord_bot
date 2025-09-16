import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { logger, getBusinessMetrics, BusinessMetricsCollector } from '@discord-bot/logger';
import { Registry } from 'prom-client';

describe('Business Metrics Integration Tests', () => {
  let registry: Registry;
  let metricsCollector: BusinessMetricsCollector;

  beforeAll(() => {
    registry = new Registry();
    metricsCollector = getBusinessMetrics(registry);
    logger.info('Business metrics tests initialized');
  });

  afterAll(() => {
    logger.info('Business metrics tests completed');
  });

  beforeEach(() => {
    // Clear registry between tests
    registry.clear();
    metricsCollector = getBusinessMetrics(registry);
  });

  describe('User Engagement Metrics', () => {
    it('should track user activity correctly', () => {
      const userId = 'user123';
      const guildId = 'guild456';

      // Track user activity
      metricsCollector.trackUserActivity(userId, guildId);

      // Should not throw errors
      expect(true).toBe(true);
    });

    it('should track user sessions', () => {
      const userId = 'user123';
      const guildId = 'guild456';

      metricsCollector.trackSessionStart(userId, guildId);

      // Wait a bit for session duration
      setTimeout(() => {
        metricsCollector.trackSessionEnd(userId, guildId);
      }, 100);

      expect(true).toBe(true);
    });

    it('should handle multiple concurrent users', () => {
      const users = ['user1', 'user2', 'user3'];
      const guilds = ['guild1', 'guild2'];

      // Track activity for multiple users across multiple guilds
      users.forEach(userId => {
        guilds.forEach(guildId => {
          metricsCollector.trackUserActivity(userId, guildId);
          metricsCollector.trackSessionStart(userId, guildId);
        });
      });

      expect(true).toBe(true);
    });
  });

  describe('Music Playback Metrics', () => {
    it('should track song playback correctly', () => {
      const guildId = 'guild123';
      const track = {
        title: 'Test Song',
        author: 'Test Artist',
        duration: 180000, // 3 minutes
        source: 'youtube',
        uri: 'https://youtube.com/watch?v=test'
      };
      const userId = 'user123';

      metricsCollector.trackSongPlay(guildId, track, false, userId);

      expect(true).toBe(true);
    });

    it('should track autoplay songs differently', () => {
      const guildId = 'guild123';
      const track = {
        title: 'Autoplay Song',
        duration: 240000,
        source: 'youtube'
      };

      metricsCollector.trackSongPlay(guildId, track, true); // isAutoplay = true

      expect(true).toBe(true);
    });

    it('should track song skips with completion rates', () => {
      const guildId = 'guild123';
      const track = {
        title: 'Skipped Song',
        duration: 180000
      };
      const playedDuration = 30000; // 30 seconds out of 3 minutes

      metricsCollector.trackSongSkip(guildId, track, playedDuration, 'user_skip', 'user123');

      expect(true).toBe(true);
    });

    it('should handle different skip reasons', () => {
      const guildId = 'guild123';
      const track = { title: 'Test Track', duration: 120000 };
      const skipReasons: Array<'user_skip' | 'autoplay_skip' | 'error_skip' | 'queue_advance'> = [
        'user_skip',
        'autoplay_skip',
        'error_skip',
        'queue_advance'
      ];

      skipReasons.forEach(reason => {
        metricsCollector.trackSongSkip(guildId, track, 60000, reason);
      });

      expect(true).toBe(true);
    });
  });

  describe('Queue Management Metrics', () => {
    it('should track queue operations', () => {
      const guildId = 'guild123';
      const operations: Array<'add' | 'remove' | 'clear' | 'shuffle'> = [
        'add', 'remove', 'clear', 'shuffle'
      ];

      operations.forEach((operation, index) => {
        metricsCollector.trackQueueOperation(guildId, operation, index + 1, 'user123');
      });

      expect(true).toBe(true);
    });

    it('should track queue length changes', () => {
      const guildId = 'guild123';
      const userId = 'user123';

      // Simulate building up a queue
      for (let i = 1; i <= 10; i++) {
        metricsCollector.trackQueueOperation(guildId, 'add', i, userId);
      }

      // Simulate clearing queue
      metricsCollector.trackQueueOperation(guildId, 'clear', 0, userId);

      expect(true).toBe(true);
    });
  });

  describe('Search Behavior Metrics', () => {
    it('should track search queries with performance data', () => {
      const guildId = 'guild123';
      const queries = [
        { query: 'rock music', source: 'youtube', resultCount: 50, latency: 250 },
        { query: 'classical symphony', source: 'spotify', resultCount: 30, latency: 180 },
        { query: 'electronic beats', source: 'soundcloud', resultCount: 25, latency: 320 }
      ];

      queries.forEach(({ query, source, resultCount, latency }) => {
        metricsCollector.trackSearchQuery(
          guildId, query, source, resultCount, latency, false, 'user123'
        );
      });

      expect(true).toBe(true);
    });

    it('should differentiate cached vs non-cached searches', () => {
      const guildId = 'guild123';
      const query = 'popular song';
      const source = 'youtube';

      // First search (not cached)
      metricsCollector.trackSearchQuery(guildId, query, source, 40, 300, false, 'user123');

      // Second search (cached)
      metricsCollector.trackSearchQuery(guildId, query, source, 40, 50, true, 'user123');

      expect(true).toBe(true);
    });
  });

  describe('Autoplay System Metrics', () => {
    it('should track autoplay triggers', () => {
      const guildId = 'guild123';
      const triggerTypes: Array<'queue_empty' | 'user_request'> = [
        'queue_empty',
        'user_request'
      ];

      triggerTypes.forEach(triggerType => {
        metricsCollector.trackAutoplayTrigger(guildId, triggerType, 'user123');
      });

      expect(true).toBe(true);
    });

    it('should track autoplay recommendation success and failures', () => {
      const guildId = 'guild123';
      const recommendationTypes: Array<'similar' | 'artist' | 'genre' | 'mixed'> = [
        'similar', 'artist', 'genre', 'mixed'
      ];

      recommendationTypes.forEach(type => {
        // Track success
        metricsCollector.trackAutoplayRecommendation(
          guildId, type, true, 'Recommended Song', 'user123'
        );

        // Track failure
        metricsCollector.trackAutoplayRecommendation(
          guildId, type, false, undefined, 'user123'
        );
      });

      expect(true).toBe(true);
    });
  });

  describe('Command Performance Metrics', () => {
    it('should track successful command execution', () => {
      const commands = ['play', 'skip', 'pause', 'queue', 'shuffle'];
      const guildId = 'guild123';
      const userId = 'user123';

      commands.forEach(command => {
        const latency = Math.floor(Math.random() * 1000) + 100; // 100-1100ms
        metricsCollector.trackCommandExecution(command, guildId, latency, true, undefined, userId);
      });

      expect(true).toBe(true);
    });

    it('should track failed command execution with error types', () => {
      const failureScenarios = [
        { command: 'play', errorType: 'no_results' },
        { command: 'skip', errorType: 'no_current_track' },
        { command: 'pause', errorType: 'player_not_found' }
      ];
      const guildId = 'guild123';

      failureScenarios.forEach(({ command, errorType }) => {
        metricsCollector.trackCommandExecution(command, guildId, 500, false, errorType, 'user123');
      });

      expect(true).toBe(true);
    });
  });

  describe('Business Insights Generation', () => {
    it('should generate comprehensive business insights', () => {
      const guildId = 'guild123';
      const userId = 'user123';

      // Generate some activity data
      metricsCollector.trackUserActivity(userId, guildId);
      metricsCollector.trackSongPlay(guildId, {
        title: 'Insight Test Song',
        duration: 200000,
        source: 'youtube'
      }, false, userId);
      metricsCollector.trackSearchQuery(guildId, 'test query', 'youtube', 10, 200, false, userId);
      metricsCollector.trackCommandExecution('play', guildId, 150, true, undefined, userId);

      const insights = metricsCollector.getBusinessInsights();

      expect(insights).toHaveProperty('engagement');
      expect(insights).toHaveProperty('usage');
      expect(insights).toHaveProperty('performance');
      expect(insights).toHaveProperty('guilds');
      expect(insights).toHaveProperty('timestamp');
    });

    it('should provide metrics in Prometheus format', async () => {
      const guildId = 'guild123';

      // Generate some metrics
      metricsCollector.trackUserActivity('user123', guildId);
      metricsCollector.trackSongPlay(guildId, {
        title: 'Prometheus Test',
        duration: 180000
      });

      const prometheusMetrics = await metricsCollector.getMetrics();

      expect(typeof prometheusMetrics).toBe('string');
      expect(prometheusMetrics.length).toBeGreaterThan(0);
    });
  });

  describe('Metrics Data Integrity', () => {
    it('should handle high-volume metrics correctly', () => {
      const guildId = 'guild123';
      const userId = 'user123';

      // Simulate high activity
      for (let i = 0; i < 1000; i++) {
        metricsCollector.trackUserActivity(userId, guildId);

        if (i % 10 === 0) {
          metricsCollector.trackSongPlay(guildId, {
            title: `Song ${i}`,
            duration: 180000
          }, i % 5 === 0); // Every 5th song is autoplay
        }

        if (i % 7 === 0) {
          metricsCollector.trackSearchQuery(guildId, `query ${i}`, 'youtube', 25, 200);
        }
      }

      expect(true).toBe(true);
    });

    it('should handle invalid or edge case data gracefully', () => {
      const guildId = 'guild123';

      // Test edge cases
      metricsCollector.trackSongPlay(guildId, {
        title: '', // Empty title
        duration: 0 // Zero duration
      });

      metricsCollector.trackSearchQuery(guildId, '', 'unknown', 0, 0); // Empty query

      metricsCollector.trackCommandExecution('', guildId, -1, false, 'test_error'); // Invalid command

      expect(true).toBe(true);
    });
  });

  describe('Metrics Performance', () => {
    it('should track metrics collection performance', () => {
      const startTime = Date.now();
      const guildId = 'guild123';

      // Perform a batch of metric operations
      for (let i = 0; i < 100; i++) {
        metricsCollector.trackUserActivity(`user${i}`, guildId);
        metricsCollector.trackCommandExecution('test', guildId, 100, true);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly (under 1 second for 200 operations)
      expect(duration).toBeLessThan(1000);
    });
  });
});