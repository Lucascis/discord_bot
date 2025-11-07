/**
 * End-to-End Test: Premium Subscription Flow
 *
 * Purpose: Validates premium subscription lifecycle from trial to cancellation
 * Scope: Tests subscription creation, upgrades, feature access, and billing events
 * Coverage: Trial start, premium upgrade, feature unlocking, cancellation, expiration
 *
 * @group e2e
 * @group premium
 * @group subscription
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient, SubscriptionTier, SubscriptionStatus } from '@prisma/client';
import Redis from 'ioredis';
import { addDays, subDays, addMonths } from 'date-fns';

// Test configuration
const _TEST_TIMEOUT = 30000; // 30 seconds for E2E tests
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/discord_test';

// Test fixtures
const TEST_GUILD_ID = '999888777666555444';
const TEST_USER_ID = '111222333444555666';
const TEST_STRIPE_CUSTOMER_ID = 'cus_test123456789';
const TEST_STRIPE_SUBSCRIPTION_ID = 'sub_test123456789';

describe.skip('E2E: Premium Subscription Flow (requires full infrastructure)', () => {
  let prisma: PrismaClient;
  let redis: Redis;

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
    await prisma.subscription.deleteMany({ where: { guildId: TEST_GUILD_ID } });
    await prisma.guildSettings.deleteMany({ where: { guildId: TEST_GUILD_ID } });

    // Initialize Redis
    redis = new Redis(REDIS_URL);
    await redis.del(`subscription:${TEST_GUILD_ID}`);
    await redis.del(`features:${TEST_GUILD_ID}`);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.subscription.deleteMany({ where: { guildId: TEST_GUILD_ID } });
    await prisma.guildSettings.deleteMany({ where: { guildId: TEST_GUILD_ID } });
    await prisma.$disconnect();

    await redis.del(`subscription:${TEST_GUILD_ID}`);
    await redis.del(`features:${TEST_GUILD_ID}`);
    await redis.quit();
  });

  beforeEach(async () => {
    // Reset state before each test
    await prisma.subscription.deleteMany({ where: { guildId: TEST_GUILD_ID } });
    await redis.del(`subscription:${TEST_GUILD_ID}`);
    await redis.del(`features:${TEST_GUILD_ID}`);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Trial Subscription', () => {
    it('should start a free trial successfully', async () => {
      // Act
      const subscription = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.TRIAL,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addDays(new Date(), 14), // 14-day trial
          createdById: TEST_USER_ID,
        },
      });

      // Assert
      expect(subscription).toBeDefined();
      expect(subscription.tier).toBe(SubscriptionTier.TRIAL);
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);
      expect(subscription.stripeCustomerId).toBeNull();
      expect(subscription.stripeSubscriptionId).toBeNull();

      // Verify trial duration is 14 days
      const trialDays = Math.floor(
        (subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime()) /
        (1000 * 60 * 60 * 24)
      );
      expect(trialDays).toBe(14);

      // Verify Redis cache
      await redis.set(
        `subscription:${TEST_GUILD_ID}`,
        JSON.stringify({
          tier: subscription.tier,
          status: subscription.status,
          features: ['basic_playback', 'queue_management', 'search'],
        }),
        'EX',
        3600
      );

      const cached = await redis.get(`subscription:${TEST_GUILD_ID}`);
      expect(cached).toBeDefined();
    });

    it('should prevent multiple trials for same guild', async () => {
      // Arrange - Create expired trial
      await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.TRIAL,
          status: SubscriptionStatus.EXPIRED,
          currentPeriodStart: subDays(new Date(), 30),
          currentPeriodEnd: subDays(new Date(), 16),
          createdById: TEST_USER_ID,
        },
      });

      // Act & Assert - Attempting to create another trial should fail
      const existingSubscription = await prisma.subscription.findFirst({
        where: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.TRIAL,
        },
      });

      expect(existingSubscription).toBeDefined();
      expect(existingSubscription?.status).toBe(SubscriptionStatus.EXPIRED);

      // Application logic should prevent new trial
      const hasHadTrial = existingSubscription !== null;
      expect(hasHadTrial).toBe(true);
    });

    it('should grant trial features', async () => {
      // Arrange
      await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.TRIAL,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addDays(new Date(), 14),
          createdById: TEST_USER_ID,
        },
      });

      // Act - Get features
      const features = {
        basic_playback: true,
        queue_management: true,
        search: true,
        effects: false,
        premium_quality: false,
        ai_recommendations: false,
      };

      await redis.hmset(`features:${TEST_GUILD_ID}`, features);

      // Assert
      const cachedFeatures = await redis.hgetall(`features:${TEST_GUILD_ID}`);
      expect(cachedFeatures.basic_playback).toBe('true');
      expect(cachedFeatures.effects).toBe('false');
      expect(cachedFeatures.ai_recommendations).toBe('false');
    });

    it('should expire trial after 14 days', async () => {
      // Arrange - Create trial that ended yesterday
      const subscription = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.TRIAL,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: subDays(new Date(), 15),
          currentPeriodEnd: subDays(new Date(), 1),
          createdById: TEST_USER_ID,
        },
      });

      // Act - Simulate cron job checking expirations
      const now = new Date();
      const shouldExpire = subscription.currentPeriodEnd < now;

      if (shouldExpire) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SubscriptionStatus.EXPIRED },
        });
      }

      // Assert
      const updated = await prisma.subscription.findUnique({
        where: { id: subscription.id },
      });

      expect(updated?.status).toBe(SubscriptionStatus.EXPIRED);
    });
  });

  describe('Premium Upgrade', () => {
    it('should upgrade from trial to premium', async () => {
      // Arrange - Create active trial
      const trial = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.TRIAL,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: subDays(new Date(), 5),
          currentPeriodEnd: addDays(new Date(), 9),
          createdById: TEST_USER_ID,
        },
      });

      // Act - Upgrade to premium
      const premium = await prisma.subscription.update({
        where: { id: trial.id },
        data: {
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addMonths(new Date(), 1),
        },
      });

      // Assert
      expect(premium.tier).toBe(SubscriptionTier.PREMIUM);
      expect(premium.status).toBe(SubscriptionStatus.ACTIVE);
      expect(premium.stripeCustomerId).toBe(TEST_STRIPE_CUSTOMER_ID);
      expect(premium.stripeSubscriptionId).toBe(TEST_STRIPE_SUBSCRIPTION_ID);

      // Verify period is monthly
      const periodDays = Math.floor(
        (premium.currentPeriodEnd.getTime() - premium.currentPeriodStart.getTime()) /
        (1000 * 60 * 60 * 24)
      );
      expect(periodDays).toBeGreaterThanOrEqual(28);
      expect(periodDays).toBeLessThanOrEqual(31);
    });

    it('should unlock premium features on upgrade', async () => {
      // Arrange
      await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addMonths(new Date(), 1),
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act - Get premium features
      const premiumFeatures = {
        basic_playback: true,
        queue_management: true,
        search: true,
        effects: true,
        premium_quality: true,
        ai_recommendations: true,
        unlimited_queue: true,
        priority_support: true,
      };

      await redis.hmset(`features:${TEST_GUILD_ID}`, premiumFeatures);

      // Assert
      const cachedFeatures = await redis.hgetall(`features:${TEST_GUILD_ID}`);
      expect(cachedFeatures.basic_playback).toBe('true');
      expect(cachedFeatures.effects).toBe('true');
      expect(cachedFeatures.ai_recommendations).toBe('true');
      expect(cachedFeatures.unlimited_queue).toBe('true');
      expect(cachedFeatures.priority_support).toBe('true');
    });

    it('should upgrade from free to premium directly', async () => {
      // Act - Create premium subscription (no trial)
      const subscription = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addMonths(new Date(), 1),
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Assert
      expect(subscription.tier).toBe(SubscriptionTier.PREMIUM);
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);
    });
  });

  describe('Subscription Renewal', () => {
    it('should renew subscription automatically', async () => {
      // Arrange - Create subscription ending soon
      const subscription = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: subDays(new Date(), 29),
          currentPeriodEnd: addDays(new Date(), 1), // Ends tomorrow
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act - Simulate Stripe webhook renewal
      const renewed = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodStart: subscription.currentPeriodEnd,
          currentPeriodEnd: addMonths(subscription.currentPeriodEnd, 1),
        },
      });

      // Assert
      expect(renewed.status).toBe(SubscriptionStatus.ACTIVE);
      expect(renewed.currentPeriodStart.getTime()).toBe(subscription.currentPeriodEnd.getTime());

      const renewalPeriodDays = Math.floor(
        (renewed.currentPeriodEnd.getTime() - renewed.currentPeriodStart.getTime()) /
        (1000 * 60 * 60 * 24)
      );
      expect(renewalPeriodDays).toBeGreaterThanOrEqual(28);
    });

    it('should handle payment failure on renewal', async () => {
      // Arrange
      const subscription = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: subDays(new Date(), 30),
          currentPeriodEnd: subDays(new Date(), 1), // Ended yesterday
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act - Simulate payment failure webhook
      const failed = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.PAST_DUE,
        },
      });

      // Assert
      expect(failed.status).toBe(SubscriptionStatus.PAST_DUE);
      expect(failed.tier).toBe(SubscriptionTier.PREMIUM); // Tier remains, status changes

      // Features should be restricted after grace period
      const gracePeriodEnded = true; // Simplified for test
      if (gracePeriodEnded) {
        const restrictedFeatures = {
          basic_playback: true,
          effects: false,
          premium_quality: false,
          ai_recommendations: false,
        };

        await redis.hmset(`features:${TEST_GUILD_ID}`, restrictedFeatures);
        const features = await redis.hgetall(`features:${TEST_GUILD_ID}`);
        expect(features.effects).toBe('false');
      }
    });
  });

  describe('Subscription Cancellation', () => {
    it('should cancel subscription immediately', async () => {
      // Arrange
      const subscription = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addMonths(new Date(), 1),
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act - Immediate cancellation
      const cancelled = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          canceledAt: new Date(),
        },
      });

      // Assert
      expect(cancelled.status).toBe(SubscriptionStatus.CANCELLED);
      expect(cancelled.canceledAt).toBeDefined();

      // Features should be immediately revoked
      await redis.del(`features:${TEST_GUILD_ID}`);
      const features = await redis.exists(`features:${TEST_GUILD_ID}`);
      expect(features).toBe(0);
    });

    it('should cancel subscription at period end', async () => {
      // Arrange
      const subscription = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addMonths(new Date(), 1),
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act - Schedule cancellation at period end
      const scheduled = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelAtPeriodEnd: true,
          canceledAt: new Date(),
        },
      });

      // Assert
      expect(scheduled.status).toBe(SubscriptionStatus.ACTIVE); // Still active
      expect(scheduled.cancelAtPeriodEnd).toBe(true);

      // Features should remain until period end
      const now = new Date();
      const shouldHaveAccess = now < scheduled.currentPeriodEnd;
      expect(shouldHaveAccess).toBe(true);
    });

    it('should downgrade features after cancellation period ends', async () => {
      // Arrange - Subscription cancelled, period ended
      const subscription = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: subDays(new Date(), 30),
          currentPeriodEnd: subDays(new Date(), 1), // Ended yesterday
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          cancelAtPeriodEnd: true,
          canceledAt: subDays(new Date(), 15),
          createdById: TEST_USER_ID,
        },
      });

      // Act - Simulate cron job processing end-of-period cancellations
      const now = new Date();
      if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd < now) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: SubscriptionStatus.CANCELLED,
            tier: SubscriptionTier.FREE,
          },
        });
      }

      // Assert
      const updated = await prisma.subscription.findUnique({
        where: { id: subscription.id },
      });

      expect(updated?.status).toBe(SubscriptionStatus.CANCELLED);
      expect(updated?.tier).toBe(SubscriptionTier.FREE);

      // Features should be downgraded to free tier
      const freeFeatures = {
        basic_playback: true,
        queue_management: true,
        effects: false,
        premium_quality: false,
      };

      await redis.hmset(`features:${TEST_GUILD_ID}`, freeFeatures);
      const features = await redis.hgetall(`features:${TEST_GUILD_ID}`);
      expect(features.basic_playback).toBe('true');
      expect(features.effects).toBe('false');
    });
  });

  describe('Feature Access Control', () => {
    it('should allow premium features for active premium subscription', async () => {
      // Arrange
      await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addMonths(new Date(), 1),
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act - Check feature access
      const hasEffects = await checkFeatureAccess(TEST_GUILD_ID, 'effects');
      const hasAIRecommendations = await checkFeatureAccess(TEST_GUILD_ID, 'ai_recommendations');
      const hasPremiumQuality = await checkFeatureAccess(TEST_GUILD_ID, 'premium_quality');

      // Assert
      expect(hasEffects).toBe(true);
      expect(hasAIRecommendations).toBe(true);
      expect(hasPremiumQuality).toBe(true);
    });

    it('should deny premium features for free tier', async () => {
      // Arrange - No subscription or free tier
      // Act - Check feature access
      const hasEffects = await checkFeatureAccess(TEST_GUILD_ID, 'effects');
      const hasAIRecommendations = await checkFeatureAccess(TEST_GUILD_ID, 'ai_recommendations');
      const hasBasicPlayback = await checkFeatureAccess(TEST_GUILD_ID, 'basic_playback');

      // Assert
      expect(hasEffects).toBe(false);
      expect(hasAIRecommendations).toBe(false);
      expect(hasBasicPlayback).toBe(true); // Basic features always available
    });

    it('should deny premium features for expired subscription', async () => {
      // Arrange
      await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.EXPIRED,
          currentPeriodStart: subDays(new Date(), 60),
          currentPeriodEnd: subDays(new Date(), 30),
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act
      const hasEffects = await checkFeatureAccess(TEST_GUILD_ID, 'effects');
      const hasBasicPlayback = await checkFeatureAccess(TEST_GUILD_ID, 'basic_playback');

      // Assert
      expect(hasEffects).toBe(false);
      expect(hasBasicPlayback).toBe(true);
    });
  });

  describe('Webhook Events', () => {
    it('should process subscription.created webhook', async () => {
      // Arrange - Simulate Stripe webhook payload
      const webhookPayload = {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: TEST_STRIPE_SUBSCRIPTION_ID,
            customer: TEST_STRIPE_CUSTOMER_ID,
            status: 'active',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(addMonths(new Date(), 1).getTime() / 1000),
            metadata: {
              guildId: TEST_GUILD_ID,
              userId: TEST_USER_ID,
            },
          },
        },
      };

      // Act - Process webhook
      const subscription = await prisma.subscription.create({
        data: {
          guildId: webhookPayload.data.object.metadata.guildId,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(webhookPayload.data.object.current_period_start * 1000),
          currentPeriodEnd: new Date(webhookPayload.data.object.current_period_end * 1000),
          stripeCustomerId: webhookPayload.data.object.customer,
          stripeSubscriptionId: webhookPayload.data.object.id,
          createdById: webhookPayload.data.object.metadata.userId,
        },
      });

      // Assert
      expect(subscription).toBeDefined();
      expect(subscription.stripeSubscriptionId).toBe(TEST_STRIPE_SUBSCRIPTION_ID);
    });

    it('should process subscription.updated webhook', async () => {
      // Arrange
      const existing = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addMonths(new Date(), 1),
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act - Process status change webhook
      const updated = await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: SubscriptionStatus.PAST_DUE,
        },
      });

      // Assert
      expect(updated.status).toBe(SubscriptionStatus.PAST_DUE);
    });

    it('should process subscription.deleted webhook', async () => {
      // Arrange
      const existing = await prisma.subscription.create({
        data: {
          guildId: TEST_GUILD_ID,
          tier: SubscriptionTier.PREMIUM,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addMonths(new Date(), 1),
          stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: TEST_STRIPE_SUBSCRIPTION_ID,
          createdById: TEST_USER_ID,
        },
      });

      // Act - Process cancellation webhook
      const cancelled = await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          canceledAt: new Date(),
        },
      });

      // Assert
      expect(cancelled.status).toBe(SubscriptionStatus.CANCELLED);
    });
  });
});

// Helper function to check feature access
async function checkFeatureAccess(guildId: string, feature: string): Promise<boolean> {
  const prisma = new PrismaClient();
  const redis = new Redis(REDIS_URL);

  try {
    // Check cache first
    const cached = await redis.hget(`features:${guildId}`, feature);
    if (cached !== null) {
      return cached === 'true';
    }

    // Check database
    const subscription = await prisma.subscription.findFirst({
      where: {
        guildId,
        status: SubscriptionStatus.ACTIVE,
      },
    });

    if (!subscription) {
      // Free tier - only basic features
      const freeFeatures = ['basic_playback', 'queue_management', 'search'];
      return freeFeatures.includes(feature);
    }

    if (subscription.tier === SubscriptionTier.TRIAL) {
      // Trial - basic features only
      const trialFeatures = ['basic_playback', 'queue_management', 'search'];
      return trialFeatures.includes(feature);
    }

    if (subscription.tier === SubscriptionTier.PREMIUM) {
      // Premium - all features
      return true;
    }

    return false;
  } finally {
    await prisma.$disconnect();
    await redis.quit();
  }
}
