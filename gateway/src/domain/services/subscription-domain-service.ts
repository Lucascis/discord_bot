/**
 * Subscription Domain Service
 * Contains domain logic for subscription management, upgrades, downgrades, and trials
 */

import { SubscriptionTier } from '@discord-bot/config';
import { Customer } from '../entities/customer.js';
import { FeatureSubscription, SubscriptionStatus } from '../entities/feature-subscription.js';
import { PaymentPlan } from '../entities/payment-plan.js';
import { BillingPeriod, PeriodType } from '../value-objects/billing-period.js';
import { FeatureName } from '../value-objects/feature-gate.js';
import { UsageQuota, QuotaType } from '../value-objects/usage-quota.js';

export interface SubscriptionChangeResult {
  readonly success: boolean;
  readonly newTier: SubscriptionTier;
  readonly proratedAmount: number;
  readonly effectiveDate: Date;
  readonly reason?: string;
  readonly nextBillingDate: Date | null;
}

export interface TrialEligibilityResult {
  readonly eligible: boolean;
  readonly reason: string;
  readonly trialLength: number;
  readonly availableFeatures: FeatureName[];
}

export interface SubscriptionRecommendation {
  readonly recommendedTier: SubscriptionTier;
  readonly confidence: number; // 0-100
  readonly reasons: string[];
  readonly potentialSavings: number;
  readonly upgradeIncentives: string[];
}

export class SubscriptionDomainService {

  /**
   * Determines if a tier upgrade is valid
   */
  isValidUpgrade(currentTier: SubscriptionTier, targetTier: SubscriptionTier): boolean {
    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const currentIndex = tierOrder.indexOf(currentTier);
    const targetIndex = tierOrder.indexOf(targetTier);

    return targetIndex > currentIndex;
  }

  /**
   * Determines if a tier downgrade is valid
   */
  isValidDowngrade(currentTier: SubscriptionTier, targetTier: SubscriptionTier): boolean {
    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const currentIndex = tierOrder.indexOf(currentTier);
    const targetIndex = tierOrder.indexOf(targetTier);

    return targetIndex < currentIndex;
  }

