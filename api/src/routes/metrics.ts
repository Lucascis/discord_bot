import { Router } from 'express';
import { register } from 'prom-client';
import {
  checkDatabaseHealth,
  getDatabaseMetrics,
  generatePerformanceSummary
} from '@discord-bot/database';
import { logger } from '@discord-bot/logger';

const router = Router();

/**
 * Prometheus metrics endpoint
 */
router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    logger.error({ error }, 'Failed to generate Prometheus metrics');
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

/**
 * Database health check endpoint
 */
router.get('/health/database', async (req, res) => {
  try {
    const health = await checkDatabaseHealth();

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    res.status(503).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Database performance summary
 */
router.get('/database/performance', async (req, res) => {
  try {
    const [metrics, summary] = await Promise.all([
      getDatabaseMetrics(),
      generatePerformanceSummary()
    ]);

    res.json({
      metrics,
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ error }, 'Failed to generate database performance summary');
    res.status(500).json({
      error: 'Failed to generate performance summary',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Queue operations metrics
 */
router.get('/queue/operations', async (req, res) => {
  try {
    // This would aggregate queue operation metrics from Prometheus
    // For now, return basic structure
    const queueMetrics = {
      operations: {
        rebuilds: 0,
        incrementalAdds: 0,
        incrementalRemoves: 0,
        clears: 0
      },
      optimizations: {
        skippedRebuilds: 0,
        incrementalUpdates: 0
      },
      timestamp: new Date().toISOString()
    };

    res.json(queueMetrics);
  } catch (error) {
    logger.error({ error }, 'Failed to get queue operations metrics');
    res.status(500).json({
      error: 'Failed to get queue metrics',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Custom health check for all services
 */
router.get('/health', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();

    const overallHealth = {
      status: dbHealth.status === 'healthy' ? 'healthy' : 'degraded',
      services: {
        database: {
          status: dbHealth.status,
          responseTime: dbHealth.responseTime,
          connectionPool: dbHealth.connectionPool
        },
        api: {
          status: 'healthy',
          uptime: process.uptime()
        }
      },
      timestamp: new Date().toISOString()
    };

    const statusCode = overallHealth.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(overallHealth);
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    res.status(503).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;