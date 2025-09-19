import { logger } from './index.js';
import { Counter, Histogram, Gauge, Registry } from 'prom-client';

export interface BusinessMetrics {
  // User engagement
  activeUsers: number;
  dailyActiveUsers: Set<string>;
  monthlyActiveUsers: Set<string>;
  userRetention: number;

  // Music playback
  songsPlayed: number;
  totalPlaytime: number;
  averageSessionDuration: number;
  peakConcurrentListeners: number;

  // Queue metrics
  averageQueueLength: number;
  queueCompletionRate: number;
  skipRate: number;

  // Search and discovery
  searchQueries: number;
  searchSuccessRate: number;
  popularSearchTerms: Map<string, number>;
  sourceDistribution: Map<string, number>; // YouTube, Spotify, etc.

  // Autoplay metrics
  autoplayEngagementRate: number;
  autoplaySkipRate: number;
  autoplaySuccessRate: number;

  // Error and reliability
  errorRate: number;
  commandSuccessRate: number;
  averageResponseTime: number;

  // Feature adoption
  featureUsage: Map<string, number>;
  commandUsage: Map<string, number>;
}

/**
 * Business metrics collector for data-driven decisions
 */
export class BusinessMetricsCollector {
  private registry: Registry;

  // Prometheus metrics
  private metrics!: {
    // User metrics
    activeUsers: Gauge;
    userSessions: Counter;
    sessionDuration: Histogram;

    // Playback metrics
    songsPlayed: Counter;
    playbackDuration: Histogram;
    songCompletionRate: Gauge;

    // Queue metrics
    queueLength: Histogram;
    queueOperations: Counter;

    // Search metrics
    searchQueries: Counter;
    searchLatency: Histogram;
    searchResults: Histogram;

    // Autoplay metrics
    autoplayTriggers: Counter;
    autoplaySuccess: Counter;
    autoplaySkips: Counter;

    // Command metrics
    commandExecutions: Counter;
    commandLatency: Histogram;
    commandErrors: Counter;

    // Feature metrics
    featureUsage: Counter;
  };

  // In-memory aggregations
  private aggregations = {
    dailyActiveUsers: new Map<string, Set<string>>(), // date -> Set<userId>
    monthlyActiveUsers: new Map<string, Set<string>>(),
    sessionStartTimes: new Map<string, number>(), // userId:guildId -> timestamp
    searchTerms: new Map<string, number>(),
    popularTracks: new Map<string, { plays: number; title: string }>(),
    guildActivity: new Map<string, { commands: number; lastActive: number }>()
  };

  constructor(registry?: Registry) {
    this.registry = registry || new Registry();
    this.initializeMetrics();
    this.startAggregationJobs();
  }

