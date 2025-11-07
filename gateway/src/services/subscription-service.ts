/**
 * Subscription Service
 * High-level service for managing subscriptions and billing operations
 */

import { SubscriptionTier, PeriodType, calculatePriceWithPeriod, ENHANCED_PRICING } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { BillingManagementUseCase } from '../application/use-cases/billing-management-use-case.js';
import { PremiumFeatureManagementUseCase } from '../application/use-cases/premium-feature-management-use-case.js';
import { FeatureSubscription } from '../domain/entities/feature-subscription.js';

export interface SubscriptionPlan {
  tier: SubscriptionTier;
  period: PeriodType;
  basePrice: number;
  finalPrice: number;
  discountPercentage: number;
  features: string[];
  quotas: {
    queueSize: number;
    monthlyPlaytime: number;
    concurrentSessions: number;
    apiCallsPerDay: number;
  };
}

export interface SubscriptionUpgradeResult {
  success: boolean;
  subscription?: FeatureSubscription;
  billing?: {
    chargedAmount: number;
    prorationAmount: number;
    nextBillingDate: Date;
  };
  error?: string;
}

export interface TrialStartResult {
  success: boolean;
  trialSubscription?: FeatureSubscription;
  trialEndDate?: Date;
  error?: string;
}

export interface SubscriptionStatus {
  isActive: boolean;
  tier: SubscriptionTier;
  billingPeriod: PeriodType;
  expiresAt: Date | null;
  isInTrial: boolean;
  trialEndsAt: Date | null;
  daysRemaining: number;
  autoRenewal: boolean;
  features: string[];
  usage: {
    currentQuotas: Record<string, number>;
    limits: Record<string, number>;
    utilizationPercentage: number;
  };
}

export class SubscriptionService {
  constructor(
    private readonly billingUseCase: BillingManagementUseCase,
    private readonly featureUseCase: PremiumFeatureManagementUseCase
  ) {}

  /**
   * Get available subscription plans with pricing
   */
  async getAvailablePlans(
    userId?: string,
    includePromotions: boolean = true
  ): Promise<SubscriptionPlan[]> {
    const plans: SubscriptionPlan[] = [];

    for (const [tier, config] of Object.entries(ENHANCED_PRICING)) {
      if (tier === 'free') continue;

      for (const period of config.periods) {
        const basePrice = config.basePrice;
        const finalPrice = calculatePriceWithPeriod(tier as SubscriptionTier, period);
        const discountPercentage = ((basePrice - finalPrice) / basePrice) * 100;

        plans.push({
          tier: tier as SubscriptionTier,
          period,
          basePrice,
          finalPrice,
          discountPercentage,
          features: this.getFeatureList(tier as SubscriptionTier),
          quotas: this.getQuotaLimits(tier as SubscriptionTier)
        });
      }
    }

    // Add promotional plans if requested
    if (includePromotions && userId) {
      const promotionalPlans = await this.getPromotionalPlans(userId);
      plans.push(...promotionalPlans);
    }

    return plans.sort((a, b) => a.finalPrice - b.finalPrice);
  }

