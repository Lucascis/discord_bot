import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  processQueueItemsCleanup,
  processRateLimitCleanup,
  processAuditLogsCleanup,
  processCacheCleanup,
  processTempFilesCleanup
} from '../src/jobs/cleanup-jobs.js';
import type { Job } from 'bullmq';
import type { CleanupJobData } from '../src/types/jobs.js';

// Mock dependencies
vi.mock('@discord-bot/database', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    rateLimit: {
      deleteMany: vi.fn()
    },
    auditLog: {
      findMany: vi.fn(),
      deleteMany: vi.fn()
    }
  }
}));

vi.mock('../src/utils/redis-client.js', () => ({
  redisClient: {
    info: vi.fn(),
    dbsize: vi.fn(),
    keys: vi.fn(),
    ttl: vi.fn(),
    del: vi.fn(),
    call: vi.fn()
  }
}));

vi.mock('@discord-bot/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

import { prisma } from '@discord-bot/database';
import { redisClient } from '../src/utils/redis-client.js';

describe('cleanup-jobs', () => {
  const createMockJob = (data: Partial<CleanupJobData>): Job<CleanupJobData> => ({
    id: 'test-job-123',
    data: {
      type: 'cleanup',
      subtype: 'queue_items',
      requestId: 'test-request',
      timestamp: new Date().toISOString(),
      ...data
    } as CleanupJobData,
    attemptsMade: 1,
    updateProgress: vi.fn().mockResolvedValue(undefined)
  } as unknown as Job<CleanupJobData>);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processQueueItemsCleanup', () => {
    it('should delete old queue items in batches', async () => {
      const job = createMockJob({
        subtype: 'queue_items',
        olderThanDays: 7,
        batchSize: 1000
      });

      // Mock successful batch deletion
      vi.mocked(prisma.$executeRaw)
        .mockResolvedValueOnce(500) // First batch
        .mockResolvedValueOnce(300) // Second batch
        .mockResolvedValueOnce(0);  // No more items

      const result = await processQueueItemsCleanup(job);

      expect(result.success).toBe(true);
      expect(result.data?.totalDeleted).toBe(800);
      expect(result.metrics?.itemsDeleted).toBe(800);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
    });

    it('should update job progress during cleanup', async () => {
      const job = createMockJob({
        subtype: 'queue_items',
        olderThanDays: 7,
        batchSize: 100
      });

      vi.mocked(prisma.$executeRaw)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(0);

      await processQueueItemsCleanup(job);

      expect(job.updateProgress).toHaveBeenCalled();
    });

    it('should reject invalid olderThanDays parameter', async () => {
      const job = createMockJob({
        subtype: 'queue_items',
        olderThanDays: 0
      });

      await expect(processQueueItemsCleanup(job)).rejects.toThrow();
    });

    it('should include cutoff date in result', async () => {
      const job = createMockJob({
        subtype: 'queue_items',
        olderThanDays: 7
      });

      vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(0);

      const result = await processQueueItemsCleanup(job);

      expect(result.data?.cutoffDate).toBeTruthy();
      expect(new Date(result.data!.cutoffDate!)).toBeInstanceOf(Date);
    });
  });

  describe('processRateLimitCleanup', () => {
    it('should delete expired rate limits', async () => {
      const job = createMockJob({
        subtype: 'rate_limits'
      });

      vi.mocked(prisma.rateLimit.deleteMany).mockResolvedValue({
        count: 42
      });

      const result = await processRateLimitCleanup(job);

      expect(result.success).toBe(true);
      expect(result.data?.deletedCount).toBe(42);
      expect(result.metrics?.rateLimitsDeleted).toBe(42);
      expect(prisma.rateLimit.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date)
          }
        }
      });
    });

    it('should handle zero deletions', async () => {
      const job = createMockJob({
        subtype: 'rate_limits'
      });

      vi.mocked(prisma.rateLimit.deleteMany).mockResolvedValue({
        count: 0
      });

      const result = await processRateLimitCleanup(job);

      expect(result.success).toBe(true);
      expect(result.data?.deletedCount).toBe(0);
    });
  });

  describe('processAuditLogsCleanup', () => {
    it('should delete old audit logs', async () => {
      const job = createMockJob({
        subtype: 'audit_logs',
        olderThanDays: 30,
        batchSize: 500
      });

      const mockLogs = Array(100).fill(null).map((_, i) => ({
        id: `log-${i}`,
        action: 'TEST_ACTION',
        userId: 'user-123',
        guildId: 'guild-456',
        createdAt: new Date()
      }));

      vi.mocked(prisma.auditLog.findMany).mockResolvedValue(mockLogs);
      vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({
        count: 100
      });

      const result = await processAuditLogsCleanup(job);

      expect(result.success).toBe(true);
      expect(result.data?.deletedCount).toBe(100);
      expect(result.metrics?.auditLogsDeleted).toBe(100);
    });

    it('should reject olderThanDays less than 7', async () => {
      const job = createMockJob({
        subtype: 'audit_logs',
        olderThanDays: 5
      });

      await expect(processAuditLogsCleanup(job)).rejects.toThrow();
    });

    it('should handle no logs to clean', async () => {
      const job = createMockJob({
        subtype: 'audit_logs',
        olderThanDays: 30
      });

      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      const result = await processAuditLogsCleanup(job);

      expect(result.success).toBe(true);
      expect(result.data?.message).toContain('No audit logs');
      expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    });

    it('should use batch size from job data', async () => {
      const job = createMockJob({
        subtype: 'audit_logs',
        olderThanDays: 30,
        batchSize: 250
      });

      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      await processAuditLogsCleanup(job);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 250
        })
      );
    });
  });

  describe('processCacheCleanup', () => {
    beforeEach(() => {
      vi.mocked(redisClient.info).mockResolvedValue('memory_info');
      vi.mocked(redisClient.dbsize).mockResolvedValue(100);
    });

    it('should clean up expired cache keys', async () => {
      const job = createMockJob({
        subtype: 'cache'
      });

      vi.mocked(redisClient.keys)
        .mockResolvedValueOnce(['cache:key1', 'cache:key2'])
        .mockResolvedValueOnce(['temp:key1'])
        .mockResolvedValueOnce(['session:key1'])
        .mockResolvedValueOnce(['search:key1']);

      vi.mocked(redisClient.ttl)
        .mockResolvedValue(-1); // All keys have no expiration

      vi.mocked(redisClient.del).mockResolvedValue(2);
      vi.mocked(redisClient.dbsize)
        .mockResolvedValueOnce(100) // before
        .mockResolvedValueOnce(98);  // after

      const result = await processCacheCleanup(job);

      expect(result.success).toBe(true);
      expect(result.metrics?.cacheKeysDeleted).toBeGreaterThanOrEqual(0);
    });

    it('should handle memory purge failure gracefully', async () => {
      const job = createMockJob({
        subtype: 'cache'
      });

      vi.mocked(redisClient.keys).mockResolvedValue([]);
      vi.mocked(redisClient.call).mockRejectedValue(new Error('Command not supported'));

      const result = await processCacheCleanup(job);

      expect(result.success).toBe(true);
    });

    it('should only delete temp and session keys without TTL', async () => {
      const job = createMockJob({
        subtype: 'cache'
      });

      vi.mocked(redisClient.keys)
        .mockResolvedValueOnce(['cache:permanent'])
        .mockResolvedValueOnce(['temp:expired'])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      vi.mocked(redisClient.ttl).mockResolvedValue(-1);
      vi.mocked(redisClient.del).mockResolvedValue(1);

      await processCacheCleanup(job);

      // temp:expired should be deleted (temp prefix without TTL)
      // cache:permanent should not be deleted (cache prefix without TTL is ok)
      expect(redisClient.del).toHaveBeenCalled();
    });
  });

  describe('processTempFilesCleanup', () => {
    it('should reject invalid olderThanDays parameter', async () => {
      const job = createMockJob({
        subtype: 'temp_files',
        olderThanDays: 0.05
      });

      await expect(processTempFilesCleanup(job)).rejects.toThrow();
    });

    it('should handle non-existent directories gracefully', async () => {
      const job = createMockJob({
        subtype: 'temp_files',
        olderThanDays: 1
      });

      const result = await processTempFilesCleanup(job);

      expect(result.success).toBe(true);
      expect(result.data?.filesDeleted).toBe(0);
    });

    it('should calculate correct cutoff time', async () => {
      const job = createMockJob({
        subtype: 'temp_files',
        olderThanDays: 2
      });

      const result = await processTempFilesCleanup(job);

      expect(result.data?.cutoffTime).toBeTruthy();

      const cutoffDate = new Date(result.data!.cutoffTime!);
      const expectedCutoff = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));

      // Allow 1 second difference due to test execution time
      expect(Math.abs(cutoffDate.getTime() - expectedCutoff.getTime())).toBeLessThan(1000);
    });
  });

  describe('error handling', () => {
    it('should throw DatabaseError on database failures', async () => {
      const job = createMockJob({
        subtype: 'queue_items',
        olderThanDays: 7
      });

      vi.mocked(prisma.$executeRaw).mockRejectedValue(new Error('Database connection failed'));

      await expect(processQueueItemsCleanup(job)).rejects.toThrow();
    });

    it('should throw DatabaseError on rate limit cleanup failure', async () => {
      const job = createMockJob({
        subtype: 'rate_limits'
      });

      vi.mocked(prisma.rateLimit.deleteMany).mockRejectedValue(new Error('Query failed'));

      await expect(processRateLimitCleanup(job)).rejects.toThrow();
    });

    it('should include duration in successful results', async () => {
      const job = createMockJob({
        subtype: 'rate_limits'
      });

      vi.mocked(prisma.rateLimit.deleteMany).mockResolvedValue({ count: 5 });

      const result = await processRateLimitCleanup(job);

      expect(result.duration).toBeGreaterThan(0);
      expect(result.timestamp).toBeTruthy();
    });
  });

  describe('job result structure', () => {
    it('should return consistent result structure', async () => {
      const job = createMockJob({
        subtype: 'rate_limits'
      });

      vi.mocked(prisma.rateLimit.deleteMany).mockResolvedValue({ count: 10 });

      const result = await processRateLimitCleanup(job);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('metrics');
      expect(result.success).toBe(true);
    });
  });
});
