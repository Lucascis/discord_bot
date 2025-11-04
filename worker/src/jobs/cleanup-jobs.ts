/**
 * Cleanup Job Implementations
 *
 * Discord bot-specific cleanup tasks for database maintenance
 * Following BullMQ job processor patterns and Prisma best practices
 */

import type { Job } from 'bullmq';
import { prisma } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';
import { redisClient } from '../utils/redis-client.js';
import { withErrorHandling, DatabaseError, ValidationError } from '../utils/error-handler.js';
import type { CleanupJobData, JobResult } from '../types/jobs.js';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Process queue items cleanup job
 */
export const processQueueItemsCleanup = withErrorHandling(
  async (job: Job<CleanupJobData>): Promise<JobResult> => {
    const startTime = Date.now();
    const { olderThanDays = 7, batchSize = 1000 } = job.data;

    if (olderThanDays < 1) {
      throw new ValidationError('olderThanDays', olderThanDays, 'positive number >= 1');
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    try {
      // Delete old queue items in batches
      let totalDeleted = 0;
      let deletedThisBatch = 0;

      do {
        deletedThisBatch = await prisma.$executeRaw`
          DELETE FROM "QueueItem"
          WHERE id IN (
            SELECT id FROM "QueueItem"
            WHERE "createdAt" < ${cutoffDate}
            LIMIT ${batchSize}
          )
        `;

        totalDeleted += deletedThisBatch;

        // Update job progress
        await job.updateProgress((totalDeleted / (totalDeleted + batchSize)) * 100);

        // Small delay between batches to avoid overwhelming the database
        if (deletedThisBatch > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } while (deletedThisBatch > 0);

      const duration = Date.now() - startTime;

      logger.info({
        jobId: job.id,
        totalDeleted,
        olderThanDays,
        cutoffDate: cutoffDate.toISOString(),
        duration
      }, 'Queue items cleanup completed');

      return {
        success: true,
        data: { totalDeleted, olderThanDays, cutoffDate: cutoffDate.toISOString() },
        duration,
        timestamp: new Date().toISOString(),
        metrics: {
          itemsDeleted: totalDeleted,
          batchesProcessed: Math.ceil(totalDeleted / batchSize)
        }
      };
    } catch (error) {
      throw new DatabaseError('queue_items_cleanup', error instanceof Error ? error : new Error(String(error)));
    }
  }
);

/**
 * Process rate limits cleanup job
 */
export const processRateLimitCleanup = withErrorHandling(
  async (job: Job<CleanupJobData>): Promise<JobResult> => {
    const startTime = Date.now();

    try {
      // Delete expired rate limit entries
      const currentTime = new Date();
      const deleteResult = await prisma.rateLimit.deleteMany({
        where: {
          expiresAt: {
            lt: currentTime
          }
        }
      });

      const duration = Date.now() - startTime;

      logger.info({
        jobId: job.id,
        deletedCount: deleteResult.count,
        currentTime: currentTime.toISOString(),
        duration
      }, 'Rate limits cleanup completed');

      return {
        success: true,
        data: { deletedCount: deleteResult.count, currentTime: currentTime.toISOString() },
        duration,
        timestamp: new Date().toISOString(),
        metrics: {
          rateLimitsDeleted: deleteResult.count
        }
      };
    } catch (error) {
      throw new DatabaseError('rate_limits_cleanup', error instanceof Error ? error : new Error(String(error)));
    }
  }
);

/**
 * Process audit logs cleanup job
 */
export const processAuditLogsCleanup = withErrorHandling(
  async (job: Job<CleanupJobData>): Promise<JobResult> => {
    const startTime = Date.now();
    const { olderThanDays = 30, batchSize = 500 } = job.data;

    if (olderThanDays < 7) {
      throw new ValidationError('olderThanDays', olderThanDays, 'positive number >= 7');
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    try {
      // Archive old audit logs before deletion (if archival is implemented)
      const oldLogs = await prisma.auditLog.findMany({
        where: {
          createdAt: {
            lt: cutoffDate
          }
        },
        take: batchSize,
        select: {
          id: true,
          action: true,
          userId: true,
          guildId: true,
          createdAt: true
        }
      });

      if (oldLogs.length === 0) {
        return {
          success: true,
          data: { message: 'No audit logs to clean up' },
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          metrics: { logsDeleted: 0 }
        };
      }

      // Delete the logs
      const deleteResult = await prisma.auditLog.deleteMany({
        where: {
          id: {
            in: oldLogs.map((log: { id: string }) => log.id)
          }
        }
      });

      const duration = Date.now() - startTime;

      logger.info({
        jobId: job.id,
        deletedCount: deleteResult.count,
        olderThanDays,
        cutoffDate: cutoffDate.toISOString(),
        duration
      }, 'Audit logs cleanup completed');

      return {
        success: true,
        data: {
          deletedCount: deleteResult.count,
          olderThanDays,
          cutoffDate: cutoffDate.toISOString()
        },
        duration,
        timestamp: new Date().toISOString(),
        metrics: {
          auditLogsDeleted: deleteResult.count
        }
      };
    } catch (error) {
      throw new DatabaseError('audit_logs_cleanup', error instanceof Error ? error : new Error(String(error)));
    }
  }
);

/**
 * Process cache cleanup job
 */
export const processCacheCleanup = withErrorHandling(
  async (job: Job<CleanupJobData>): Promise<JobResult> => {
    const startTime = Date.now();

    try {
      // Get Redis cache statistics before cleanup
      const beforeInfo = await redisClient.info('memory');
      const beforeKeys = await redisClient.dbsize();

      // Clean up expired keys and temporary data
      const patterns = [
        'cache:*',
        'temp:*',
        'session:*',
        'search:*'
      ];

      let totalDeleted = 0;

      for (const pattern of patterns) {
        const keys = await redisClient.keys(pattern);
        const expiredKeys: string[] = [];

        // Check TTL for each key and collect expired ones
        for (const key of keys) {
          const ttl = await redisClient.ttl(key);
          if (ttl === -1) { // Key without expiration
            const keyType = key.split(':')[0];
            if (['temp', 'session'].includes(keyType)) {
              expiredKeys.push(key);
            }
          }
        }

        if (expiredKeys.length > 0) {
          const deleted = await redisClient.del(...expiredKeys);
          totalDeleted += deleted;
        }
      }

      // Force memory cleanup (if available)
      try {
        await redisClient.call('MEMORY', 'PURGE');
      } catch {
        // Memory purge command may not be available in all Redis versions
        logger.debug('Redis MEMORY PURGE command not available');
      }

      // Get statistics after cleanup
      const afterInfo = await redisClient.info('memory');
      const afterKeys = await redisClient.dbsize();

      const duration = Date.now() - startTime;

      logger.info({
        jobId: job.id,
        keysDeleted: totalDeleted,
        keysBefore: beforeKeys,
        keysAfter: afterKeys,
        duration
      }, 'Cache cleanup completed');

      return {
        success: true,
        data: {
          keysDeleted: totalDeleted,
          keysBefore: beforeKeys,
          keysAfter: afterKeys,
          memoryBefore: beforeInfo,
          memoryAfter: afterInfo
        },
        duration,
        timestamp: new Date().toISOString(),
        metrics: {
          cacheKeysDeleted: totalDeleted,
          keysReduction: beforeKeys - afterKeys
        }
      };
    } catch (error) {
      throw new DatabaseError('cache_cleanup', error instanceof Error ? error : new Error(String(error)));
    }
  }
);

/**
 * Process temporary files cleanup job
 */
export const processTempFilesCleanup = withErrorHandling(
  async (job: Job<CleanupJobData>): Promise<JobResult> => {
    const startTime = Date.now();
    const { olderThanDays = 1 } = job.data;

    if (olderThanDays < 0.1) {
      throw new ValidationError('olderThanDays', olderThanDays, 'positive number >= 0.1');
    }

    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    try {
      // Common temporary directories to clean
      const tempDirs = [
        '/tmp',
        '/var/tmp',
        join(process.cwd(), 'temp'),
        join(process.cwd(), 'logs', 'temp')
      ];

      let totalDeleted = 0;
      let totalSize = 0;

      for (const tempDir of tempDirs) {
        try {
          const exists = await fs.access(tempDir).then(() => true).catch(() => false);
          if (!exists) continue;

          const files = await fs.readdir(tempDir);

          for (const file of files) {
            const filePath = join(tempDir, file);

            try {
              const stats = await fs.stat(filePath);

              if (stats.mtime.getTime() < cutoffTime) {
                totalSize += stats.size;
                await fs.unlink(filePath);
                totalDeleted++;
              }
            } catch (fileError) {
              // Skip files that can't be accessed
              logger.debug({ filePath, error: fileError }, 'Skipped file during temp cleanup');
            }
          }
        } catch (dirError) {
          // Skip directories that can't be accessed
          logger.debug({ tempDir, error: dirError }, 'Skipped directory during temp cleanup');
        }
      }

      const duration = Date.now() - startTime;

      logger.info({
        jobId: job.id,
        filesDeleted: totalDeleted,
        sizeFreed: totalSize,
        olderThanDays,
        duration
      }, 'Temporary files cleanup completed');

      return {
        success: true,
        data: {
          filesDeleted: totalDeleted,
          sizeFreed: totalSize,
          olderThanDays,
          cutoffTime: new Date(cutoffTime).toISOString()
        },
        duration,
        timestamp: new Date().toISOString(),
        metrics: {
          tempFilesDeleted: totalDeleted,
          bytesFreed: totalSize
        }
      };
    } catch (error) {
      throw new DatabaseError('temp_files_cleanup', error instanceof Error ? error : new Error(String(error)));
    }
  }
);

/**
 * Job processor mapping
 */
export const cleanupJobProcessors = {
  queue_items: processQueueItemsCleanup,
  rate_limits: processRateLimitCleanup,
  audit_logs: processAuditLogsCleanup,
  cache: processCacheCleanup,
  temp_files: processTempFilesCleanup
} as const;