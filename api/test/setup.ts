import { vi, beforeAll, afterAll, beforeEach } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.API_KEY = 'test-api-key-12345678901234567890123456789012';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.WEBHOOK_SECRET = 'test-webhook-secret';
process.env.API_RATE_LIMIT_IN_MEMORY = 'true';

// Mock Prisma client
vi.mock('@discord-bot/database', () => ({
  prisma: {
    serverConfiguration: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    webhookSubscription: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
    },
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  }
}));

// Mock Redis client
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockImplementation((channel, callback) => {
        if (callback) callback(null);
        return Promise.resolve(1);
      }),
      unsubscribe: vi.fn().mockImplementation((channel, callback) => {
        if (callback) callback(null);
        return Promise.resolve(1);
      }),
      on: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      status: 'ready',
    }))
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
  HealthChecker: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    check: vi.fn().mockResolvedValue({
      service: 'api',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {},
    }),
  })),
  CommonHealthChecks: {
    database: vi.fn().mockResolvedValue({ status: 'healthy', responseTime: 10, lastCheck: new Date().toISOString() }),
    memory: vi.fn().mockResolvedValue({ status: 'healthy', responseTime: 1, lastCheck: new Date().toISOString() }),
  }
}));

beforeAll(() => {
  // Setup before all tests
});

afterAll(() => {
  // Cleanup after all tests
});

beforeEach(() => {
  // Reset mocks before each test
  vi.clearAllMocks();
});
