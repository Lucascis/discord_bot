import { logger, getBusinessMetrics } from '@discord-bot/logger';
import { Registry } from 'prom-client';
import { audioCacheManager } from './cache.js';
import type { AudioCacheStats } from './cache.js';

type CacheLayerReport = AudioCacheStats['search'];

const extractHitRate = (report: CacheLayerReport): number => report.overall.hitRate;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);


/**
 * Audio Service Business Metrics
 *
 * Comprehensive metrics collection for the Discord music bot audio service.
 * Tracks user engagement, music playback patterns, search behavior, and
 * autoplay effectiveness to drive data-driven decision making.
 *
 * Key Metrics Categories:
 * - User Engagement: DAU/MAU, session duration, retention
 * - Music Playback: tracks played, completion rates, sources
 * - Queue Management: queue operations, patterns, efficiency
 * - Search Behavior: queries, success rates, popular terms
 * - Autoplay Performance: engagement, skip rates, effectiveness
 * - System Performance: response times, error rates, cache hits
 */

export class AudioMetricsCollector {
  public readonly businessMetrics: ReturnType<typeof getBusinessMetrics>;
  private metricsRegistry: Registry;

  constructor(registry?: Registry) {
    this.metricsRegistry = registry || new Registry();
    this.businessMetrics = getBusinessMetrics(this.metricsRegistry);

    // Start automated metrics collection
    this.startMetricsCollection();
  }

  /**
   * Track User Engagement Metrics
   */

  // Track when a user starts a music session
  trackUserSessionStart(userId: string, guildId: string): void {
    try {
      this.businessMetrics.trackUserActivity(userId, guildId);
      this.businessMetrics.trackSessionStart(userId, guildId);

      logger.debug({
        userId,
        guildId,
        event: 'session_start'
      }, 'User session started');
    } catch (error) {
      logger.error({ error, userId, guildId }, 'Failed to track user session start');
    }
  }

  // Track when a user ends a music session
  trackUserSessionEnd(userId: string, guildId: string): void {
    try {
      this.businessMetrics.trackSessionEnd(userId, guildId);

      logger.debug({
        userId,
        guildId,
        event: 'session_end'
      }, 'User session ended');
    } catch (error) {
      logger.error({ error, userId, guildId }, 'Failed to track user session end');
    }
  }

  /**
   * Track Music Playback Metrics
   */

  // Track song playback with comprehensive metadata
  trackSongPlayback(
    guildId: string,
    track: {
      title: string;
      author?: string;
      duration: number;
      source?: string;
      uri?: string;
    },
    isAutoplay: boolean = false,
    userId?: string
  ): void {
    try {
      // Track with business metrics
      this.businessMetrics.trackSongPlay(guildId, track, isAutoplay);

      // Track user activity if userId provided
      if (userId) {
        this.businessMetrics.trackUserActivity(userId, guildId);
      }

      // Track feature usage
      this.businessMetrics.trackFeatureUsage('music_playback', guildId);

      if (isAutoplay) {
        this.businessMetrics.trackFeatureUsage('autoplay_track', guildId);
      }

      logger.debug({
        guildId,
        track: track.title,
        source: track.source,
        isAutoplay,
        userId,
        event: 'track_played'
      }, 'Song playback tracked');
    } catch (error) {
      logger.error({ error, guildId, track: track.title }, 'Failed to track song playback');
    }
  }

  // Track song skip behavior
  trackSongSkip(
    guildId: string,
    track: {
      title: string;
      duration: number;
    },
    playedDuration: number,
    skipReason: 'user_skip' | 'autoplay_skip' | 'error_skip' | 'queue_advance' = 'user_skip',
    userId?: string
  ): void {
    try {
      this.businessMetrics.trackSongSkip(guildId, track, playedDuration, skipReason);

      // Track user activity if userId provided
      if (userId) {
        this.businessMetrics.trackUserActivity(userId, guildId);
      }

      // Track feature usage based on skip reason
      this.businessMetrics.trackFeatureUsage('track_skip', guildId);

      if (skipReason === 'autoplay_skip') {
        this.businessMetrics.trackAutoplaySkip(guildId, 'user_initiated');
      }

      logger.debug({
        guildId,
        track: track.title,
        playedDuration,
        totalDuration: track.duration,
        completionRate: (playedDuration / track.duration) * 100,
        skipReason,
        userId,
        event: 'track_skipped'
      }, 'Song skip tracked');
    } catch (error) {
      logger.error({ error, guildId, track: track.title }, 'Failed to track song skip');
    }
  }