  private initializeMetrics(): void {
    // User metrics
    this.metrics = {
      activeUsers: new Gauge({
        name: 'discord_bot_active_users',
        help: 'Number of active users',
        labelNames: ['guild_id'],
        registers: [this.registry]
      }),

      userSessions: new Counter({
        name: 'discord_bot_user_sessions_total',
        help: 'Total user sessions',
        labelNames: ['guild_id'],
        registers: [this.registry]
      }),

      sessionDuration: new Histogram({
        name: 'discord_bot_session_duration_seconds',
        help: 'User session duration in seconds',
        labelNames: ['guild_id'],
        buckets: [60, 300, 600, 1800, 3600, 7200, 14400], // 1m, 5m, 10m, 30m, 1h, 2h, 4h
        registers: [this.registry]
      }),

      // Playback metrics
      songsPlayed: new Counter({
        name: 'discord_bot_songs_played_total',
        help: 'Total songs played',
        labelNames: ['guild_id', 'source', 'autoplay'],
        registers: [this.registry]
      }),

      playbackDuration: new Histogram({
        name: 'discord_bot_playback_duration_seconds',
        help: 'Song playback duration',
        labelNames: ['guild_id', 'source'],
        buckets: [30, 60, 120, 180, 240, 300, 600], // 30s to 10m
        registers: [this.registry]
      }),

      songCompletionRate: new Gauge({
        name: 'discord_bot_song_completion_rate',
        help: 'Rate of songs played to completion',
        labelNames: ['guild_id'],
        registers: [this.registry]
      }),

      // Queue metrics
      queueLength: new Histogram({
        name: 'discord_bot_queue_length',
        help: 'Queue length distribution',
        labelNames: ['guild_id'],
        buckets: [0, 1, 5, 10, 25, 50, 100],
        registers: [this.registry]
      }),

      queueOperations: new Counter({
        name: 'discord_bot_queue_operations_total',
        help: 'Queue operations',
        labelNames: ['guild_id', 'operation'], // add, remove, clear, shuffle
        registers: [this.registry]
      }),

      // Search metrics
      searchQueries: new Counter({
        name: 'discord_bot_search_queries_total',
        help: 'Total search queries',
        labelNames: ['guild_id', 'source', 'cached'],
        registers: [this.registry]
      }),

      searchLatency: new Histogram({
        name: 'discord_bot_search_latency_seconds',
        help: 'Search query latency',
        labelNames: ['source', 'cached'],
        buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [this.registry]
      }),

      searchResults: new Histogram({
        name: 'discord_bot_search_results_count',
        help: 'Number of search results returned',
        labelNames: ['source'],
        buckets: [0, 1, 5, 10, 25, 50, 100],
        registers: [this.registry]
      }),

      // Autoplay metrics
      autoplayTriggers: new Counter({
        name: 'discord_bot_autoplay_triggers_total',
        help: 'Autoplay trigger events',
        labelNames: ['guild_id', 'trigger_type'], // queue_empty, user_request
        registers: [this.registry]
      }),

      autoplaySuccess: new Counter({
        name: 'discord_bot_autoplay_success_total',
        help: 'Successful autoplay recommendations',
        labelNames: ['guild_id', 'recommendation_type'], // similar, artist, genre
        registers: [this.registry]
      }),

      autoplaySkips: new Counter({
        name: 'discord_bot_autoplay_skips_total',
        help: 'Autoplay tracks skipped',
        labelNames: ['guild_id', 'skip_reason'],
        registers: [this.registry]
      }),

      // Command metrics
      commandExecutions: new Counter({
        name: 'discord_bot_command_executions_total',
        help: 'Command executions',
        labelNames: ['command', 'guild_id', 'status'],
        registers: [this.registry]
      }),

      commandLatency: new Histogram({
        name: 'discord_bot_command_latency_seconds',
        help: 'Command execution latency',
        labelNames: ['command'],
        buckets: [0.1, 0.25, 0.5, 1, 2.5, 5],
        registers: [this.registry]
      }),

      commandErrors: new Counter({
        name: 'discord_bot_command_errors_total',
        help: 'Command execution errors',
        labelNames: ['command', 'error_type'],
        registers: [this.registry]
      }),

      // Feature metrics
      featureUsage: new Counter({
        name: 'discord_bot_feature_usage_total',
        help: 'Feature usage tracking',
        labelNames: ['feature', 'guild_id'],
        registers: [this.registry]
      })
    };
  }

  // User engagement tracking
  trackUserActivity(userId: string, guildId: string): void {
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0, 7);

    // Daily active users
    if (!this.aggregations.dailyActiveUsers.has(today)) {
      this.aggregations.dailyActiveUsers.set(today, new Set());
    }
    this.aggregations.dailyActiveUsers.get(today)!.add(userId);

    // Monthly active users
    if (!this.aggregations.monthlyActiveUsers.has(month)) {
      this.aggregations.monthlyActiveUsers.set(month, new Set());
    }
    this.aggregations.monthlyActiveUsers.get(month)!.add(userId);

    // Update guild activity
    const guildStats = this.aggregations.guildActivity.get(guildId) || { commands: 0, lastActive: 0 };
    guildStats.lastActive = Date.now();
    this.aggregations.guildActivity.set(guildId, guildStats);

