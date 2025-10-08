/**
 * BullMQ Worker Management
 *
 * Centralized worker configuration and management for all job queues
 * Following BullMQ best practices and Discord bot requirements
 */

import { Worker, WorkerOptions } from 'bullmq';
import { redisClient } from '../utils/redis-client.js';
import { logger } from '@discord-bot/logger';
import { logJobError, classifyError } from '../utils/error-handler.js';
import { cleanupJobProcessors } from '../jobs/cleanup-jobs.js';
import type {
  JobData,
  CleanupJobData,
  WorkerConfig,
  JobResult,
  JobMetrics
} from '../types/jobs.js';

/**
 * Worker configurations
 */
const workerConfigs: Record<string, WorkerConfig> = {
  cleanup: {
    concurrency: 2,
    stalledInterval: 30000,
    maxStalledCount: 1,
    limiter: {
      max: 5,
      duration: 60000 // 5 jobs per minute
    }
  },
  analytics: {
    concurrency: 1,
    stalledInterval: 60000,
    maxStalledCount: 1,
    limiter: {
      max: 10,
      duration: 60000 // 10 jobs per minute
    }
  },
  maintenance: {
    concurrency: 1,
    stalledInterval: 120000,
    maxStalledCount: 1,
    limiter: {
      max: 2,
      duration: 60000 // 2 jobs per minute
    }
  },
  health: {
    concurrency: 3,
    stalledInterval: 15000,
    maxStalledCount: 2,
    limiter: {
      max: 20,
      duration: 60000 // 20 jobs per minute
    }
  }
};

/**
 * Active workers registry
 */
const activeWorkers = new Map<string, Worker>();

/**
 * Job metrics collection
 */
const jobMetrics: JobMetrics[] = [];

/**
 * Create worker options
 */
function createWorkerOptions(queueName: string): WorkerOptions {
  const config = workerConfigs[queueName];

  return {
    connection: redisClient,
    concurrency: config.concurrency,
    limiter: config.limiter,
    removeOnComplete: {
      age: 24 * 60 * 60, // 24 hours
      count: 100
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60, // 7 days
      count: 50
    }
  };
}

/**
 * Generic job processor wrapper with metrics
 */
function createJobProcessor<T extends JobData>(
  queueName: string,
  processors: Record<string, Function>
) {
  return async (job: any): Promise<JobResult> => {
    const startTime = Date.now();
    const jobType = job.data.subtype || job.data.type;

    // Find and execute the appropriate processor
    const processor = processors[jobType];
    if (!processor) {
      throw new Error(`No processor found for job type: ${jobType}`);
    }

    try {
      logger.info({
        jobId: job.id,
        queueName,
        jobType,
        data: { ...job.data, sensitive: '[REDACTED]' }
      }, 'Processing job');

      const result = await processor(job);

      // Collect success metrics
      const metrics: JobMetrics = {
        queueName,
        jobType,
        status: 'completed',
        duration: Date.now() - startTime,
        attempts: job.attemptsMade,
        timestamp: new Date().toISOString()
      };

      jobMetrics.push(metrics);

      logger.info({
        jobId: job.id,
        queueName,
        jobType,
        duration: metrics.duration,
        success: result.success
      }, 'Job completed successfully');

      return result;
    } catch (error) {
      const workerError = classifyError(error);

      // Log the error with context
      logJobError(workerError, job.id, queueName, job.data);

      // Collect failure metrics
      const metrics: JobMetrics = {
        queueName,
        jobType,
        status: 'failed',
        duration: Date.now() - startTime,
        attempts: job.attemptsMade,
        timestamp: new Date().toISOString(),
        error: workerError.toJobError()
      };

      jobMetrics.push(metrics);

      throw workerError;
    }
  };
}

/**
 * Initialize cleanup worker
 */
export function initializeCleanupWorker(): Worker<CleanupJobData> {
  const worker = new Worker(
    'cleanup',
    createJobProcessor('cleanup', cleanupJobProcessors),
    createWorkerOptions('cleanup')
  );

  // Worker event handlers
  worker.on('ready', () => {
    logger.info({ queue: 'cleanup' }, 'Cleanup worker ready');
  });

  worker.on('error', (error) => {
    logger.error({ error: error.message, queue: 'cleanup' }, 'Cleanup worker error');
  });

  worker.on('stalled', (jobId, prev) => {
    logger.warn({ jobId, prev, queue: 'cleanup' }, 'Cleanup job stalled');
  });

  activeWorkers.set('cleanup', worker);
  return worker;
}

