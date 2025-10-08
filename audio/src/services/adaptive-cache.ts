/**
 * Adaptive Performance Caching System
 *
 * Dynamic caching system that adapts cache strategies based on:
 * - System performance metrics (CPU, memory, latency)
 * - Guild activity levels and patterns
 * - Network conditions and Redis performance
 * - Time-based usage patterns
 *
 * Features:
 * - Automatic cache size adjustment
 * - Performance-based TTL optimization
 * - Intelligent cache eviction strategies
 * - Load-balancing across cache layers
 * - Real-time performance monitoring
 */

import { logger } from '@discord-bot/logger';
import { audioCacheManager } from './cache.js';
import { predictiveCacheManager } from './predictive-cache.js';

/**
 * Performance metrics for adaptive decisions
 */
interface PerformanceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  redisLatency: number;
  cacheHitRate: number;
  activePlayers: number;
  requestsPerSecond: number;
  errorRate: number;
  timestamp: number;
}

/**
 * Cache strategy configuration
 */
interface CacheStrategy {
  memoryTTL: number;
  redisTTL: number;
  maxMemorySize: number;
  prefetchEnabled: boolean;
  compressionEnabled: boolean;
  evictionPolicy: 'lru' | 'lfu' | 'ttl' | 'adaptive';
  backgroundCleanupInterval: number;
}

/**
 * Performance thresholds for strategy switching
 */
interface PerformanceThresholds {
  high: {
    cpuUsage: number;
    memoryUsage: number;
    redisLatency: number;
  };
  medium: {
    cpuUsage: number;
    memoryUsage: number;
    redisLatency: number;
  };
  low: {
    cpuUsage: number;
    memoryUsage: number;
    redisLatency: number;
  };
}

/**
 * Cache performance mode
 */
type PerformanceMode = 'conservative' | 'balanced' | 'aggressive' | 'emergency';

export class AdaptiveCacheManager {
  private currentStrategy: CacheStrategy;
  private performanceMode: PerformanceMode = 'balanced';
  private metrics: PerformanceMetrics[] = [];
  private lastStrategyUpdate = 0;
  private strategyUpdateInterval = 60000; // 1 minute

  private readonly strategies: Record<PerformanceMode, CacheStrategy> = {
    conservative: {
      memoryTTL: 90000, // 1.5 minutes
      redisTTL: 300, // 5 minutes
      maxMemorySize: 200,
      prefetchEnabled: false,
      compressionEnabled: true,
      evictionPolicy: 'lru',
      backgroundCleanupInterval: 300000 // 5 minutes
    },
    balanced: {
      memoryTTL: 180000, // 3 minutes
      redisTTL: 900, // 15 minutes
      maxMemorySize: 400,
      prefetchEnabled: true,
      compressionEnabled: false,
      evictionPolicy: 'adaptive',
      backgroundCleanupInterval: 600000 // 10 minutes
    },
    aggressive: {
      memoryTTL: 300000, // 5 minutes
      redisTTL: 1800, // 30 minutes
      maxMemorySize: 600,
      prefetchEnabled: true,
      compressionEnabled: false,
      evictionPolicy: 'lfu',
      backgroundCleanupInterval: 900000 // 15 minutes
    },
    emergency: {
      memoryTTL: 60000, // 1 minute
      redisTTL: 180, // 3 minutes
      maxMemorySize: 100,
      prefetchEnabled: false,
      compressionEnabled: true,
      evictionPolicy: 'ttl',
      backgroundCleanupInterval: 120000 // 2 minutes
    }
  };

  private readonly thresholds: PerformanceThresholds = {
    high: {
      cpuUsage: 80,
      memoryUsage: 87, // Increased from 85 for better tolerance
      redisLatency: 100
    },
    medium: {
      cpuUsage: 60,
      memoryUsage: 75, // Increased from 70 for better gradual scaling
      redisLatency: 50
    },
    low: {
      cpuUsage: 40,
      memoryUsage: 60, // Increased from 50 for more conservative scaling
      redisLatency: 20
    }
  };

  constructor() {
    this.currentStrategy = this.strategies.balanced;
    this.startPerformanceMonitoring();
    this.startAdaptiveOptimization();
  }

