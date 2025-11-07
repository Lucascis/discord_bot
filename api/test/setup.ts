import { vi, beforeAll, afterAll, beforeEach } from 'vitest';

// ===================================================================
// CRITICAL: HOIST MOCKS BEFORE ANY MODULE IMPORTS
// ===================================================================
// This ensures mocks are set up BEFORE app.ts imports and creates Redis connections

// Create mocks in hoisted scope
const { MockRedisClass, setMockRedisResponse, clearMockRedisResponses } = vi.hoisted(() => {
  const mockResponseRegistry = new Map<string, unknown>();

  class MockRedis {
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
      const mockResponse = mockResponseRegistry.get(type);

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

  return {
    MockRedisClass: MockRedis,
    globalMockResponseRegistry: mockResponseRegistry,
    setMockRedisResponse: (requestType: string, response: unknown): void => {
      mockResponseRegistry.set(requestType, response);
    },
    clearMockRedisResponses: (): void => {
      mockResponseRegistry.clear();
    }
  };
});

// Create singleton instance BEFORE mocking ioredis
const mockRedisInstance = new MockRedisClass();

// Mock ioredis module with HOISTED mock - all instances share same mock
vi.mock('ioredis', () => ({
  default: class extends MockRedisClass {
    constructor(...args: unknown[]) {
      super(...args);
      // Return the singleton instance methods to share state
      return mockRedisInstance as unknown as InstanceType<typeof MockRedisClass>;
    }
  },
  Redis: class extends MockRedisClass {
    constructor(...args: unknown[]) {
      super(...args);
      // Return the singleton instance methods to share state
      return mockRedisInstance as unknown as InstanceType<typeof MockRedisClass>;
    }
  }
}));

// NOW set environment variables AFTER hoisting mocks
process.env.NODE_ENV = 'test';
process.env.API_KEY = 'test-api-key-12345678901234567890123456789012';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.WEBHOOK_SECRET = 'test-webhook-secret';
process.env.API_RATE_LIMIT_IN_MEMORY = 'true';

// mockRedisInstance is already created above

// Mock @discord-bot/database with PROPER factory functions
vi.mock('@discord-bot/database', () => {
  // Factory function that creates a NEW mock for each test
  const createMockFn = () => vi.fn();

  return {
    prisma: {
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
  }
}));

// ===================================================================
// EXPORT HELPERS TO GLOBAL SCOPE (Best Practice for Test Utilities)
// ===================================================================
declare global {
   
  var mockRedis: InstanceType<typeof MockRedisClass>;
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
});

beforeEach(() => {
  // Reset ALL mocks before each test for isolation
  vi.clearAllMocks();
  clearMockRedisResponses();
});
