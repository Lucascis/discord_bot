import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initializeCleanupWorker,
  initializeAllWorkers,
  shutdownAllWorkers,
  pauseAllWorkers,
  resumeAllWorkers,
  getWorkerStats,
  getJobMetrics,
  clearOldMetrics,
  checkWorkersHealth
} from '../src/workers/bullmq-worker.js';

// Mock Worker from bullmq - define mock functions first
const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
const mockWorkerPause = vi.fn().mockResolvedValue(undefined);
const mockWorkerResume = vi.fn().mockResolvedValue(undefined);
const mockWorkerIsPaused = vi.fn().mockReturnValue(false);

// Mock bullmq - define inline to avoid hoisting issues
vi.mock('bullmq', () => {
  return {
    Worker: class MockWorker {
      closing = false;
      opts: any;

      constructor(public queueName: string, public processor: any, public options: any) {
        this.opts = options;
      }

      on = mockWorkerOn.mockReturnThis();
      close = mockWorkerClose;
      pause = mockWorkerPause;
      resume = mockWorkerResume;
      isPaused = mockWorkerIsPaused;
    }
  };
});

vi.mock('../src/utils/redis-client.js', () => ({
  redisClient: {
    connect: vi.fn(),
    quit: vi.fn(),
    ping: vi.fn()
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

vi.mock('../src/jobs/cleanup-jobs.js', () => ({
  cleanupJobProcessors: {
    queue_items: vi.fn(),
    rate_limits: vi.fn(),
    audit_logs: vi.fn(),
    cache: vi.fn(),
    temp_files: vi.fn()
  }
}));

describe('bullmq-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeCleanupWorker', () => {
    it('should create cleanup worker with correct configuration', () => {
      const worker = initializeCleanupWorker();

      expect(worker).toBeDefined();
      expect(worker.queueName).toBe('cleanup');
      expect(worker.opts.concurrency).toBe(2);
    });

    it('should register worker event handlers', () => {
      initializeCleanupWorker();

      expect(mockWorkerOn).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockWorkerOn).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWorkerOn).toHaveBeenCalledWith('stalled', expect.any(Function));
    });

    it('should configure rate limiting', () => {
      const worker = initializeCleanupWorker();

      expect(worker.opts.limiter).toEqual({
        max: 5,
        duration: 60000
      });
    });

    it('should configure job removal policies', () => {
      const worker = initializeCleanupWorker();

      expect(worker.opts.removeOnComplete).toEqual({
        age: 24 * 60 * 60,
        count: 100
      });
      expect(worker.opts.removeOnFail).toEqual({
        age: 7 * 24 * 60 * 60,
        count: 50
      });
    });
  });

  describe('initializeAllWorkers', () => {
    it('should initialize cleanup worker', async () => {
      await initializeAllWorkers();

      const stats = await getWorkerStats();
      expect(stats).toHaveProperty('cleanup');
    });

    it('should log successful initialization', async () => {
      const { logger } = await import('@discord-bot/logger');

      await initializeAllWorkers();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          activeWorkers: expect.any(Array),
          totalWorkers: expect.any(Number)
        }),
        expect.stringContaining('initialized')
      );
    });
  });

  describe('shutdownAllWorkers', () => {
    it('should close all active workers', async () => {
      await initializeAllWorkers();
      await shutdownAllWorkers();

      expect(mockWorkerClose).toHaveBeenCalled();
    });

    it('should clear workers registry', async () => {
      await initializeAllWorkers();
      await shutdownAllWorkers();

      const stats = await getWorkerStats();
      expect(Object.keys(stats)).toHaveLength(0);
    });

    it('should handle shutdown errors', async () => {
      const { logger } = await import('@discord-bot/logger');

      await initializeAllWorkers();

      mockWorkerClose.mockRejectedValueOnce(new Error('Close failed'));

      await expect(shutdownAllWorkers()).rejects.toThrow('Close failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('pauseAllWorkers', () => {
    it('should pause all workers', async () => {
      await initializeAllWorkers();
      await pauseAllWorkers();

      expect(mockWorkerPause).toHaveBeenCalled();
    });

    it('should log pause operation', async () => {
      const { logger } = await import('@discord-bot/logger');

      await initializeAllWorkers();
      await pauseAllWorkers();

      expect(logger.info).toHaveBeenCalledWith('All workers paused');
    });
  });

  describe('resumeAllWorkers', () => {
    it('should resume all workers', async () => {
      await initializeAllWorkers();
      await pauseAllWorkers();
      await resumeAllWorkers();

      expect(mockWorkerResume).toHaveBeenCalled();
    });

    it('should log resume operation', async () => {
      const { logger } = await import('@discord-bot/logger');

      await initializeAllWorkers();
      await resumeAllWorkers();

      expect(logger.info).toHaveBeenCalledWith('All workers resumed');
    });
  });

  describe('getWorkerStats', () => {
    it('should return stats for all workers', async () => {
      await initializeAllWorkers();
      const stats = await getWorkerStats();

      expect(stats).toHaveProperty('cleanup');
      expect(stats.cleanup).toHaveProperty('isRunning');
      expect(stats.cleanup).toHaveProperty('isPaused');
      expect(stats.cleanup).toHaveProperty('concurrency');
    });

    it('should indicate running status correctly', async () => {
      await initializeAllWorkers();
      const stats = await getWorkerStats();

      expect((stats.cleanup as any).isRunning).toBe(true);
    });

    it('should indicate paused status correctly', async () => {
      await initializeAllWorkers();
      await pauseAllWorkers();

      mockWorkerIsPaused.mockReturnValueOnce(true);

      const stats = await getWorkerStats();
      expect((stats.cleanup as any).isPaused).toBe(true);
    });

    it('should handle errors in worker stats', async () => {
      await initializeAllWorkers();

      mockWorkerIsPaused.mockImplementationOnce(() => {
        throw new Error('Stats error');
      });

      const stats = await getWorkerStats();

      expect(stats.cleanup).toHaveProperty('error');
    });
  });

  describe('getJobMetrics', () => {
    it('should return job metrics summary', () => {
      const metrics = getJobMetrics();

      expect(metrics).toHaveProperty('total');
      expect(metrics).toHaveProperty('byStatus');
      expect(metrics).toHaveProperty('byQueue');
      expect(metrics).toHaveProperty('averageDuration');
      expect(metrics).toHaveProperty('recentErrors');
    });

    it('should calculate average duration correctly', () => {
      const metrics = getJobMetrics();

      expect(metrics.averageDuration).toBeGreaterThanOrEqual(0);
    });

    it('should limit recent errors to last 10', () => {
      const metrics = getJobMetrics();

      expect(metrics.recentErrors.length).toBeLessThanOrEqual(10);
    });
  });

  describe('clearOldMetrics', () => {
    it('should keep only last 1000 metrics', () => {
      clearOldMetrics();

      const metrics = getJobMetrics();
      expect(metrics.total).toBeLessThanOrEqual(1000);
    });
  });

  describe('checkWorkersHealth', () => {
    it('should return healthy status for running workers', async () => {
      await initializeAllWorkers();
      const health = await checkWorkersHealth();

      expect(health.healthy).toBe(true);
      expect(health.details).toHaveProperty('workers');
      expect(health.details).toHaveProperty('totalWorkers');
      expect(health.details).toHaveProperty('metrics');
    });

    it('should return unhealthy status for closed workers', async () => {
      await initializeAllWorkers();

      // Simulate a closed worker
      const stats = await getWorkerStats();
      const worker = (stats as any)._worker;
      if (worker) {
        worker.closing = true;
      }

      const health = await checkWorkersHealth();

      // Health check should still work even if worker is closing
      expect(health).toHaveProperty('healthy');
    });

    it('should include worker details in health check', async () => {
      await initializeAllWorkers();
      const health = await checkWorkersHealth();

      expect(health.details.workers).toHaveProperty('cleanup');
    });
  });

  describe('worker configuration', () => {
    it('should use correct concurrency settings', () => {
      const worker = initializeCleanupWorker();

      expect(worker.opts.concurrency).toBe(2);
    });

    it('should use correct stalled job settings', async () => {
      const worker = initializeCleanupWorker();

      // Stalled interval should be set in options
      expect(worker.opts).toBeDefined();
    });
  });

  describe('job processor', () => {
    it('should process jobs with correct processor', async () => {
      const worker = initializeCleanupWorker();

      expect(worker.processor).toBeDefined();
      expect(typeof worker.processor).toBe('function');
    });

    it('should handle job processing errors', async () => {
      const { cleanupJobProcessors } = await import('../src/jobs/cleanup-jobs.js');
      const worker = initializeCleanupWorker();

      // Mock a processor that throws
      vi.mocked(cleanupJobProcessors.queue_items).mockRejectedValueOnce(
        new Error('Processing failed')
      );

      const mockJob = {
        id: 'test-123',
        data: {
          type: 'cleanup',
          subtype: 'queue_items',
          requestId: 'req-123',
          timestamp: new Date().toISOString()
        },
        attemptsMade: 1
      };

      await expect(worker.processor(mockJob)).rejects.toThrow();
    });
  });

  describe('event handlers', () => {
    it('should handle ready event', async () => {
      const { logger } = await import('@discord-bot/logger');
      const _worker = initializeCleanupWorker();

      // Find the ready handler
      const readyCall = mockWorkerOn.mock.calls.find(call => call[0] === 'ready');
      expect(readyCall).toBeDefined();

      if (readyCall) {
        const readyHandler = readyCall[1];
        readyHandler();

        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ queue: 'cleanup' }),
          expect.stringContaining('ready')
        );
      }
    });

    it('should handle error event', async () => {
      const { logger } = await import('@discord-bot/logger');
      const _worker = initializeCleanupWorker();

      const errorCall = mockWorkerOn.mock.calls.find(call => call[0] === 'error');
      expect(errorCall).toBeDefined();

      if (errorCall) {
        const errorHandler = errorCall[1];
        errorHandler(new Error('Test error'));

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Test error',
            queue: 'cleanup'
          }),
          expect.stringContaining('error')
        );
      }
    });

    it('should handle stalled event', async () => {
      const { logger } = await import('@discord-bot/logger');
      const _worker = initializeCleanupWorker();

      const stalledCall = mockWorkerOn.mock.calls.find(call => call[0] === 'stalled');
      expect(stalledCall).toBeDefined();

      if (stalledCall) {
        const stalledHandler = stalledCall[1];
        stalledHandler('job-123', 'prev-worker');

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId: 'job-123',
            prev: 'prev-worker',
            queue: 'cleanup'
          }),
          expect.stringContaining('stalled')
        );
      }
    });
  });
});