  /**
   * Track Queue Management Metrics
   */

  // Track queue operations (add, remove, clear, shuffle)
  trackQueueOperation(
    guildId: string,
    operation: 'add' | 'remove' | 'clear' | 'shuffle',
    queueLength: number,
    userId?: string
  ): void {
    try {
      this.businessMetrics.trackQueueOperation(guildId, operation, queueLength);

      // Track user activity if userId provided
      if (userId) {
        this.businessMetrics.trackUserActivity(userId, guildId);
      }

      // Track feature usage
      this.businessMetrics.trackFeatureUsage(`queue_${operation}`, guildId);

      logger.debug({
        guildId,
        operation,
        queueLength,
        userId,
        event: 'queue_operation'
      }, 'Queue operation tracked');
    } catch (error) {
      logger.error({ error, guildId, operation }, 'Failed to track queue operation');
    }
  }

  /**
   * Track Search Behavior Metrics
   */

  // Track search queries and results
  trackSearchQuery(
    guildId: string,
    query: string,
    source: string,
    resultCount: number,
    latency: number,
    cached: boolean = false,
    userId?: string
  ): void {
    try {
      this.businessMetrics.trackSearch(guildId, query, source, resultCount, latency, cached);

      // Track user activity if userId provided
      if (userId) {
        this.businessMetrics.trackUserActivity(userId, guildId);
      }

      // Track feature usage
      this.businessMetrics.trackFeatureUsage('search', guildId);

      if (cached) {
        this.businessMetrics.trackFeatureUsage('cached_search', guildId);
      }

      logger.debug({
        guildId,
        query: query.substring(0, 50), // Truncate for privacy
        source,
        resultCount,
        latency,
        cached,
        userId,
        event: 'search_query'
      }, 'Search query tracked');
    } catch (error) {
      logger.error({ error, guildId, source }, 'Failed to track search query');
    }
  }

  /**
   * Track Autoplay System Metrics
   */

  // Track autoplay triggers
  trackAutoplayTrigger(
    guildId: string,
    triggerType: 'queue_empty' | 'user_request',
    userId?: string
  ): void {
    try {
      this.businessMetrics.trackAutoplayTrigger(guildId, triggerType);

      // Track user activity if userId provided
      if (userId) {
        this.businessMetrics.trackUserActivity(userId, guildId);
      }

      // Track feature usage
      this.businessMetrics.trackFeatureUsage('autoplay_trigger', guildId);

      logger.debug({
        guildId,
        triggerType,
        userId,
        event: 'autoplay_triggered'
      }, 'Autoplay trigger tracked');
    } catch (error) {
      logger.error({ error, guildId, triggerType }, 'Failed to track autoplay trigger');
    }
  }

  // Track autoplay recommendation success/failure
  trackAutoplayRecommendation(
    guildId: string,
    recommendationType: 'similar' | 'artist' | 'genre' | 'mixed',
    success: boolean,
    trackTitle?: string,
    userId?: string
  ): void {
    try {
      this.businessMetrics.trackAutoplayRecommendation(guildId, recommendationType, success);

      // Track user activity if userId provided
      if (userId) {
        this.businessMetrics.trackUserActivity(userId, guildId);
      }

      // Track feature usage
      const featureName = success ? 'autoplay_success' : 'autoplay_failure';
      this.businessMetrics.trackFeatureUsage(featureName, guildId);

      logger.debug({
        guildId,
        recommendationType,
        success,
        trackTitle,
        userId,
        event: 'autoplay_recommendation'
      }, 'Autoplay recommendation tracked');
    } catch (error) {
      logger.error({ error, guildId, recommendationType }, 'Failed to track autoplay recommendation');
    }
  }

  /**
   * Track Command Performance Metrics
   */

