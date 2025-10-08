/**
 * Search Performance Optimizer
 *
 * Advanced search optimization system that implements:
 * - Predictive cache warming based on trending queries
 * - Popular query pre-fetching
 * - Search result quality optimization
 * - Performance monitoring and auto-tuning
 */

import { logger } from '@discord-bot/logger';
import { searchCache } from './cache.js';
import { audioMetrics } from './metrics.js';

interface PopularQuery {
  query: string;
  source: string;
  frequency: number;
  lastUsed: number;
  avgResponseTime: number;
}

interface SearchPattern {
  hour: number;
  queries: string[];
  frequency: number;
}

export class SearchOptimizer {
  private popularQueries: Map<string, PopularQuery> = new Map();
  private searchPatterns: Map<number, SearchPattern> = new Map();
  private warmingInProgress = new Set<string>();
  private readonly maxPopularQueries = 200;
  private readonly warmingConcurrency = 5;

  constructor() {
    this.startBackgroundOptimization();
  }

  /**
   * Track search query for optimization
   */
  trackSearch(query: string, source: string, responseTime: number, cached: boolean): void {
    const key = `${source}:${query.toLowerCase()}`;
    const existing = this.popularQueries.get(key);

    if (existing) {
      existing.frequency++;
      existing.lastUsed = Date.now();
      existing.avgResponseTime = (existing.avgResponseTime + responseTime) / 2;
    } else {
      // Only track if we have space or this is better than the worst query
      if (this.popularQueries.size < this.maxPopularQueries) {
        this.popularQueries.set(key, {
          query,
          source,
          frequency: 1,
          lastUsed: Date.now(),
          avgResponseTime: responseTime
        });
      } else {
        // Replace least popular query if this one is better
        const leastPopular = this.findLeastPopularQuery();
        if (leastPopular && leastPopular.frequency < 3) {
          this.popularQueries.delete(leastPopular.key);
          this.popularQueries.set(key, {
            query,
            source,
            frequency: 1,
            lastUsed: Date.now(),
            avgResponseTime: responseTime
          });
        }
      }
    }

    // Track hourly patterns
    const currentHour = new Date().getHours();
    const pattern = this.searchPatterns.get(currentHour) || {
      hour: currentHour,
      queries: [],
      frequency: 0
    };

    if (!pattern.queries.includes(query) && pattern.queries.length < 50) {
      pattern.queries.push(query);
    }
    pattern.frequency++;
    this.searchPatterns.set(currentHour, pattern);
  }

