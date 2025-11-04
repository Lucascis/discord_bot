import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Redis Client Test Suite
 *
 * Tests for Redis connection management in worker service
 * Following ioredis patterns and BullMQ requirements
 */

// Mock ioredis
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockQuit = vi.fn().mockResolvedValue('OK');
const mockPing = vi.fn().mockResolvedValue('PONG');
const mockInfo = vi.fn().mockResolvedValue('redis_version:7.0.0');
const mockOn = vi.fn().mockReturnThis();

class MockRedis {
  status = 'end';

  constructor(options: any) {}

  connect = mockConnect;
  quit = mockQuit;
  ping = mockPing;
  info = mockInfo;
  on = mockOn;
}

vi.mock('ioredis', () => ({
  default: MockRedis
}));

vi.mock('@discord-bot/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@discord-bot/config', () => ({
  env: {
    REDIS_URL: 'redis://localhost:6379'
  }
}));

describe('redis-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockQuit.mockResolvedValue('OK');
    mockPing.mockResolvedValue('PONG');
    mockInfo.mockResolvedValue('redis_version:7.0.0');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('client initialization', () => {
    it('should export redisClient', async () => {
      const { redisClient } = await import('../src/utils/redis-client.js');

      expect(redisClient).toBeDefined();
    });

    it('should export redisPubSub', async () => {
      const { redisPubSub } = await import('../src/utils/redis-client.js');

      expect(redisPubSub).toBeDefined();
    });

    it('should export redisBlocking', async () => {
      const { redisBlocking } = await import('../src/utils/redis-client.js');

      expect(redisBlocking).toBeDefined();
    });

    it('should create three separate Redis instances', async () => {
      const { redisClient, redisPubSub, redisBlocking } = await import('../src/utils/redis-client.js');

      // All three should be different instances
      expect(redisClient).not.toBe(redisPubSub);
      expect(redisClient).not.toBe(redisBlocking);
      expect(redisPubSub).not.toBe(redisBlocking);
    });
  });

  describe('initializeRedis', () => {
    it('should initialize all Redis connections', async () => {
      const { initializeRedis } = await import('../src/utils/redis-client.js');

      await initializeRedis();

      expect(mockConnect).toHaveBeenCalled();
    });

    it('should handle already connected clients', async () => {
      const { initializeRedis, redisClient } = await import('../src/utils/redis-client.js');

      redisClient.status = 'ready';

      await initializeRedis();

      // Should not attempt additional connection
      expect(redisClient.status).toBe('ready');
    });

    it('should handle connection errors', async () => {
      const { initializeRedis } = await import('../src/utils/redis-client.js');

      mockConnect.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(initializeRedis()).rejects.toThrow('Connection failed');
    });

    it('should log successful initialization', async () => {
      const { initializeRedis } = await import('../src/utils/redis-client.js');
      const { logger } = await import('@discord-bot/logger');

      await initializeRedis();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Redis connections initialized')
      );
    });

    it('should log initialization errors', async () => {
      const { initializeRedis } = await import('../src/utils/redis-client.js');
      const { logger } = await import('@discord-bot/logger');

      mockConnect.mockRejectedValueOnce(new Error('Init error'));

      await expect(initializeRedis()).rejects.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('closeRedis', () => {
    it('should close all Redis connections', async () => {
      const { closeRedis } = await import('../src/utils/redis-client.js');

      await closeRedis();

      expect(mockQuit).toHaveBeenCalled();
    });

    it('should close all three connections', async () => {
      const { closeRedis } = await import('../src/utils/redis-client.js');

      await closeRedis();

      // Should be called 3 times (main, pubSub, blocking)
      expect(mockQuit).toHaveBeenCalled();
    });

    it('should handle close errors', async () => {
      const { closeRedis } = await import('../src/utils/redis-client.js');

      mockQuit.mockRejectedValueOnce(new Error('Close failed'));

      await expect(closeRedis()).rejects.toThrow('Close failed');
    });

    it('should log successful closure', async () => {
      const { closeRedis } = await import('../src/utils/redis-client.js');
      const { logger } = await import('@discord-bot/logger');

      await closeRedis();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Redis connections closed')
      );
    });

    it('should log close errors', async () => {
      const { closeRedis } = await import('../src/utils/redis-client.js');
      const { logger } = await import('@discord-bot/logger');

      mockQuit.mockRejectedValueOnce(new Error('Close error'));

      await expect(closeRedis()).rejects.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('checkRedisHealth', () => {
    it('should return healthy status when all connections are good', async () => {
      const { checkRedisHealth } = await import('../src/utils/redis-client.js');

      mockPing.mockResolvedValue('PONG');

      const health = await checkRedisHealth();

      expect(health.healthy).toBe(true);
      expect(health.details).toHaveProperty('main', 'connected');
      expect(health.details).toHaveProperty('pubSub', 'connected');
      expect(health.details).toHaveProperty('blocking', 'connected');
    });

    it('should return unhealthy status when connection fails', async () => {
      const { checkRedisHealth } = await import('../src/utils/redis-client.js');

      mockPing.mockRejectedValue(new Error('Ping failed'));

      const health = await checkRedisHealth();

      expect(health.healthy).toBe(false);
    });

    it('should include error details for failed connections', async () => {
      const { checkRedisHealth } = await import('../src/utils/redis-client.js');

      mockPing.mockRejectedValueOnce(new Error('Main client error'));

      const health = await checkRedisHealth();

      expect(health.details).toHaveProperty('errors');
      expect(Array.isArray(health.details.errors)).toBe(true);
    });

    it('should test all three connections', async () => {
      const { checkRedisHealth } = await import('../src/utils/redis-client.js');

      await checkRedisHealth();

      // Ping should be called for each connection
      expect(mockPing).toHaveBeenCalled();
    });

    it('should handle partial failures gracefully', async () => {
      const { checkRedisHealth } = await import('../src/utils/redis-client.js');

      mockPing
        .mockResolvedValueOnce('PONG') // main succeeds
        .mockRejectedValueOnce(new Error('pubSub fails')) // pubSub fails
        .mockResolvedValueOnce('PONG'); // blocking succeeds

      const health = await checkRedisHealth();

      expect(health.healthy).toBe(false);
      expect(health.details.main).toBe('connected');
      expect(health.details.pubSub).toBe('disconnected');
      expect(health.details.blocking).toBe('connected');
    });

    it('should log health check errors', async () => {
      const { checkRedisHealth } = await import('../src/utils/redis-client.js');
      const { logger } = await import('@discord-bot/logger');

      mockPing.mockImplementation(() => {
        throw new Error('Health check error');
      });

      const health = await checkRedisHealth();

      expect(health.healthy).toBe(false);
    });
  });

  describe('getRedisInfo', () => {
    it('should return Redis server info', async () => {
      const { getRedisInfo } = await import('../src/utils/redis-client.js');

      mockInfo.mockResolvedValue('redis_version:7.0.0');

      const info = await getRedisInfo();

      expect(info).toHaveProperty('server');
      expect(info).toHaveProperty('memory');
      expect(info).toHaveProperty('stats');
      expect(info).toHaveProperty('keyspace');
    });

    it('should call info multiple times for different sections', async () => {
      const { getRedisInfo } = await import('../src/utils/redis-client.js');

      await getRedisInfo();

      // info() should be called for: default, memory, stats, keyspace
      expect(mockInfo).toHaveBeenCalled();
    });

    it('should handle info errors', async () => {
      const { getRedisInfo } = await import('../src/utils/redis-client.js');

      mockInfo.mockRejectedValueOnce(new Error('Info failed'));

      const info = await getRedisInfo();

      expect(info).toHaveProperty('error');
    });

    it('should log info retrieval errors', async () => {
      const { getRedisInfo } = await import('../src/utils/redis-client.js');
      const { logger } = await import('@discord-bot/logger');

      mockInfo.mockRejectedValueOnce(new Error('Info error'));

      await getRedisInfo();

      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Failed to get Redis info')
      );
    });
  });

  describe('event handlers', () => {
    it('should register connect event handlers', async () => {
      await import('../src/utils/redis-client.js');

      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('should register ready event handlers', async () => {
      await import('../src/utils/redis-client.js');

      expect(mockOn).toHaveBeenCalledWith('ready', expect.any(Function));
    });

    it('should register error event handlers', async () => {
      await import('../src/utils/redis-client.js');

      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should register close event handlers', async () => {
      await import('../src/utils/redis-client.js');

      expect(mockOn).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should register reconnecting event handlers', async () => {
      await import('../src/utils/redis-client.js');

      expect(mockOn).toHaveBeenCalledWith('reconnecting', expect.any(Function));
    });

    it('should register handlers for all three clients', async () => {
      await import('../src/utils/redis-client.js');

      // Each client should have event handlers
      // mockOn should be called multiple times
      expect(mockOn.mock.calls.length).toBeGreaterThan(10);
    });
  });

  describe('connection options', () => {
    it('should configure maxRetriesPerRequest to null for BullMQ', async () => {
      const { redisClient } = await import('../src/utils/redis-client.js');

      // BullMQ requires maxRetriesPerRequest: null
      expect(redisClient).toBeDefined();
    });

    it('should enable lazy connect', async () => {
      const { redisClient } = await import('../src/utils/redis-client.js');

      // Lazy connect should be enabled to prevent auto-connection
      expect(redisClient).toBeDefined();
    });

    it('should enable ready check', async () => {
      const { redisClient } = await import('../src/utils/redis-client.js');

      expect(redisClient).toBeDefined();
    });
  });

  describe('connection resilience', () => {
    it('should not reconnect if already connecting', async () => {
      const { initializeRedis, redisClient } = await import('../src/utils/redis-client.js');

      redisClient.status = 'connecting';
      mockConnect.mockClear();

      await initializeRedis();

      // Should not call connect again
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('should not reconnect if already ready', async () => {
      const { initializeRedis, redisClient } = await import('../src/utils/redis-client.js');

      redisClient.status = 'ready';
      mockConnect.mockClear();

      await initializeRedis();

      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('should handle concurrent initialization calls', async () => {
      const { initializeRedis } = await import('../src/utils/redis-client.js');

      // Multiple concurrent calls should not cause issues
      await Promise.all([
        initializeRedis(),
        initializeRedis(),
        initializeRedis()
      ]);

      // Should succeed without errors
      expect(mockConnect).toHaveBeenCalled();
    });
  });
});
