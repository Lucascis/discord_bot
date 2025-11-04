import { describe, it, expect, vi, beforeEach, afterEach, MockedFunction } from 'vitest';
import type { Queue, Job } from 'bullmq';

/**
 * Cleanup Queue Test Suite
 *
 * Tests for BullMQ cleanup queue implementation
 * Following Discord bot maintenance patterns
 */

// Mock dependencies
const mockQueueOn = vi.fn().mockReturnThis();
const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-123' });
const mockQueueGetWaiting = vi.fn().mockResolvedValue([]);
const mockQueueGetActive = vi.fn().mockResolvedValue([]);
const mockQueueGetCompleted = vi.fn().mockResolvedValue([]);
const mockQueueGetFailed = vi.fn().mockResolvedValue([]);
const mockQueueGetDelayed = vi.fn().mockResolvedValue([]);
const mockQueuePause = vi.fn().mockResolvedValue(undefined);
const mockQueueResume = vi.fn().mockResolvedValue(undefined);
const mockQueueClean = vi.fn().mockResolvedValue([]);

class MockQueue {
  constructor(public name: string, public options: any) {}

  on = mockQueueOn;
  add = mockQueueAdd;
  getWaiting = mockQueueGetWaiting;
  getActive = mockQueueGetActive;
  getCompleted = mockQueueGetCompleted;
  getFailed = mockQueueGetFailed;
  getDelayed = mockQueueGetDelayed;
  pause = mockQueuePause;
  resume = mockQueueResume;
  clean = mockQueueClean;
}

vi.mock('bullmq', () => ({
  Queue: MockQueue
}));