  // Track command execution with performance data
  trackCommandExecution(
    command: string,
    guildId: string,
    latency: number,
    success: boolean,
    errorType?: string,
    userId?: string
  ): void {
    try {
      this.businessMetrics.trackCommand(command, guildId, latency, success, errorType);

      // Track user activity if userId provided
      if (userId) {
        this.businessMetrics.trackUserActivity(userId, guildId);
      }

      // Track feature usage
      this.businessMetrics.trackFeatureUsage(`command_${command}`, guildId);

      logger.debug({
        command,
        guildId,
        latency,
        success,
        errorType,
        userId,
        event: 'command_executed'
      }, 'Command execution tracked');
    } catch (error) {
      logger.error({ error, command, guildId }, 'Failed to track command execution');
    }
  }

  /**
   * Get Business Insights and KPIs
   */

  // Get comprehensive business insights
  getBusinessInsights(): Record<string, unknown> {
    try {
      const insights = this.businessMetrics.getBusinessInsights();
      const cacheStats = audioCacheManager.getCacheStats();

      const cachePerformance = {
        searchHitRate: extractHitRate(cacheStats.search),
        queueHitRate: extractHitRate(cacheStats.queue),
        userHitRate: extractHitRate(cacheStats.user),
        flagsHitRate: extractHitRate(cacheStats.featureFlags),
        overallHealthScore: cacheStats.overall.healthScore,
      };

      const redisDetails = {
        status: cacheStats.redis.redisStatus,
        circuitState: cacheStats.redis.state,
        fallbackCacheSize: cacheStats.redis.fallbackCache.size,
        messageBufferSize: cacheStats.redis.messageBuffer.currentSize,
      };

      return {
        ...insights,
        technical: {
          cachePerformance,
          redis: redisDetails,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get business insights');
      return {
        error: 'Failed to generate insights',
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Get metrics in Prometheus format
  async getPrometheusMetrics(): Promise<string> {
    try {
      return await this.businessMetrics.getMetrics();
    } catch (error) {
      logger.error({ error }, 'Failed to get Prometheus metrics');
      return '';
    }
  }

  /**
   * Automated Metrics Collection
   */

  private startMetricsCollection(): void {
    // Collect cache performance metrics every 5 minutes
    setInterval(() => {
      try {
        const cacheStats = audioCacheManager.getCacheStats();

        // Track cache hit rates as feature usage
        this.businessMetrics.trackFeatureUsage('cache_search', 'system');
        this.businessMetrics.trackFeatureUsage('cache_queue', 'system');
        this.businessMetrics.trackFeatureUsage('cache_user', 'system');
        this.businessMetrics.trackFeatureUsage('cache_flags', 'system');

        logger.debug({
          searchHitRate: extractHitRate(cacheStats.search),
          queueHitRate: extractHitRate(cacheStats.queue),
          userHitRate: extractHitRate(cacheStats.user),
          flagsHitRate: extractHitRate(cacheStats.featureFlags),
          healthScore: cacheStats.overall.healthScore,
        }, 'Cache performance metrics collected');
      } catch (error) {
        logger.error({ error }, 'Failed to collect cache performance metrics');
      }
    }, 300000); // 5 minutes

    // Log business insights every hour
    setInterval(() => {
      try {
        const insights = this.getBusinessInsights();
        const engagement = isRecord(insights.engagement) ? insights.engagement : {};
        const usage = isRecord(insights.usage) ? insights.usage : {};
        const technical = isRecord(insights.technical) ? insights.technical : {};
        const cachePerformance = isRecord(technical.cachePerformance)
          ? technical.cachePerformance
          : {};

        logger.info({
          dau: getNumber(engagement.dau),
          mau: getNumber(engagement.mau),
          totalSongs: getNumber(usage.totalSongsPlayed),
          cacheHealth: getNumber(cachePerformance.overallHealthScore),
        }, 'Hourly business metrics summary');
      } catch (error) {
        logger.error({ error }, 'Failed to log business insights');
      }
    }, 3600000); // 1 hour
  }
}

// Export a function to create singleton instance with shared registry
let audioMetricsInstance: AudioMetricsCollector | null = null;

export function getAudioMetrics(registry?: Registry): AudioMetricsCollector {
  if (!audioMetricsInstance) {
    audioMetricsInstance = new AudioMetricsCollector(registry);
  }
  return audioMetricsInstance;
}

// For backward compatibility
export const audioMetrics = getAudioMetrics();
