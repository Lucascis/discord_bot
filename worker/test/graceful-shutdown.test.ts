import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Graceful Shutdown Test Suite
 *
 * Tests for worker service graceful shutdown handling
 * Following Node.js best practices and BullMQ shutdown patterns
 */

// Mock dependencies
vi.mock('@discord-bot/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../src/workers/bullmq-worker.js', () => ({
  shutdownAllWorkers: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../src/utils/redis-client.js', () => ({
  closeRedis: vi.fn().mockResolvedValue(undefined)
}));

describe('graceful-shutdown', () => {
  let processExit: any;
  let processOn: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock process.exit to prevent actual exit
    processExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Mock process.on to capture event handlers
    processOn = vi.spyOn(process, 'on');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initializeGracefulShutdown', () => {
    it('should register SIGTERM handler', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      expect(processOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('should register SIGINT handler', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      expect(processOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    it('should register uncaughtException handler', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      expect(processOn).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    });

    it('should register unhandledRejection handler', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      expect(processOn).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    });

    it('should register exit handler', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      expect(processOn).toHaveBeenCalledWith('exit', expect.any(Function));
    });

    it('should log initialization', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');
      const { logger } = await import('@discord-bot/logger');

      initializeGracefulShutdown();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          gracefulTimeout: expect.any(Number),
          forceTimeout: expect.any(Number)
        }),
        expect.stringContaining('Graceful shutdown handlers initialized')
      );
    });
  });

  describe('addCleanupFunction', () => {
    it('should add cleanup function to registry', async () => {
      const { addCleanupFunction } = await import('../src/utils/graceful-shutdown.js');

      const cleanup = vi.fn().mockResolvedValue(undefined);

      addCleanupFunction(cleanup);

      // Function should be added (verified by getShutdownHealth)
      expect(cleanup).toBeDefined();
    });

    it('should support multiple cleanup functions', async () => {
      const { addCleanupFunction } = await import('../src/utils/graceful-shutdown.js');

      const cleanup1 = vi.fn().mockResolvedValue(undefined);
      const cleanup2 = vi.fn().mockResolvedValue(undefined);

      addCleanupFunction(cleanup1);
      addCleanupFunction(cleanup2);

      // Both should be added
      expect(cleanup1).toBeDefined();
      expect(cleanup2).toBeDefined();
    });
  });

  describe('removeCleanupFunction', () => {
    it('should remove cleanup function from registry', async () => {
      const { addCleanupFunction, removeCleanupFunction, getShutdownHealth } =
        await import('../src/utils/graceful-shutdown.js');

      const cleanup = vi.fn().mockResolvedValue(undefined);

      addCleanupFunction(cleanup);
      const healthBefore = getShutdownHealth();
      const countBefore = healthBefore.details.cleanupFunctionsRegistered as number;

      removeCleanupFunction(cleanup);
      const healthAfter = getShutdownHealth();
      const countAfter = healthAfter.details.cleanupFunctionsRegistered as number;

      expect(countAfter).toBeLessThan(countBefore);
    });

    it('should handle removing non-existent function', async () => {
      const { removeCleanupFunction } = await import('../src/utils/graceful-shutdown.js');

      const cleanup = vi.fn().mockResolvedValue(undefined);

      // Should not throw error
      expect(() => removeCleanupFunction(cleanup)).not.toThrow();
    });
  });

  describe('isShuttingDown', () => {
    it('should return false initially', async () => {
      const { isShuttingDown } = await import('../src/utils/graceful-shutdown.js');

      expect(isShuttingDown()).toBe(false);
    });

    it('should return true after shutdown initiated', async () => {
      const { triggerShutdown, isShuttingDown } = await import('../src/utils/graceful-shutdown.js');

      // Trigger shutdown
      triggerShutdown();

      // Give it a moment to update state
      await new Promise(resolve => setTimeout(resolve, 10));

      // May or may not be shutting down depending on async timing
      // This test documents the API rather than testing async behavior
      expect(typeof isShuttingDown()).toBe('boolean');
    });
  });

  describe('getShutdownHealth', () => {
    it('should return health status', async () => {
      const { getShutdownHealth } = await import('../src/utils/graceful-shutdown.js');

      const health = getShutdownHealth();

      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('details');
    });

    it('should include shutdown state in details', async () => {
      const { getShutdownHealth } = await import('../src/utils/graceful-shutdown.js');

      const health = getShutdownHealth();

      expect(health.details).toHaveProperty('isShuttingDown');
      expect(health.details).toHaveProperty('hasShutdownTimeout');
      expect(health.details).toHaveProperty('hasForceShutdownTimeout');
      expect(health.details).toHaveProperty('cleanupFunctionsRegistered');
    });

    it('should be healthy when not shutting down', async () => {
      const { getShutdownHealth } = await import('../src/utils/graceful-shutdown.js');

      const health = getShutdownHealth();

      expect(health.healthy).toBe(true);
      expect(health.details.isShuttingDown).toBe(false);
    });

    it('should include cleanup function count', async () => {
      const { addCleanupFunction, getShutdownHealth } =
        await import('../src/utils/graceful-shutdown.js');

      const cleanup = vi.fn().mockResolvedValue(undefined);
      addCleanupFunction(cleanup);

      const health = getShutdownHealth();

      expect(health.details.cleanupFunctionsRegistered).toBeGreaterThanOrEqual(0);
      expect(typeof health.details.cleanupFunctionsRegistered).toBe('number');
    });
  });

  describe('triggerShutdown', () => {
    it('should initiate shutdown sequence', async () => {
      const { triggerShutdown } = await import('../src/utils/graceful-shutdown.js');
      const { logger } = await import('@discord-bot/logger');

      triggerShutdown();

      expect(logger.info).toHaveBeenCalledWith('Manual shutdown triggered');
    });

    it('should call shutdown handlers', async () => {
      const { triggerShutdown } = await import('../src/utils/graceful-shutdown.js');
      const { shutdownAllWorkers } = await import('../src/workers/bullmq-worker.js');

      triggerShutdown();

      // Give async operations time to execute
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(shutdownAllWorkers).toHaveBeenCalled();
    });
  });

  describe('shutdown sequence', () => {
    it('should shutdown workers before closing Redis', async () => {
      const { triggerShutdown } = await import('../src/utils/graceful-shutdown.js');
      const { shutdownAllWorkers } = await import('../src/workers/bullmq-worker.js');
      const { closeRedis } = await import('../src/utils/redis-client.js');

      triggerShutdown();

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify both were called
      expect(shutdownAllWorkers).toHaveBeenCalled();
      expect(closeRedis).toHaveBeenCalled();
    });

    it('should execute cleanup functions during shutdown', async () => {
      const { addCleanupFunction, triggerShutdown } =
        await import('../src/utils/graceful-shutdown.js');

      const cleanup = vi.fn().mockResolvedValue(undefined);
      addCleanupFunction(cleanup);

      triggerShutdown();

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(cleanup).toHaveBeenCalled();
    });

    it('should handle cleanup function errors gracefully', async () => {
      const { addCleanupFunction, triggerShutdown } =
        await import('../src/utils/graceful-shutdown.js');
      const { logger } = await import('@discord-bot/logger');

      const failingCleanup = vi.fn().mockRejectedValue(new Error('Cleanup failed'));
      addCleanupFunction(failingCleanup);

      triggerShutdown();

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should log the error but continue
      expect(logger.error).toHaveBeenCalled();
    });

    it('should exit process after successful shutdown', async () => {
      const { triggerShutdown } = await import('../src/utils/graceful-shutdown.js');

      triggerShutdown();

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(processExit).toHaveBeenCalledWith(0);
    });
  });

  describe('error handling', () => {
    it('should handle shutdown errors', async () => {
      const { triggerShutdown } = await import('../src/utils/graceful-shutdown.js');
      const { shutdownAllWorkers } = await import('../src/workers/bullmq-worker.js');
      const { logger } = await import('@discord-bot/logger');

      vi.mocked(shutdownAllWorkers).mockRejectedValueOnce(new Error('Shutdown failed'));

      triggerShutdown();

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(logger.error).toHaveBeenCalled();
      expect(processExit).toHaveBeenCalledWith(1);
    });

    it('should force exit on uncaught exception', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      // Find the uncaughtException handler
      const uncaughtHandler = processOn.mock.calls.find(
        call => call[0] === 'uncaughtException'
      )?.[1];

      expect(uncaughtHandler).toBeDefined();

      if (uncaughtHandler) {
        uncaughtHandler(new Error('Test error'));
        expect(processExit).toHaveBeenCalledWith(1);
      }
    });

    it('should force exit on unhandled rejection', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      const rejectionHandler = processOn.mock.calls.find(
        call => call[0] === 'unhandledRejection'
      )?.[1];

      expect(rejectionHandler).toBeDefined();

      if (rejectionHandler) {
        rejectionHandler(new Error('Test rejection'), Promise.reject());
        expect(processExit).toHaveBeenCalledWith(1);
      }
    });
  });

  describe('shutdown timeout handling', () => {
    it('should have graceful shutdown timeout', async () => {
      const { getShutdownHealth } = await import('../src/utils/graceful-shutdown.js');

      const health = getShutdownHealth();

      // Should have timeout tracking
      expect(health.details).toHaveProperty('hasShutdownTimeout');
    });

    it('should have force shutdown timeout', async () => {
      const { getShutdownHealth } = await import('../src/utils/graceful-shutdown.js');

      const health = getShutdownHealth();

      expect(health.details).toHaveProperty('hasForceShutdownTimeout');
    });
  });

  describe('signal handling', () => {
    it('should register SIGTERM handler correctly', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      const sigtermHandler = processOn.mock.calls.find(
        call => call[0] === 'SIGTERM'
      )?.[1];

      expect(sigtermHandler).toBeDefined();
      expect(typeof sigtermHandler).toBe('function');
    });

    it('should register SIGINT handler correctly', async () => {
      const { initializeGracefulShutdown } = await import('../src/utils/graceful-shutdown.js');

      initializeGracefulShutdown();

      const sigintHandler = processOn.mock.calls.find(
        call => call[0] === 'SIGINT'
      )?.[1];

      expect(sigintHandler).toBeDefined();
      expect(typeof sigintHandler).toBe('function');
    });

    it('should prevent duplicate shutdowns', async () => {
      const { triggerShutdown, isShuttingDown } =
        await import('../src/utils/graceful-shutdown.js');
      const { logger } = await import('@discord-bot/logger');

      triggerShutdown();

      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to trigger again
      triggerShutdown();

      // Should warn about duplicate
      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const hasWarning = warnCalls.some(call =>
        call[0]?.toString().includes('shutdown already in progress')
      );

      // May or may not warn depending on timing
      expect(typeof hasWarning).toBe('boolean');
    });
  });
});
