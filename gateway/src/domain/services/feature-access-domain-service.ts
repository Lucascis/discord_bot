/**
 * Feature Access Domain Service
 * Contains domain logic for premium feature access control and validation
 */

import { SubscriptionTier } from '@discord-bot/config';
import { FeatureGate, FeatureName, FeatureRestriction } from '../value-objects/feature-gate.js';
import { PremiumFeature, FeatureCategory } from '../entities/premium-feature.js';
import { FeatureSubscription } from '../entities/feature-subscription.js';
import { Customer } from '../entities/customer.js';

export interface AccessCheckResult {
  readonly hasAccess: boolean;
  readonly reason: string;
  readonly upgradeRequired?: SubscriptionTier;
  readonly alternativeFeatures: FeatureName[];
  readonly remainingUsage?: number;
  readonly resetTime?: Date;
  readonly quota?: {
    readonly limit: number;
    readonly remaining: number;
    readonly used: number;
    readonly resetTime?: Date;
  };
}

export interface FeatureUsageLimit {
  readonly limit: number;
  readonly period: 'hour' | 'day' | 'month' | 'lifetime';
  readonly current: number;
  readonly exceeded: boolean;
}

export interface FeatureBundleAccess {
  readonly bundleName: string;
  readonly accessibleFeatures: FeatureName[];
  readonly restrictedFeatures: FeatureName[];
  readonly partialAccess: boolean;
  readonly upgradePath: SubscriptionTier[];
}

export class FeatureAccessDomainService {

  /**
   * Performs comprehensive access check for a feature
   */
  checkFeatureAccess(
    featureName: FeatureName,
    userTier: SubscriptionTier,
    subscription: FeatureSubscription | null,
    usageCount: number = 0,
    dailyUsageCount: number = 0
  ): AccessCheckResult {
    const featureGate = FeatureGate.forFeature(featureName, userTier, usageCount, dailyUsageCount);

    // Basic tier access check
    if (!featureGate.canAccessFeature()) {
      return {
        hasAccess: false,
        reason: `Feature requires ${featureGate.restriction.requiredTier} tier or higher`,
        upgradeRequired: featureGate.restriction.requiredTier,
        alternativeFeatures: this.getAlternativeFeatures(featureName, userTier)
      };
    }

    // Check subscription status
    if (subscription && !subscription.isActive) {
      return {
        hasAccess: false,
        reason: 'Subscription is not active',
        alternativeFeatures: this.getFreeAlternatives(featureName)
      };
    }

    // Check usage limits
    if (featureGate.hasExceededLimits()) {
      const remainingUsage = featureGate.getRemainingUsage();
      const remainingDaily = featureGate.getRemainingDailyUsage();

      return {
        hasAccess: false,
        reason: featureGate.getAccessDenialReason() || 'Usage limit exceeded',
        alternativeFeatures: this.getAlternativeFeatures(featureName, userTier),
        remainingUsage: Math.max(remainingUsage, remainingDaily),
        resetTime: this.calculateResetTime(featureName)
      };
    }

    // Beta feature access check
    const restriction = FeatureGate.getRestriction(featureName);
    if (restriction.betaFeature && !this.hasBetaAccess(userTier)) {
      return {
        hasAccess: false,
        reason: 'Beta feature access not available for current tier',
        upgradeRequired: 'premium',
        alternativeFeatures: this.getStableAlternatives(featureName)
      };
    }

    return {
      hasAccess: true,
      reason: 'Access granted',
      alternativeFeatures: [],
      remainingUsage: featureGate.getRemainingUsage()
    };
  }

