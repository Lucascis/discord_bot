import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '@discord-bot/database';
import * as subscriptionModule from '@discord-bot/subscription';
import { validApiKey } from './fixtures.js';

function getSubscriptionPlanMock() {
  if (!(prisma as unknown as Record<string, unknown>).subscriptionPlan) {
    (prisma as unknown as Record<string, unknown>).subscriptionPlan = {
      findMany: vi.fn()
    };
  }
  return (prisma as unknown as { subscriptionPlan: { findMany: ReturnType<typeof vi.fn> } }).subscriptionPlan.findMany;
}

describe('Plan administration routes', () => {
  it('returns plans from database', async () => {
    const planRecord = {
      id: 'plan-1',
      name: 'PREMIUM',
      displayName: 'Premium',
      description: 'desc',
      features: { concurrentPlaybacks: 5 },
      limits: { maxQueueSize: 500 },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      prices: [
        {
          id: 'price-1',
          provider: 'stripe',
          providerPriceId: 'price_123',
          amount: 999,
          currency: 'USD',
          interval: 'MONTH',
          intervalCount: 1,
          trialPeriodDays: null,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]
    };

    getSubscriptionPlanMock().mockResolvedValue([planRecord] as never);

    const res = await request(app)
      .get('/api/v1/plans')
      .set('X-API-Key', validApiKey);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].tierName).toBe('PREMIUM');
    expect(res.body.data[0].prices[0].providerPriceId).toBe('price_123');
  });

  it('reloads plan cache on demand', async () => {
    const loadSpy = vi.spyOn(subscriptionModule, 'loadPlansFromDatabase').mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/plans/reload')
      .set('X-API-Key', `${validApiKey}-admin`);

    expect(res.status).toBe(200);
    expect(res.body.data.reloaded).toBe(true);
    expect(loadSpy).toHaveBeenCalled();
  });

  it('returns runtime plans from cache', async () => {
    const res = await request(app)
      .get('/api/v1/plans/runtime')
      .set('X-API-Key', validApiKey);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].tier).toBeDefined();
  });

  it('updates plan metadata with experiments', async () => {
    vi.mocked(prisma.subscriptionPlan.findUnique).mockResolvedValue({
      id: 'plan-1',
      features: {},
      active: true
    } as never);

    vi.mocked(prisma.subscriptionPlan.update).mockResolvedValue({
      id: 'plan-1',
      displayName: 'Nuevo plan',
      description: 'desc',
      features: { experiments: ['BF2025'] },
      active: true,
      prices: []
    } as never);

    const res = await request(app)
      .put('/api/v1/plans/plan-1')
      .set('X-API-Key', validApiKey)
      .send({ displayName: 'Nuevo plan', experiments: ['BF2025'] });

    expect(res.status).toBe(200);
    expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        displayName: 'Nuevo plan',
        features: { experiments: ['BF2025'] }
      })
    }));
  });

  it('returns 404 when plan not found', async () => {
    vi.mocked(prisma.subscriptionPlan.findUnique).mockResolvedValue(null as never);

    const res = await request(app)
      .put('/api/v1/plans/unknown')
      .set('X-API-Key', validApiKey)
      .send({ displayName: 'Test' });

    expect(res.status).toBe(404);
  });

  it('updates plan price values', async () => {
    vi.mocked(prisma.subscriptionPrice.update).mockResolvedValue({
      id: 'price-1',
      amount: 1999,
      currency: 'USD',
      interval: 'MONTH',
      intervalCount: 1,
      provider: 'stripe',
      providerPriceId: 'price_123',
      active: true
    } as never);

    const res = await request(app)
      .put('/api/v1/plans/plan-1/prices/price-1')
      .set('X-API-Key', validApiKey)
      .send({ amount: 1999 });

    expect(res.status).toBe(200);
    expect(prisma.subscriptionPrice.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 1999 })
    }));
  });

  it('creates new plan price record', async () => {
    vi.mocked(prisma.subscriptionPlan.findUnique).mockResolvedValue({
      id: 'plan-1'
    } as never);

    vi.mocked(prisma.subscriptionPrice.create).mockResolvedValue({
      id: 'price-new',
      planId: 'plan-1',
      provider: 'stripe',
      providerPriceId: 'price_new',
      amount: 2500,
      currency: 'USD',
      interval: 'MONTH',
      intervalCount: 1,
      active: true
    } as never);

    const res = await request(app)
      .post('/api/v1/plans/plan-1/prices')
      .set('X-API-Key', validApiKey)
      .send({
        provider: 'stripe',
        providerPriceId: 'price_new',
        amount: 2500,
        currency: 'USD',
        interval: 'MONTH'
      });

    expect(res.status).toBe(200);
    expect(prisma.subscriptionPrice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerPriceId: 'price_new',
        amount: 2500
      })
    }));
  });
});
