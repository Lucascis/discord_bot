import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthChecker, CommonHealthChecks } from '../src/health.js';

// Mock dependencies
vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    ping: vi.fn(),
    isOpen: true,
    isReady: true
  }))
}));

describe('HealthChecker', () => {
  let healthChecker: HealthChecker;

  beforeEach(() => {
    vi.clearAllMocks();
    healthChecker = new HealthChecker('test-service', '1.0.0');
  });

  describe('basic functionality', () => {
    it('should initialize with service name and version', () => {
      const checker = new HealthChecker('my-service', '2.1.0');
      expect(checker).toBeDefined();
    });

    it('should register health checks', () => {
      const mockCheck = vi.fn().mockResolvedValue({
        status: 'healthy',
        message: 'All good',
        responseTime: 10
      });

      healthChecker.register('test-check', mockCheck);
      
      // Should not throw when registering
      expect(() => {
        healthChecker.register('another-check', mockCheck);
      }).not.toThrow();
    });

    it('should run health checks and return results', async () => {
      const mockCheck = vi.fn().mockResolvedValue({
        status: 'healthy',
        message: 'Test check passed',
        responseTime: 25,
        details: { custom: 'data' }
      });

      healthChecker.register('mock-check', mockCheck);
      
      const result = await healthChecker.check();

      expect(result.service).toBe('test-service');
      expect(result.version).toBe('1.0.0');
      expect(result.status).toBe('healthy');
      expect(result.checks).toHaveProperty('mock-check');
      expect(result.checks['mock-check']).toMatchObject({
        status: 'healthy',
        message: 'Test check passed',
        responseTime: 25,
        details: { custom: 'data' }
      });
      expect(mockCheck).toHaveBeenCalledOnce();
    });

    it('should handle multiple health checks', async () => {
      const check1 = vi.fn().mockResolvedValue({
        status: 'healthy',
        message: 'Check 1 OK',
        responseTime: 10
      });

      const check2 = vi.fn().mockResolvedValue({
        status: 'healthy',
        message: 'Check 2 OK',
        responseTime: 15
      });

      healthChecker.register('check1', check1);
      healthChecker.register('check2', check2);

      const result = await healthChecker.check();

      expect(result.status).toBe('healthy');
      expect(Object.keys(result.checks)).toHaveLength(2);
      expect(result.checks.check1.status).toBe('healthy');
      expect(result.checks.check2.status).toBe('healthy');
    });
  });

  describe('health status determination', () => {
    it('should report healthy when all checks pass', async () => {
      healthChecker.register('check1', async () => ({
        status: 'healthy',
        message: 'OK',
        responseTime: 10
      }));

      healthChecker.register('check2', async () => ({
        status: 'healthy', 
        message: 'OK',
        responseTime: 20
      }));

      const result = await healthChecker.check();
      expect(result.status).toBe('healthy');
      expect(result.overall.status).toBe('healthy');
    });

    it('should report degraded when some checks are degraded', async () => {
      healthChecker.register('healthy-check', async () => ({
        status: 'healthy',
        message: 'OK',
        responseTime: 10
      }));

      healthChecker.register('degraded-check', async () => ({
        status: 'degraded',
        message: 'Slow response',
        responseTime: 500
      }));

      const result = await healthChecker.check();
      expect(result.status).toBe('degraded');
      expect(result.overall.status).toBe('degraded');
      expect(result.overall.message).toContain('degraded');
    });

    it('should report unhealthy when critical checks fail', async () => {
      healthChecker.register('healthy-check', async () => ({
        status: 'healthy',
        message: 'OK',
        responseTime: 10
      }));

      healthChecker.register('critical-check', async () => ({
        status: 'unhealthy',
        message: 'Database connection failed',
        responseTime: 1000
      }));

      const result = await healthChecker.check();
      expect(result.status).toBe('unhealthy');
      expect(result.overall.status).toBe('unhealthy');
      expect(result.overall.message).toContain('critical checks failed');
    });
  });

  describe('error handling', () => {
    it('should handle check function errors gracefully', async () => {
      const failingCheck = vi.fn().mockRejectedValue(new Error('Check failed'));

      healthChecker.register('failing-check', failingCheck);

      const result = await healthChecker.check();

      expect(result.status).toBe('unhealthy');
      expect(result.checks['failing-check'].status).toBe('unhealthy');
      expect(result.checks['failing-check'].message).toContain('Check failed');
    });

    it('should handle timeouts', async () => {
      const slowCheck = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          status: 'healthy',
          message: 'Eventually OK',
          responseTime: 6000
        }), 6000))
      );

      healthChecker.register('slow-check', slowCheck);

      const result = await healthChecker.check();

      expect(result.checks['slow-check'].status).toBe('unhealthy');
      expect(result.checks['slow-check'].message).toContain('timeout');
    });

    it('should continue with other checks if one fails', async () => {
      const failingCheck = vi.fn().mockRejectedValue(new Error('Failure'));
      const workingCheck = vi.fn().mockResolvedValue({
        status: 'healthy',
        message: 'Working fine',
        responseTime: 10
      });

      healthChecker.register('failing', failingCheck);
      healthChecker.register('working', workingCheck);

      const result = await healthChecker.check();

      expect(result.checks.failing.status).toBe('unhealthy');
      expect(result.checks.working.status).toBe('healthy');
      expect(workingCheck).toHaveBeenCalledOnce();
    });
  });

  describe('timing and metrics', () => {
    it('should measure response time for checks', async () => {
      const delay = 50;
      const delayedCheck = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, delay));
        return {
          status: 'healthy',
          message: 'OK',
          responseTime: 0 // This will be overridden by actual measurement
        };
      });

      healthChecker.register('timed-check', delayedCheck);

      const result = await healthChecker.check();

      expect(result.checks['timed-check'].responseTime).toBeGreaterThanOrEqual(delay - 10);
      expect(result.overall.responseTime).toBeGreaterThanOrEqual(delay - 10);
    });

    it('should include overall response time', async () => {
      healthChecker.register('check1', async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return { status: 'healthy', message: 'OK', responseTime: 20 };
      });

      healthChecker.register('check2', async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { status: 'healthy', message: 'OK', responseTime: 30 };
      });

      const result = await healthChecker.check();

      expect(result.overall.responseTime).toBeGreaterThanOrEqual(20);
      expect(typeof result.timestamp).toBe('string');
      expect(typeof result.uptime).toBe('number');
    });
  });

  describe('metadata', () => {
    it('should include service metadata', async () => {
      const result = await healthChecker.check();

      expect(result.service).toBe('test-service');
      expect(result.version).toBe('1.0.0');
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeGreaterThan(0);
    });

    it('should include overall status summary', async () => {
      healthChecker.register('test', async () => ({
        status: 'healthy',
        message: 'OK',
        responseTime: 10
      }));

      const result = await healthChecker.check();

      expect(result.overall).toBeDefined();
      expect(result.overall.status).toBe('healthy');
      expect(result.overall.message).toBeDefined();
      expect(result.overall.responseTime).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('CommonHealthChecks', () => {
  describe('memory check', () => {
    it('should report healthy memory usage', async () => {
      // Mock low memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 100 * 1024 * 1024, // 100MB
        heapTotal: 150 * 1024 * 1024, // 150MB
        external: 10 * 1024 * 1024,   // 10MB
        rss: 200 * 1024 * 1024        // 200MB
      });

      const result = await CommonHealthChecks.memory(512); // 512MB limit

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('Memory usage');
      expect(result.details?.usagePercent).toContain('19.5%');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should report degraded memory usage', async () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 400 * 1024 * 1024, // 400MB
        heapTotal: 450 * 1024 * 1024,
        external: 50 * 1024 * 1024,
        rss: 500 * 1024 * 1024
      });

      const result = await CommonHealthChecks.memory(512); // 512MB limit

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('High memory usage');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should report unhealthy memory usage', async () => {
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        heapUsed: 600 * 1024 * 1024, // 600MB
        heapTotal: 650 * 1024 * 1024,
        external: 50 * 1024 * 1024,
        rss: 700 * 1024 * 1024
      });

      const result = await CommonHealthChecks.memory(512); // 512MB limit

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Critical memory usage');

      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('redis check', () => {
    it('should report healthy Redis connection', async () => {
      const mockRedis = {
        ping: vi.fn().mockResolvedValue('PONG'),
        isOpen: true,
        isReady: true
      };

      const result = await CommonHealthChecks.redis(mockRedis as any);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('Redis connection healthy');
      expect(mockRedis.ping).toHaveBeenCalledOnce();
    });

    it('should report unhealthy Redis connection when not connected', async () => {
      const mockRedis = {
        ping: vi.fn().mockRejectedValue(new Error('Connection refused')),
        isOpen: false,
        isReady: false
      };

      const result = await CommonHealthChecks.redis(mockRedis as any);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Redis connection failed');
    });

    it('should handle Redis ping failures', async () => {
      const mockRedis = {
        ping: vi.fn().mockRejectedValue(new Error('Ping timeout')),
        isOpen: true,
        isReady: true
      };

      const result = await CommonHealthChecks.redis(mockRedis as any);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Ping timeout');
    });
  });

  describe('database check', () => {
    it('should report healthy database connection', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }])
      };

      const result = await CommonHealthChecks.database(mockPrisma as any);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('Database connection healthy');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should report unhealthy database connection on error', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockRejectedValue(new Error('Connection timeout'))
      };

      const result = await CommonHealthChecks.database(mockPrisma as any);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Database connection failed');
      expect(result.message).toContain('Connection timeout');
    });
  });

  describe('lavalink check', () => {
    it('should report healthy Lavalink connection', async () => {
      const mockManager = {
        nodeManager: {
          nodes: new Map([
            ['node1', {
              id: 'node1',
              connected: true,
              stats: { 
                players: 5, 
                playingPlayers: 3,
                cpu: { cores: 4, systemLoad: 0.3, lavalinkLoad: 0.2 },
                memory: { used: 100000000, free: 400000000, allocated: 500000000 }
              }
            }]
          ])
        }
      };

      const result = await CommonHealthChecks.lavalink(mockManager as any);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('Lavalink nodes healthy');
      expect(result.details?.nodes).toHaveLength(1);
    });

    it('should report unhealthy when no nodes connected', async () => {
      const mockManager = {
        nodeManager: {
          nodes: new Map()
        }
      };

      const result = await CommonHealthChecks.lavalink(mockManager as any);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('No Lavalink nodes connected');
    });

    it('should report degraded when nodes have high load', async () => {
      const mockManager = {
        nodeManager: {
          nodes: new Map([
            ['node1', {
              id: 'node1',
              connected: true,
              stats: {
                players: 100,
                playingPlayers: 90,
                cpu: { cores: 4, systemLoad: 0.9, lavalinkLoad: 0.8 },
                memory: { used: 800000000, free: 200000000, allocated: 1000000000 }
              }
            }]
          ])
        }
      };

      const result = await CommonHealthChecks.lavalink(mockManager as any);

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('High load detected');
    });
  });
});