import { beforeAll, afterAll, vi } from 'vitest';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Mock environment variables for testing
beforeAll(async () => {
  // Setup test environment variables
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/discord_test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.DISCORD_TOKEN = 'test-token';
  process.env.DISCORD_APPLICATION_ID = 'test-app-id';
  process.env.LAVALINK_PASSWORD = 'youshallnotpass';

  // Mock Redis client (both redis and ioredis)
  vi.doMock('redis', () => ({
    createClient: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(0),
      expire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(-1),
      keys: vi.fn().mockResolvedValue([]),
      hget: vi.fn().mockResolvedValue(null),
      hset: vi.fn().mockResolvedValue(1),
      hdel: vi.fn().mockResolvedValue(1),
      hgetall: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
      isOpen: true,
      isReady: true
    }))
  }));

  // Mock ioredis
  vi.doMock('ioredis', () => ({
    default: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(0),
      expire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(-1),
      keys: vi.fn().mockResolvedValue([]),
      on: vi.fn(),
      off: vi.fn(),
      status: 'ready'
    }))
  }));

  // Mock Discord API calls
  vi.doMock('discord.js', () => ({
    Client: vi.fn(() => ({
      login: vi.fn().mockResolvedValue('test-token'),
      on: vi.fn(),
      once: vi.fn(),
      destroy: vi.fn(),
      user: { id: 'test-bot-id', tag: 'TestBot#1234' },
      isReady: vi.fn().mockReturnValue(true),
      ws: { ping: 50 },
      readyAt: new Date()
    })),
    GatewayIntentBits: {
      Guilds: 1,
      GuildVoiceStates: 2,
      GuildMessages: 4
    },
    Events: {
      ClientReady: 'ready',
      InteractionCreate: 'interactionCreate'
    },
    REST: vi.fn(() => ({
      setToken: vi.fn().mockReturnThis(),
      put: vi.fn().mockResolvedValue(undefined)
    })),
    Routes: {
      applicationGuildCommands: vi.fn()
    },
    SlashCommandBuilder: vi.fn(() => ({
      setName: vi.fn().mockReturnThis(),
      setDescription: vi.fn().mockReturnThis(),
      addStringOption: vi.fn().mockReturnThis(),
      addIntegerOption: vi.fn().mockReturnThis(),
      toJSON: vi.fn().mockReturnValue({})
    }))
  }));

  // Mock Prisma
  vi.doMock('@prisma/client', () => ({
    PrismaClient: vi.fn(() => ({
      $connect: vi.fn().mockResolvedValue(undefined),
      $disconnect: vi.fn().mockResolvedValue(undefined),
      guildConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({})
      },
      queue: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 })
      }
    }))
  }));

  // Mock Lavalink client
  vi.doMock('lavalink-client', () => ({
    LavalinkManager: vi.fn(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }))
  }));
});

afterAll(() => {
  vi.restoreAllMocks();
});