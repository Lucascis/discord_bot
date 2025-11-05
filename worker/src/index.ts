/**
 * Worker Service - Main Entry Point
 *
 * Production-ready background job processing service
 * Following BullMQ best practices and Discord bot requirements
 */

// Load environment variables FIRST, before any other imports
import './env-loader.js';

import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';
import http from 'node:http';
import { Registry, collectDefaultMetrics, Gauge, Counter, Histogram } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Worker service imports
import { initializeRedis, checkRedisHealth } from './utils/redis-client.js';
import { initializeAllWorkers, getWorkerStats, getJobMetrics, checkWorkersHealth } from './workers/bullmq-worker.js';
import { initializeGracefulShutdown, addCleanupFunction, getShutdownHealth } from './utils/graceful-shutdown.js';
import { scheduleDailyCleanup } from './queues/cleanup-queue.js';

/**
 * Service state tracking
 */
interface ServiceState {
  startTime: Date;
  isReady: boolean;
  initializationError?: string;
}

const serviceState: ServiceState = {
  startTime: new Date(),
  isReady: false
};

/**
 * Prometheus metrics
 */
const registry = new Registry();
collectDefaultMetrics({ register: registry });

// Worker-specific metrics
const workersActiveGauge = new Gauge({
  name: 'discord_bot_workers_active',
  help: 'Number of active BullMQ workers',
  labelNames: ['queue_name'],
  registers: [registry]
});

const jobsProcessedCounter = new Counter({
  name: 'discord_bot_jobs_processed_total',
  help: 'Total number of jobs processed',
  labelNames: ['queue_name', 'job_type', 'status'],
  registers: [registry]
});

const _jobDurationHistogram = new Histogram({
  name: 'discord_bot_job_duration_seconds',
  help: 'Job processing duration in seconds',
  labelNames: ['queue_name', 'job_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry]
});

const _redisConnectionsGauge = new Gauge({
  name: 'discord_bot_redis_connections',
  help: 'Number of Redis connections',
  labelNames: ['connection_type', 'status'],
  registers: [registry]
});

/**
 * Update Prometheus metrics periodically
 */
function updateMetrics(): void {
  try {
    // Update worker metrics
    const workerStats = getWorkerStats();
    for (const [queueName, stats] of Object.entries(workerStats)) {
      if (typeof stats === 'object' && stats !== null && 'isRunning' in stats) {
        workersActiveGauge.set({ queue_name: queueName }, stats.isRunning ? 1 : 0);
      }
    }

    // Update job metrics
    const jobMetrics = getJobMetrics();
    for (const [status, _count] of Object.entries(jobMetrics.byStatus)) {
      jobsProcessedCounter.inc({ queue_name: 'all', job_type: 'all', status }, 0);
    }
  } catch (error) {
    logger.error({ error }, 'Failed to update Prometheus metrics');
  }
}

/**
 * Enhanced health check endpoint
 */
async function handleHealthCheck(): Promise<{
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  details: Record<string, unknown>;
}> {
  const uptime = Date.now() - serviceState.startTime.getTime();

  if (!serviceState.isReady) {
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime,
      details: {
        ready: false,
        error: serviceState.initializationError || 'Service not ready'
      }
    };
  }

  try {
    // Check Redis health
    const redisHealth = await checkRedisHealth();

    // Check workers health
    const workersHealth = await checkWorkersHealth();

    // Check shutdown state
    const shutdownHealth = getShutdownHealth();

    const allHealthy = redisHealth.healthy && workersHealth.healthy && shutdownHealth.healthy;

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime,
      details: {
        ready: serviceState.isReady,
        redis: redisHealth,
        workers: workersHealth,
        shutdown: shutdownHealth,
        jobMetrics: getJobMetrics()
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime,
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

/**
 * HTTP server for health checks and metrics
 */
const healthServer = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(404);
    res.end();
    return;
  }

  try {
    if (req.url.startsWith('/health')) {
      const health = await handleHealthCheck();
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
      return;
    }

    if (req.url.startsWith('/ready')) {
      const statusCode = serviceState.isReady ? 200 : 503;
      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ready: serviceState.isReady,
        timestamp: new Date().toISOString()
      }));
      return;
    }

    if (req.url.startsWith('/metrics')) {
      updateMetrics();
      res.writeHead(200, { 'content-type': registry.contentType });
      res.end(await registry.metrics());
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  } catch (error) {
    logger.error({ error, url: req.url }, 'HTTP server error');
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

/**
 * Initialize worker service
 */
async function initializeWorkerService(): Promise<void> {
  try {
    logger.info('Starting Discord Bot Worker Service...');

    // 1. Initialize graceful shutdown handlers
    initializeGracefulShutdown();

    // 2. Initialize Redis connections
    logger.info('Initializing Redis connections...');
    await initializeRedis();

    // 3. Initialize BullMQ workers
    logger.info('Initializing BullMQ workers...');
    await initializeAllWorkers();

    // 4. Schedule recurring jobs
    logger.info('Scheduling recurring cleanup jobs...');
    await scheduleDailyCleanup();

    // 5. Start HTTP server
    const port = env.WORKER_HTTP_PORT || 3003;
    await new Promise<void>((resolve) => {
      healthServer.listen(port, () => {
        logger.info(`Worker health server listening on port ${port}`);
        resolve();
      });
    });

    // 6. Set up periodic metrics updates
    setInterval(updateMetrics, 30000); // Update every 30 seconds

    // 7. Add cleanup functions for graceful shutdown
    addCleanupFunction(async () => {
      logger.info('Closing HTTP server...');
      await new Promise<void>((resolve) => {
        healthServer.close(() => resolve());
      });
    });

    serviceState.isReady = true;

    logger.info({
      startTime: serviceState.startTime.toISOString(),
      port,
      workersInitialized: true,
      recurringJobsScheduled: true
    }, 'Worker service initialized successfully');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serviceState.initializationError = errorMessage;

    logger.error({
      error: errorMessage,
      startTime: serviceState.startTime.toISOString()
    }, 'Failed to initialize worker service');

    throw error;
  }
}

/**
 * OpenTelemetry setup
 */
if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  void sdk.start();
  logger.info('OpenTelemetry initialized');
}

/**
 * Start the service
 */
initializeWorkerService().catch((error) => {
  logger.error({ error }, 'Worker service startup failed');
  process.exit(1);
});
