import { vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Mock environment variables FIRST - before any other imports
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/discord_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_APPLICATION_ID = 'test-app-id';
process.env.LAVALINK_PASSWORD = 'youshallnotpass';
process.env.API_KEY = 'test-api-key-12345678901234567890123456789012';
process.env.WEBHOOK_SECRET = 'test-webhook-secret';
process.env.API_RATE_LIMIT_IN_MEMORY = 'true';

// ===================================================================
// PROFESSIONAL MOCK INFRASTRUCTURE - Enterprise Testing Best Practices
// ===================================================================

// Global mock response registry for Redis pub/sub simulation
const globalMockResponseRegistry = new Map<string, unknown>();

// Helper functions for tests (exported to global scope)
function setMockRedisResponse(requestType: string, response: unknown): void {
  globalMockResponseRegistry.set(requestType, response);
}

function clearMockRedisResponses(): void {
  globalMockResponseRegistry.clear();
}

// Shared Redis mock instance with pub/sub simulation
class MockRedisClass {
  private messageHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  public status: string = 'ready';

  constructor(_url?: string) {}

  // Connection Management
  connect = vi.fn().mockResolvedValue(undefined);
  disconnect = vi.fn().mockResolvedValue(undefined);
  quit = vi.fn().mockResolvedValue('OK');
  ping = vi.fn().mockResolvedValue('PONG');

  // Key-Value Operations
  get = vi.fn().mockResolvedValue(null);
  set = vi.fn().mockResolvedValue('OK');
  del = vi.fn().mockResolvedValue(1);
  exists = vi.fn().mockResolvedValue(0);
  incr = vi.fn().mockResolvedValue(1);
  decr = vi.fn().mockResolvedValue(-1);

  // Expiration
  expire = vi.fn().mockResolvedValue(1);
  ttl = vi.fn().mockResolvedValue(-1);
  pttl = vi.fn().mockResolvedValue(-1);

  // Pub/Sub with AUTOMATIC response simulation
  publish = vi.fn().mockImplementation(async (channel: string, message: string) => {
    try {
      const request = JSON.parse(message);
      const { requestId, type } = request;
      const mockResponse = globalMockResponseRegistry.get(type);

      if (mockResponse && requestId) {
        // Determine response channel based on request type
        let responseChannel = `audio-response:${requestId}`;
        if (type.includes('SEARCH') || channel.includes('search')) {
          responseChannel = `search-response:${requestId}`;
        } else if (type.includes('ANALYTICS') || channel.includes('analytics')) {
          responseChannel = `analytics-response:${requestId}`;
        } else if (type.includes('GUILD') || channel.includes('guild')) {
          responseChannel = `guild-response:${requestId}`;
        }

        // Simulate async response via message event
        setImmediate(() => {
          const handlers = this.messageHandlers.get('message') || [];
          handlers.forEach(handler => {
            handler(responseChannel, JSON.stringify(mockResponse));
          });
        });
      }
    } catch {
      // Ignore JSON parse errors (expected for some tests)
    }
    return 1;
  });

  subscribe = vi.fn().mockImplementation((channel: string | string[], callback?: (...args: unknown[]) => void) => {
    if (callback) setImmediate(() => callback(null));
    return Promise.resolve(Array.isArray(channel) ? channel.length : 1);
  });

  unsubscribe = vi.fn().mockImplementation((channel?: string | string[], callback?: (...args: unknown[]) => void) => {
    if (callback) setImmediate(() => callback(null));
    return Promise.resolve(0);
  });

  // Event Emitter
  on = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    if (!this.messageHandlers.has(event)) {
      this.messageHandlers.set(event, []);
    }
    this.messageHandlers.get(event)!.push(handler);
    return this;
  });

  once = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    const wrappedHandler = (...args: unknown[]) => {
      handler(...args);
      const handlers = this.messageHandlers.get(event) || [];
      const index = handlers.indexOf(wrappedHandler);
      if (index > -1) handlers.splice(index, 1);
    };
    return this.on(event, wrappedHandler);
  });

  off = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    const handlers = this.messageHandlers.get(event) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) handlers.splice(index, 1);
    return this;
  });

  removeAllListeners = vi.fn().mockImplementation((event?: string) => {
    if (event) {
      this.messageHandlers.delete(event);
    } else {
      this.messageHandlers.clear();
    }
    return this;
  });

  // Hash, List, Set Operations
  hget = vi.fn().mockResolvedValue(null);
  hset = vi.fn().mockResolvedValue(1);
  hdel = vi.fn().mockResolvedValue(1);
  hgetall = vi.fn().mockResolvedValue({});
  lpush = vi.fn().mockResolvedValue(1);
  rpush = vi.fn().mockResolvedValue(1);
  lpop = vi.fn().mockResolvedValue(null);
  rpop = vi.fn().mockResolvedValue(null);
  lrange = vi.fn().mockResolvedValue([]);
  sadd = vi.fn().mockResolvedValue(1);
  srem = vi.fn().mockResolvedValue(1);
  smembers = vi.fn().mockResolvedValue([]);

  // Transaction & Pipeline
  multi = vi.fn().mockReturnValue({
    exec: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
  });

  pipeline = vi.fn().mockReturnValue({
    exec: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
  });
}

