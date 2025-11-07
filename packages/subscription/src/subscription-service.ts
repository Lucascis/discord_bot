/**
 * Subscription Service
 * Core service for managing subscriptions, features, and usage limits
 */

import { PrismaClient,
  SubscriptionTier,
  SubscriptionStatus,
  BillingInterval,
  Prisma } from '@prisma/client';
import { logger } from '@discord-bot/logger';
import { getPlanByTier, needsUpgrade, getNextTier } from './plans.js';
import { tierHasFeature, getFeatureValue } from './features.js';
import { getLimitValue, isWithinLimit, calculateLimitPercentage, calculateNextReset, getLimit } from './limits.js';
import type {
  SubscriptionInfo,
  FeatureAccessResult,
  UsageLimitResult,
  CreateSubscriptionParams,
  UpdateSubscriptionParams,
  UsageTrackingUpdate,
  UsageStats,
} from './types.js';

export class SubscriptionService {
  private testGuildIds: Set<string> = new Set();

  constructor(
    private readonly prisma: PrismaClient,
    options?: { testGuildIds?: string[] }
  ) {
    if (options?.testGuildIds) {
      this.testGuildIds = new Set(options.testGuildIds);
    }
  }

  /**
   * Get subscription info for a guild
   * Creates a FREE tier subscription if none exists
   */
  async getSubscription(guildId: string): Promise<SubscriptionInfo> {
    // Find customer by guildId (for guild-level subscriptions)
    // In the new schema, we need to find a customer that has this guildId
    // For now, we'll use discordUserId as the lookup since guildId might not be set on Customer
    // This is a transitional approach - ideally we'd have a Guild->Customer mapping

    // First, try to find an active subscription for this guild
    // We'll look for a customer with this guildId or create one
    let customer = await this.prisma.customer.findFirst({
      where: {
        // For guild subscriptions, we use the guildId as the discordUserId
        // This allows backward compatibility
        discordUserId: guildId,
      },
      include: {
        subscriptions: {
          where: {
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE],
            },
          },
          include: {
            plan: true,
            price: true,
            usageLimits: true,
            usageTracking: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    // Create default FREE subscription if no customer/subscription exists
    if (!customer || customer.subscriptions.length === 0) {
      const subscription = await this.createSubscription({
        guildId,
        tier: SubscriptionTier.FREE,
        billingCycle: BillingInterval.MONTH,
      });

      // Re-fetch to get the full subscription with relations
      customer = await this.prisma.customer.findFirst({
        where: { discordUserId: guildId },
        include: {
          subscriptions: {
            where: { id: subscription.id },
            include: {
              plan: true,
              price: true,
              usageLimits: true,
              usageTracking: true,
            },
          },
        },
      });
    }

    const subscription = customer!.subscriptions[0];

    // Map plan name to tier
    const tier = this.getTierFromPlanName(subscription.plan.name);
    const plan = getPlanByTier(tier);
    const isActive = this.isSubscriptionActive(subscription);
    const isTrialing = !!(subscription.trialStart && subscription.trialEnd && new Date() <= subscription.trialEnd);

    return {
      guildId,
      tier,
      status: subscription.status,
      isActive,
      isTrialing,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      features: plan.features,
      limits: plan.limits,
    };
  }

  /**
   * Create a new subscription
   */
  async createSubscription(params: CreateSubscriptionParams) {
    const { guildId, tier, billingCycle, stripeCustomerId, trialDays } = params;

    const now = new Date();
    const trialStart = trialDays ? now : null;
    const trialEnd = trialDays ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;

    // Calculate period dates
    const currentPeriodStart = now;
    let currentPeriodEnd: Date;

    if (tier === SubscriptionTier.FREE) {
      // FREE tier: set period end far in the future (effectively unlimited)
      currentPeriodEnd = new Date(now.getFullYear() + 100, now.getMonth(), now.getDate());
    } else {
      currentPeriodEnd = billingCycle === BillingInterval.MONTH
        ? new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
        : new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    }

    // Get or create customer
    let customer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
    });

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          discordUserId: guildId,
          email: `guild-${guildId}@placeholder.local`, // Placeholder email for guild subscriptions
          stripeCustomerId,
          status: 'ACTIVE',
        },
      });
    }

    // Get or create subscription plan
    const planName = tier.toLowerCase();
    let plan = await this.prisma.subscriptionPlan.findUnique({
      where: { name: planName },
    });

    if (!plan) {
      const planDef = getPlanByTier(tier);
      plan = await this.prisma.subscriptionPlan.create({
        data: {
          name: planName,
          displayName: planDef.displayName,
          description: planDef.description,
          features: planDef.features as unknown as Prisma.InputJsonValue,
          limits: planDef.limits as unknown as Prisma.InputJsonValue,
          active: true,
        },
      });
    }

    // Get or create price for this plan
    let price = await this.prisma.subscriptionPrice.findFirst({
      where: {
        planId: plan.id,
        interval: billingCycle,
        provider: 'stripe',
      },
    });

    if (!price) {
      const planDef = getPlanByTier(tier);
      const amount = billingCycle === BillingInterval.MONTH ? planDef.price.monthly : planDef.price.yearly;

      price = await this.prisma.subscriptionPrice.create({
        data: {
          planId: plan.id,
          provider: 'stripe',
          providerPriceId: `price_${tier.toLowerCase()}_${billingCycle.toLowerCase()}_${Date.now()}`,
          amount,
          currency: 'USD',
          interval: billingCycle,
          intervalCount: 1,
          trialPeriodDays: trialDays,
          active: true,
        },
      });
    }

    // Create subscription
    const subscription = await this.prisma.subscription.create({
      data: {
        customerId: customer.id,
        planId: plan.id,
        priceId: price.id,
        provider: 'stripe',
        providerSubscriptionId: `sub_${guildId}_${Date.now()}`,
        status: trialDays ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        currentPeriodStart,
        currentPeriodEnd,
        trialStart,
        trialEnd,
        cancelAtPeriodEnd: false,
      },
      include: {
        plan: true,
        price: true,
        usageLimits: true,
        usageTracking: true,
      },
    });

    // Initialize usage limits
    await this.initializeUsageLimits(subscription.id, tier);

    // Initialize usage tracking
    await this.initializeUsageTracking(subscription.id, currentPeriodStart, currentPeriodEnd);

    // Log subscription event
    await this.logSubscriptionEvent(guildId, 'CREATED', tier);

    logger.info({ guildId, tier }, 'Subscription created');

    return subscription;
  }

  /**
   * Update subscription
   */
  async updateSubscription(guildId: string, params: UpdateSubscriptionParams) {
    // Find customer and current subscription
    const customer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
      include: {
        subscriptions: {
          where: {
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE],
            },
          },
          include: {
            plan: true,
            price: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!customer || customer.subscriptions.length === 0) {
      throw new Error(`Subscription not found for guild ${guildId}`);
    }

    const subscription = customer.subscriptions[0];
    const previousTier = this.getTierFromPlanName(subscription.plan.name);
    const newTier = params.tier || previousTier;
    const newBillingCycle = params.billingCycle || subscription.price.interval;

    // Log upgrade/downgrade event
    if (newTier !== previousTier) {
      const eventType = needsUpgrade(previousTier, newTier) ? 'UPGRADED' : 'DOWNGRADED';
      await this.logSubscriptionEvent(guildId, eventType, newTier, previousTier);
    }

    const updateData: Prisma.SubscriptionUpdateInput = {};

    // Update plan if tier changed
    if (newTier !== previousTier || newBillingCycle !== subscription.price.interval) {
      // Get or create new plan
      const planName = newTier.toLowerCase();
      let plan = await this.prisma.subscriptionPlan.findUnique({
        where: { name: planName },
      });

      if (!plan) {
        const planDef = getPlanByTier(newTier);
        plan = await this.prisma.subscriptionPlan.create({
          data: {
            name: planName,
            displayName: planDef.displayName,
            description: planDef.description,
            features: planDef.features as unknown as Prisma.InputJsonValue,
            limits: planDef.limits as unknown as Prisma.InputJsonValue,
            active: true,
          },
        });
      }

      // Get or create new price
      let price = await this.prisma.subscriptionPrice.findFirst({
        where: {
          planId: plan.id,
          interval: newBillingCycle,
          provider: 'stripe',
        },
      });

      if (!price) {
        const planDef = getPlanByTier(newTier);
        const amount = newBillingCycle === BillingInterval.MONTH ? planDef.price.monthly : planDef.price.yearly;

        price = await this.prisma.subscriptionPrice.create({
          data: {
            planId: plan.id,
            provider: 'stripe',
            providerPriceId: `price_${newTier.toLowerCase()}_${newBillingCycle.toLowerCase()}_${Date.now()}`,
            amount,
            currency: 'USD',
            interval: newBillingCycle,
            intervalCount: 1,
            active: true,
          },
        });
      }

      updateData.plan = { connect: { id: plan.id } };
      updateData.price = { connect: { id: price.id } };
    }

    if (typeof params.cancelAtPeriodEnd !== 'undefined') {
      updateData.cancelAtPeriodEnd = params.cancelAtPeriodEnd;
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: updateData,
    });

    // Update usage limits if tier changed
    if (newTier !== previousTier) {
      await this.updateUsageLimits(subscription.id, newTier);
    }

    logger.info({ guildId, previousTier, newTier }, 'Subscription updated');

    return updated;
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(guildId: string, reason?: string, immediately = false) {
    // Find customer and current subscription
    const customer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
      include: {
        subscriptions: {
          where: {
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE],
            },
          },
          include: {
            plan: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!customer || customer.subscriptions.length === 0) {
      throw new Error(`Subscription not found for guild ${guildId}`);
    }

    const subscription = customer.subscriptions[0];
    const previousTier = this.getTierFromPlanName(subscription.plan.name);

    if (immediately) {
      // Cancel immediately and downgrade to FREE
      // Get FREE plan
      const freePlanName = SubscriptionTier.FREE.toLowerCase();
      let freePlan = await this.prisma.subscriptionPlan.findUnique({
        where: { name: freePlanName },
      });

      if (!freePlan) {
        const planDef = getPlanByTier(SubscriptionTier.FREE);
        freePlan = await this.prisma.subscriptionPlan.create({
          data: {
            name: freePlanName,
            displayName: planDef.displayName,
            description: planDef.description,
            features: planDef.features as unknown as Prisma.InputJsonValue,
            limits: planDef.limits as unknown as Prisma.InputJsonValue,
            active: true,
          },
        });
      }

      // Get FREE price
      let freePrice = await this.prisma.subscriptionPrice.findFirst({
        where: {
          planId: freePlan.id,
          interval: BillingInterval.MONTH,
          provider: 'stripe',
        },
      });

      if (!freePrice) {
        freePrice = await this.prisma.subscriptionPrice.create({
          data: {
            planId: freePlan.id,
            provider: 'stripe',
            providerPriceId: `price_free_month_${Date.now()}`,
            amount: 0,
            currency: 'USD',
            interval: BillingInterval.MONTH,
            intervalCount: 1,
            active: true,
          },
        });
      }

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: freePlan.id,
          priceId: freePrice.id,
          status: SubscriptionStatus.CANCELED,
          canceledAt: new Date(),
          cancelReason: reason,
          cancelAtPeriodEnd: false,
        },
      });

      // Update usage limits to FREE tier
      await this.updateUsageLimits(subscription.id, SubscriptionTier.FREE);

      await this.logSubscriptionEvent(guildId, 'CANCELED', SubscriptionTier.FREE, previousTier);
    } else {
      // Cancel at period end
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelAtPeriodEnd: true,
          cancelReason: reason,
        },
      });
    }

    logger.info({ guildId, immediately, reason }, 'Subscription canceled');
  }

  /**
   * Check if guild has access to a feature
   */
  async checkFeatureAccess(guildId: string, featureKey: string): Promise<FeatureAccessResult> {
    const subscription = await this.getSubscription(guildId);

    if (!subscription.isActive) {
      return {
        hasAccess: false,
        featureKey,
        upgradeMessage: 'Your subscription is not active. Please renew to access this feature.',
      };
    }

    const hasAccess = tierHasFeature(subscription.tier, featureKey);
    const currentValue = getFeatureValue(featureKey, subscription.tier);

    if (!hasAccess) {
      const nextTier = getNextTier(subscription.tier);
      return {
        hasAccess: false,
        featureKey,
        currentValue,
        requiredTier: nextTier || undefined,
        upgradeMessage: nextTier
          ? `This feature requires ${nextTier} tier or higher. Upgrade to unlock!`
          : 'This feature is not available in your current plan.',
      };
    }

    return {
      hasAccess: true,
      featureKey,
      currentValue,
    };
  }

  /**
   * Check usage limit
   */
  async checkUsageLimit(guildId: string, limitType: string): Promise<UsageLimitResult> {
    // Test guilds bypass all limits
    if (this.testGuildIds.has(guildId)) {
      return {
        withinLimit: true,
        limitType,
        currentValue: 0,
        maxValue: -1, // unlimited for test guilds
        percentageUsed: 0,
        resetDate: undefined,
        upgradeMessage: undefined,
      };
    }

    const subscription = await this.getSubscription(guildId);
    const maxValue = getLimitValue(limitType, subscription.tier);

    // Find customer and subscription
    const customer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
      include: {
        subscriptions: {
          where: {
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE],
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!customer || customer.subscriptions.length === 0) {
      throw new Error(`Subscription not found for guild ${guildId}`);
    }

    const subscriptionRecord = customer.subscriptions[0];

    // Get or create usage limit
    let usageLimit = await this.prisma.usageLimit.findUnique({
      where: {
        subscriptionId_limitType: {
          subscriptionId: subscriptionRecord.id,
          limitType,
        },
      },
    });

    if (!usageLimit) {
      const limitDef = getLimit(limitType);
      const resetPeriod = limitDef?.resetPeriod || null;
      const nextReset = resetPeriod ? calculateNextReset(resetPeriod) : null;

      usageLimit = await this.prisma.usageLimit.create({
        data: {
          subscriptionId: subscriptionRecord.id,
          limitType,
          maxValue,
          currentValue: 0,
          resetPeriod,
          nextReset,
          lastReset: resetPeriod ? new Date() : null,
        },
      });
    }

    const withinLimit = isWithinLimit(usageLimit.currentValue, maxValue);
    const percentageUsed = calculateLimitPercentage(usageLimit.currentValue, maxValue);

    if (!withinLimit) {
      const nextTier = getNextTier(subscription.tier);
      return {
        withinLimit: false,
        limitType,
        currentValue: usageLimit.currentValue,
        maxValue,
        percentageUsed,
        resetDate: usageLimit.nextReset || undefined,
        upgradeMessage: nextTier
          ? `You've reached your ${limitType} limit. Upgrade to ${nextTier} for higher limits!`
          : 'You\'ve reached your usage limit.',
      };
    }

    return {
      withinLimit: true,
      limitType,
      currentValue: usageLimit.currentValue,
      maxValue,
      percentageUsed,
      resetDate: usageLimit.nextReset || undefined,
    };
  }

  /**
   * Increment usage limit
   */
  async incrementUsage(guildId: string, limitType: string, amount = 1): Promise<void> {
    // Find customer and subscription
    const customer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
      include: {
        subscriptions: {
          where: {
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE],
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!customer || customer.subscriptions.length === 0) return;

    const subscriptionRecord = customer.subscriptions[0];

    const usageLimit = await this.prisma.usageLimit.findUnique({
      where: {
        subscriptionId_limitType: {
          subscriptionId: subscriptionRecord.id,
          limitType,
        },
      },
    });

    if (usageLimit) {
      // Check if reset is needed
      if (usageLimit.nextReset && new Date() >= usageLimit.nextReset) {
        const limitDef = getLimit(limitType);
        const nextReset = limitDef?.resetPeriod ? calculateNextReset(limitDef.resetPeriod) : null;

        await this.prisma.usageLimit.update({
          where: { id: usageLimit.id },
          data: {
            currentValue: amount,
            lastReset: new Date(),
            nextReset,
          },
        });
      } else {
        await this.prisma.usageLimit.update({
          where: { id: usageLimit.id },
          data: {
            currentValue: { increment: amount },
          },
        });
      }
    }
  }

  /**
   * Update usage tracking
   */
  async updateUsageTracking(guildId: string, updates: UsageTrackingUpdate): Promise<void> {
    // Find customer and subscription
    const customer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
      include: {
        subscriptions: {
          where: {
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE],
            },
          },
          include: {
            usageTracking: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!customer || customer.subscriptions.length === 0) return;

    const subscriptionRecord = customer.subscriptions[0];
    const usageTracking = subscriptionRecord.usageTracking;

    if (!usageTracking) return;

    await this.prisma.usageTracking.update({
      where: { id: usageTracking.id },
      data: {
        tracksPlayed: updates.tracksPlayed ? { increment: updates.tracksPlayed } : undefined,
        playbackMinutes: updates.playbackMinutes ? { increment: updates.playbackMinutes } : undefined,
        apiRequests: updates.apiRequests ? { increment: updates.apiRequests } : undefined,
        totalTracksPlayed: updates.tracksPlayed ? { increment: updates.tracksPlayed } : undefined,
        totalPlaybackMinutes: updates.playbackMinutes ? { increment: updates.playbackMinutes } : undefined,
        totalApiRequests: updates.apiRequests ? { increment: updates.apiRequests } : undefined,
        lastActivity: new Date(),
      },
    });
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(guildId: string): Promise<UsageStats | null> {
    // Find customer and subscription
    const customer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
      include: {
        subscriptions: {
          where: {
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE],
            },
          },
          include: {
            usageTracking: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!customer || customer.subscriptions.length === 0) return null;

    const subscriptionRecord = customer.subscriptions[0];
    const tracking = subscriptionRecord.usageTracking;

    if (!tracking) return null;

    return {
      current: {
        tracksPlayed: tracking.tracksPlayed,
        playbackMinutes: tracking.playbackMinutes,
        apiRequests: tracking.apiRequests,
        periodStart: tracking.currentPeriodStart,
        periodEnd: tracking.currentPeriodEnd,
      },
      lifetime: {
        totalTracksPlayed: tracking.totalTracksPlayed,
        totalPlaybackMinutes: tracking.totalPlaybackMinutes,
        totalApiRequests: tracking.totalApiRequests,
      },
    };
  }

  /**
   * Check if subscription is active
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isSubscriptionActive(subscription: any): boolean {
    if (subscription.status === SubscriptionStatus.CANCELED) return false;
    if (subscription.status === SubscriptionStatus.UNPAID) return false;
    if (subscription.status === SubscriptionStatus.INCOMPLETE_EXPIRED) return false;

    // Free tier is always active
    // In new schema, check plan name instead of tier field
    if (subscription.plan && subscription.plan.name === 'free') return true;

    // Check if period has ended
    if (subscription.currentPeriodEnd && new Date() > subscription.currentPeriodEnd) {
      return false;
    }

    return true;
  }

  /**
   * Map plan name to SubscriptionTier enum
   */
  private getTierFromPlanName(planName: string): SubscriptionTier {
    const normalized = planName.toLowerCase();

    switch (normalized) {
      case 'free':
        return SubscriptionTier.FREE;
      case 'basic':
        return SubscriptionTier.BASIC;
      case 'premium':
        return SubscriptionTier.PREMIUM;
      case 'enterprise':
        return SubscriptionTier.ENTERPRISE;
      default:
        logger.warn({ planName }, 'Unknown plan name, defaulting to FREE');
        return SubscriptionTier.FREE;
    }
  }

  /**
   * Initialize usage limits for a subscription
   */
  private async initializeUsageLimits(subscriptionId: string, tier: SubscriptionTier): Promise<void> {
    const limitKeys = [
      'concurrent_playbacks',
      'monthly_tracks',
      'queue_size',
      'max_song_duration',
      'api_rate_limit',
      'daily_playback_hours',
      'max_guilds',
      'playlist_size',
    ];

    for (const limitType of limitKeys) {
      const maxValue = getLimitValue(limitType, tier);
      const limitDef = getLimit(limitType);
      const resetPeriod = limitDef?.resetPeriod || null;
      const nextReset = resetPeriod ? calculateNextReset(resetPeriod) : null;

      await this.prisma.usageLimit.create({
        data: {
          subscriptionId,
          limitType,
          maxValue,
          currentValue: 0,
          resetPeriod,
          nextReset,
          lastReset: resetPeriod ? new Date() : null,
        },
      });
    }
  }

  /**
   * Update usage limits when tier changes
   */
  private async updateUsageLimits(subscriptionId: string, newTier: SubscriptionTier): Promise<void> {
    const limits = await this.prisma.usageLimit.findMany({
      where: { subscriptionId },
    });

    for (const limit of limits) {
      const newMaxValue = getLimitValue(limit.limitType, newTier);
      await this.prisma.usageLimit.update({
        where: { id: limit.id },
        data: { maxValue: newMaxValue },
      });
    }
  }

  /**
   * Initialize usage tracking
   */
  private async initializeUsageTracking(
    subscriptionId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<void> {
    await this.prisma.usageTracking.create({
      data: {
        subscriptionId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
  }

  /**
   * Log subscription event
   */
  private async logSubscriptionEvent(
    guildId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventType: any,
    tier?: SubscriptionTier,
    previousTier?: SubscriptionTier
  ): Promise<void> {
    await this.prisma.subscriptionEvent.create({
      data: {
        guildId,
        eventType,
        tier,
        previousTier,
      },
    });
  }
}