  /**
   * Get trending queries for pre-warming
   */
  getTrendingQueries(limit: number = 20): PopularQuery[] {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    return Array.from(this.popularQueries.values())
      .filter(q => now - q.lastUsed < oneHour) // Only recent queries
      .sort((a, b) => {
        // Sort by frequency and recency
        const scoreA = a.frequency * (1 / Math.max(1, (now - a.lastUsed) / oneHour));
        const scoreB = b.frequency * (1 / Math.max(1, (now - b.lastUsed) / oneHour));
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  /**
   * Pre-warm cache with popular queries
   */
  async warmPopularQueries(player: any): Promise<void> {
    const trending = this.getTrendingQueries(10);
    const promises: Promise<void>[] = [];

    for (const popular of trending) {
      const key = `${popular.source}:${popular.query}`;

      if (this.warmingInProgress.has(key)) continue;
      if (promises.length >= this.warmingConcurrency) break;

      // Check if already cached
      const cached = await searchCache.getCachedSearchResult(popular.query, popular.source);
      if (cached) continue;

      this.warmingInProgress.add(key);
      promises.push(this.warmQuery(player, popular));
    }

    if (promises.length > 0) {
      logger.debug({ count: promises.length }, 'Pre-warming popular search queries');
      await Promise.allSettled(promises);
    }
  }

  /**
   * Pre-warm cache based on time patterns
   */
  async warmTimeBasedQueries(player: any): Promise<void> {
    const currentHour = new Date().getHours();
    const pattern = this.searchPatterns.get(currentHour);

    if (!pattern || pattern.queries.length === 0) return;

    const queries = pattern.queries.slice(0, 5); // Top 5 queries for this hour
    const promises: Promise<void>[] = [];

    for (const query of queries) {
      const key = `youtube:${query}`; // Default to YouTube

      if (this.warmingInProgress.has(key)) continue;
      if (promises.length >= 3) break; // Limit for time-based warming

      const cached = await searchCache.getCachedSearchResult(query, 'youtube');
      if (cached) continue;

      this.warmingInProgress.add(key);
      promises.push(this.warmQuery(player, {
        query,
        source: 'youtube',
        frequency: 0,
        lastUsed: Date.now(),
        avgResponseTime: 0
      }));
    }

    if (promises.length > 0) {
      logger.debug({ hour: currentHour, count: promises.length }, 'Pre-warming time-based queries');
      await Promise.allSettled(promises);
    }
  }

  /**
   * Warm a specific query
   */
  private async warmQuery(player: any, popular: PopularQuery): Promise<void> {
    const key = `${popular.source}:${popular.query}`;

    try {
      const startTime = Date.now();

      // Perform the search
      const result = await player.search(
        { query: popular.query },
        { id: 'cache-warmer' }
      );

      if (result?.tracks?.length > 0) {
        await searchCache.cacheSearchResult(
          popular.query,
          result.tracks,
          popular.source,
          undefined // No user for warming
        );

        const duration = Date.now() - startTime;
        logger.debug({
          query: popular.query,
          source: popular.source,
          results: result.tracks.length,
          duration
        }, 'Cache warming successful');
      }
    } catch (error) {
      logger.warn({
        query: popular.query,
        source: popular.source,
        error: error instanceof Error ? error.message : String(error)
      }, 'Cache warming failed');
    } finally {
      this.warmingInProgress.delete(key);
    }
  }

  /**
   * Get search performance recommendations
   */
  getPerformanceRecommendations(): {
    slowQueries: PopularQuery[];
    cacheHitRate: number;
    recommendedActions: string[];
  } {
    const slowQueries = Array.from(this.popularQueries.values())
      .filter(q => q.avgResponseTime > 500)
      .sort((a, b) => b.avgResponseTime - a.avgResponseTime)
      .slice(0, 10);

    const totalQueries = Array.from(this.popularQueries.values())
      .reduce((sum, q) => sum + q.frequency, 0);

    const fastQueries = Array.from(this.popularQueries.values())
      .filter(q => q.avgResponseTime < 200)
      .reduce((sum, q) => sum + q.frequency, 0);

    const estimatedCacheHitRate = totalQueries > 0 ? (fastQueries / totalQueries) * 100 : 0;

    const recommendations: string[] = [];

    if (slowQueries.length > 5) {
      recommendations.push('Consider pre-warming slow queries during low-usage periods');
    }

    if (estimatedCacheHitRate < 60) {
      recommendations.push('Increase cache TTL for popular queries');
    }

    if (this.popularQueries.size > this.maxPopularQueries * 0.9) {
      recommendations.push('Consider increasing popular query tracking limit');
    }

    return {
      slowQueries,
      cacheHitRate: estimatedCacheHitRate,
      recommendedActions: recommendations
    };
  }

  /**
   * Cleanup old search patterns and queries
   */
  cleanup(): void {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;

    // Remove very old queries
    for (const [key, query] of this.popularQueries.entries()) {
      if (now - query.lastUsed > sevenDays) {
        this.popularQueries.delete(key);
      }
    }

    // Keep only recent patterns
    for (const [hour, pattern] of this.searchPatterns.entries()) {
      // Remove patterns that haven't been used recently
      // This is a simplified cleanup - in production, you'd want more sophisticated logic
      if (pattern.frequency < 5) {
        this.searchPatterns.delete(hour);
      }
    }

    logger.debug({
      popularQueries: this.popularQueries.size,
      searchPatterns: this.searchPatterns.size
    }, 'Search optimizer cleanup completed');
  }

  /**
   * Start background optimization processes
   */
  private startBackgroundOptimization(): void {
    // Cleanup every 6 hours
    setInterval(() => {
      this.cleanup();
    }, 6 * 60 * 60 * 1000);

    // Performance reporting every 30 minutes
    setInterval(() => {
      const recommendations = this.getPerformanceRecommendations();
      if (recommendations.slowQueries.length > 0) {
        logger.info({
          slowQueriesCount: recommendations.slowQueries.length,
          cacheHitRate: recommendations.cacheHitRate.toFixed(1),
          recommendations: recommendations.recommendedActions
        }, 'Search performance analysis');
      }
    }, 30 * 60 * 1000);
  }

  /**
   * Find least popular query for replacement
   */
  private findLeastPopularQuery(): { key: string; frequency: number } | null {
    let leastPopular: { key: string; frequency: number } | null = null;

    for (const [key, query] of this.popularQueries.entries()) {
      if (!leastPopular || query.frequency < leastPopular.frequency) {
        leastPopular = { key, frequency: query.frequency };
      }
    }

    return leastPopular;
  }

  /**
   * Get current search statistics
   */
  getStats(): {
    popularQueries: number;
    searchPatterns: number;
    warmingInProgress: number;
    memoryUsage: number;
  } {
    const memoryUsage = this.estimateMemoryUsage();

    return {
      popularQueries: this.popularQueries.size,
      searchPatterns: this.searchPatterns.size,
      warmingInProgress: this.warmingInProgress.size,
      memoryUsage
    };
  }

  /**
   * Estimate memory usage in MB
   */
  private estimateMemoryUsage(): number {
    const avgQuerySize = 50; // bytes
    const avgPatternSize = 200; // bytes

    const totalSize =
      (this.popularQueries.size * (avgQuerySize + 100)) + // Popular queries + metadata
      (this.searchPatterns.size * avgPatternSize) +        // Search patterns
      (this.warmingInProgress.size * 20);                  // Warming set

    return Math.round(totalSize / 1024 / 1024 * 100) / 100; // Convert to MB
  }
}

export const searchOptimizer = new SearchOptimizer();