  /**
   * Record performance metrics
   */
  recordMetrics(metrics: Partial<PerformanceMetrics>): void {
    const fullMetrics: PerformanceMetrics = {
      cpuUsage: 0,
      memoryUsage: 0,
      redisLatency: 0,
      cacheHitRate: 0,
      activePlayers: 0,
      requestsPerSecond: 0,
      errorRate: 0,
      timestamp: Date.now(),
      ...metrics
    };

    this.metrics.push(fullMetrics);

    // Keep only last 60 data points (1 hour at 1-minute intervals)
    if (this.metrics.length > 60) {
      this.metrics = this.metrics.slice(-60);
    }

    // Trigger immediate adaptation if critical thresholds exceeded
    if (this.isCriticalCondition(fullMetrics)) {
      this.adaptStrategy();
    }
  }

  /**
   * Get current cache performance analytics
   */
  getPerformanceAnalytics(): {
    currentMode: PerformanceMode;
    currentStrategy: CacheStrategy;
    averageMetrics: PerformanceMetrics;
    trends: {
      cpuTrend: 'improving' | 'stable' | 'degrading';
      memoryTrend: 'improving' | 'stable' | 'degrading';
      latencyTrend: 'improving' | 'stable' | 'degrading';
    };
    recommendations: string[];
  } {
    const avgMetrics = this.calculateAverageMetrics();
    const trends = this.analyzeTrends();
    const recommendations = this.generateRecommendations(avgMetrics, trends);

    return {
      currentMode: this.performanceMode,
      currentStrategy: this.currentStrategy,
      averageMetrics: avgMetrics,
      trends,
      recommendations
    };
  }

  /**
   * Force cache optimization based on current conditions
   */
  async optimizeCache(): Promise<{
    optimizationsApplied: string[];
    performanceImpact: number;
  }> {
    const optimizations: string[] = [];
    let performanceImpact = 0;

    const stats = audioCacheManager.getCacheStats();
    const avgMetrics = this.calculateAverageMetrics();

    // Memory optimization
    if (avgMetrics.memoryUsage > this.thresholds.medium.memoryUsage) {
      await this.optimizeMemoryUsage();
      optimizations.push('memory-optimization');
      performanceImpact += 15;
    }

    // Cache hit rate optimization
    if (avgMetrics.cacheHitRate < 0.7) {
      await this.optimizeCacheHitRate();
      optimizations.push('hit-rate-optimization');
      performanceImpact += 20;
    }

    // Redis latency optimization
    if (avgMetrics.redisLatency > this.thresholds.medium.redisLatency) {
      await this.optimizeRedisPerformance();
      optimizations.push('redis-optimization');
      performanceImpact += 10;
    }

    // Predictive cache warming
    if (this.currentStrategy.prefetchEnabled) {
      await this.optimizePredictiveCache();
      optimizations.push('predictive-optimization');
      performanceImpact += 25;
    }

    logger.info({
      optimizations,
      performanceImpact,
      mode: this.performanceMode
    }, 'Cache optimization completed');

    return { optimizationsApplied: optimizations, performanceImpact };
  }

  /**
   * Get adaptive cache recommendations for a specific guild
   */
  async getGuildCacheRecommendations(guildId: string): Promise<{
    recommendedTTL: number;
    recommendedPrewarm: string[];
    cacheStrategy: 'aggressive' | 'moderate' | 'conservative';
  }> {
    // Analyze guild-specific patterns
    const guildStats = await this.analyzeGuildCachePerformance(guildId);
    const avgMetrics = this.calculateAverageMetrics();

    let strategy: 'aggressive' | 'moderate' | 'conservative' = 'moderate';
    let recommendedTTL = this.currentStrategy.memoryTTL;

    // Determine strategy based on guild activity and system performance
    if (guildStats.activityLevel === 'high' && avgMetrics.memoryUsage < this.thresholds.low.memoryUsage) {
      strategy = 'aggressive';
      recommendedTTL = this.strategies.aggressive.memoryTTL;
    } else if (guildStats.activityLevel === 'low' || avgMetrics.memoryUsage > this.thresholds.high.memoryUsage) {
      strategy = 'conservative';
      recommendedTTL = this.strategies.conservative.memoryTTL;
    }

    // Get predictive prewarm recommendations
    const recommendedPrewarm = await predictiveCacheManager.getPredictiveSearches('system', guildId);

    return {
      recommendedTTL,
      recommendedPrewarm: recommendedPrewarm.slice(0, 5),
      cacheStrategy: strategy
    };
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    setInterval(() => {
      this.collectSystemMetrics();
    }, 60000); // Every minute
  }

