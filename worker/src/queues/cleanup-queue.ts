/**
 * Cleanup Queue Implementation
 *
 * Database cleanup jobs for Discord bot maintenance
 * Following BullMQ best practices and Discord-specific requirements
 */

import { Queue, QueueOptions } from 'bullmq';
import { redisClient } from '../utils/redis-client.js';
import { logger } from '@discord-bot/logger';
import type {
  CleanupJobData,
  QueueConfig,
  ScheduleOptions,
  JobPriorityType
} from '../types/jobs.js';
import { JobPriority, QueueName } from '../types/jobs.js';

/**
 * Cleanup queue configuration
 */
const queueConfig: QueueConfig = {
  name: QueueName.CLEANUP,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 10,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  },
  rateLimiter: {
    max: 10,
    duration: 60000 // 10 jobs per minute
  }
};

/**
 * BullMQ queue options
 */
const queueOptions: QueueOptions = {
  connection: redisClient,
  defaultJobOptions: queueConfig.defaultJobOptions
};

/**
 * Cleanup job queue instance
 */
export const cleanupQueue = new Queue<CleanupJobData>('cleanup', queueOptions);

/**
 * Queue event listeners
 */
cleanupQueue.on('error' as any, (error: any) => {
  logger.error({ error: error.message, queue: 'cleanup' }, 'Cleanup queue error');
});

cleanupQueue.on('waiting' as any, (jobId: any) => {
  logger.debug({ jobId, queue: 'cleanup' }, 'Cleanup job waiting');
});

cleanupQueue.on('active' as any, (job: any) => {
  logger.info({
    jobId: job.id,
    queue: 'cleanup',
    type: job.data.subtype,
    guildId: job.data.guildId
  }, 'Cleanup job started');
});

cleanupQueue.on('completed' as any, (job: any, result: any) => {
  logger.info({
    jobId: job.id,
    queue: 'cleanup',
    type: job.data.subtype,
    duration: result.duration,
    success: result.success
  }, 'Cleanup job completed');
});

cleanupQueue.on('failed' as any, (job: any, error: any) => {
  logger.error({
    jobId: job?.id,
    queue: 'cleanup',
    type: job?.data?.subtype,
    error: error.message,
    attempts: job?.attemptsMade
  }, 'Cleanup job failed');
});

/**
 * Add queue item cleanup job
 */
export async function addQueueItemCleanup(
  olderThanDays: number = 7,
  batchSize: number = 1000,
  options?: ScheduleOptions
): Promise<void> {
  const jobData: CleanupJobData = {
    type: 'cleanup',
    subtype: 'queue_items',
    requestId: `cleanup_queue_${Date.now()}`,
    timestamp: new Date().toISOString(),
    olderThanDays,
    batchSize,
    priority: options?.priority || JobPriority.NORMAL
  };

  await cleanupQueue.add('queue_items_cleanup', jobData, {
    priority: jobData.priority,
    delay: options?.delay,
    repeat: options?.repeat,
    removeOnComplete: queueConfig.defaultJobOptions.removeOnComplete,
    removeOnFail: queueConfig.defaultJobOptions.removeOnFail
  });

  logger.info({
    subtype: 'queue_items',
    olderThanDays,
    batchSize,
    priority: jobData.priority
  }, 'Queue items cleanup job scheduled');
}

/**
 * Add rate limit cleanup job
 */
export async function addRateLimitCleanup(
  options?: ScheduleOptions
): Promise<void> {
  const jobData: CleanupJobData = {
    type: 'cleanup',
    subtype: 'rate_limits',
    requestId: `cleanup_rate_${Date.now()}`,
    timestamp: new Date().toISOString(),
    priority: options?.priority || JobPriority.NORMAL
  };

  await cleanupQueue.add('rate_limits_cleanup', jobData, {
    priority: jobData.priority,
    delay: options?.delay,
    repeat: options?.repeat,
    removeOnComplete: queueConfig.defaultJobOptions.removeOnComplete,
    removeOnFail: queueConfig.defaultJobOptions.removeOnFail
  });

  logger.info({
    subtype: 'rate_limits',
    priority: jobData.priority
  }, 'Rate limits cleanup job scheduled');
}

/**
 * Add audit logs cleanup job
 */