  /**
   * Validates feature bundle access for a subscription tier
   */
  validateFeatureBundleAccess(
    features: FeatureName[],
    userTier: SubscriptionTier
  ): FeatureBundleAccess {
    const accessibleFeatures: FeatureName[] = [];
    const restrictedFeatures: FeatureName[] = [];

    for (const feature of features) {
      const gate = FeatureGate.forFeature(feature, userTier);
      if (gate.canAccessFeature()) {
        accessibleFeatures.push(feature);
      } else {
        restrictedFeatures.push(feature);
      }
    }

    const partialAccess = accessibleFeatures.length > 0 && restrictedFeatures.length > 0;
    const upgradePath = this.calculateUpgradePath(restrictedFeatures, userTier);

    return {
      bundleName: this.generateBundleName(features),
      accessibleFeatures,
      restrictedFeatures,
      partialAccess,
      upgradePath
    };
  }

  /**
   * Determines the minimum tier required for a set of features
   */
  getMinimumTierForFeatures(features: FeatureName[]): SubscriptionTier {
    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    let requiredTier: SubscriptionTier = 'free';

    for (const feature of features) {
      const restriction = FeatureGate.getRestriction(feature);
      const featureTierIndex = tierOrder.indexOf(restriction.requiredTier);
      const currentTierIndex = tierOrder.indexOf(requiredTier);

      if (featureTierIndex > currentTierIndex) {
        requiredTier = restriction.requiredTier;
      }
    }

    return requiredTier;
  }

  /**
   * Calculates feature usage efficiency score
   */
  calculateUsageEfficiency(
    subscription: FeatureSubscription,
    actualUsage: Map<FeatureName, number>
  ): { score: number; underused: FeatureName[]; overused: FeatureName[]; recommendations: string[] } {
    const underused: FeatureName[] = [];
    const overused: FeatureName[] = [];
    const recommendations: string[] = [];
    let totalEfficiency = 0;
    let featureCount = 0;

    const availableFeatures = subscription.getAvailableFeatures();

    for (const feature of availableFeatures) {
      const usage = actualUsage.get(feature) || 0;
      const featureUsage = subscription.getFeatureUsage(feature);

      if (!featureUsage) continue;

      const quota = featureUsage.quota;
      let efficiency = 0;

      if (quota.isUnlimited) {
        // For unlimited features, efficiency based on usage frequency
        efficiency = Math.min(100, (usage / 50) * 100); // 50 uses = 100% efficiency
      } else {
        // For limited features, efficiency is usage percentage
        efficiency = Math.min(100, (usage / quota.limit) * 100);
      }

      totalEfficiency += efficiency;
      featureCount++;

      if (efficiency < 25) {
        underused.push(feature);
      } else if (efficiency > 90 && !quota.isUnlimited) {
        overused.push(feature);
      }
    }

    // Generate recommendations
    if (underused.length > 0) {
      recommendations.push(`Consider exploring: ${underused.join(', ')}`);
    }

    if (overused.length > 0) {
      recommendations.push(`Consider upgrading for unlimited: ${overused.join(', ')}`);
    }

    const score = featureCount > 0 ? totalEfficiency / featureCount : 0;

    return { score, underused, overused, recommendations };
  }

  /**
   * Suggests feature upgrades based on usage patterns
   */
  suggestFeatureUpgrades(
    currentTier: SubscriptionTier,
    usageHistory: Map<FeatureName, number[]>, // Usage over time
    blockedAttempts: Map<FeatureName, number>
  ): { feature: FeatureName; reason: string; urgency: 'low' | 'medium' | 'high' }[] {
    const suggestions: { feature: FeatureName; reason: string; urgency: 'low' | 'medium' | 'high' }[] = [];

    // Check for frequently blocked features
    for (const [feature, attempts] of blockedAttempts.entries()) {
      if (attempts > 5) {
        const restriction = FeatureGate.getRestriction(feature);
        suggestions.push({
          feature,
          reason: `Blocked ${attempts} times - upgrade to ${restriction.requiredTier} for access`,
          urgency: attempts > 15 ? 'high' : 'medium'
        });
      }
    }

    // Check for trending usage patterns
    for (const [feature, history] of usageHistory.entries()) {
      if (history.length < 3) continue;

      const trend = this.calculateTrend(history);
      if (trend > 50) { // Growing usage
        const gate = FeatureGate.forFeature(feature, currentTier);
        if (!gate.canAccessFeature()) {
          suggestions.push({
            feature,
            reason: `Growing usage trend (+${trend.toFixed(0)}%) - consider upgrading`,
            urgency: trend > 100 ? 'high' : 'medium'
          });
        }
      }
    }

    return suggestions.sort((a, b) => {
      const urgencyOrder = { high: 3, medium: 2, low: 1 };
      return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
    });
  }

