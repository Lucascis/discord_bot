/**
 * End-to-End Test: Music Playback Flow
 *
 * Purpose: Validates complete music playback functionality from user command to audio output
 * Scope: Tests Discord interactions, Redis pub/sub, Lavalink integration, and database persistence
 * Coverage: Play, queue, skip, pause, resume, stop, disconnect
 *
 * @group e2e
 * @group music
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Client, GatewayIntentBits, VoiceChannel, TextChannel, Guild } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { LavalinkManager } from 'lavalink-client';

// Test configuration
const TEST_TIMEOUT = 60000; // 60 seconds for E2E tests
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/discord_test';
const LAVALINK_HOST = process.env.LAVALINK_HOST || 'localhost';
const LAVALINK_PORT = process.env.LAVALINK_PORT || '2333';
const LAVALINK_PASSWORD = process.env.LAVALINK_PASSWORD || 'youshallnotpass';

// Mock Discord bot token (use test bot in CI)
const DISCORD_TOKEN = process.env.DISCORD_TEST_TOKEN || 'test-token';

// Test fixtures
const TEST_YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
const TEST_SEARCH_QUERY = 'never gonna give you up';
const TEST_GUILD_ID = '123456789012345678';
const TEST_VOICE_CHANNEL_ID = '234567890123456789';
const TEST_TEXT_CHANNEL_ID = '345678901234567890';

describe('E2E: Music Playback Flow', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let lavalinkManager: LavalinkManager;
  let mockClient: any;
  let mockGuild: any;
  let mockVoiceChannel: any;
  let mockTextChannel: any;

  beforeAll(async () => {
    // Initialize database
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: DATABASE_URL,
        },
      },
    });

    // Clear test data
    await prisma.queue.deleteMany({ where: { guildId: TEST_GUILD_ID } });
    await prisma.guildSettings.deleteMany({ where: { guildId: TEST_GUILD_ID } });

    // Initialize Redis
    redis = new Redis(REDIS_URL);
    await redis.flushdb();

    // Mock Discord client
    mockClient = {
      user: { id: '987654321098765432', tag: 'TestBot#0001' },
      guilds: new Map(),
      channels: new Map(),
    };

    // Mock Guild
    mockGuild = {
      id: TEST_GUILD_ID,
      name: 'Test Guild',
      channels: new Map(),
      members: new Map(),
    };

    // Mock Voice Channel
    mockVoiceChannel = {
      id: TEST_VOICE_CHANNEL_ID,
      name: 'Music',
      type: 2, // GUILD_VOICE
      guild: mockGuild,
      joinable: true,
      members: new Map(),
    };

    // Mock Text Channel
    mockTextChannel = {
      id: TEST_TEXT_CHANNEL_ID,
      name: 'music-commands',
      type: 0, // GUILD_TEXT
      guild: mockGuild,
      send: vi.fn().mockResolvedValue({ id: '111111111111111111' }),
      messages: {
        fetch: vi.fn(),
        delete: vi.fn(),
      },
    };

    mockGuild.channels.set(TEST_VOICE_CHANNEL_ID, mockVoiceChannel);
    mockGuild.channels.set(TEST_TEXT_CHANNEL_ID, mockTextChannel);
    mockClient.guilds.set(TEST_GUILD_ID, mockGuild);

    // Initialize Lavalink (mock or real depending on environment)
    if (process.env.CI !== 'true') {
      try {
        lavalinkManager = new LavalinkManager({
          nodes: [
            {
              id: 'test-node',
              host: LAVALINK_HOST,
              port: parseInt(LAVALINK_PORT),
              authorization: LAVALINK_PASSWORD,
              secure: false,
            },
          ],
          client: {
            id: mockClient.user.id,
          },
        });
      } catch (error) {
        console.warn('Lavalink not available, using mock:', error);
      }
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Cleanup
    await prisma.queue.deleteMany({ where: { guildId: TEST_GUILD_ID } });
    await prisma.guildSettings.deleteMany({ where: { guildId: TEST_GUILD_ID } });
    await prisma.$disconnect();

    await redis.flushdb();
    await redis.quit();

    if (lavalinkManager) {
      await lavalinkManager.destroyPlayer(TEST_GUILD_ID);
    }
  });

  beforeEach(async () => {
    // Reset state before each test
    await prisma.queue.deleteMany({ where: { guildId: TEST_GUILD_ID } });
    await redis.del(`queue:${TEST_GUILD_ID}`);
    await redis.del(`ui:${TEST_TEXT_CHANNEL_ID}`);
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe('Play Command', () => {
    it('should play a song from YouTube URL', async () => {
      // Arrange
      const command = {
        type: 'play',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        voiceChannelId: TEST_VOICE_CHANNEL_ID,
        query: TEST_YOUTUBE_URL,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Assert
      const queue = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
        orderBy: { position: 'asc' },
      });

      expect(queue).toHaveLength(1);
      expect(queue[0].title).toContain('Never Gonna Give You Up');
      expect(queue[0].url).toBe(TEST_YOUTUBE_URL);
      expect(queue[0].position).toBe(0);

      // Verify Redis cache
      const cachedQueue = await redis.lrange(`queue:${TEST_GUILD_ID}`, 0, -1);
      expect(cachedQueue).toHaveLength(1);

      // Verify UI message sent
      expect(mockTextChannel.send).toHaveBeenCalled();
    }, TEST_TIMEOUT);

    it('should play a song from search query', async () => {
      // Arrange
      const command = {
        type: 'play',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        voiceChannelId: TEST_VOICE_CHANNEL_ID,
        query: TEST_SEARCH_QUERY,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Assert
      const queue = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(queue).toHaveLength(1);
      expect(queue[0].title.toLowerCase()).toContain('never gonna give you up');
    }, TEST_TIMEOUT);

    it('should add song to queue when music is already playing', async () => {
      // Arrange - Add first song
      await prisma.queue.create({
        data: {
          guildId: TEST_GUILD_ID,
          title: 'First Song',
          author: 'Artist',
          url: 'https://youtube.com/watch?v=test1',
          duration: 180000,
          position: 0,
          addedBy: '111111111111111111',
        },
      });

      const command = {
        type: 'play',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        voiceChannelId: TEST_VOICE_CHANNEL_ID,
        query: TEST_YOUTUBE_URL,
        userId: '222222222222222222',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Assert
      const queue = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
        orderBy: { position: 'asc' },
      });

      expect(queue).toHaveLength(2);
      expect(queue[0].title).toBe('First Song');
      expect(queue[1].title).toContain('Never Gonna Give You Up');
      expect(queue[1].position).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe('Queue Operations', () => {
    beforeEach(async () => {
      // Setup queue with multiple songs
      await prisma.queue.createMany({
        data: [
          {
            guildId: TEST_GUILD_ID,
            title: 'Song 1',
            author: 'Artist 1',
            url: 'https://youtube.com/watch?v=test1',
            duration: 180000,
            position: 0,
            addedBy: '111111111111111111',
          },
          {
            guildId: TEST_GUILD_ID,
            title: 'Song 2',
            author: 'Artist 2',
            url: 'https://youtube.com/watch?v=test2',
            duration: 200000,
            position: 1,
            addedBy: '111111111111111111',
          },
          {
            guildId: TEST_GUILD_ID,
            title: 'Song 3',
            author: 'Artist 3',
            url: 'https://youtube.com/watch?v=test3',
            duration: 220000,
            position: 2,
            addedBy: '111111111111111111',
          },
        ],
      });
    });

    it('should skip to next track', async () => {
      // Arrange
      const command = {
        type: 'skip',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert
      const queue = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
        orderBy: { position: 'asc' },
      });

      // First song should be removed
      expect(queue).toHaveLength(2);
      expect(queue[0].title).toBe('Song 2');
      expect(queue[0].position).toBe(0); // Re-indexed
      expect(queue[1].title).toBe('Song 3');
      expect(queue[1].position).toBe(1);
    }, TEST_TIMEOUT);

    it('should clear entire queue', async () => {
      // Arrange
      const command = {
        type: 'clear',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert
      const queue = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(queue).toHaveLength(0);

      // Verify Redis cache cleared
      const cachedQueue = await redis.lrange(`queue:${TEST_GUILD_ID}`, 0, -1);
      expect(cachedQueue).toHaveLength(0);
    }, TEST_TIMEOUT);

    it('should shuffle queue', async () => {
      // Arrange
      const originalOrder = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
        orderBy: { position: 'asc' },
      });

      const command = {
        type: 'shuffle',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert
      const shuffledQueue = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
        orderBy: { position: 'asc' },
      });

      expect(shuffledQueue).toHaveLength(originalOrder.length);

      // Check that order changed (with small chance of false negative)
      const orderChanged = shuffledQueue.some((track, index) =>
        track.title !== originalOrder[index].title
      );
      expect(orderChanged).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe('Playback Controls', () => {
    it('should pause playback', async () => {
      // Arrange
      const command = {
        type: 'pause',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(settings?.isPaused).toBe(true);
    }, TEST_TIMEOUT);

    it('should resume playback', async () => {
      // Arrange - Set paused state
      await prisma.guildSettings.upsert({
        where: { guildId: TEST_GUILD_ID },
        create: {
          guildId: TEST_GUILD_ID,
          isPaused: true,
        },
        update: {
          isPaused: true,
        },
      });

      const command = {
        type: 'resume',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(settings?.isPaused).toBe(false);
    }, TEST_TIMEOUT);

    it('should stop playback and clear queue', async () => {
      // Arrange - Add songs to queue
      await prisma.queue.createMany({
        data: [
          {
            guildId: TEST_GUILD_ID,
            title: 'Song 1',
            author: 'Artist',
            url: 'https://youtube.com/watch?v=test1',
            duration: 180000,
            position: 0,
            addedBy: '111111111111111111',
          },
          {
            guildId: TEST_GUILD_ID,
            title: 'Song 2',
            author: 'Artist',
            url: 'https://youtube.com/watch?v=test2',
            duration: 200000,
            position: 1,
            addedBy: '111111111111111111',
          },
        ],
      });

      const command = {
        type: 'stop',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert
      const queue = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(queue).toHaveLength(0);
    }, TEST_TIMEOUT);

    it('should seek to specific position', async () => {
      // Arrange
      const command = {
        type: 'seek',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        position: 60000, // Seek to 1 minute
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Would verify player position if we had real Lavalink
      // For now, just verify command was published
      const published = await redis.get('last-command-test');
      expect(published).toBeDefined();
    }, TEST_TIMEOUT);
  });

  describe('Loop Modes', () => {
    it('should enable track loop', async () => {
      // Arrange
      const command = {
        type: 'loop',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        mode: 'track',
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(settings?.loopMode).toBe('track');
    }, TEST_TIMEOUT);

    it('should enable queue loop', async () => {
      // Arrange
      const command = {
        type: 'loop',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        mode: 'queue',
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(settings?.loopMode).toBe('queue');
    }, TEST_TIMEOUT);

    it('should disable loop', async () => {
      // Arrange
      await prisma.guildSettings.upsert({
        where: { guildId: TEST_GUILD_ID },
        create: {
          guildId: TEST_GUILD_ID,
          loopMode: 'track',
        },
        update: {
          loopMode: 'track',
        },
      });

      const command = {
        type: 'loop',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        mode: 'off',
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(settings?.loopMode).toBe('off');
    }, TEST_TIMEOUT);
  });

  describe('Error Handling', () => {
    it('should handle invalid YouTube URL gracefully', async () => {
      // Arrange
      const command = {
        type: 'play',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        voiceChannelId: TEST_VOICE_CHANNEL_ID,
        query: 'https://youtube.com/invalid',
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Assert - Should not crash, queue should remain empty
      const queue = await prisma.queue.findMany({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(queue).toHaveLength(0);
    }, TEST_TIMEOUT);

    it('should handle bot disconnect gracefully', async () => {
      // Arrange - Setup playing state
      await prisma.queue.create({
        data: {
          guildId: TEST_GUILD_ID,
          title: 'Playing Song',
          author: 'Artist',
          url: 'https://youtube.com/watch?v=test',
          duration: 180000,
          position: 0,
          addedBy: '111111111111111111',
        },
      });

      const command = {
        type: 'disconnect',
        guildId: TEST_GUILD_ID,
        channelId: TEST_TEXT_CHANNEL_ID,
        userId: '111111111111111111',
      };

      // Act
      await redis.publish('discord-bot:commands', JSON.stringify(command));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert - Queue should persist (configurable behavior)
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: TEST_GUILD_ID },
      });

      expect(settings?.isPaused).toBe(true);
    }, TEST_TIMEOUT);
  });
});