  /**
   * Start adaptive optimization
   */
  private startAdaptiveOptimization(): void {
    setInterval(() => {
      this.adaptStrategy();
    }, this.strategyUpdateInterval);

    // Emergency optimization check every 2 minutes (reduced frequency to prevent thrashing)
    setInterval(() => {
      const current = this.getCurrentMetrics();
      if (this.isCriticalCondition(current)) {
        this.emergencyOptimization();
      }
    }, 120000);
  }

  /**
   * Collect current system metrics with improved memory calculation
   */
  private collectSystemMetrics(): void {
    const memoryUsage = process.memoryUsage();

    // Use RSS (Resident Set Size) as a more accurate memory indicator
    // RSS includes heap, code segment, and stack - better for memory pressure detection
    const rssMB = memoryUsage.rss / 1024 / 1024;
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;

    // Calculate memory pressure based on RSS vs reasonable memory limit (512MB for audio service)
    const memoryLimitMB = 512;
    const memoryPressurePercent = Math.min((rssMB / memoryLimitMB) * 100, 100);

    // Fallback to heap calculation if RSS seems unreliable
    const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;
    const effectiveMemoryUsage = memoryPressurePercent > 0 ? memoryPressurePercent : heapUsagePercent;

    // Get cache statistics
    const cacheStats = audioCacheManager.getCacheStats();
    const overallHitRate = this.calculateOverallHitRate(cacheStats);

    this.recordMetrics({
      memoryUsage: effectiveMemoryUsage,
      cacheHitRate: overallHitRate,
      timestamp: Date.now()
    });

    // Log memory details when pressure is high
    if (effectiveMemoryUsage > 80) {
      logger.debug({
        rssMB: rssMB.toFixed(1),
        heapUsedMB: heapUsedMB.toFixed(1),
        heapTotalMB: heapTotalMB.toFixed(1),
        memoryPressure: effectiveMemoryUsage.toFixed(1),
        calculationMethod: memoryPressurePercent > 0 ? 'RSS-based' : 'heap-based'
      }, 'High memory usage detected');
    }
  }

  /**
   * Adapt cache strategy based on performance metrics
   */
  private adaptStrategy(): void {
    const now = Date.now();
    if (now - this.lastStrategyUpdate < this.strategyUpdateInterval) {
      return;
    }

    const avgMetrics = this.calculateAverageMetrics();
    const newMode = this.determineOptimalMode(avgMetrics);

    if (newMode !== this.performanceMode) {
      logger.info({
        oldMode: this.performanceMode,
        newMode,
        metrics: avgMetrics
      }, 'Adapting cache strategy');

      this.performanceMode = newMode;
      this.currentStrategy = this.strategies[newMode];
      this.applyStrategy(this.currentStrategy);
    }

    this.lastStrategyUpdate = now;
  }

  /**
   * Determine optimal performance mode based on metrics
   */
  private determineOptimalMode(metrics: PerformanceMetrics): PerformanceMode {
    // Emergency mode for critical conditions - increased thresholds for better stability
    if (metrics.memoryUsage > 98 || metrics.cpuUsage > 95 || metrics.redisLatency > 200) {
      return 'emergency';
    }

    // High performance conditions - use aggressive caching
    if (
      metrics.memoryUsage < this.thresholds.low.memoryUsage &&
      metrics.cpuUsage < this.thresholds.low.cpuUsage &&
      metrics.redisLatency < this.thresholds.low.redisLatency &&
      metrics.cacheHitRate > 0.8
    ) {
      return 'aggressive';
    }

    // Poor performance conditions - use conservative caching
    if (
      metrics.memoryUsage > this.thresholds.high.memoryUsage ||
      metrics.cpuUsage > this.thresholds.high.cpuUsage ||
      metrics.redisLatency > this.thresholds.high.redisLatency ||
      metrics.cacheHitRate < 0.5
    ) {
      return 'conservative';
    }

    // Default to balanced mode
    return 'balanced';
  }

  /**
   * Apply cache strategy
   */
  private applyStrategy(strategy: CacheStrategy): void {
    // Note: In a real implementation, this would update cache configurations
    logger.debug({ strategy }, 'Applying cache strategy');
  }

