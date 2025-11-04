/**
 * Subscription Service
 * Core service for managing subscriptions, features, and usage limits
 */

import {
  PrismaClient,
  SubscriptionTier,
  SubscriptionStatus,
  BillingCycle,
  ResetPeriod,
  Prisma,
} from '@prisma/client';
import { logger } from '@discord-bot/logger';
import { getPlanByTier, needsUpgrade, getNextTier } from './plans.js';
import { tierHasFeature, getFeatureValue } from './features.js';
import { getLimitValue, isWithinLimit, calculateLimitPercentage, calculateNextReset, getLimit } from './limits.js';
import type {
  SubscriptionInfo,
  SubscriptionCheckResult,
  FeatureAccessResult,
  UsageLimitResult,
  CreateSubscriptionParams,
  UpdateSubscriptionParams,
  UsageTrackingUpdate,
  UsageStats,
} from './types.js';

export class SubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get subscription info for a guild
   * Creates a FREE tier subscription if none exists
   */
  async getSubscription(guildId: string): Promise<SubscriptionInfo> {
    let subscription = await this.prisma.subscription.findUnique({
      where: { guildId },
      include: {
        usageLimits: true,
        usageTracking: true,
      },
    });

    // Create default FREE subscription if none exists
    if (!subscription) {
      subscription = await this.createSubscription({
        guildId,
        tier: SubscriptionTier.FREE,
        billingCycle: BillingCycle.MONTHLY,
      });
    }

    const plan = getPlanByTier(subscription.tier);
    const isActive = this.isSubscriptionActive(subscription);

    return {
      guildId: subscription.guildId,
      tier: subscription.tier,
      status: subscription.status,
      isActive,
      isTrialing: subscription.isTrialing,
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
    let currentPeriodStart = now;
    let currentPeriodEnd: Date | null = null;

    if (tier !== SubscriptionTier.FREE) {
      currentPeriodEnd = billingCycle === BillingCycle.MONTHLY
        ? new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
        : new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    }

    const subscription = await this.prisma.subscription.create({
      data: {
        guildId,
        tier,
        status: trialDays ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        billingCycle: tier === SubscriptionTier.FREE ? null : billingCycle,
        currentPeriodStart: tier === SubscriptionTier.FREE ? null : currentPeriodStart,
        currentPeriodEnd: tier === SubscriptionTier.FREE ? null : currentPeriodEnd,
        stripeCustomerId,
        isTrialing: !!trialDays,
        trialStart,
        trialEnd,
      },
      include: {
        usageLimits: true,
        usageTracking: true,
      },
    });

    // Initialize usage limits
    await this.initializeUsageLimits(subscription.id, tier);

    // Initialize usage tracking
    await this.initializeUsageTracking(subscription.id, currentPeriodStart, currentPeriodEnd || new Date());

    // Log subscription event
    await this.logSubscriptionEvent(guildId, 'CREATED', tier);

    logger.info({ guildId, tier }, 'Subscription created');

    return subscription;
  }

  /**
   * Update subscription
   */
  async updateSubscription(guildId: string, params: UpdateSubscriptionParams) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { guildId },
    });

    if (!subscription) {
      throw new Error(`Subscription not found for guild ${guildId}`);
    }

    const previousTier = subscription.tier;
    const newTier = params.tier || previousTier;

    // Log upgrade/downgrade event
    if (newTier !== previousTier) {
      const eventType = needsUpgrade(previousTier, newTier) ? 'UPGRADED' : 'DOWNGRADED';
      await this.logSubscriptionEvent(guildId, eventType, newTier, previousTier);
    }

    const updateData: Prisma.SubscriptionUpdateInput = {
      tier: newTier,
    };

    if (typeof params.cancelAtPeriodEnd !== 'undefined') {
      updateData.cancelAtPeriodEnd = params.cancelAtPeriodEnd;
    }

    if (newTier === SubscriptionTier.FREE) {
      updateData.billingCycle = { set: null };
    } else if (typeof params.billingCycle !== 'undefined') {
      updateData.billingCycle = { set: params.billingCycle };
    }

    const updated = await this.prisma.subscription.update({
      where: { guildId },
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
    const subscription = await this.prisma.subscription.findUnique({
      where: { guildId },
    });

    if (!subscription) {
      throw new Error(`Subscription not found for guild ${guildId}`);
    }

    if (immediately) {
      // Cancel immediately and downgrade to FREE
      await this.prisma.subscription.update({
        where: { guildId },
        data: {
          tier: SubscriptionTier.FREE,
          status: SubscriptionStatus.CANCELED,
          canceledAt: new Date(),
          cancellationReason: reason,
          cancelAtPeriodEnd: false,
        },
      });

      await this.logSubscriptionEvent(guildId, 'CANCELED', SubscriptionTier.FREE, subscription.tier);
    } else {
      // Cancel at period end
      await this.prisma.subscription.update({
        where: { guildId },
        data: {
          cancelAtPeriodEnd: true,
          cancellationReason: reason,
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
    const subscription = await this.getSubscription(guildId);
    const maxValue = getLimitValue(limitType, subscription.tier);

    // Get or create usage limit
    let usageLimit = await this.prisma.usageLimit.findUnique({
      where: {
        subscriptionId_limitType: {
          subscriptionId: (await this.prisma.subscription.findUnique({ where: { guildId } }))!.id,
          limitType,
        },
      },
    });

    if (!usageLimit) {
      const subscriptionRecord = await this.prisma.subscription.findUnique({ where: { guildId } });
      if (!subscriptionRecord) {
        throw new Error(`Subscription not found for guild ${guildId}`);
      }

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
    const subscriptionRecord = await this.prisma.subscription.findUnique({ where: { guildId } });
    if (!subscriptionRecord) return;

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
    const subscriptionRecord = await this.prisma.subscription.findUnique({
      where: { guildId },
      include: { usageTracking: true },
    });

    if (!subscriptionRecord || !subscriptionRecord.usageTracking) return;

    await this.prisma.usageTracking.update({
      where: { id: subscriptionRecord.usageTracking.id },
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
    const subscriptionRecord = await this.prisma.subscription.findUnique({
      where: { guildId },
      include: { usageTracking: true },
    });

    if (!subscriptionRecord || !subscriptionRecord.usageTracking) return null;

    const tracking = subscriptionRecord.usageTracking;

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
  private isSubscriptionActive(subscription: any): boolean {
    if (subscription.status === SubscriptionStatus.CANCELED) return false;
    if (subscription.status === SubscriptionStatus.UNPAID) return false;
    if (subscription.status === SubscriptionStatus.INCOMPLETE_EXPIRED) return false;

    // Free tier is always active
    if (subscription.tier === SubscriptionTier.FREE) return true;

    // Check if period has ended
    if (subscription.currentPeriodEnd && new Date() > subscription.currentPeriodEnd) {
      return false;
    }

    return true;
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