/**
 * Initialize all workers
 */
export async function initializeAllWorkers(): Promise<void> {
  try {
    // Initialize cleanup worker
    initializeCleanupWorker();

    // TODO: Initialize other workers as they are implemented
    // initializeAnalyticsWorker();
    // initializeMaintenanceWorker();
    // initializeHealthWorker();

    logger.info({
      activeWorkers: Array.from(activeWorkers.keys()),
      totalWorkers: activeWorkers.size
    }, 'All workers initialized successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize workers');
    throw error;
  }
}

/**
 * Gracefully shutdown all workers
 */
export async function shutdownAllWorkers(): Promise<void> {
  try {
    const shutdownPromises = Array.from(activeWorkers.values()).map(worker =>
      worker.close()
    );

    await Promise.all(shutdownPromises);
    activeWorkers.clear();

    logger.info('All workers shutdown gracefully');
  } catch (error) {
    logger.error({ error }, 'Error during worker shutdown');
    throw error;
  }
}

/**
 * Pause all workers
 */
export async function pauseAllWorkers(): Promise<void> {
  const pausePromises = Array.from(activeWorkers.values()).map(worker =>
    worker.pause()
  );

  await Promise.all(pausePromises);
  logger.info('All workers paused');
}

/**
 * Resume all workers
 */
export async function resumeAllWorkers(): Promise<void> {
  const resumePromises = Array.from(activeWorkers.values()).map(worker =>
    worker.resume()
  );

  await Promise.all(resumePromises);
  logger.info('All workers resumed');
}

/**
 * Get worker statistics
 */
export async function getWorkerStats(): Promise<Record<string, unknown>> {
  const stats: Record<string, unknown> = {};

  for (const [name, worker] of activeWorkers) {
    try {
      stats[name] = {
        isRunning: !worker.closing,
        isPaused: worker.isPaused(),
        concurrency: worker.opts.concurrency
      };
    } catch (error) {
      stats[name] = {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return stats;
}

/**
 * Get job metrics summary
 */
export function getJobMetrics(): {
  total: number;
  byStatus: Record<string, number>;
  byQueue: Record<string, number>;
  averageDuration: number;
  recentErrors: JobMetrics[];
} {
  const total = jobMetrics.length;
  const byStatus: Record<string, number> = {};
  const byQueue: Record<string, number> = {};
  let totalDuration = 0;

  for (const metric of jobMetrics) {
    byStatus[metric.status] = (byStatus[metric.status] || 0) + 1;
    byQueue[metric.queueName] = (byQueue[metric.queueName] || 0) + 1;
    if (metric.duration) {
      totalDuration += metric.duration;
    }
  }

  const recentErrors = jobMetrics
    .filter(m => m.status === 'failed')
    .slice(-10); // Last 10 errors

  return {
    total,
    byStatus,
    byQueue,
    averageDuration: total > 0 ? totalDuration / total : 0,
    recentErrors
  };
}

/**
 * Clear old metrics (keep only last 1000)
 */
export function clearOldMetrics(): void {
  if (jobMetrics.length > 1000) {
    jobMetrics.splice(0, jobMetrics.length - 1000);
  }
}

/**
 * Health check for all workers
 */
export async function checkWorkersHealth(): Promise<{
  healthy: boolean;
  details: Record<string, unknown>;
}> {
  const workerHealth: Record<string, unknown> = {};
  let allHealthy = true;

  for (const [name, worker] of activeWorkers) {
    const isHealthy = !worker.closing;
    workerHealth[name] = {
      running: isHealthy,
      paused: worker.isPaused(),
      concurrency: worker.opts.concurrency
    };

    if (!isHealthy) {
      allHealthy = false;
    }
  }

  return {
    healthy: allHealthy,
    details: {
      workers: workerHealth,
      totalWorkers: activeWorkers.size,
      metrics: getJobMetrics()
    }
  };
}