  /**
   * Validates feature compatibility with user environment
   */
  validateFeatureCompatibility(
    featureName: FeatureName,
    userAgent: string,
    connectionType: 'wifi' | 'mobile' | 'ethernet',
    deviceCapabilities: { audio: boolean; storage: number; bandwidth: number }
  ): { compatible: boolean; issues: string[]; recommendations: string[] } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Audio quality features require good connection
    if (['lossless_audio', 'spatial_audio'].includes(featureName)) {
      if (connectionType === 'mobile') {
        issues.push('High-quality audio may consume significant mobile data');
        recommendations.push('Connect to Wi-Fi for best experience');
      }

      if (deviceCapabilities.bandwidth < 1000) { // 1 Mbps
        issues.push('Insufficient bandwidth for high-quality audio');
        recommendations.push('Upgrade internet connection or use standard quality');
      }
    }

    // Storage-dependent features
    if (['custom_playlists', 'analytics_access'].includes(featureName)) {
      if (deviceCapabilities.storage < 100) { // 100 MB
        issues.push('Insufficient storage for feature data');
        recommendations.push('Free up device storage');
      }
    }

    // Voice features require audio capabilities
    if (featureName === 'voice_commands' && !deviceCapabilities.audio) {
      issues.push('Voice commands require microphone access');
      recommendations.push('Enable microphone permissions');
    }

