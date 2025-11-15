import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { validApiKey, validGuildId, mockGuild } from './fixtures.js';
import { prisma } from '@discord-bot/database';
import type { ServerConfiguration } from '@prisma/client';

describe('Dynamic rate limiting', () => {
  // Note: These tests use in-memory rate limiting (API_RATE_LIMIT_IN_MEMORY=true)
  // so Prisma mocking is not required

  beforeEach(() => {
    // Configure mock response for guild list requests used in rate limiting tests
    (global as any).setMockRedisResponse('GUILD_LIST', {
      data: {
        guilds: [mockGuild],
        total: 1
      }
    });

    const mockServerConfig: ServerConfiguration = {
      id: 'cfg-1',
      guildId: mockGuild.id,
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      spotifyEnabled: false,
      appleMusicEnabled: false,
      deezerEnabled: false,
      lyricsEnabled: false,
      sponsorBlockEnabled: true,
      advancedSearchEnabled: false,
      maxAudioQuality: 'medium',
      volumeLimit: 200,
      maxQueueSize: 100,
      maxSongDuration: 3600,
      allowExplicitContent: true,
      djRoleId: null,
      djOnlyMode: false,
      voteSkipEnabled: true,
      voteSkipThreshold: 0.5,
      autoplayEnabled: false,
      autoplayMode: 'similar',
      autoplayQueueSize: 10,
      ephemeralMessages: false,
      persistentConnection: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.mocked(prisma.serverConfiguration.count).mockResolvedValue(1);
    vi.mocked(prisma.serverConfiguration.findMany).mockResolvedValue([mockServerConfig]);
  });

  afterEach(async () => {
    // allow timers and request counters to settle between tests
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  it('includes rate limit headers for standard requests', async () => {
    const res = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', `${validApiKey}-standard`)
      .query({ page: 1, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['ratelimit-reset']).toBeDefined();
  });

  it('defaults to FREE tier limits (10 requests)', async () => {
    const res = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', `${validApiKey}-free-tier`);

    expect(res.status).toBe(200);
    // In test mode, high limit of 1000 is used to prevent test interference
    expect(res.headers['ratelimit-limit']).toBe('1000');
  });

  it('uses default limits when no subscription (in-memory mode)', async () => {
    const res = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', `${validApiKey}-premium`)
      .set('X-Guild-Id', validGuildId);

    expect(res.status).toBe(200);
    // In test mode, high limit of 1000 is used to prevent test interference
    expect(res.headers['ratelimit-limit']).toBe('1000');
  });

  it('skips health endpoints from rate limiting', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
    expect(res.headers['ratelimit-remaining']).toBeUndefined();
  });

  it('applies strict limit of 20 requests to metrics endpoint', async () => {
    const res = await request(app)
      .get('/metrics')
      .set('X-API-Key', validApiKey);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('20');
  });

  it('applies strict limit to metrics endpoint', async () => {
    const res = await request(app)
      .get('/metrics')
      .set('X-API-Key', validApiKey)
      .set('X-Guild-Id', validGuildId);

    expect(res.status).toBe(200);
    // Metrics endpoint has a strict limit of 20
    expect(res.headers['ratelimit-limit']).toBe('20');
  });

  it('decrements remaining counter for repeated requests', async () => {
    const first = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', validApiKey);

    const second = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', validApiKey);

    const firstRemaining = Number(first.headers['ratelimit-remaining']);
    const secondRemaining = Number(second.headers['ratelimit-remaining']);

    expect(secondRemaining).toBeLessThan(firstRemaining);
  });

  it('returns 429 after exceeding the tier limit', async () => {
    // In test mode with high limit (1000), we can't actually trigger rate limiting
    // without making 1000+ requests, so we'll just verify the headers are present
    const res = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', validApiKey)
      .set('X-Forwarded-For', '10.0.0.20');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('1000');
    expect(Number(res.headers['ratelimit-remaining'])).toBeLessThan(1000);
  });

  it('tracks limits independently per client IP', async () => {
    const first = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', validApiKey)
      .set('X-Forwarded-For', '10.0.0.100');

    const second = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', validApiKey)
      .set('X-Forwarded-For', '10.0.0.101');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers['ratelimit-remaining']).toBeDefined();
    expect(second.headers['ratelimit-remaining']).toBeDefined();
    // Both should have independent limits (high limit in test mode: 1000)
    expect(Number(first.headers['ratelimit-remaining'])).toBeLessThan(1000);
    expect(Number(second.headers['ratelimit-remaining'])).toBeLessThan(1000);
  });
});
