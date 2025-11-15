import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import type { APIResponse } from '../../types/api.js';
import { prisma } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';
import { loadPlansFromDatabase, getAllPlans } from '@discord-bot/subscription';
import { z } from 'zod';
import { BillingInterval } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../middleware/error-handler.js';
import { validateJSONContentType } from '../../middleware/validation.js';

const router: ExpressRouter = Router();

router.get('/', asyncHandler(async (req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({
    include: {
      prices: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  const response: APIResponse<Array<Record<string, unknown>>> = {
    data: plans.map((plan) => ({
      id: plan.id,
      tierName: plan.name,
      displayName: plan.displayName ?? plan.name,
      description: plan.description,
      active: plan.active,
      features: plan.features,
      limits: plan.limits,
      prices: plan.prices.map((price) => ({
        id: price.id,
        provider: price.provider,
        providerPriceId: price.providerPriceId,
        amount: price.amount,
        currency: price.currency,
        interval: price.interval,
        intervalCount: price.intervalCount,
        active: price.active,
        trialPeriodDays: price.trialPeriodDays
      }))
    })),
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  };

  res.json(response);
}));

router.get('/runtime', asyncHandler(async (req, res) => {
  try {
    const plans = getAllPlans();
    const response: APIResponse<typeof plans> = {
      data: plans,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };
    res.json(response);
  } catch (error) {
    logger.warn({ error }, 'Plan cache was empty, forcing reload');
    await loadPlansFromDatabase(prisma);
    const plans = getAllPlans();
    const response: APIResponse<typeof plans> = {
      data: plans,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };
    res.json(response);
  }
}));

router.post('/reload', asyncHandler(async (req, res) => {
  await loadPlansFromDatabase(prisma);
  const response: APIResponse<{ reloaded: boolean }> = {
    data: { reloaded: true },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  };
  res.json(response);
}));

const planUpdateSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
  experiments: z.array(z.string().min(1)).optional()
});

function mergeFeatures(features: unknown, experiments?: string[]): Record<string, unknown> {
  const base = typeof features === 'object' && features !== null && !Array.isArray(features)
    ? { ...(features as Record<string, unknown>) }
    : {};
  if (experiments) {
    base.experiments = experiments;
  }
  return base;
}

router.put('/:planId', validateJSONContentType, asyncHandler(async (req, res) => {
  const { planId } = req.params;
  const payload = planUpdateSchema.parse(req.body ?? {});

  if (Object.keys(payload).length === 0) {
    throw new ValidationError('No plan fields provided');
  }

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId }
  });

  if (!plan) {
    throw new NotFoundError('Plan');
  }

  const updated = await prisma.subscriptionPlan.update({
    where: { id: planId },
    data: {
      ...(payload.displayName ? { displayName: payload.displayName } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(typeof payload.active === 'boolean' ? { active: payload.active } : {}),
      ...(payload.experiments ? { features: mergeFeatures(plan.features, payload.experiments) } : {})
    },
    include: { prices: true }
  });

  const response: APIResponse<Record<string, unknown>> = {
    data: {
      id: updated.id,
      displayName: updated.displayName,
      description: updated.description,
      active: updated.active,
      features: updated.features,
      prices: updated.prices
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  };

  res.json(response);
}));

const priceUpdateSchema = z.object({
  amount: z.number().int().positive().optional(),
  currency: z.string().min(3).max(5).optional(),
  interval: z.nativeEnum(BillingInterval).optional(),
  intervalCount: z.number().int().positive().optional(),
  providerPriceId: z.string().min(2).optional(),
  active: z.boolean().optional()
});

router.put('/:planId/prices/:priceId', validateJSONContentType, asyncHandler(async (req, res) => {
  const { priceId } = req.params;
  const payload = priceUpdateSchema.parse(req.body ?? {});

  if (Object.keys(payload).length === 0) {
    throw new ValidationError('No price fields provided');
  }

  const updatedPrice = await prisma.subscriptionPrice.update({
    where: { id: priceId },
    data: {
      ...(payload.amount !== undefined ? { amount: payload.amount } : {}),
      ...(payload.currency ? { currency: payload.currency } : {}),
      ...(payload.interval ? { interval: payload.interval } : {}),
      ...(payload.intervalCount ? { intervalCount: payload.intervalCount } : {}),
      ...(payload.providerPriceId ? { providerPriceId: payload.providerPriceId } : {}),
      ...(typeof payload.active === 'boolean' ? { active: payload.active } : {})
    }
  });

  const response: APIResponse<typeof updatedPrice> = {
    data: updatedPrice,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  };

  res.json(response);
}));

const priceCreateSchema = z.object({
  provider: z.string().min(2),
  providerPriceId: z.string().min(2),
  amount: z.number().int().positive(),
  currency: z.string().min(3).max(5),
  interval: z.nativeEnum(BillingInterval),
  intervalCount: z.number().int().positive().default(1),
  active: z.boolean().optional(),
  trialPeriodDays: z.number().int().optional()
});

router.post('/:planId/prices', validateJSONContentType, asyncHandler(async (req, res) => {
  const { planId } = req.params;
  const payload = priceCreateSchema.parse(req.body ?? {});

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId }
  });

  if (!plan) {
    throw new NotFoundError('Plan');
  }

  const newPrice = await prisma.subscriptionPrice.create({
    data: {
      planId,
      provider: payload.provider,
      providerPriceId: payload.providerPriceId,
      amount: payload.amount,
      currency: payload.currency,
      interval: payload.interval,
      intervalCount: payload.intervalCount,
      active: payload.active ?? true,
      trialPeriodDays: payload.trialPeriodDays
    }
  });

  const response: APIResponse<typeof newPrice> = {
    data: newPrice,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  };

  res.json(response);
}));

export default router;