vi.mock('../src/utils/redis-client.js', () => ({
  redisClient: {
    connect: vi.fn(),
    quit: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG')
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

describe('cleanup-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cleanupQueue initialization', () => {
    it('should create cleanup queue with correct name', async () => {
      const { cleanupQueue } = await import('../src/queues/cleanup-queue.js');

      expect(cleanupQueue).toBeDefined();
      expect(cleanupQueue.name).toBe('cleanup');
    });

    it('should configure queue with Redis connection', async () => {
      const { cleanupQueue } = await import('../src/queues/cleanup-queue.js');

      expect(cleanupQueue.options).toBeDefined();
      expect(cleanupQueue.options.connection).toBeDefined();
    });

    it('should configure default job options', async () => {
      const { cleanupQueue } = await import('../src/queues/cleanup-queue.js');

      expect(cleanupQueue.options.defaultJobOptions).toBeDefined();
      expect(cleanupQueue.options.defaultJobOptions).toHaveProperty('removeOnComplete');
      expect(cleanupQueue.options.defaultJobOptions).toHaveProperty('removeOnFail');
      expect(cleanupQueue.options.defaultJobOptions).toHaveProperty('attempts');
      expect(cleanupQueue.options.defaultJobOptions).toHaveProperty('backoff');
    });

    it('should set correct retry attempts', async () => {
      const { cleanupQueue } = await import('../src/queues/cleanup-queue.js');

      expect(cleanupQueue.options.defaultJobOptions.attempts).toBe(3);
    });

    it('should configure exponential backoff', async () => {
      const { cleanupQueue } = await import('../src/queues/cleanup-queue.js');

      const backoff = cleanupQueue.options.defaultJobOptions.backoff;
      expect(backoff).toBeDefined();
      expect(backoff.type).toBe('exponential');
      expect(backoff.delay).toBe(2000);
    });
  });

  describe('queue event listeners', () => {
    it('should register error event listener', async () => {
      await import('../src/queues/cleanup-queue.js');

      expect(mockQueueOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should register waiting event listener', async () => {
      await import('../src/queues/cleanup-queue.js');

      expect(mockQueueOn).toHaveBeenCalledWith('waiting', expect.any(Function));
    });

    it('should register active event listener', async () => {
      await import('../src/queues/cleanup-queue.js');

      expect(mockQueueOn).toHaveBeenCalledWith('active', expect.any(Function));
    });

    it('should register completed event listener', async () => {
      await import('../src/queues/cleanup-queue.js');

      expect(mockQueueOn).toHaveBeenCalledWith('completed', expect.any(Function));
    });

    it('should register failed event listener', async () => {
      await import('../src/queues/cleanup-queue.js');

      expect(mockQueueOn).toHaveBeenCalledWith('failed', expect.any(Function));
    });
  });

  describe('addQueueItemCleanup', () => {
    it('should add queue item cleanup job with default parameters', async () => {
      const { addQueueItemCleanup } = await import('../src/queues/cleanup-queue.js');

      await addQueueItemCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'queue_items_cleanup',
        expect.objectContaining({
          type: 'cleanup',
          subtype: 'queue_items',
          olderThanDays: 7,
          batchSize: 1000
        }),
        expect.any(Object)
      );
    });

    it('should add job with custom parameters', async () => {
      const { addQueueItemCleanup } = await import('../src/queues/cleanup-queue.js');
      const { JobPriority } = await import('../src/types/jobs.js');

      await addQueueItemCleanup(14, 500, { priority: JobPriority.HIGH });

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'queue_items_cleanup',
        expect.objectContaining({
          olderThanDays: 14,
          batchSize: 500,
          priority: JobPriority.HIGH
        }),
        expect.any(Object)
      );
    });

    it('should include requestId and timestamp', async () => {
      const { addQueueItemCleanup } = await import('../src/queues/cleanup-queue.js');

      await addQueueItemCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'queue_items_cleanup',
        expect.objectContaining({
          requestId: expect.stringContaining('cleanup_queue_'),
          timestamp: expect.any(String)
        }),
        expect.any(Object)
      );
    });

    it('should configure job options correctly', async () => {
      const { addQueueItemCleanup } = await import('../src/queues/cleanup-queue.js');
      const { JobPriority } = await import('../src/types/jobs.js');

      await addQueueItemCleanup(7, 1000, {
        priority: JobPriority.HIGH,
        delay: 5000
      });

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'queue_items_cleanup',
        expect.any(Object),
        expect.objectContaining({
          priority: JobPriority.HIGH,
          delay: 5000
        })
      );
    });

    it('should support cron scheduling', async () => {
      const { addQueueItemCleanup } = await import('../src/queues/cleanup-queue.js');

      await addQueueItemCleanup(7, 1000, {
        cron: '0 2 * * *'
      });

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'queue_items_cleanup',
        expect.any(Object),
        expect.objectContaining({
          repeat: '0 2 * * *'
        })
      );
    });
  });

  describe('addRateLimitCleanup', () => {
    it('should add rate limit cleanup job', async () => {
      const { addRateLimitCleanup } = await import('../src/queues/cleanup-queue.js');

      await addRateLimitCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'rate_limits_cleanup',
        expect.objectContaining({
          type: 'cleanup',
          subtype: 'rate_limits'
        }),
        expect.any(Object)
      );
    });

    it('should include requestId with rate prefix', async () => {
      const { addRateLimitCleanup } = await import('../src/queues/cleanup-queue.js');

      await addRateLimitCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'rate_limits_cleanup',
        expect.objectContaining({
          requestId: expect.stringContaining('cleanup_rate_')
        }),
        expect.any(Object)
      );
    });

    it('should support custom options', async () => {
      const { addRateLimitCleanup } = await import('../src/queues/cleanup-queue.js');
      const { JobPriority } = await import('../src/types/jobs.js');

      await addRateLimitCleanup({
        priority: JobPriority.LOW,
        delay: 10000
      });

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'rate_limits_cleanup',
        expect.objectContaining({
          priority: JobPriority.LOW
        }),
        expect.objectContaining({
          delay: 10000
        })
      );
    });
  });

  describe('addAuditLogsCleanup', () => {
    it('should add audit logs cleanup job with defaults', async () => {
      const { addAuditLogsCleanup } = await import('../src/queues/cleanup-queue.js');

      await addAuditLogsCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'audit_logs_cleanup',
        expect.objectContaining({
          type: 'cleanup',
          subtype: 'audit_logs',
          olderThanDays: 30,
          batchSize: 500
        }),
        expect.any(Object)
      );
    });

    it('should include requestId with audit prefix', async () => {
      const { addAuditLogsCleanup } = await import('../src/queues/cleanup-queue.js');

      await addAuditLogsCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'audit_logs_cleanup',
        expect.objectContaining({
          requestId: expect.stringContaining('cleanup_audit_')
        }),
        expect.any(Object)
      );
    });

    it('should accept custom days and batch size', async () => {
      const { addAuditLogsCleanup } = await import('../src/queues/cleanup-queue.js');

      await addAuditLogsCleanup(60, 1000);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'audit_logs_cleanup',
        expect.objectContaining({
          olderThanDays: 60,
          batchSize: 1000
        }),
        expect.any(Object)
      );
    });
  });

  describe('addCacheCleanup', () => {
    it('should add cache cleanup job', async () => {
      const { addCacheCleanup } = await import('../src/queues/cleanup-queue.js');

      await addCacheCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'cache_cleanup',
        expect.objectContaining({
          type: 'cleanup',
          subtype: 'cache'
        }),
        expect.any(Object)
      );
    });

    it('should include requestId with cache prefix', async () => {
      const { addCacheCleanup } = await import('../src/queues/cleanup-queue.js');

      await addCacheCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'cache_cleanup',
        expect.objectContaining({
          requestId: expect.stringContaining('cleanup_cache_')
        }),
        expect.any(Object)
      );
    });
  });

  describe('addTempFilesCleanup', () => {
    it('should add temp files cleanup job with defaults', async () => {
      const { addTempFilesCleanup } = await import('../src/queues/cleanup-queue.js');

      await addTempFilesCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'temp_files_cleanup',
        expect.objectContaining({
          type: 'cleanup',
          subtype: 'temp_files',
          olderThanDays: 1
        }),
        expect.any(Object)
      );
    });

    it('should include requestId with temp prefix', async () => {
      const { addTempFilesCleanup } = await import('../src/queues/cleanup-queue.js');

      await addTempFilesCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'temp_files_cleanup',
        expect.objectContaining({
          requestId: expect.stringContaining('cleanup_temp_')
        }),
        expect.any(Object)
      );
    });

    it('should accept custom days parameter', async () => {
      const { addTempFilesCleanup } = await import('../src/queues/cleanup-queue.js');

      await addTempFilesCleanup(7);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'temp_files_cleanup',
        expect.objectContaining({
          olderThanDays: 7
        }),
        expect.any(Object)
      );
    });
  });

  describe('scheduleDailyCleanup', () => {
    it('should schedule all cleanup jobs', async () => {
      const { scheduleDailyCleanup } = await import('../src/queues/cleanup-queue.js');

      await scheduleDailyCleanup();

      // Should have called add 5 times (one for each cleanup type)
      expect(mockQueueAdd).toHaveBeenCalledTimes(5);
    });

    it('should schedule with daily cron pattern', async () => {
      const { scheduleDailyCleanup } = await import('../src/queues/cleanup-queue.js');

      await scheduleDailyCleanup();

      // All jobs should have cron: '0 2 * * *' (2 AM daily)
      const calls = mockQueueAdd.mock.calls;
      calls.forEach(call => {
        expect(call[2]).toHaveProperty('repeat', '0 2 * * *');
      });
    });

    it('should schedule queue items cleanup', async () => {
      const { scheduleDailyCleanup } = await import('../src/queues/cleanup-queue.js');

      await scheduleDailyCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'queue_items_cleanup',
        expect.objectContaining({
          subtype: 'queue_items',
          olderThanDays: 7,
          batchSize: 1000
        }),
        expect.any(Object)
      );
    });

    it('should schedule rate limit cleanup', async () => {
      const { scheduleDailyCleanup } = await import('../src/queues/cleanup-queue.js');

      await scheduleDailyCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'rate_limits_cleanup',
        expect.objectContaining({
          subtype: 'rate_limits'
        }),
        expect.any(Object)
      );
    });

    it('should schedule audit logs cleanup', async () => {
      const { scheduleDailyCleanup } = await import('../src/queues/cleanup-queue.js');

      await scheduleDailyCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'audit_logs_cleanup',
        expect.objectContaining({
          subtype: 'audit_logs',
          olderThanDays: 30,
          batchSize: 500
        }),
        expect.any(Object)
      );
    });

    it('should schedule cache cleanup', async () => {
      const { scheduleDailyCleanup } = await import('../src/queues/cleanup-queue.js');

      await scheduleDailyCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'cache_cleanup',
        expect.objectContaining({
          subtype: 'cache'
        }),
        expect.any(Object)
      );
    });

    it('should schedule temp files cleanup', async () => {
      const { scheduleDailyCleanup } = await import('../src/queues/cleanup-queue.js');

      await scheduleDailyCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'temp_files_cleanup',
        expect.objectContaining({
          subtype: 'temp_files',
          olderThanDays: 1
        }),
        expect.any(Object)
      );
    });
  });

  describe('getCleanupQueueStats', () => {
    it('should return stats for all job states', async () => {
      const { getCleanupQueueStats } = await import('../src/queues/cleanup-queue.js');

      mockQueueGetWaiting.mockResolvedValue([{ id: '1' }, { id: '2' }]);
      mockQueueGetActive.mockResolvedValue([{ id: '3' }]);
      mockQueueGetCompleted.mockResolvedValue([{ id: '4' }, { id: '5' }, { id: '6' }]);
      mockQueueGetFailed.mockResolvedValue([{ id: '7' }]);
      mockQueueGetDelayed.mockResolvedValue([]);

      const stats = await getCleanupQueueStats();

      expect(stats).toEqual({
        waiting: 2,
        active: 1,
        completed: 3,
        failed: 1,
        delayed: 0,
        total: 7
      });
    });

    it('should handle empty queue', async () => {
      const { getCleanupQueueStats } = await import('../src/queues/cleanup-queue.js');

      mockQueueGetWaiting.mockResolvedValue([]);
      mockQueueGetActive.mockResolvedValue([]);
      mockQueueGetCompleted.mockResolvedValue([]);
      mockQueueGetFailed.mockResolvedValue([]);
      mockQueueGetDelayed.mockResolvedValue([]);

      const stats = await getCleanupQueueStats();

      expect(stats).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        total: 0
      });
    });

    it('should calculate total correctly', async () => {
      const { getCleanupQueueStats } = await import('../src/queues/cleanup-queue.js');

      mockQueueGetWaiting.mockResolvedValue([{ id: '1' }]);
      mockQueueGetActive.mockResolvedValue([{ id: '2' }]);
      mockQueueGetCompleted.mockResolvedValue([{ id: '3' }]);
      mockQueueGetFailed.mockResolvedValue([{ id: '4' }]);
      mockQueueGetDelayed.mockResolvedValue([{ id: '5' }]);

      const stats = await getCleanupQueueStats();

      expect(stats.total).toBe(5);
      expect(stats.total).toBe(
        stats.waiting + stats.active + stats.completed + stats.failed + stats.delayed
      );
    });
  });

  describe('pauseCleanupQueue', () => {
    it('should pause the cleanup queue', async () => {
      const { pauseCleanupQueue } = await import('../src/queues/cleanup-queue.js');

      await pauseCleanupQueue();

      expect(mockQueuePause).toHaveBeenCalled();
    });

    it('should log pause operation', async () => {
      const { pauseCleanupQueue } = await import('../src/queues/cleanup-queue.js');
      const { logger } = await import('@discord-bot/logger');

      await pauseCleanupQueue();

      expect(logger.info).toHaveBeenCalledWith('Cleanup queue paused');
    });
  });

  describe('resumeCleanupQueue', () => {
    it('should resume the cleanup queue', async () => {
      const { resumeCleanupQueue } = await import('../src/queues/cleanup-queue.js');

      await resumeCleanupQueue();

      expect(mockQueueResume).toHaveBeenCalled();
    });

    it('should log resume operation', async () => {
      const { resumeCleanupQueue } = await import('../src/queues/cleanup-queue.js');
      const { logger } = await import('@discord-bot/logger');

      await resumeCleanupQueue();

      expect(logger.info).toHaveBeenCalledWith('Cleanup queue resumed');
    });
  });

  describe('cleanupOldJobs', () => {
    it('should clean up completed jobs older than 24 hours', async () => {
      const { cleanupOldJobs } = await import('../src/queues/cleanup-queue.js');

      await cleanupOldJobs();

      expect(mockQueueClean).toHaveBeenCalledWith(
        24 * 60 * 60 * 1000, // 24 hours in ms
        100, // keep 100
        'completed'
      );
    });

    it('should clean up failed jobs older than 7 days', async () => {
      const { cleanupOldJobs } = await import('../src/queues/cleanup-queue.js');

      await cleanupOldJobs();

      expect(mockQueueClean).toHaveBeenCalledWith(
        7 * 24 * 60 * 60 * 1000, // 7 days in ms
        50, // keep 50
        'failed'
      );
    });

    it('should log cleanup operation', async () => {
      const { cleanupOldJobs } = await import('../src/queues/cleanup-queue.js');
      const { logger } = await import('@discord-bot/logger');

      await cleanupOldJobs();

      expect(logger.info).toHaveBeenCalledWith('Old cleanup jobs cleaned');
    });

    it('should clean both completed and failed jobs', async () => {
      const { cleanupOldJobs } = await import('../src/queues/cleanup-queue.js');

      await cleanupOldJobs();

      expect(mockQueueClean).toHaveBeenCalledTimes(2);
      expect(mockQueueClean).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 'completed');
      expect(mockQueueClean).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 'failed');
    });
  });

  describe('job priority system', () => {
    it('should support different priority levels', async () => {
      const { addQueueItemCleanup } = await import('../src/queues/cleanup-queue.js');
      const { JobPriority } = await import('../src/types/jobs.js');

      await addQueueItemCleanup(7, 1000, { priority: JobPriority.HIGH });

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'queue_items_cleanup',
        expect.objectContaining({
          priority: JobPriority.HIGH
        }),
        expect.objectContaining({
          priority: JobPriority.HIGH
        })
      );
    });

    it('should use NORMAL priority by default', async () => {
      const { addQueueItemCleanup } = await import('../src/queues/cleanup-queue.js');
      const { JobPriority } = await import('../src/types/jobs.js');

      await addQueueItemCleanup();

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'queue_items_cleanup',
        expect.objectContaining({
          priority: JobPriority.NORMAL
        }),
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should handle queue add failures', async () => {
      const { addQueueItemCleanup } = await import('../src/queues/cleanup-queue.js');

      mockQueueAdd.mockRejectedValueOnce(new Error('Redis connection failed'));

      await expect(addQueueItemCleanup()).rejects.toThrow('Redis connection failed');
    });

    it('should handle stats retrieval failures', async () => {
      const { getCleanupQueueStats } = await import('../src/queues/cleanup-queue.js');

      mockQueueGetWaiting.mockRejectedValueOnce(new Error('Stats error'));

      await expect(getCleanupQueueStats()).rejects.toThrow('Stats error');
    });

    it('should handle pause failures', async () => {
      const { pauseCleanupQueue } = await import('../src/queues/cleanup-queue.js');

      mockQueuePause.mockRejectedValueOnce(new Error('Pause failed'));

      await expect(pauseCleanupQueue()).rejects.toThrow('Pause failed');
    });

    it('should handle resume failures', async () => {
      const { resumeCleanupQueue } = await import('../src/queues/cleanup-queue.js');

      mockQueueResume.mockRejectedValueOnce(new Error('Resume failed'));

      await expect(resumeCleanupQueue()).rejects.toThrow('Resume failed');
    });
  });
});
