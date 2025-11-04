import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionTier } from '@prisma/client';
import { app } from '../src/app.js';
import { prisma } from '@discord-bot/database';
import { validApiKey, validGuildId } from './fixtures.js';

const subscriptionFindUnique = prisma.subscription.findUnique as unknown as vi.Mock;

describe('Dynamic rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptionFindUnique.mockReset();
    subscriptionFindUnique.mockResolvedValue(null);
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
    expect(res.headers['ratelimit-limit']).toBe('10');
  });

  it('uses premium tier limits when subscription exists', async () => {
    subscriptionFindUnique.mockResolvedValue({
      guildId: validGuildId,
      tier: SubscriptionTier.PREMIUM,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', `${validApiKey}-premium`)
      .set('X-Guild-Id', validGuildId);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('100');
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
      .set('X-API-Key', `${validApiKey}-metrics`);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('20');
  });

  it('clamps unlimited tiers for strict endpoints', async () => {
    subscriptionFindUnique.mockResolvedValue({
      guildId: validGuildId,
      tier: SubscriptionTier.ENTERPRISE,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get('/metrics')
      .set('X-API-Key', `${validApiKey}-enterprise`)
      .set('X-Guild-Id', validGuildId);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('20');
  });

  it('decrements remaining counter for repeated requests', async () => {
    const apiKey = `${validApiKey}-remaining`;

    const first = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', apiKey);

    const second = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', apiKey);

    const firstRemaining = Number(first.headers['ratelimit-remaining']);
    const secondRemaining = Number(second.headers['ratelimit-remaining']);

    expect(secondRemaining).toBeLessThan(firstRemaining);
  });

  it('returns 429 after exceeding the tier limit', async () => {
    const apiKey = `${validApiKey}-429`;
    let rateLimited = false;

    for (let i = 0; i < 12; i += 1) {
      const res = await request(app)
        .get('/api/v1/guilds')
        .set('X-API-Key', apiKey)
        .set('X-Forwarded-For', '10.0.0.10');

      if (res.status === 429) {
        rateLimited = true;
        expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(res.headers['ratelimit-limit']).toBe('10');
        expect(res.headers['ratelimit-remaining']).toBe('0');
        expect(Number(res.headers['ratelimit-reset'])).toBeGreaterThan(Math.floor(Date.now() / 1000));
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        break;
      }
    }

    expect(rateLimited).toBe(true);
  });

  it('tracks limits independently per API key', async () => {
    const firstKey = `${validApiKey}-k1`;
    const secondKey = `${validApiKey}-k2`;

    const first = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', firstKey);

    const second = await request(app)
      .get('/api/v1/guilds')
      .set('X-API-Key', secondKey);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers['ratelimit-remaining']).toBe('9');
    expect(second.headers['ratelimit-remaining']).toBe('9');
  });
});
