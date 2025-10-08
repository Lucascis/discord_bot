/**
 * Premium Feature Management Use Case
 * Orchestrates premium feature access, usage tracking, and intelligent recommendations
 */

import { SubscriptionTier } from '@discord-bot/config';
import { FeatureName, FeatureGate } from '../../domain/value-objects/feature-gate.js';
import { PremiumFeature, FeatureCategory } from '../../domain/entities/premium-feature.js';
import { FeatureSubscription } from '../../domain/entities/feature-subscription.js';
import { UsageAnalytics, UsageEvent, UsageEventType } from '../../domain/entities/usage-analytics';
import { FeatureAccessDomainService, AccessCheckResult } from '../../domain/services/feature-access-domain-service.js';

// Re-export for external use
export type { AccessCheckResult };

export interface PremiumFeatureRepository {
  findByName(featureName: FeatureName): Promise<PremiumFeature | null>;
  findByCategory(category: FeatureCategory): Promise<PremiumFeature[]>;
  findByTier(tier: SubscriptionTier): Promise<PremiumFeature[]>;
  findAll(): Promise<PremiumFeature[]>;
  save(feature: PremiumFeature): Promise<void>;
  updateUsageMetrics(featureName: FeatureName, usageCount: number): Promise<void>;
}

export interface FeatureSubscriptionRepository {
  findByUserAndGuild(userId: string, guildId: string): Promise<FeatureSubscription | null>;
  findByUserId(userId: string): Promise<FeatureSubscription[]>;
  save(subscription: FeatureSubscription): Promise<void>;
  findExpiring(days: number): Promise<FeatureSubscription[]>;
}

export interface AnalyticsRepository {
  save(analytics: UsageAnalytics): Promise<void>;
  findByTimeframe(start: Date, end: Date): Promise<UsageAnalytics | null>;
  recordEvent(event: UsageEvent): Promise<void>;
}

export interface NotificationService {
  sendFeatureAccessGranted(userId: string, feature: FeatureName): Promise<void>;
  sendFeatureAccessDenied(userId: string, feature: FeatureName, reason: string): Promise<void>;
  sendUpgradeRecommendation(userId: string, recommendations: string[]): Promise<void>;
  sendUsageLimitWarning(userId: string, feature: FeatureName, remainingUsage: number): Promise<void>;
}

export class PremiumFeatureManagementUseCase {
  constructor(
    private readonly featureRepository: PremiumFeatureRepository,
    private readonly subscriptionRepository: FeatureSubscriptionRepository,
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly notificationService: NotificationService,
    private readonly featureAccessService: FeatureAccessDomainService
  ) {}

  /**
   * Check if user has access to a specific feature
   */
  async checkFeatureAccess(
    userId: string,
    guildId: string,
    featureName: FeatureName,
    requestContext?: { userAgent?: string; connectionType?: string }
  ): Promise<AccessCheckResult & { accessGranted: boolean }> {
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    const userTier = subscription?.tier || 'free';

    // Get current usage for the feature
    const usageRecord = subscription?.getFeatureUsage(featureName);
    const usageCount = usageRecord?.usageCount || 0;
    const dailyUsageCount = usageRecord?.dailyUsageCount || 0;

    // Perform access check
    const accessResult = this.featureAccessService.checkFeatureAccess(
      featureName,
      userTier,
      subscription,
      usageCount,
      dailyUsageCount
    );

    // Record analytics event
    await this.recordFeatureAccessEvent(userId, guildId, featureName, userTier, accessResult.hasAccess);

    // Send notifications based on result
    if (accessResult.hasAccess) {
      await this.notificationService.sendFeatureAccessGranted(userId, featureName);
    } else {
      await this.notificationService.sendFeatureAccessDenied(userId, featureName, accessResult.reason);

      // Send upgrade recommendation if applicable
      if (accessResult.upgradeRequired) {
        const recommendations = [`Upgrade to ${accessResult.upgradeRequired} to access ${featureName}`];
        await this.notificationService.sendUpgradeRecommendation(userId, recommendations);
      }
    }

    return {
      ...accessResult,
      accessGranted: accessResult.hasAccess
    };
  }