export async function addAuditLogsCleanup(
  olderThanDays: number = 30,
  batchSize: number = 500,
  options?: ScheduleOptions
): Promise<void> {
  const jobData: CleanupJobData = {
    type: 'cleanup',
    subtype: 'audit_logs',
    requestId: `cleanup_audit_${Date.now()}`,
    timestamp: new Date().toISOString(),
    olderThanDays,
    batchSize,
    priority: options?.priority || JobPriority.NORMAL
  };

  await cleanupQueue.add('audit_logs_cleanup', jobData, {
    priority: jobData.priority,
    delay: options?.delay,
    repeat: options?.repeat,
    removeOnComplete: queueConfig.defaultJobOptions.removeOnComplete,
    removeOnFail: queueConfig.defaultJobOptions.removeOnFail
  });

  logger.info({
    subtype: 'audit_logs',
    olderThanDays,
    batchSize,
    priority: jobData.priority
  }, 'Audit logs cleanup job scheduled');
}

/**
 * Add cache cleanup job
 */
export async function addCacheCleanup(
  options?: ScheduleOptions
): Promise<void> {
  const jobData: CleanupJobData = {
    type: 'cleanup',
    subtype: 'cache',
    requestId: `cleanup_cache_${Date.now()}`,
    timestamp: new Date().toISOString(),
    priority: options?.priority || JobPriority.NORMAL
  };

  await cleanupQueue.add('cache_cleanup', jobData, {
    priority: jobData.priority,
    delay: options?.delay,
    repeat: options?.repeat,
    removeOnComplete: queueConfig.defaultJobOptions.removeOnComplete,
    removeOnFail: queueConfig.defaultJobOptions.removeOnFail
  });

  logger.info({
    subtype: 'cache',
    priority: jobData.priority
  }, 'Cache cleanup job scheduled');
}

/**
 * Add temporary files cleanup job
 */
export async function addTempFilesCleanup(
  olderThanDays: number = 1,
  options?: ScheduleOptions
): Promise<void> {
  const jobData: CleanupJobData = {
    type: 'cleanup',
    subtype: 'temp_files',
    requestId: `cleanup_temp_${Date.now()}`,
    timestamp: new Date().toISOString(),
    olderThanDays,
    priority: options?.priority || JobPriority.NORMAL
  };

  await cleanupQueue.add('temp_files_cleanup', jobData, {
    priority: jobData.priority,
    delay: options?.delay,
    repeat: options?.repeat,
    removeOnComplete: queueConfig.defaultJobOptions.removeOnComplete,
    removeOnFail: queueConfig.defaultJobOptions.removeOnFail
  });

  logger.info({
    subtype: 'temp_files',
    olderThanDays,
    priority: jobData.priority
  }, 'Temporary files cleanup job scheduled');
}

/**
 * Schedule daily cleanup jobs
 */
export async function scheduleDailyCleanup(): Promise<void> {
  const dailyOptions: ScheduleOptions = {
    cron: '0 2 * * *', // Daily at 2 AM
    priority: JobPriority.NORMAL
  };

  await Promise.all([
    addQueueItemCleanup(7, 1000, dailyOptions),
    addRateLimitCleanup(dailyOptions),
    addAuditLogsCleanup(30, 500, dailyOptions),
    addCacheCleanup(dailyOptions),
    addTempFilesCleanup(1, dailyOptions)
  ]);

  logger.info('Daily cleanup jobs scheduled successfully');
}

/**
 * Get cleanup queue statistics
 */
export async function getCleanupQueueStats(): Promise<Record<string, number>> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    cleanupQueue.getWaiting(),
    cleanupQueue.getActive(),
    cleanupQueue.getCompleted(),
    cleanupQueue.getFailed(),
    cleanupQueue.getDelayed()
  ]);

  return {
    waiting: waiting.length,
    active: active.length,
    completed: completed.length,
    failed: failed.length,
    delayed: delayed.length,
    total: waiting.length + active.length + completed.length + failed.length + delayed.length
  };
}

/**
 * Pause cleanup queue
 */
export async function pauseCleanupQueue(): Promise<void> {
  await cleanupQueue.pause();
  logger.info('Cleanup queue paused');
}

/**
 * Resume cleanup queue
 */
export async function resumeCleanupQueue(): Promise<void> {
  await cleanupQueue.resume();
  logger.info('Cleanup queue resumed');
}

/**
 * Clean up completed and failed jobs
 */
export async function cleanupOldJobs(): Promise<void> {
  await cleanupQueue.clean(24 * 60 * 60 * 1000, 100, 'completed'); // Keep 24h
  await cleanupQueue.clean(7 * 24 * 60 * 60 * 1000, 50, 'failed'); // Keep 7 days

  logger.info('Old cleanup jobs cleaned');
}