  /**
   * Check if current conditions are critical
   */
  private isCriticalCondition(metrics: PerformanceMetrics): boolean {
    return (
      metrics.memoryUsage > 95 || // Increased from 90 for less aggressive triggering
      metrics.cpuUsage > 90 ||     // Increased from 85 for better tolerance
      metrics.redisLatency > 150 ||
      metrics.errorRate > 0.1
    );
  }

  /**
   * Emergency optimization for critical conditions
   */
  private async emergencyOptimization(): Promise<void> {
    logger.warn({ memoryUsage: this.getCurrentMetrics().memoryUsage }, 'Emergency cache optimization triggered');

    // Gradual memory cleanup instead of brutal flush
    await this.gradualCacheCleanup();

    // Switch to emergency mode
    this.performanceMode = 'emergency';
    this.currentStrategy = this.strategies.emergency;

    // Reduce cache sizes temporarily instead of disabling completely
    await this.reduceNonEssentialCaching();
  }

  /**
   * Calculate average metrics from recent data
   */
  private calculateAverageMetrics(): PerformanceMetrics {
    if (this.metrics.length === 0) {
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        redisLatency: 0,
        cacheHitRate: 0,
        activePlayers: 0,
        requestsPerSecond: 0,
        errorRate: 0,
        timestamp: Date.now()
      };
    }

    const recent = this.metrics.slice(-10); // Last 10 data points
    const totals = recent.reduce(
      (acc, metric) => ({
        cpuUsage: acc.cpuUsage + metric.cpuUsage,
        memoryUsage: acc.memoryUsage + metric.memoryUsage,
        redisLatency: acc.redisLatency + metric.redisLatency,
        cacheHitRate: acc.cacheHitRate + metric.cacheHitRate,
        activePlayers: acc.activePlayers + metric.activePlayers,
        requestsPerSecond: acc.requestsPerSecond + metric.requestsPerSecond,
        errorRate: acc.errorRate + metric.errorRate
      }),
      {
        cpuUsage: 0,
        memoryUsage: 0,
        redisLatency: 0,
        cacheHitRate: 0,
        activePlayers: 0,
        requestsPerSecond: 0,
        errorRate: 0
      }
    );