  /**
   * Record feature usage and update metrics
   */
  async recordFeatureUsage(
    userId: string,
    guildId: string,
    featureName: FeatureName,
    amount: number = 1
  ): Promise<{ success: boolean; remainingUsage?: number; warning?: string }> {
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    if (!subscription || !subscription.isActive) {
      return { success: false };
    }

    try {
      // Record usage in subscription
      subscription.recordFeatureUsage(featureName, amount);
      await this.subscriptionRepository.save(subscription);

      // Update feature metrics
      await this.featureRepository.updateUsageMetrics(featureName, amount);

      // Record analytics event
      await this.recordUsageEvent(userId, guildId, featureName, subscription.tier, amount);

      // Check for usage warnings
      const usageRecord = subscription.getFeatureUsage(featureName);
      if (usageRecord) {
        const remainingUsage = usageRecord.quota.getRemaining();
        const usagePercentage = usageRecord.quota.getUsagePercentage();

        // Send warning if approaching limit
        if (usagePercentage > 80 && remainingUsage > 0) {
          await this.notificationService.sendUsageLimitWarning(
            userId,
            featureName,
            remainingUsage
          );
          return {
            success: true,
            remainingUsage,
            warning: `Approaching usage limit: ${remainingUsage} remaining`
          };
        }

        return { success: true, remainingUsage };
      }

      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Get available features for a user's subscription tier
   */
  async getAvailableFeatures(userId: string, guildId: string): Promise<{
    availableFeatures: PremiumFeature[];
    restrictedFeatures: PremiumFeature[];
    recommendations: string[];
  }> {
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    const userTier = subscription?.tier || 'free';

    const allFeatures = await this.featureRepository.findAll();
    const availableFeatures: PremiumFeature[] = [];
    const restrictedFeatures: PremiumFeature[] = [];

    for (const feature of allFeatures) {
      if (feature.isAvailableForTier(userTier)) {
        availableFeatures.push(feature);
      } else {
        restrictedFeatures.push(feature);
      }
    }

    // Generate recommendations based on usage patterns
    const recommendations = await this.generateFeatureRecommendations(userId, guildId, userTier);

    return {
      availableFeatures,
      restrictedFeatures,
      recommendations
    };
  }

  /**
   * Get feature usage statistics for a user
   */
  async getFeatureUsageStats(userId: string, guildId: string): Promise<{
    totalUsage: number;
    featureBreakdown: Map<FeatureName, number>;
    efficiency: { score: number; underused: FeatureName[]; recommendations: string[] };
    trendsAnalysis: { growing: FeatureName[]; declining: FeatureName[] };
  }> {
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    if (!subscription) {
      return {
        totalUsage: 0,
        featureBreakdown: new Map(),
        efficiency: { score: 0, underused: [], recommendations: [] },
        trendsAnalysis: { growing: [], declining: [] }
      };
    }

    const featureBreakdown = new Map<FeatureName, number>();
    let totalUsage = 0;

    // Calculate usage breakdown
    for (const featureName of subscription.getAvailableFeatures()) {
      const usage = subscription.getFeatureUsage(featureName);
      if (usage) {
        featureBreakdown.set(featureName, usage.usageCount);
        totalUsage += usage.usageCount;
      }
    }

    // Calculate efficiency
    const efficiency = this.featureAccessService.calculateUsageEfficiency(
      subscription,
      featureBreakdown
    );

    // Analyze trends (simplified)
    const trendsAnalysis = await this.analyzeTrends(userId, guildId);

    return {
      totalUsage,
      featureBreakdown,
      efficiency,
      trendsAnalysis
    };
  }

  /**
   * Validate feature bundle access
   */
  async validateFeatureBundleAccess(
    userId: string,
    guildId: string,
    features: FeatureName[]
  ): Promise<{
    bundleName: string;
    accessibleFeatures: FeatureName[];
    restrictedFeatures: FeatureName[];
    partialAccess: boolean;
    upgradeRequired?: SubscriptionTier;
  }> {
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    const userTier = subscription?.tier || 'free';

    const bundleAccess = this.featureAccessService.validateFeatureBundleAccess(features, userTier);

    // Determine required upgrade tier
    let upgradeRequired: SubscriptionTier | undefined;
    if (bundleAccess.restrictedFeatures.length > 0) {
      upgradeRequired = this.featureAccessService.getMinimumTierForFeatures(
        bundleAccess.restrictedFeatures
      );
    }

    return {
      bundleName: bundleAccess.bundleName,
      accessibleFeatures: bundleAccess.accessibleFeatures,
      restrictedFeatures: bundleAccess.restrictedFeatures,
      partialAccess: bundleAccess.partialAccess,
      upgradeRequired
    };
  }

  /**
   * Process feature access analytics
   */
  async processFeatureAnalytics(timeframe: 'day' | 'week' | 'month'): Promise<{
    totalEvents: number;
    popularFeatures: FeatureName[];
    conversionInsights: { feature: FeatureName; conversionRate: number }[];
    recommendations: string[];
  }> {
    const now = new Date();
    let startDate: Date;

    switch (timeframe) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    const analytics = await this.analyticsRepository.findByTimeframe(startDate, now);
    if (!analytics) {
      return {
        totalEvents: 0,
        popularFeatures: [],
        conversionInsights: [],
        recommendations: []
      };
    }

    const popularFeatures = analytics.getMostPopularFeatures(5)
      .map(stat => stat.featureName);

    const conversionInsights = Array.from(analytics.featureStats.entries())
      .map(([feature, stats]) => ({
        feature,
        conversionRate: stats.conversionRate
      }))
      .sort((a, b) => b.conversionRate - a.conversionRate)
      .slice(0, 10);

    const recommendations = [
      'Focus marketing on high-conversion features',
      'Improve onboarding for popular features',
      'Consider feature bundling for better value perception'
    ];

    return {
      totalEvents: analytics.totalEvents,
      popularFeatures,
      conversionInsights,
      recommendations
    };
  }

  /**
   * Manage feature rollout and A/B testing
   */
  async manageFeatureRollout(
    featureName: FeatureName,
    rolloutPercentage: number,
    targetTiers: SubscriptionTier[]
  ): Promise<{ success: boolean; affectedUsers: number; message: string }> {
    const feature = await this.featureRepository.findByName(featureName);
    if (!feature) {
      return { success: false, affectedUsers: 0, message: 'Feature not found' };
    }

    // Update feature status based on rollout
    if (rolloutPercentage === 0) {
      feature.updateStatus('deprecated');
    } else if (rolloutPercentage < 100) {
      feature.updateStatus('beta');
    } else {
      feature.updateStatus('active');
    }

    await this.featureRepository.save(feature);

    // Calculate affected users (simplified)
    const affectedUsers = Math.floor(rolloutPercentage * 10); // Placeholder calculation

    return {
      success: true,
      affectedUsers,
      message: `Feature ${featureName} rolled out to ${rolloutPercentage}% of ${targetTiers.join(', ')} users`
    };
  }

  private async recordFeatureAccessEvent(
    userId: string,
    guildId: string,
    featureName: FeatureName,
    tier: SubscriptionTier,
    accessGranted: boolean
  ): Promise<void> {
    const event: UsageEvent = {
      id: `access_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'feature_used',
      userId,
      guildId,
      tier,
      featureName,
      metadata: { accessGranted },
      timestamp: new Date()
    };

    await this.analyticsRepository.recordEvent(event);
  }

  private async recordUsageEvent(
    userId: string,
    guildId: string,
    featureName: FeatureName,
    tier: SubscriptionTier,
    amount: number
  ): Promise<void> {
    const event: UsageEvent = {
      id: `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'feature_used',
      userId,
      guildId,
      tier,
      featureName,
      metadata: { amount },
      timestamp: new Date()
    };

    await this.analyticsRepository.recordEvent(event);
  }

  private async generateFeatureRecommendations(
    userId: string,
    guildId: string,
    userTier: SubscriptionTier
  ): Promise<string[]> {
    const recommendations: string[] = [];

    // Get user's current subscription features
    const tierFeatures = await this.featureRepository.findByTier(userTier);
    const underutilizedFeatures = tierFeatures.filter(feature =>
      feature.metrics && feature.metrics.totalUsage < 5
    );

    if (underutilizedFeatures.length > 0) {
      recommendations.push(`Explore unused features: ${underutilizedFeatures.map(f => f.displayName).join(', ')}`);
    }

    // Suggest tier upgrades based on blocked attempts
    if (userTier !== 'enterprise') {
      const nextTier = this.getNextTier(userTier);
      recommendations.push(`Upgrade to ${nextTier} for advanced features`);
    }

    return recommendations;
  }

  private async analyzeTrends(userId: string, guildId: string): Promise<{
    growing: FeatureName[];
    declining: FeatureName[];
  }> {
    // Simplified trend analysis
    // In a real implementation, this would analyze historical usage data
    return {
      growing: ['ai_recommendations', 'voice_commands'],
      declining: ['advanced_search']
    };
  }

  private getNextTier(currentTier: SubscriptionTier): SubscriptionTier {
    const tiers: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const currentIndex = tiers.indexOf(currentTier);
    return tiers[currentIndex + 1] || 'enterprise';
  }

  /**
   * Get feature recommendations for user
   */
  async getFeatureRecommendations(
    userId: string,
    guildId: string
  ): Promise<{
    recommendations: Array<{
      feature: FeatureName;
      reason: string;
      benefit: string;
      tier: SubscriptionTier;
    }>;
  }> {
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    const currentTier = subscription?.tier || 'free';

    // Simplified recommendation logic
    const recommendations = [
      {
        feature: 'high_quality_audio' as FeatureName,
        reason: 'Enhanced audio experience',
        benefit: 'Crystal clear sound quality',
        tier: 'basic' as SubscriptionTier
      },
      {
        feature: 'ai_recommendations' as FeatureName,
        reason: 'Personalized music discovery',
        benefit: 'AI-powered music suggestions',
        tier: 'premium' as SubscriptionTier
      }
    ];

    return { recommendations };
  }

  /**
   * Check feature rollout status
   */
  async checkFeatureRollout(
    featureName: FeatureName,
    userId: string
  ): Promise<{
    isRolledOut: boolean;
    rolloutPercentage: number;
    reason: string;
  }> {
    // Simplified rollout logic
    const rolloutFeatures = new Set(['ai_recommendations', 'voice_commands']);
    const isRolledOut = rolloutFeatures.has(featureName);

    return {
      isRolledOut,
      rolloutPercentage: isRolledOut ? 100 : 0,
      reason: isRolledOut ? 'Feature fully rolled out' : 'Feature not yet available'
    };
  }

  /**
   * Get subscription details
   */
  async getSubscriptionDetails(
    userId: string,
    guildId: string
  ): Promise<{
    subscription: FeatureSubscription | null;
    features: Array<{
      name: FeatureName;
      available: boolean;
      usageRemaining?: number;
    }>;
  }> {
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    const features = await this.featureRepository.findAll();

    const featureDetails = features.map(feature => ({
      name: feature.name,
      available: subscription?.hasFeatureAccess(feature.name) || false,
      usageRemaining: subscription?.getFeatureUsage(feature.name)?.quota.getRemaining()
    }));

    return {
      subscription,
      features: featureDetails
    };
  }

  /**
   * Get usage analytics
   */
  async getUsageAnalytics(
    userId: string,
    timeframe: 'day' | 'week' | 'month'
  ): Promise<{
    totalUsage: number;
    featureUsage: Record<string, number>;
    trends: Array<{
      feature: string;
      change: number;
      direction: 'up' | 'down' | 'stable';
    }>;
  }> {
    // Simplified analytics - in real implementation would query actual usage data
    const mockAnalytics = {
      totalUsage: 150,
      featureUsage: {
        high_quality_audio: 50,
        ai_recommendations: 30,
        advanced_search: 25,
        voice_commands: 20,
        custom_branding: 15,
        lyrics_display: 10
      },
      trends: [
        { feature: 'ai_recommendations', change: 15, direction: 'up' as const },
        { feature: 'voice_commands', change: 10, direction: 'up' as const },
        { feature: 'advanced_search', change: -5, direction: 'down' as const }
      ]
    };

    return mockAnalytics;
  }
}