    this.metrics.activeUsers.labels(guildId).inc();
  }

  trackSessionStart(userId: string, guildId: string): void {
    const sessionKey = `${userId}:${guildId}`;
    this.aggregations.sessionStartTimes.set(sessionKey, Date.now());
    this.metrics.userSessions.labels(guildId).inc();
  }

  trackSessionEnd(userId: string, guildId: string): void {
    const sessionKey = `${userId}:${guildId}`;
    const startTime = this.aggregations.sessionStartTimes.get(sessionKey);

    if (startTime) {
      const duration = (Date.now() - startTime) / 1000;
      this.metrics.sessionDuration.labels(guildId).observe(duration);
      this.aggregations.sessionStartTimes.delete(sessionKey);
    }
  }

  // Music playback tracking
  trackSongPlay(
    guildId: string,
    track: { title: string; duration: number; source?: string },
    isAutoplay: boolean = false
  ): void {
    const source = track.source || 'unknown';

    this.metrics.songsPlayed.labels(guildId, source, String(isAutoplay)).inc();
    this.metrics.playbackDuration.labels(guildId, source).observe(track.duration);

    // Track popular tracks
    const trackKey = `${source}:${track.title}`;
    const trackStats = this.aggregations.popularTracks.get(trackKey) || { plays: 0, title: track.title };
    trackStats.plays++;
    this.aggregations.popularTracks.set(trackKey, trackStats);
  }

  trackSongSkip(guildId: string, playedDuration: number, totalDuration: number): void {
    const completionRate = playedDuration / totalDuration;
    this.metrics.songCompletionRate.labels(guildId).set(completionRate);
  }

  // Queue tracking
  trackQueueOperation(guildId: string, operation: 'add' | 'remove' | 'clear' | 'shuffle', queueLength: number): void {
    this.metrics.queueOperations.labels(guildId, operation).inc();
    this.metrics.queueLength.labels(guildId).observe(queueLength);
  }

  // Search tracking
  trackSearch(
    guildId: string,
    query: string,
    source: string,
    resultCount: number,
    latency: number,
    cached: boolean = false
  ): void {
    this.metrics.searchQueries.labels(guildId, source, String(cached)).inc();
    this.metrics.searchLatency.labels(source, String(cached)).observe(latency);
    this.metrics.searchResults.labels(source).observe(resultCount);

    // Track search terms
    const normalizedQuery = query.toLowerCase().trim();
    this.aggregations.searchTerms.set(
      normalizedQuery,
      (this.aggregations.searchTerms.get(normalizedQuery) || 0) + 1
    );
  }

  // Autoplay tracking
  trackAutoplayTrigger(guildId: string, triggerType: 'queue_empty' | 'user_request'): void {
    this.metrics.autoplayTriggers.labels(guildId, triggerType).inc();
  }

  trackAutoplayRecommendation(
    guildId: string,
    recommendationType: 'similar' | 'artist' | 'genre' | 'mixed',
    success: boolean
  ): void {
    if (success) {
      this.metrics.autoplaySuccess.labels(guildId, recommendationType).inc();
    }
  }

  trackAutoplaySkip(guildId: string, reason: string): void {
    this.metrics.autoplaySkips.labels(guildId, reason).inc();
  }

  // Command tracking
  trackCommand(
    command: string,
    guildId: string,
    latency: number,
    success: boolean,
    errorType?: string
  ): void {
    this.metrics.commandExecutions.labels(command, guildId, success ? 'success' : 'failure').inc();
    this.metrics.commandLatency.labels(command).observe(latency);

    if (!success && errorType) {
      this.metrics.commandErrors.labels(command, errorType).inc();
    }

    // Update guild activity
    const guildStats = this.aggregations.guildActivity.get(guildId) || { commands: 0, lastActive: 0 };
    guildStats.commands++;
    guildStats.lastActive = Date.now();
    this.aggregations.guildActivity.set(guildId, guildStats);
  }

  // Feature tracking
  trackFeatureUsage(feature: string, guildId: string): void {
    this.metrics.featureUsage.labels(feature, guildId).inc();
  }

  // Alias methods for backward compatibility and tests
  trackSearchQuery(
    guildId: string,
    query: string,
    source: string,
    resultCount: number,
    latency: number,
    cached: boolean = false,
    userId?: string
  ): void {
    this.trackSearch(guildId, query, source, resultCount, latency, cached);
    if (userId) {
      this.trackUserActivity(userId, guildId);
    }
  }

  trackCommandExecution(
    command: string,
    guildId: string,
    latency: number,
    success: boolean,
    errorType?: string,
    userId?: string
  ): void {
    this.trackCommand(command, guildId, latency, success, errorType);
    if (userId) {
      this.trackUserActivity(userId, guildId);
    }
  }

  // Get business insights
  getBusinessInsights(): {
    timestamp: string;
    engagement: {
      dau: number;
      mau: number;
      avgSessionDuration: number;
      retentionRate: number;
    };
    usage: {
      totalSongsPlayed: number;
      topSearchTerms: Array<{ term: string; count: number }>;
      topTracks: Array<{ title: string; plays: number }>;
      sourceDistribution: Record<string, number>;
    };
    performance: {
      searchSuccessRate: number;
      commandSuccessRate: number;
      autoplayEngagement: number;
    };
    guilds: {
      activeGuilds: number;
      topGuilds: Array<{ guildId: string; commands: number }>;
    };
  } {
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0, 7);

    // Sort search terms
    const topSearchTerms = Array.from(this.aggregations.searchTerms.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term, count]) => ({ term, count }));

    // Sort popular tracks
    const topTracks = Array.from(this.aggregations.popularTracks.values())
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 10)
      .map(({ title, plays }) => ({ title, plays }));

    // Sort guilds by activity
    const topGuilds = Array.from(this.aggregations.guildActivity.entries())
      .sort((a, b) => b[1].commands - a[1].commands)
      .slice(0, 10)
      .map(([guildId, stats]) => ({ guildId, commands: stats.commands }));

    // Calculate active guilds (active in last 24 hours)
    const activeGuilds = Array.from(this.aggregations.guildActivity.values())
      .filter(stats => Date.now() - stats.lastActive < 86400000).length;

    return {
      timestamp: new Date().toISOString(),
      engagement: {
        dau: this.aggregations.dailyActiveUsers.get(today)?.size || 0,
        mau: this.aggregations.monthlyActiveUsers.get(month)?.size || 0,
        avgSessionDuration: 0, // Would need to calculate from histogram
        retentionRate: 0 // Would need historical data
      },
      usage: {
        totalSongsPlayed: 0, // Would need to sum from counter
        topSearchTerms,
        topTracks,
        sourceDistribution: {} // Would need to aggregate from metrics
      },
      performance: {
        searchSuccessRate: 0, // Would need to calculate
        commandSuccessRate: 0, // Would need to calculate
        autoplayEngagement: 0 // Would need to calculate
      },
      guilds: {
        activeGuilds,
        topGuilds
      }
    };
  }

  // Export metrics for Prometheus
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  private startAggregationJobs(): void {
    // Clean up old data every hour
    setInterval(() => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30); // Keep 30 days of data
      const cutoff = cutoffDate.toISOString().split('T')[0];

      // Clean daily active users
      for (const [date] of this.aggregations.dailyActiveUsers) {
        if (date < cutoff) {
          this.aggregations.dailyActiveUsers.delete(date);
        }
      }

      // Clean old sessions
      const sessionCutoff = Date.now() - 86400000; // 24 hours
      for (const [key, startTime] of this.aggregations.sessionStartTimes) {
        if (startTime < sessionCutoff) {
          this.aggregations.sessionStartTimes.delete(key);
        }
      }

      logger.debug('Business metrics aggregation cleanup completed');
    }, 3600000); // Every hour
  }
}

// Singleton instance
let metricsCollector: BusinessMetricsCollector | null = null;

export function getBusinessMetrics(registry?: Registry): BusinessMetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new BusinessMetricsCollector(registry);
  }
  return metricsCollector;
}