import { beforeAll, afterAll, vi } from 'vitest';

// Mock environment variables for testing
beforeAll(() => {
  // Setup test environment variables
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL = 'redis://localhost:6379';

  // Mock Discord API calls
  vi.mock('discord.js', () => ({
    Client: vi.fn(() => ({
      login: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      user: { id: 'test-bot-id', tag: 'TestBot#1234' }
    })),
    GatewayIntentBits: {
      Guilds: 1,
      GuildVoiceStates: 2
    }
  }));

  // Mock Redis client
  vi.mock('redis', () => ({
    createClient: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      publish: vi.fn(),
      subscribe: vi.fn()
    }))
  }));
});

afterAll(() => {
  vi.restoreAllMocks();
});