/**
 * Worker Service Integration for Audio Service
 *
 * This module provides seamless integration between Audio Service and Worker Service
 * for background analytics, maintenance, and performance monitoring tasks.
 *
 * Following best practices for microservices communication via Redis pub/sub.
 */

import { createClient } from 'redis';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import type { Track } from 'lavalink-client';

/**
 * Redis client for Worker Service communication
 */
const workerRedis = createClient({ url: env.REDIS_URL });

/**
 * Initialize Worker Service integration
 */
export async function initializeWorkerIntegration(): Promise<void> {
  try {
    await workerRedis.connect();
    logger.info('[Audio] Worker Service integration initialized');
  } catch (error) {
    logger.error({ error }, '[Audio] Failed to initialize Worker Service integration');
    throw error;
  }
}

/**
 * Analytics job types for Worker Service
 */
export interface AudioAnalyticsJob {
  type: 'audio_analytics';
  subtype: 'track_played' | 'search_performed' | 'autoplay_triggered' | 'queue_updated' | 'user_interaction';
  guildId: string;
  userId?: string;
  timestamp: string;
  data: Record<string, unknown>;
  priority?: number;
}

/**
 * Schedule analytics job in Worker Service
 */
export async function scheduleAnalyticsJob(jobData: Omit<AudioAnalyticsJob, 'type' | 'timestamp'>): Promise<void> {
  try {
    const job: AudioAnalyticsJob = {
      type: 'audio_analytics',
      timestamp: new Date().toISOString(),
      ...jobData
    };

    await workerRedis.publish('discord-bot:worker-request', JSON.stringify({
      requestId: `analytics_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      type: 'SCHEDULE_JOB',
      queue: 'analytics',
      jobData: job
    }));

    logger.debug({
      subtype: job.subtype,
      guildId: job.guildId,
      userId: job.userId
    }, 'Analytics job scheduled');
  } catch (error) {
    logger.error({ error, jobData }, 'Failed to schedule analytics job');
  }
}

/**
 * Track playback analytics
 */
export async function trackPlaybackAnalytics(
  guildId: string,
  userId: string,
  track: Track,
  source: 'user_request' | 'autoplay' | 'queue'
): Promise<void> {
  await scheduleAnalyticsJob({
    subtype: 'track_played',
    guildId,
    userId,
    data: {
      track: {
        identifier: track.info.identifier,
        title: track.info.title,
        author: track.info.author,
        duration: track.info.duration,
        uri: track.info.uri,
        sourceName: track.info.sourceName
      },
      source,
      playedAt: new Date().toISOString()
    },
    priority: 5
  });
}

/**
 * Track search analytics
 */
export async function trackSearchAnalytics(
  guildId: string,
  userId: string,
  query: string,
  resultsCount: number,
  source: string,
  responseTime: number
): Promise<void> {
  await scheduleAnalyticsJob({
    subtype: 'search_performed',
    guildId,
    userId,
    data: {
      query: query.substring(0, 100), // Limit query length for privacy
      resultsCount,
      source,
      responseTime,
      searchedAt: new Date().toISOString()
    },
    priority: 3
  });
}

/**
 * Track autoplay trigger analytics
 */
export async function trackAutoplayAnalytics(
  guildId: string,
  mode: 'similar' | 'artist' | 'genre' | 'mixed',
  previousTrack: Track | null,
  selectedTrack: Track,
  candidatesCount: number
): Promise<void> {
  await scheduleAnalyticsJob({
    subtype: 'autoplay_triggered',
    guildId,
    data: {
      autoplayMode: mode,
      previousTrack: previousTrack ? {
        identifier: previousTrack.info.identifier,
        title: previousTrack.info.title,
        author: previousTrack.info.author
      } : null,
      selectedTrack: {
        identifier: selectedTrack.info.identifier,
        title: selectedTrack.info.title,
        author: selectedTrack.info.author,
        sourceName: selectedTrack.info.sourceName
      },
      candidatesCount,
      triggeredAt: new Date().toISOString()
    },
    priority: 7
  });
}

/**
 * Track queue update analytics
 */
export async function trackQueueAnalytics(
  guildId: string,
  userId: string,
  action: 'add' | 'remove' | 'clear' | 'shuffle' | 'move',
  queueSize: number,
  details?: Record<string, unknown>
): Promise<void> {
  await scheduleAnalyticsJob({
    subtype: 'queue_updated',
    guildId,
    userId,
    data: {
      action,
      queueSize,
      updatedAt: new Date().toISOString(),
      ...details
    },
    priority: 4
  });
}

/**
 * Track user interaction analytics
 */
export async function trackUserInteractionAnalytics(
  guildId: string,
  userId: string,
  interaction: 'play' | 'pause' | 'skip' | 'seek' | 'volume' | 'filter',
  details?: Record<string, unknown>
): Promise<void> {
  await scheduleAnalyticsJob({
    subtype: 'user_interaction',
    guildId,
    userId,
    data: {
      interaction,
      interactionAt: new Date().toISOString(),
      ...details
    },
    priority: 6
  });
}

/**
 * Request audio data cleanup from Worker Service
 */
export async function requestAudioDataCleanup(
  guildId?: string,
  olderThanDays: number = 30
): Promise<void> {
  try {
    await workerRedis.publish('discord-bot:worker-request', JSON.stringify({
      requestId: `audio_cleanup_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      type: 'SCHEDULE_JOB',
      queue: 'cleanup',
      jobData: {
        type: 'cleanup',
        subtype: 'audio_data',
        guildId,
        olderThanDays,
        requestId: `audio_cleanup_${Date.now()}`,
        timestamp: new Date().toISOString(),
        priority: 5
      }
    }));

    logger.info({ guildId, olderThanDays }, 'Audio data cleanup requested');
  } catch (error) {
    logger.error({ error, guildId, olderThanDays }, 'Failed to request audio data cleanup');
  }
}

/**
 * Request performance optimization analysis
 */
export async function requestPerformanceAnalysis(
  guildId: string,
  metrics: {
    memoryUsage: number;
    searchLatency: number;
    queueOperationLatency: number;
    cacheHitRate: number;
  }
): Promise<void> {
  try {
    await workerRedis.publish('discord-bot:worker-request', JSON.stringify({
      requestId: `perf_analysis_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      type: 'SCHEDULE_JOB',
      queue: 'analytics',
      jobData: {
        type: 'analytics',
        subtype: 'performance_analysis',
        guildId,
        metrics,
        requestId: `perf_analysis_${Date.now()}`,
        timestamp: new Date().toISOString(),
        priority: 8
      }
    }));

    logger.debug({ guildId, metrics }, 'Performance analysis requested');
  } catch (error) {
    logger.error({ error, guildId, metrics }, 'Failed to request performance analysis');
  }
}

/**
 * Close Worker Service integration
 */
export async function closeWorkerIntegration(): Promise<void> {
  try {
    await workerRedis.quit();
    logger.info('[Audio] Worker Service integration closed');
  } catch (error) {
    logger.error({ error }, '[Audio] Error closing Worker Service integration');
  }
}

/**
 * Health check for Worker Service integration
 */
export async function checkWorkerIntegrationHealth(): Promise<{
  healthy: boolean;
  details: Record<string, unknown>;
}> {
  try {
    const pingResult = await workerRedis.ping();
    return {
      healthy: pingResult === 'PONG',
      details: {
        connected: workerRedis.isReady,
        ping: pingResult
      }
    };
  } catch (error) {
    return {
      healthy: false,
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}