  /**
   * Start a free trial
   */
  async startTrial(
    userId: string,
    guildId: string,
    tier: SubscriptionTier = 'premium'
  ): Promise<TrialStartResult> {
    try {
      // Check if user is eligible for trial
      const isEligible = await this.checkTrialEligibility(userId, tier);
      if (!isEligible) {
        return {
          success: false,
          error: 'User not eligible for trial'
        };
      }

      // Create trial subscription through billing use case
      const result = await this.billingUseCase.processTrialSubscription(
        userId,
        guildId,
        tier,
        14 // 14-day trial
      );

      if (result.success && result.subscription) {
        // Calculate trial end date (14 days from now)
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 14);

        return {
          success: true,
          trialSubscription: result.subscription,
          trialEndDate
        };
      }

      return {
        success: false,
        error: result.error || 'Failed to start trial'
      };

    } catch (error) {
      logger.error({ error, guildId }, 'Trial start failed');
      return {
        success: false,
        error: 'Service error'
      };
    }
  }

  /**
   * Upgrade subscription
   */
  async upgradeSubscription(
    userId: string,
    guildId: string,
    newTier: SubscriptionTier,
    newPeriod: PeriodType,
    _paymentMethodId?: string
  ): Promise<SubscriptionUpgradeResult> {
    try {
      // Get current subscription
      const currentSubscription = await this.getSubscriptionStatus(userId, guildId);

      // Validate upgrade
      if (currentSubscription.tier === newTier) {
        return {
          success: false,
          error: 'Already on requested tier'
        };
      }

      // Calculate pricing
      const _pricing = await this.billingUseCase.calculatePricing(
        newTier,
        newPeriod,
        userId
      );

      // Get the current subscription to pass to processUpgrade
      const subscriptionResult = await this.featureUseCase.getSubscriptionDetails(userId, guildId);
      if (!subscriptionResult.subscription) {
        return {
          success: false,
          error: 'Current subscription not found'
        };
      }
      const subscriptionDetails = subscriptionResult.subscription;

      // Create mock customer data (in real implementation, would fetch from database)
      const customerData = {
        email: `${userId}@example.com`,
        name: `User ${userId}`
      };

      // Process upgrade
      const upgradeResult = await this.billingUseCase.processUpgrade(
        subscriptionDetails,
        newTier,
        customerData
      );

      if (upgradeResult.success && upgradeResult.billingCalculation) {
        return {
          success: true,
          subscription: subscriptionDetails, // Would be updated subscription
          billing: {
            chargedAmount: upgradeResult.billingCalculation.totalPrice,
            prorationAmount: upgradeResult.billingCalculation.prorationAmount || 0,
            nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
          }
        };
      }

      return {
        success: false,
        error: upgradeResult.error || 'Upgrade failed'
      };

    } catch (error) {
      logger.error({ error, guildId, targetTier: newTier }, 'Subscription upgrade failed');
      return {
        success: false,
        error: 'Service error'
      };
    }
  }

  /**
   * Downgrade subscription
   */
  async downgradeSubscription(
    userId: string,
    guildId: string,
    newTier: SubscriptionTier,
    _reason: string
  ): Promise<{ success: boolean; effectiveDate?: Date; creditAmount?: number; error?: string }> {
    try {
      // Get current subscription
      const subscriptionResult = await this.featureUseCase.getSubscriptionDetails(userId, guildId);
      if (!subscriptionResult.subscription) {
        return {
          success: false,
          error: 'Current subscription not found'
        };
      }

      const result = await this.billingUseCase.processDowngrade(
        subscriptionResult.subscription,
        newTier
      );

      return {
        success: result.success,
        effectiveDate: new Date(), // Would be calculated based on billing cycle
        creditAmount: result.refundAmount,
        error: result.error
      };

    } catch (error) {
      logger.error({ error, guildId, targetTier: newTier }, 'Subscription downgrade failed');
      return {
        success: false,
        error: 'Service error'
      };
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    userId: string,
    guildId: string,
    reason: string,
    immediate: boolean = false
  ): Promise<{
    success: boolean;
    cancellationDate?: Date;
    refundAmount?: number;
    error?: string;
  }> {
    try {
      // Get current subscription
      const subscriptionResult = await this.featureUseCase.getSubscriptionDetails(userId, guildId);
      if (!subscriptionResult.subscription) {
        return {
          success: false,
          error: 'Current subscription not found'
        };
      }

      const result = await this.billingUseCase.cancelSubscription(
        subscriptionResult.subscription,
        reason
      );

      return {
        success: result.success,
        cancellationDate: immediate ? new Date() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        refundAmount: result.refundAmount,
        error: result.error
      };

    } catch (error) {
      logger.error({ error, guildId }, 'Subscription cancellation failed');
      return {
        success: false,
        error: 'Service error'
      };
    }
  }

  /**
   * Get detailed subscription status
   */
  async getSubscriptionStatus(userId: string, guildId: string): Promise<SubscriptionStatus> {
    try {
      // Get subscription details
      const subscriptionResult = await this.featureUseCase.getSubscriptionDetails(userId, guildId);

      if (!subscriptionResult.subscription) {
        return this.getFreeSubscriptionStatus();
      }

      const subscription = subscriptionResult.subscription;

      // Calculate days remaining
      const now = new Date();
      const expiresAt = subscription.nextBillingAt || subscription.trialEndsAt;
      const daysRemaining = expiresAt ?
        Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : -1;

      // Get usage statistics
      const usage = await this.getUsageStatistics(userId, guildId);

      // Extract feature names from feature details
      const featureNames = subscriptionResult.features
        .filter(f => f.available)
        .map(f => f.name);

      return {
        isActive: subscription.isActive,
        tier: subscription.tier,
        billingPeriod: subscription.billingPeriod.type,
        expiresAt: subscription.nextBillingAt || subscription.trialEndsAt,
        isInTrial: subscription.isOnTrial,
        trialEndsAt: subscription.trialEndsAt,
        daysRemaining,
        autoRenewal: subscription.billingPeriod.isRecurring,
        features: featureNames,
        usage
      };

    } catch (error) {
      logger.error({ error, guildId }, 'Failed to get subscription status');
      return this.getFreeSubscriptionStatus();
    }
  }

  /**
   * Convert trial to paid subscription
   */
  async convertTrialToPaid(
    userId: string,
    guildId: string,
    billingPeriod: PeriodType,
    paymentMethodId: string
  ): Promise<{ success: boolean; subscription?: FeatureSubscription; error?: string }> {
    try {
      // Get current trial subscription
      const subscriptionResult = await this.featureUseCase.getSubscriptionDetails(userId, guildId);
      if (!subscriptionResult.subscription) {
        return {
          success: false,
          error: 'Trial subscription not found'
        };
      }
      const subscription = subscriptionResult.subscription;

      // Create customer data
      const customerData = {
        email: `${userId}@example.com`,
        name: `User ${userId}`
      };

      const result = await this.billingUseCase.convertTrialToPaid(
        subscription,
        paymentMethodId,
        customerData
      );

      return {
        success: result.success,
        subscription: result.success ? subscription : undefined, // Would be updated subscription
        error: result.error
      };

    } catch (error) {
      logger.error({ error, guildId }, 'Trial conversion failed');
      return {
        success: false,
        error: 'Service error'
      };
    }
  }

  /**
   * Get subscription recommendations
   */
  async getSubscriptionRecommendations(
    userId: string,
    guildId: string
  ): Promise<{
    currentTier: SubscriptionTier;
    recommendedTier?: SubscriptionTier;
    recommendations: {
      tier: SubscriptionTier;
      reason: string;
      potentialSavings?: number;
      additionalFeatures: string[];
    }[];
  }> {
    try {
      const current = await this.getSubscriptionStatus(userId, guildId);
      const usage = await this.analyzeUsagePatterns(userId, guildId);

      const recommendations = this.generateRecommendations(current, usage);

      return {
        currentTier: current.tier,
        recommendedTier: recommendations[0]?.tier,
        recommendations
      };

    } catch (error) {
      logger.error({ error, guildId }, 'Failed to get recommendations');
      return {
        currentTier: 'free',
        recommendations: []
      };
    }
  }

  /**
   * Get billing history
   */
  async getBillingHistory(
    userId: string,
    limit: number = 10
  ): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    billingRecords: any[];
    totalSpent: number;
    nextBillingDate?: Date;
    paymentFailures: number;
  }> {
    try {
      const history = await this.billingUseCase.getBillingHistory(userId, limit);

      return {
        billingRecords: history.billingRecords,
        totalSpent: history.totalSpent,
        nextBillingDate: history.nextBillingDate,
        paymentFailures: history.billingRecords.filter(r => r.status === 'failed').length
      };

    } catch (error) {
      logger.error({ error, userId }, 'Failed to get billing history');
      return {
        billingRecords: [],
        totalSpent: 0,
        paymentFailures: 0
      };
    }
  }

  // Private helper methods

  private async checkTrialEligibility(userId: string, tier: SubscriptionTier): Promise<boolean> {
    // Check if user has already used a trial for this tier
    const history = await this.getBillingHistory(userId, 50);
    const hasUsedTrial = history.billingRecords.some(record =>
      record.metadata?.isTrialStarted && record.metadata?.tier === tier
    );

    return !hasUsedTrial;
  }

  private async getPromotionalPlans(_userId: string): Promise<SubscriptionPlan[]> {
    // Implementation would fetch user-specific promotional offers
    return [];
  }

  private getFeatureList(tier: SubscriptionTier): string[] {
    const features = {
      free: ['Basic playback', 'YouTube support', 'Basic queue'],
      basic: ['Spotify integration', 'High quality audio', 'Lyrics display'],
      premium: ['Apple Music', 'Lossless audio', 'Advanced features'],
      enterprise: ['All features', 'Analytics', 'API access']
    };

    return features[tier] || [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getQuotaLimits(tier: SubscriptionTier): any {
    const quotas = {
      free: { queueSize: 50, monthlyPlaytime: 36000, concurrentSessions: 1, apiCallsPerDay: 100 },
      basic: { queueSize: 100, monthlyPlaytime: 108000, concurrentSessions: 2, apiCallsPerDay: 500 },
      premium: { queueSize: 500, monthlyPlaytime: 432000, concurrentSessions: 5, apiCallsPerDay: 2000 },
      enterprise: { queueSize: 1000, monthlyPlaytime: -1, concurrentSessions: -1, apiCallsPerDay: -1 }
    };

    return quotas[tier] || quotas.free;
  }

  private getFreeSubscriptionStatus(): SubscriptionStatus {
    return {
      isActive: true,
      tier: 'free',
      billingPeriod: 'monthly',
      expiresAt: null,
      isInTrial: false,
      trialEndsAt: null,
      daysRemaining: -1,
      autoRenewal: false,
      features: this.getFeatureList('free'),
      usage: {
        currentQuotas: { queueSize: 0, monthlyPlaytime: 0 },
        limits: { queueSize: 50, monthlyPlaytime: 36000 },
        utilizationPercentage: 0
      }
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getUsageStatistics(userId: string, _guildId: string): Promise<any> {
    // Get usage data from feature use case
    const usageStats = await this.featureUseCase.getUsageAnalytics(userId, 'month');

    const quotaLimits = this.getQuotaLimits('premium'); // Would get actual tier
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const utilization = Object.entries(usageStats.featureUsage || {}).reduce((acc, [key, value]: [string, any]) => {
      const limit = quotaLimits[key];
      if (limit > 0) {
        acc[key] = (value / limit) * 100;
      }
      return acc;
    }, {} as Record<string, number>);

    const avgUtilization = Object.values(utilization).length > 0 ?
      Object.values(utilization).reduce((sum, val) => sum + val, 0) / Object.values(utilization).length : 0;

    return {
      currentQuotas: usageStats.featureUsage || {},
      limits: quotaLimits,
      utilizationPercentage: Math.round(avgUtilization)
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async analyzeUsagePatterns(userId: string, guildId: string): Promise<any> {
    // Analyze user behavior to generate recommendations
    const stats = await this.getUsageStatistics(userId, guildId);

    return {
      heavyUsage: stats.utilizationPercentage > 80,
      lightUsage: stats.utilizationPercentage < 20,
      growingUsage: true, // Would calculate trend
      preferredFeatures: [] // Would analyze most used features
    };
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generateRecommendations(current: SubscriptionStatus, usage: any): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recommendations: any[] = [];

    if (current.tier === 'free' && usage.heavyUsage) {
      recommendations.push({
        tier: 'basic',
        reason: 'Heavy usage detected - upgrade for higher limits',
        additionalFeatures: ['Spotify integration', 'Higher quality audio']
      });
    }

    if (current.tier === 'basic' && usage.heavyUsage) {
      recommendations.push({
        tier: 'premium',
        reason: 'Approaching limits - premium offers better value',
        additionalFeatures: ['Lossless audio', 'Apple Music', 'Advanced features']
      });
    }

    if (current.tier === 'premium' && usage.lightUsage) {
      recommendations.push({
        tier: 'basic',
        reason: 'Low usage - consider downgrading to save money',
        potentialSavings: 5.00
      });
    }

    return recommendations;
  }
}