  /**
   * Calculates subscription change result including prorations
   */
  calculateSubscriptionChange(
    currentSubscription: FeatureSubscription,
    targetTier: SubscriptionTier,
    newBillingPeriod: BillingPeriod,
    changeDate: Date = new Date()
  ): SubscriptionChangeResult {
    const isUpgrade = this.isValidUpgrade(currentSubscription.tier, targetTier);
    const isDowngrade = this.isValidDowngrade(currentSubscription.tier, targetTier);

    if (!isUpgrade && !isDowngrade && currentSubscription.tier !== targetTier) {
      return {
        success: false,
        newTier: currentSubscription.tier,
        proratedAmount: 0,
        effectiveDate: changeDate,
        reason: `Invalid tier change from ${currentSubscription.tier} to ${targetTier}`,
        nextBillingDate: null
      };
    }

    // Calculate proration for billing period change
    const currentBillingPeriod = currentSubscription.billingPeriod;
    let proratedAmount = 0;

    if (currentBillingPeriod.allowsProration()) {
      // Simplified proration calculation
      const daysInPeriod = currentBillingPeriod.type === 'monthly' ? 30 : 90;
      const daysSinceLastBilling = Math.floor(
        (changeDate.getTime() - currentSubscription.lastBillingAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      const remainingDays = Math.max(0, daysInPeriod - daysSinceLastBilling);

      const currentDailyRate = currentBillingPeriod.getTotalPrice() / daysInPeriod;
      const newDailyRate = newBillingPeriod.getTotalPrice() / daysInPeriod;

      proratedAmount = (newDailyRate - currentDailyRate) * remainingDays;
    } else {
      proratedAmount = newBillingPeriod.getTotalPrice();
    }

    const nextBillingDate = newBillingPeriod.getNextBillingDate(changeDate);

    return {
      success: true,
      newTier: targetTier,
      proratedAmount: Math.max(0, proratedAmount),
      effectiveDate: changeDate,
      nextBillingDate
    };
  }

  /**
   * Checks trial eligibility for a user
   */
  checkTrialEligibility(
    customer: Customer,
    targetTier: SubscriptionTier,
    hasUsedTrialBefore: boolean = false
  ): TrialEligibilityResult {
    // Free tier users can't trial "down"
    if (targetTier === 'free') {
      return {
        eligible: false,
        reason: 'Free tier is not eligible for trial',
        trialLength: 0,
        availableFeatures: []
      };
    }

    // Users who already used trial are not eligible
    if (hasUsedTrialBefore) {
      return {
        eligible: false,
        reason: 'Trial already used for this tier',
        trialLength: 0,
        availableFeatures: []
      };
    }

    // Must be upgrading to a higher tier
    if (!this.isValidUpgrade(customer.subscriptionPlan.type as SubscriptionTier, targetTier)) {
      return {
        eligible: false,
        reason: 'Trial only available for tier upgrades',
        trialLength: 0,
        availableFeatures: []
      };
    }

    // Determine trial length based on target tier
    const trialLengths = {
      basic: 7,
      premium: 14,
      enterprise: 30
    };

    // Get available features for trial tier
    const trialFeatures = this.getTrialFeatures(targetTier);

    return {
      eligible: true,
      reason: `Eligible for ${targetTier} trial`,
      trialLength: trialLengths[targetTier] || 14,
      availableFeatures: trialFeatures
    };
  }

  /**
   * Validates subscription status transitions
   */
  isValidStatusTransition(
    currentStatus: SubscriptionStatus,
    newStatus: SubscriptionStatus
  ): boolean {
    const validTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
      'pending': ['active', 'cancelled', 'expired'],
      'active': ['suspended', 'cancelled', 'expired'],
      'suspended': ['active', 'cancelled', 'expired'],
      'cancelled': ['pending'],
      'expired': ['pending', 'active'],
      'trial': ['active', 'cancelled', 'expired']
    };

    return validTransitions[currentStatus]?.includes(newStatus) ?? false;
  }

  /**
   * Calculates subscription value score for a customer
   */
  calculateSubscriptionValue(
    subscription: FeatureSubscription,
    monthlyUsage: Map<FeatureName, number>,
    monthlyPlaytime: number
  ): number {
    let valueScore = 0;

    // Base value from tier
    const tierValues = { free: 0, basic: 25, premium: 50, enterprise: 100 };
    valueScore += tierValues[subscription.tier] || 0;

    // Usage-based value
    const usageValue = Array.from(monthlyUsage.values()).reduce((sum, usage) => sum + usage, 0);
    valueScore += Math.min(25, usageValue / 10); // Cap at 25 points

    // Playtime value (premium audio features)
    const playtimeHours = monthlyPlaytime / (1000 * 60 * 60);
    valueScore += Math.min(25, playtimeHours / 2); // Cap at 25 points

    return Math.min(100, valueScore);
  }

  /**
   * Generates subscription recommendations based on usage patterns
   */
  generateRecommendation(
    customer: Customer,
    monthlyUsage: Map<FeatureName, number>,
    monthlyPlaytime: number,
    averageSessionDuration: number
  ): SubscriptionRecommendation {
    const currentTier = customer.subscriptionPlan.type as SubscriptionTier;
    const usageScore = this.calculateSubscriptionValue(
      { tier: currentTier } as FeatureSubscription,
      monthlyUsage,
      monthlyPlaytime
    );

    let recommendedTier: SubscriptionTier = currentTier;
    let confidence = 70;
    const reasons: string[] = [];
    let potentialSavings = 0;
    const upgradeIncentives: string[] = [];

    // High usage suggests upgrade
    if (usageScore > 70 && currentTier !== 'enterprise') {
      const tierUpgrades = {
        free: 'basic',
        basic: 'premium',
        premium: 'enterprise'
      };
      recommendedTier = tierUpgrades[currentTier] as SubscriptionTier;
      confidence = 85;
      reasons.push('High feature usage detected');
      upgradeIncentives.push('Unlock unlimited features');
    }

    // Long sessions suggest audio quality upgrade
    if (averageSessionDuration > 3600000 && currentTier === 'free') { // 1 hour
      recommendedTier = 'basic';
      confidence = Math.max(confidence, 80);
      reasons.push('Long listening sessions benefit from higher audio quality');
      upgradeIncentives.push('Experience high-quality audio');
    }

    // Premium audio usage
    if (monthlyPlaytime > 36000000 && currentTier !== 'premium') { // 10 hours
      recommendedTier = 'premium';
      confidence = Math.max(confidence, 90);
      reasons.push('Extensive music usage warrants premium features');
      upgradeIncentives.push('Lossless audio and advanced features');
    }

    // Enterprise usage patterns
    if (customer.guildIds.length > 5 && currentTier !== 'enterprise') {
      recommendedTier = 'enterprise';
      confidence = Math.max(confidence, 95);
      reasons.push('Managing multiple servers benefits from enterprise features');
      upgradeIncentives.push('Unlimited servers and white-label options');
    }

    // Calculate potential savings for yearly billing
    if (currentTier === recommendedTier) {
      const yearlyDiscount = 15; // 15% annual discount
      const monthlyPrice = customer.subscriptionPlan.price;
      potentialSavings = (monthlyPrice * 12 * yearlyDiscount) / 100;
      reasons.push('Switch to annual billing for savings');
    }

    // Low usage suggests downgrade
    if (usageScore < 20 && currentTier !== 'free') {
      const tierDowngrades = {
        enterprise: 'premium',
        premium: 'basic',
        basic: 'free'
      };
      recommendedTier = tierDowngrades[currentTier] as SubscriptionTier;
      confidence = 75;
      reasons.push('Low usage suggests a lower tier might be more appropriate');
    }

    return {
      recommendedTier,
      confidence,
      reasons,
      potentialSavings,
      upgradeIncentives
    };
  }

  /**
   * Determines optimal billing period based on usage and preferences
   */
  getOptimalBillingPeriod(
    currentUsage: number,
    predictedGrowth: number,
    priceFlexibility: 'low' | 'medium' | 'high'
  ): PeriodType {
    // High usage and low price flexibility suggest annual billing
    if (currentUsage > 50 && priceFlexibility === 'low') {
      return 'yearly';
    }

    // Medium to high flexibility with moderate usage suggests quarterly
    if (currentUsage > 25 && priceFlexibility === 'medium') {
      return 'quarterly';
    }

    // High predicted growth suggests shorter periods initially
    if (predictedGrowth > 100) {
      return 'monthly';
    }

    // Default for most users
    return 'monthly';
  }

  /**
   * Calculates churn risk based on usage patterns
   */
  calculateChurnRisk(
    subscription: FeatureSubscription,
    recentUsage: Map<FeatureName, number>,
    daysSinceLastUse: number,
    supportTickets: number
  ): { risk: 'low' | 'medium' | 'high'; score: number; factors: string[] } {
    let riskScore = 0;
    const factors: string[] = [];

    // Usage decline risk
    const totalUsage = Array.from(recentUsage.values()).reduce((sum, usage) => sum + usage, 0);
    if (totalUsage < 5) {
      riskScore += 30;
      factors.push('Very low feature usage');
    } else if (totalUsage < 15) {
      riskScore += 15;
      factors.push('Below average usage');
    }

    // Inactivity risk
    if (daysSinceLastUse > 14) {
      riskScore += 40;
      factors.push('Extended period of inactivity');
    } else if (daysSinceLastUse > 7) {
      riskScore += 20;
      factors.push('Recent inactivity');
    }

    // Support issues risk
    if (supportTickets > 3) {
      riskScore += 25;
      factors.push('Multiple support issues');
    } else if (supportTickets > 1) {
      riskScore += 10;
      factors.push('Recent support issues');
    }

    // Trial ending risk
    if (subscription.isOnTrial && subscription.daysUntilTrialEnd < 3) {
      riskScore += 35;
      factors.push('Trial ending soon');
    }

    let risk: 'low' | 'medium' | 'high' = 'low';
    if (riskScore >= 60) {
      risk = 'high';
    } else if (riskScore >= 30) {
      risk = 'medium';
    }

    return { risk, score: riskScore, factors };
  }

  /**
   * Validates subscription quotas for tier change
   */
  validateQuotasForTierChange(
    currentQuotas: Map<QuotaType, UsageQuota>,
    targetTier: SubscriptionTier
  ): { valid: boolean; violations: string[]; recommendations: string[] } {
    const violations: string[] = [];
    const recommendations: string[] = [];

    for (const [quotaType, quota] of currentQuotas.entries()) {
      const targetQuota = UsageQuota.forTierAndType(targetTier, quotaType);

      // Check if current usage would exceed new tier limits
      if (!targetQuota.isUnlimited && quota.used > targetQuota.limit) {
        violations.push(
          `${quotaType} usage (${quota.used}) exceeds ${targetTier} tier limit (${targetQuota.limit})`
        );
        recommendations.push(
          `Reduce ${quotaType} usage or consider a higher tier`
        );
      }

      // Warn about significant limit reductions
      if (!targetQuota.isUnlimited && !quota.isUnlimited) {
        const reductionPercentage = ((quota.limit - targetQuota.limit) / quota.limit) * 100;
        if (reductionPercentage > 50) {
          recommendations.push(
            `${quotaType} limit will be reduced by ${reductionPercentage.toFixed(0)}%`
          );
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      recommendations
    };
  }

  private getTrialFeatures(tier: SubscriptionTier): FeatureName[] {
    const tierFeatures: Record<SubscriptionTier, FeatureName[]> = {
      free: [],
      basic: ['high_quality_audio', 'lyrics_display', 'advanced_search'],
      premium: ['lossless_audio', 'unlimited_queue', 'ai_recommendations', 'custom_branding'],
      enterprise: ['white_labeling', 'dedicated_support', 'sla_guarantee', 'cross_server_sync']
    };

    return tierFeatures[tier] || [];
  }
}