    return {
      compatible: issues.length === 0,
      issues,
      recommendations
    };
  }

  /**
   * Calculates feature access priority for resource allocation
   */
  calculateFeaturePriority(
    feature: FeatureName,
    userTier: SubscriptionTier,
    usageFrequency: number,
    systemLoad: number
  ): { priority: number; shouldDegrade: boolean; gracefulDegradation?: FeatureName } {
    let priority = 50; // Base priority

    // Tier-based priority
    const tierPriorities = { free: 10, basic: 25, premium: 50, enterprise: 100 };
    priority += tierPriorities[userTier];

    // Usage-based priority
    priority += Math.min(30, usageFrequency * 2);

    // Feature importance
    const featureImportance = this.getFeatureImportance(feature);
    priority += featureImportance;

    // System load adjustment
    if (systemLoad > 80) {
      priority *= 0.7;
    }

    const shouldDegrade = systemLoad > 90 && priority < 100;
    const gracefulDegradation = shouldDegrade ? this.getGracefulDegradation(feature) : undefined;

    return {
      priority: Math.min(100, priority),
      shouldDegrade,
      gracefulDegradation
    };
  }

  private getAlternativeFeatures(feature: FeatureName, tier: SubscriptionTier): FeatureName[] {
    const alternatives: Partial<Record<FeatureName, FeatureName[]>> = {
      lossless_audio: ['high_quality_audio'],
      spatial_audio: ['high_quality_audio'],
      ai_recommendations: ['advanced_search'],
      voice_commands: ['advanced_search'],
      unlimited_queue: ['queue_management'],
      white_labeling: ['custom_branding'],
      dedicated_support: ['priority_support']
    };

    const possibleAlts = alternatives[feature] || [];
    return possibleAlts.filter(alt => {
      const gate = FeatureGate.forFeature(alt, tier);
      return gate.canAccessFeature();
    });
  }

  private getFreeAlternatives(feature: FeatureName): FeatureName[] {
    return this.getAlternativeFeatures(feature, 'free');
  }

  private getStableAlternatives(feature: FeatureName): FeatureName[] {
    // Return non-beta alternatives
    const stableFeatures: FeatureName[] = [
      'high_quality_audio',
      'lyrics_display',
      'sponsor_block',
      'advanced_search',
      'custom_branding',
      'priority_support',
      'analytics_access'
    ];

    return stableFeatures.filter(f => f !== feature);
  }

  private hasBetaAccess(tier: SubscriptionTier): boolean {
    return tier === 'premium' || tier === 'enterprise';
  }

  private calculateResetTime(feature: FeatureName): Date {
    const restriction = FeatureGate.getRestriction(feature);
    const now = new Date();

    if (restriction.dailyLimit !== undefined && restriction.dailyLimit !== -1) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      return tomorrow;
    }

    // Default to next hour for hourly limits
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour;
  }

  private calculateUpgradePath(features: FeatureName[], currentTier: SubscriptionTier): SubscriptionTier[] {
    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const currentIndex = tierOrder.indexOf(currentTier);
    const requiredTier = this.getMinimumTierForFeatures(features);
    const requiredIndex = tierOrder.indexOf(requiredTier);

    return tierOrder.slice(currentIndex + 1, requiredIndex + 1);
  }

  private generateBundleName(features: FeatureName[]): string {
    if (features.length === 1) {
      return features[0].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    const categories = this.categorizeFeatures(features);
    const mainCategory = Object.keys(categories)[0];
    return `${mainCategory} Features Bundle`;
  }

  private categorizeFeatures(features: FeatureName[]): Record<string, FeatureName[]> {
    const categories: Record<string, FeatureName[]> = {};

    for (const feature of features) {
      const category = this.getFeatureCategory(feature);
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(feature);
    }

    return categories;
  }

  private getFeatureCategory(feature: FeatureName): string {
    const audioFeatures = ['high_quality_audio', 'lossless_audio', 'spatial_audio', 'audio_effects', 'custom_equalizer'];
    const aiFeatures = ['ai_recommendations', 'mood_detection', 'voice_commands'];
    const queueFeatures = ['unlimited_queue', 'playlist_collaboration', 'cross_server_sync'];

    if (audioFeatures.includes(feature)) return 'Audio';
    if (aiFeatures.includes(feature)) return 'AI';
    if (queueFeatures.includes(feature)) return 'Queue';
    return 'Premium';
  }

  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;

    return firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
  }

  private getFeatureImportance(feature: FeatureName): number {
    const importance: Record<FeatureName, number> = {
      // Core features
      high_quality_audio: 30,
      lossless_audio: 25,
      unlimited_queue: 20,
      queue_management: 15,

      // Advanced features
      ai_recommendations: 15,
      custom_branding: 15,
      analytics_access: 15,
      api_access: 20,

      // Audio features
      spatial_audio: 25,
      audio_effects: 15,
      custom_equalizer: 10,

      // Convenience features
      lyrics_display: 10,
      sponsor_block: 10,
      advanced_search: 10,

      // Collaboration features
      playlist_collaboration: 12,
      cross_server_sync: 18,

      // Support features
      priority_support: 15,
      dedicated_support: 15,
      sla_guarantee: 20,

      // Premium features
      white_labeling: 20,

      // Experimental features
      voice_commands: 5,
      mood_detection: 5
    };

    return importance[feature] || 10;
  }

  private getGracefulDegradation(feature: FeatureName): FeatureName | undefined {
    const degradationMap: Partial<Record<FeatureName, FeatureName>> = {
      lossless_audio: 'high_quality_audio',
      spatial_audio: 'high_quality_audio',
      ai_recommendations: 'advanced_search',
      voice_commands: 'advanced_search',
      unlimited_queue: 'queue_management',
      custom_equalizer: 'audio_effects',
      dedicated_support: 'priority_support',
      white_labeling: 'custom_branding'
    };

    return degradationMap[feature];
  }
}