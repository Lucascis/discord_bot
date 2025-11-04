import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateGuildId, validatePagination } from '../../middleware/validation.js';
import { NotFoundError, InternalServerError } from '../../middleware/error-handler.js';
import type {
  APIResponse,
  PaginatedResponse,
  GuildAnalytics,
  DashboardMetrics,
  Snowflake
} from '../../types/api.js';
import { logger } from '@discord-bot/logger';
import Redis from 'ioredis';
import { env } from '@discord-bot/config';

/**
 * Analytics Dashboard API Router
 *
 * Implements REST endpoints for analytics and metrics dashboard
 * Integrates with Worker Service for background analytics processing
 */

const router: ExpressRouter = Router();

// Redis client for inter-service communication
const redis = new Redis(env.REDIS_URL);

/**
 * Helper function to request analytics data from Worker Service via Redis
 */
async function requestFromWorker<T>(
  requestType: string,
  payload: Record<string, unknown>,
  timeoutMs: number = 10000
): Promise<T> {
  const requestId = `analytics_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  // Create response listener
  const responsePromise = new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      redis.unsubscribe(`analytics-response:${requestId}`);
      reject(new Error('Worker service timeout'));
    }, timeoutMs);

    redis.subscribe(`analytics-response:${requestId}`, (err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    redis.on('message', (channel, message) => {
      if (channel === `analytics-response:${requestId}`) {
        clearTimeout(timeout);
        redis.unsubscribe(`analytics-response:${requestId}`);

        try {
          const response = JSON.parse(message);
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.data);
          }
        } catch {
          reject(new Error('Invalid response format'));
        }
      }
    });
  });

  // Send request to worker service
  await redis.publish('discord-bot:analytics-request', JSON.stringify({
    requestId,
    type: requestType,
    ...payload
  }));

  return responsePromise;
}

/**
 * GET /api/v1/analytics/dashboard
 * Get general dashboard metrics and overview
 */
router.get('/dashboard', asyncHandler(async (req, res) => {
  try {
    logger.info({
      requestId: req.headers['x-request-id']
    }, 'Fetching dashboard metrics from worker service');

    // Request dashboard metrics from worker service
    const dashboardData = await requestFromWorker<DashboardMetrics>('DASHBOARD_METRICS', {});

    const response: APIResponse<DashboardMetrics> = {
      data: dashboardData,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id']
    }, 'Failed to fetch dashboard metrics');

    throw new InternalServerError('Failed to fetch dashboard metrics');
  }
}));

/**
 * GET /api/v1/analytics/guilds/:guildId
 * Get analytics for specific guild
 */
router.get('/guilds/:guildId',
  validateGuildId,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const { period = 'week', limit = 50 } = req.query as { period?: string; limit?: string };

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        period,
        limit
      }, 'Fetching guild analytics from worker service');

      // Request guild analytics from worker service
      const analyticsData = await requestFromWorker<GuildAnalytics>('GUILD_ANALYTICS', {
        guildId,
        period,
        limit: typeof limit === 'string' ? parseInt(limit, 10) : limit
      });

      const response: APIResponse<GuildAnalytics> = {
        data: analyticsData,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      res.json(response);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(`Analytics for guild ${guildId}`);
      }

      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId,
        period
      }, 'Failed to fetch guild analytics');

      throw new InternalServerError('Failed to fetch guild analytics');
    }
  })
);

/**
 * GET /api/v1/analytics/music/popular
 * Get popular tracks across all guilds
 */
router.get('/music/popular',
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const { period = 'week', genre } = req.query as { period?: string; genre?: string };

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        page,
        limit,
        period,
        genre
      }, 'Fetching popular tracks analytics from worker service');

      // Request popular tracks data from worker service
      const popularData = await requestFromWorker<{
        tracks: Array<{
          track: {
            title: string;
            artist: string;
            url: string;
            duration: number;
          };
          playCount: number;
          uniqueGuilds: number;
          avgRating?: number;
        }>;
        total: number;
      }>('POPULAR_TRACKS', {
        page,
        limit,
        period,
        genre
      });

      const totalPages = Math.ceil(popularData.total / limit);

      const response: PaginatedResponse<typeof popularData.tracks[0]> = {
        data: popularData.tracks,
        pagination: {
          page,
          limit,
          total: popularData.total,
          totalPages,
          hasNext: page < totalPages,
          hasPrevious: page > 1
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        page,
        limit,
        period
      }, 'Failed to fetch popular tracks analytics');

      throw new InternalServerError('Failed to fetch popular tracks analytics');
    }
  })
);

/**
 * GET /api/v1/analytics/usage/trends
 * Get usage trends and growth metrics
 */
router.get('/usage/trends', asyncHandler(async (req, res) => {
  const { period = 'month', metric = 'commands' } = req.query as {
    period?: string;
    metric?: string;
  };

  try {
    logger.info({
      requestId: req.headers['x-request-id'],
      period,
      metric
    }, 'Fetching usage trends from worker service');

    // Request usage trends from worker service
    const trendsData = await requestFromWorker<{
      metric: string;
      period: string;
      dataPoints: Array<{
        timestamp: string;
        value: number;
        change?: number; // percentage change from previous period
      }>;
      summary: {
        total: number;
        average: number;
        growth: number; // percentage growth
        peak: {
          value: number;
          timestamp: string;
        };
      };
    }>('USAGE_TRENDS', {
      period,
      metric
    });

    const response: APIResponse<typeof trendsData> = {
      data: trendsData,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id'],
      period,
      metric
    }, 'Failed to fetch usage trends');

    throw new InternalServerError('Failed to fetch usage trends');
  }
}));

/**
 * GET /api/v1/analytics/performance
 * Get performance and system metrics
 */
router.get('/performance', asyncHandler(async (req, res) => {
  const { timeRange = '24h' } = req.query as { timeRange?: string };

  try {
    logger.info({
      requestId: req.headers['x-request-id'],
      timeRange
    }, 'Fetching performance metrics from worker service');

    // Request performance metrics from worker service
    const performanceData = await requestFromWorker<{
      timeRange: string;
      metrics: {
        responseTime: {
          avg: number;
          p50: number;
          p95: number;
          p99: number;
        };
        throughput: {
          commandsPerSecond: number;
          peakCommandsPerSecond: number;
          totalCommands: number;
        };
        errorRate: {
          percentage: number;
          total: number;
          byType: Record<string, number>;
        };
        systemHealth: {
          memoryUsage: number;
          cpuUsage: number;
          diskUsage: number;
          activeConnections: number;
        };
        serviceStatus: {
          gateway: 'healthy' | 'degraded' | 'unhealthy';
          audio: 'healthy' | 'degraded' | 'unhealthy';
          worker: 'healthy' | 'degraded' | 'unhealthy';
          api: 'healthy' | 'degraded' | 'unhealthy';
        };
      };
    }>('PERFORMANCE_METRICS', {
      timeRange
    });

    const response: APIResponse<typeof performanceData> = {
      data: performanceData,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id'],
      timeRange
    }, 'Failed to fetch performance metrics');

    throw new InternalServerError('Failed to fetch performance metrics');
  }
}));

/**
 * POST /api/v1/analytics/reports/generate
 * Generate custom analytics report
 */
router.post('/reports/generate',
  asyncHandler(async (req, res) => {
    const {
      guildIds,
      metrics,
      dateRange,
      format = 'json'
    }: {
      guildIds?: Snowflake[];
      metrics: string[];
      dateRange: {
        start: string;
        end: string;
      };
      format?: 'json' | 'csv' | 'excel';
    } = req.body;

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildIds: guildIds?.length || 'all',
        metrics,
        dateRange,
        format
      }, 'Generating custom analytics report via worker service');

      // Request report generation from worker service
      const reportData = await requestFromWorker<{
        reportId: string;
        status: 'processing' | 'completed' | 'failed';
        downloadUrl?: string;
        estimatedCompletion?: string;
        metrics: string[];
        format: string;
      }>('GENERATE_REPORT', {
        guildIds,
        metrics,
        dateRange,
        format
      });

      const response: APIResponse<typeof reportData> = {
        data: reportData,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        reportId: reportData.reportId,
        status: reportData.status
      }, 'Analytics report generation initiated');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        metrics,
        dateRange
      }, 'Failed to generate analytics report');

      throw new InternalServerError('Failed to generate analytics report');
    }
  })
);

/**
 * GET /api/v1/analytics/reports/:reportId
 * Get status of generated report
 */
router.get('/reports/:reportId', asyncHandler(async (req, res) => {
  const { reportId } = req.params;

  try {
    logger.info({
      requestId: req.headers['x-request-id'],
      reportId
    }, 'Fetching report status from worker service');

    // Request report status from worker service
    const reportStatus = await requestFromWorker<{
      reportId: string;
      status: 'processing' | 'completed' | 'failed';
      downloadUrl?: string;
      error?: string;
      progress?: number;
      createdAt: string;
      completedAt?: string;
    }>('REPORT_STATUS', {
      reportId
    });

    const response: APIResponse<typeof reportStatus> = {
      data: reportStatus,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw new NotFoundError(`Report ${reportId}`);
    }

    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id'],
      reportId
    }, 'Failed to fetch report status');

    throw new InternalServerError('Failed to fetch report status');
  }
}));

export default router;