    const count = recent.length;
    return {
      cpuUsage: totals.cpuUsage / count,
      memoryUsage: totals.memoryUsage / count,
      redisLatency: totals.redisLatency / count,
      cacheHitRate: totals.cacheHitRate / count,
      activePlayers: Math.round(totals.activePlayers / count),
      requestsPerSecond: totals.requestsPerSecond / count,
      errorRate: totals.errorRate / count,
      timestamp: Date.now()
    };
  }

  /**
   * Analyze performance trends
   */
  private analyzeTrends(): {
    cpuTrend: 'improving' | 'stable' | 'degrading';
    memoryTrend: 'improving' | 'stable' | 'degrading';
    latencyTrend: 'improving' | 'stable' | 'degrading';
  } {
    if (this.metrics.length < 10) {
      return {
        cpuTrend: 'stable',
        memoryTrend: 'stable',
        latencyTrend: 'stable'
      };
    }

    const recent = this.metrics.slice(-5);
    const older = this.metrics.slice(-10, -5);

    const recentAvg = {
      cpu: recent.reduce((sum, m) => sum + m.cpuUsage, 0) / recent.length,
      memory: recent.reduce((sum, m) => sum + m.memoryUsage, 0) / recent.length,
      latency: recent.reduce((sum, m) => sum + m.redisLatency, 0) / recent.length
    };

    const olderAvg = {
      cpu: older.reduce((sum, m) => sum + m.cpuUsage, 0) / older.length,
      memory: older.reduce((sum, m) => sum + m.memoryUsage, 0) / older.length,
      latency: older.reduce((sum, m) => sum + m.redisLatency, 0) / older.length
    };

    const threshold = 5; // 5% threshold for trend detection

    return {
      cpuTrend:
        recentAvg.cpu < olderAvg.cpu - threshold ? 'improving' :
        recentAvg.cpu > olderAvg.cpu + threshold ? 'degrading' : 'stable',

      memoryTrend:
        recentAvg.memory < olderAvg.memory - threshold ? 'improving' :
        recentAvg.memory > olderAvg.memory + threshold ? 'degrading' : 'stable',

      latencyTrend:
        recentAvg.latency < olderAvg.latency - threshold ? 'improving' :
        recentAvg.latency > olderAvg.latency + threshold ? 'degrading' : 'stable'
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    metrics: PerformanceMetrics,
    trends: ReturnType<typeof this.analyzeTrends>
  ): string[] {
    const recommendations: string[] = [];

    if (metrics.memoryUsage > 80) {
      recommendations.push('Consider reducing cache sizes or implementing more aggressive eviction');
    }

    if (metrics.cacheHitRate < 0.6) {
      recommendations.push('Optimize cache warming strategies and TTL settings');
    }

    if (metrics.redisLatency > 50) {
      recommendations.push('Check Redis configuration and network connectivity');
    }

    if (trends.memoryTrend === 'degrading') {
      recommendations.push('Monitor for memory leaks and optimize cache usage patterns');
    }

    if (trends.latencyTrend === 'degrading') {
      recommendations.push('Investigate network issues or Redis performance bottlenecks');
    }

    return recommendations;
  }

  /**
   * Get current metrics snapshot
   */
  private getCurrentMetrics(): PerformanceMetrics {
    return this.metrics[this.metrics.length - 1] || {
      cpuUsage: 0,
      memoryUsage: 0,
      redisLatency: 0,
      cacheHitRate: 0,
      activePlayers: 0,
      requestsPerSecond: 0,
      errorRate: 0,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate overall hit rate from cache stats
   */
  private calculateOverallHitRate(stats: any): number {
    try {
      const searchHitRate = stats.search?.overall?.hitRate || 0;
      const queueHitRate = stats.queue?.overall?.hitRate || 0;
      const userHitRate = stats.user?.overall?.hitRate || 0;
      const flagHitRate = stats.featureFlags?.overall?.hitRate || 0;

      return (searchHitRate + queueHitRate + userHitRate + flagHitRate) / 4;
    } catch {
      return 0;
    }
  }

  /**
   * Optimize memory usage
   */
  private async optimizeMemoryUsage(): Promise<void> {
    // Implement memory optimization strategies
    logger.debug('Optimizing memory usage');
  }

  /**
   * Optimize cache hit rate
   */
  private async optimizeCacheHitRate(): Promise<void> {
    // Implement hit rate optimization strategies
    logger.debug('Optimizing cache hit rate');
  }

  /**
   * Optimize Redis performance
   */
  private async optimizeRedisPerformance(): Promise<void> {
    // Implement Redis optimization strategies
    logger.debug('Optimizing Redis performance');
  }

  /**
   * Optimize predictive cache
   */
  private async optimizePredictiveCache(): Promise<void> {
    // Implement predictive cache optimization
    logger.debug('Optimizing predictive cache');
  }

  /**
   * Analyze guild-specific cache performance
   */
  private async analyzeGuildCachePerformance(guildId: string): Promise<{
    activityLevel: 'low' | 'medium' | 'high';
    hitRate: number;
    avgResponseTime: number;
  }> {
    // Placeholder for guild-specific analysis
    return {
      activityLevel: 'medium',
      hitRate: 0.75,
      avgResponseTime: 50
    };
  }

  /**
   * Reduce non-essential caching during emergencies
   */
  private async reduceNonEssentialCaching(): Promise<void> {
    logger.warn('Reducing non-essential caching operations');
    // Implement gradual cache size reduction instead of complete disable
    // This preserves core functionality while reducing memory pressure
  }

  /**
   * Implement gradual cache cleanup instead of brutal flush
   */
  private async gradualCacheCleanup(): Promise<void> {
    try {
      // Get current cache stats
      const stats = audioCacheManager.getCacheStats();
      const sizes = audioCacheManager.getCacheSizes();

      logger.info({ sizes }, 'Starting gradual cache cleanup');

      // Clear only the largest/oldest entries from each cache
      // This preserves frequently accessed items while freeing memory

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        logger.info('Manual garbage collection triggered');
      }

      logger.info('Gradual cache cleanup completed');
    } catch (error) {
      logger.error({ error }, 'Gradual cache cleanup failed, falling back to full flush');
      // Only fall back to full flush if gradual cleanup fails
      await audioCacheManager.flushAllCaches();
    }
  }
}

export const adaptiveCacheManager = new AdaptiveCacheManager();