// Create singleton mock instance
const mockRedisInstance = new MockRedisClass();

// Mock ioredis module
vi.mock('ioredis', () => ({
  default: MockRedisClass,
  Redis: MockRedisClass
}));

// Mock @discord-bot/database with PROPER factory functions
vi.mock('@discord-bot/database', () => {
  // Factory function that creates a NEW mock for each test
  const createMockFn = () => vi.fn();

  return {
    prisma: {
      guildConfig: {
        findUnique: createMockFn(),
        create: createMockFn(),
        update: createMockFn(),
      },
      queue: {
        findMany: createMockFn(),
        create: createMockFn(),
        deleteMany: createMockFn(),
      },
      serverConfiguration: {
        findUnique: createMockFn(),
        upsert: createMockFn(),
        create: createMockFn(),
        update: createMockFn(),
      },
      webhookSubscription: {
        upsert: createMockFn(),
        findUnique: createMockFn(),
      },
      subscription: {
        findUnique: createMockFn(),
      },
      $connect: vi.fn().mockResolvedValue(undefined),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    }
  };
});

// Mock logger
vi.mock('@discord-bot/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  HealthChecker: class MockHealthChecker {
    constructor(public service: string, public version: string) {}
    register = vi.fn();
    async check() {
      return {
        service: this.service,
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
        checks: {},
      };
    }
  },
  CommonHealthChecks: {
    database: vi.fn().mockResolvedValue({
      status: 'healthy',
      responseTime: 10,
      lastCheck: new Date().toISOString()
    }),
    memory: vi.fn().mockResolvedValue({
      status: 'healthy',
      responseTime: 1,
      lastCheck: new Date().toISOString()
    }),
  },
  getBusinessMetrics: vi.fn().mockImplementation((_registry: unknown) => ({
    trackUserActivity: vi.fn(),
    trackSessionStart: vi.fn(),
    trackSessionEnd: vi.fn(),
    trackSongPlay: vi.fn(),
    trackCommand: vi.fn(),
    getBusinessInsights: vi.fn().mockReturnValue({
      engagement: { dau: 0, wau: 0, mau: 0, avgSessionDuration: 0 },
      usage: { totalSongs: 0, totalCommands: 0, avgQueueLength: 0 },
      performance: { avgCommandLatency: 0, successRate: 0 },
      guilds: { total: 0, active: 0 }
    }),
    getMetrics: vi.fn().mockResolvedValue('# Mock Prometheus metrics\n')
  }))
}));

// ===================================================================
// EXPORT HELPERS TO GLOBAL SCOPE (Best Practice for Test Utilities)
// ===================================================================
declare global {
  var mockRedis: MockRedisClass;
  function setMockRedisResponse(requestType: string, response: unknown): void;
  function clearMockRedisResponses(): void;
}

(global as unknown as Record<string, unknown>).mockRedis = mockRedisInstance;
(global as unknown as Record<string, unknown>).setMockRedisResponse = setMockRedisResponse;
(global as unknown as Record<string, unknown>).clearMockRedisResponses = clearMockRedisResponses;

// ===================================================================
// TEST LIFECYCLE HOOKS
// ===================================================================
beforeAll(() => {
  // Global setup before all tests
});

afterAll(() => {
  // Global cleanup after all tests
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Reset ALL mocks before each test for isolation
  vi.clearAllMocks();
  clearMockRedisResponses();
});