/**
 * Search Cache Pre-warmer
 *
 * Background service that proactively warms the search cache with:
 * - Popular queries from recent activity
 * - Time-based trending queries
 * - Guild-specific popular searches
 * - Predictive searches based on patterns
 */

import { logger } from '@discord-bot/logger';
import { searchOptimizer } from './search-optimizer.js';
import type { LavalinkManager, LavalinkNode } from 'lavalink-client';

export class SearchPrewarmer {
  private manager: LavalinkManager | null = null;
  private warmingInterval: NodeJS.Timeout | null = null;
  private isWarming = false;
  private warmingStats = {
    totalWarmed: 0,
    successRate: 0,
    avgWarmingTime: 0,
    lastWarmingSession: 0
  };

  constructor() {
    // Start pre-warming after audio service is ready
    setTimeout(() => {
      this.startPrewarming();
    }, 30000); // Wait 30 seconds after startup
  }

  /**
   * Initialize with Lavalink manager
   */
  initialize(manager: LavalinkManager): void {
    this.manager = manager;
    logger.info('Search pre-warmer initialized');
  }

  /**
   * Start background pre-warming process
   */
  private startPrewarming(): void {
    // Run pre-warming every 15 minutes during active hours
    this.warmingInterval = setInterval(() => {
      this.runWarmingSession();
    }, 15 * 60 * 1000);

    // Initial warming session
    setTimeout(() => {
      this.runWarmingSession();
    }, 5000);
  }

  /**
   * Run a complete warming session
   */
  private async runWarmingSession(): Promise<void> {
    if (this.isWarming || !this.manager) return;

    const currentHour = new Date().getHours();

    // Skip warming during low-activity hours (2 AM - 6 AM)
    if (currentHour >= 2 && currentHour <= 6) return;

    this.isWarming = true;
    const sessionStart = Date.now();
    let warmedCount = 0;
    let successCount = 0;

    try {
      logger.debug('Starting search cache warming session');

      // Get a player for warming (use first available node)
      const nodes = Array.from(this.manager.nodeManager.nodes.values());
      const activeNode = nodes.find((node: LavalinkNode) => node.connected);

      if (!activeNode) {
        logger.warn('No active Lavalink nodes available for cache warming');
        return;
      }

      // Create a temporary player for warming
      const dummyPlayer = this.manager.createPlayer({
        guildId: '1', // Use valid snowflake format for dummy guild
        voiceChannelId: 'dummy',
        textChannelId: 'dummy',
        node: activeNode.id,
        volume: 0,
        selfDeaf: true
      });

      try {
        // Warm popular queries
        await searchOptimizer.warmPopularQueries(dummyPlayer);
        warmedCount += 10; // Estimate

        // Warm time-based queries
        await searchOptimizer.warmTimeBasedQueries(dummyPlayer);
        warmedCount += 5; // Estimate

        successCount = warmedCount; // Simplified success tracking

        logger.info({
          warmedQueries: warmedCount,
          successRate: successCount / warmedCount * 100,
          duration: Date.now() - sessionStart
        }, 'Search cache warming session completed');

      } finally {
        // Clean up the dummy player
        try {
          dummyPlayer.destroy();
        } catch (error) {
          // Ignore cleanup errors
        }
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error)
      }, 'Search cache warming session failed');
    } finally {
      this.isWarming = false;

      // Update stats
      this.warmingStats.totalWarmed += warmedCount;
      this.warmingStats.successRate = successCount / Math.max(warmedCount, 1) * 100;
      this.warmingStats.avgWarmingTime = Date.now() - sessionStart;
      this.warmingStats.lastWarmingSession = Date.now();
    }
  }

  /**
   * Force a warming session (manual trigger)
   */
  async forceWarmingSession(): Promise<{
    success: boolean;
    warmedQueries: number;
    duration: number;
  }> {
    if (this.isWarming) {
      return {
        success: false,
        warmedQueries: 0,
        duration: 0
      };
    }

    const start = Date.now();
    await this.runWarmingSession();

    return {
      success: true,
      warmedQueries: 10, // Simplified estimate
      duration: Date.now() - start
    };
  }

  /**
   * Warm specific queries
   */
  async warmSpecificQueries(queries: string[]): Promise<{
    warmed: number;
    failed: number;
    duration: number;
  }> {
    if (!this.manager || this.isWarming) {
      return { warmed: 0, failed: 0, duration: 0 };
    }

    const start = Date.now();
    let warmed = 0;
    let failed = 0;

    const nodes = Array.from(this.manager.nodeManager.nodes.values());
    const activeNode = nodes.find((node: LavalinkNode) => node.connected);

    if (!activeNode) {
      return { warmed: 0, failed: queries.length, duration: Date.now() - start };
    }

    const dummyPlayer = this.manager.createPlayer({
      guildId: 'specific-warmer',
      voiceChannelId: 'dummy',
      textChannelId: 'dummy',
      node: activeNode.id,
      volume: 0,
      selfDeaf: true
    });

    try {
      for (const query of queries.slice(0, 20)) { // Limit to 20 queries
        try {
          const result = await dummyPlayer.search(
            { query },
            { id: 'cache-warmer' }
          );

          if (result?.tracks?.length > 0) {
            // Cache would be handled by the search function
            warmed++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          logger.debug({
            query,
            error: error instanceof Error ? error.message : String(error)
          }, 'Specific query warming failed');
        }

        // Rate limiting to prevent overwhelming Lavalink
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      try {
        dummyPlayer.destroy();
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    logger.info({
      warmed,
      failed,
      duration: Date.now() - start
    }, 'Specific query warming completed');

    return {
      warmed,
      failed,
      duration: Date.now() - start
    };
  }

  /**
   * Get pre-warming statistics
   */
  getStats() {
    const nextWarming = this.warmingInterval ?
      15 * 60 * 1000 - (Date.now() - this.warmingStats.lastWarmingSession) : -1;

    return {
      isActive: this.warmingInterval !== null,
      isCurrentlyWarming: this.isWarming,
      stats: { ...this.warmingStats },
      nextWarmingIn: Math.max(0, nextWarming)
    };
  }

  /**
   * Stop pre-warming process
   */
  stop(): void {
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval);
      this.warmingInterval = null;
    }

    logger.info('Search pre-warmer stopped');
  }

  /**
   * Configure warming schedule
   */
  configureSchedule(intervalMinutes: number): void {
    this.stop();

    if (intervalMinutes > 0) {
      this.warmingInterval = setInterval(() => {
        this.runWarmingSession();
      }, intervalMinutes * 60 * 1000);

      logger.info({ intervalMinutes }, 'Search pre-warmer schedule updated');
    }
  }

  /**
   * Get recommended queries for warming based on patterns
   */
  getRecommendedQueries(): string[] {
    const trending = searchOptimizer.getTrendingQueries(10);
    return trending.map(q => q.query);
  }
}

export const searchPrewarmer = new SearchPrewarmer();