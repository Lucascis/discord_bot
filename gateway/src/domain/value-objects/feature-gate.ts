/**
 * Feature Gate Value Object
 * Controls access to premium features based on subscription tiers
 */

import { SubscriptionTier } from '@discord-bot/config';

export type FeatureName =
  | 'high_quality_audio'
  | 'lossless_audio'
  | 'spatial_audio'
  | 'audio_effects'
  | 'custom_equalizer'
  | 'lyrics_display'
  | 'sponsor_block'
  | 'advanced_search'
  | 'unlimited_queue'
  | 'queue_management'
  | 'playlist_collaboration'
  | 'cross_server_sync'
  | 'ai_recommendations'
  | 'mood_detection'
  | 'voice_commands'
  | 'custom_branding'
  | 'priority_support'
  | 'analytics_access'
  | 'api_access'
  | 'white_labeling'
  | 'dedicated_support'
  | 'sla_guarantee';

export interface FeatureRestriction {
  readonly requiredTier: SubscriptionTier;
  readonly usageLimit?: number;        // -1 for unlimited
  readonly dailyLimit?: number;        // -1 for unlimited
  readonly requiresPayment: boolean;
  readonly betaFeature: boolean;
  readonly description: string;
}

export class FeatureGate {
  private static readonly FEATURE_RESTRICTIONS: Record<FeatureName, FeatureRestriction> = {
    // Audio Quality Features
    high_quality_audio: {
      requiredTier: 'basic',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'High quality audio streaming (320kbps)'
    },
    lossless_audio: {
      requiredTier: 'premium',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Lossless FLAC audio streaming'
    },
    spatial_audio: {
      requiredTier: 'premium',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: true,
      description: '3D spatial audio experience'
    },
    audio_effects: {
      requiredTier: 'basic',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Audio effects and processing'
    },
    custom_equalizer: {
      requiredTier: 'premium',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Custom 31-band equalizer'
    },

    // Content Features
    lyrics_display: {
      requiredTier: 'basic',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Real-time lyrics display'
    },
    sponsor_block: {
      requiredTier: 'free',
      usageLimit: -1,
      requiresPayment: false,
      betaFeature: false,
      description: 'Automatic sponsor segment skipping'
    },
    advanced_search: {
      requiredTier: 'basic',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Advanced search capabilities'
    },

    // Queue Features
    unlimited_queue: {
      requiredTier: 'premium',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Unlimited queue size'
    },
    queue_management: {
      requiredTier: 'basic',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Advanced queue management features'
    },
    playlist_collaboration: {
      requiredTier: 'premium',
      usageLimit: 10,
      dailyLimit: -1,
      requiresPayment: true,
      betaFeature: true,
      description: 'Collaborative playlist management'
    },
    cross_server_sync: {
      requiredTier: 'enterprise',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Synchronize music across servers'
    },

    // AI Features
    ai_recommendations: {
      requiredTier: 'premium',
      usageLimit: 100,
      dailyLimit: -1,
      requiresPayment: true,
      betaFeature: true,
      description: 'AI-powered music recommendations'
    },
    mood_detection: {
      requiredTier: 'enterprise',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: true,
      description: 'Mood-based music selection'
    },
    voice_commands: {
      requiredTier: 'premium',
      usageLimit: 50,
      dailyLimit: -1,
      requiresPayment: true,
      betaFeature: true,
      description: 'Voice command recognition'
    },

    // Branding & Support
    custom_branding: {
      requiredTier: 'premium',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Custom bot branding and avatar'
    },
    priority_support: {
      requiredTier: 'premium',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Priority customer support'
    },

    // Analytics & API
    analytics_access: {
      requiredTier: 'basic',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Advanced usage analytics'
    },
    api_access: {
      requiredTier: 'premium',
      usageLimit: 1000,
      dailyLimit: 10000,
      requiresPayment: true,
      betaFeature: false,
      description: 'REST API access'
    },

    // Enterprise Features
    white_labeling: {
      requiredTier: 'enterprise',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Complete white-label solution'
    },
    dedicated_support: {
      requiredTier: 'enterprise',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: 'Dedicated support representative'
    },
    sla_guarantee: {
      requiredTier: 'enterprise',
      usageLimit: -1,
      requiresPayment: true,
      betaFeature: false,
      description: '99.9% uptime SLA guarantee'
    }
  };

  constructor(
    private readonly _featureName: FeatureName,
    private readonly _userTier: SubscriptionTier,
    private readonly _usageCount: number = 0,
    private readonly _dailyUsageCount: number = 0
  ) {
    this.validateFeature(_featureName);
  }

  get featureName(): FeatureName {
    return this._featureName;
  }

  get userTier(): SubscriptionTier {
    return this._userTier;
  }

  get restriction(): FeatureRestriction {
    return FeatureGate.FEATURE_RESTRICTIONS[this._featureName];
  }

  get usageCount(): number {
    return this._usageCount;
  }

  get dailyUsageCount(): number {
    return this._dailyUsageCount;
  }

  /**
   * Check if user has access to this feature
   */
  hasAccess(): boolean {
    return this.canAccessFeature() && !this.hasExceededLimits();
  }

  /**
   * Check if user tier allows access to feature
   */
  canAccessFeature(): boolean {
    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const requiredTierIndex = tierOrder.indexOf(this.restriction.requiredTier);
    const userTierIndex = tierOrder.indexOf(this._userTier);

    return userTierIndex >= requiredTierIndex;
  }

  /**
   * Check if usage limits have been exceeded
   */
  hasExceededLimits(): boolean {
    const restriction = this.restriction;

    // Check usage limit
    if (restriction.usageLimit !== undefined && restriction.usageLimit !== -1) {
      if (this._usageCount >= restriction.usageLimit) {
        return true;
      }
    }

    // Check daily limit
    if (restriction.dailyLimit !== undefined && restriction.dailyLimit !== -1) {
      if (this._dailyUsageCount >= restriction.dailyLimit) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get access denial reason
   */
  getAccessDenialReason(): string | null {
    if (!this.canAccessFeature()) {
      return `Feature '${this._featureName}' requires ${this.restriction.requiredTier} tier or higher. Current tier: ${this._userTier}`;
    }

    if (this.hasExceededLimits()) {
      const restriction = this.restriction;
      if (restriction.dailyLimit !== -1 && this._dailyUsageCount >= restriction.dailyLimit!) {
        return `Daily limit exceeded for '${this._featureName}': ${this._dailyUsageCount}/${restriction.dailyLimit}`;
      }
      if (restriction.usageLimit !== -1 && this._usageCount >= restriction.usageLimit!) {
        return `Usage limit exceeded for '${this._featureName}': ${this._usageCount}/${restriction.usageLimit}`;
      }
    }

    return null;
  }

  /**
   * Get remaining usage count
   */
  getRemainingUsage(): number {
    const restriction = this.restriction;
    if (restriction.usageLimit === -1) return -1; // Unlimited

    return Math.max(0, restriction.usageLimit! - this._usageCount);
  }

  /**
   * Get remaining daily usage count
   */
  getRemainingDailyUsage(): number {
    const restriction = this.restriction;
    if (restriction.dailyLimit === -1) return -1; // Unlimited

    return Math.max(0, restriction.dailyLimit! - this._dailyUsageCount);
  }

  /**
   * Create feature gate for a specific feature and user
   */
  static forFeature(
    featureName: FeatureName,
    userTier: SubscriptionTier,
    usageCount: number = 0,
    dailyUsageCount: number = 0
  ): FeatureGate {
    return new FeatureGate(featureName, userTier, usageCount, dailyUsageCount);
  }

  /**
   * Get all available features
   */
  static getAllFeatures(): FeatureName[] {
    return Object.keys(FeatureGate.FEATURE_RESTRICTIONS) as FeatureName[];
  }

  /**
   * Get features available for a specific tier
   */
  static getFeaturesForTier(tier: SubscriptionTier): FeatureName[] {
    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const tierIndex = tierOrder.indexOf(tier);

    return FeatureGate.getAllFeatures().filter(feature => {
      const restriction = FeatureGate.FEATURE_RESTRICTIONS[feature];
      const requiredTierIndex = tierOrder.indexOf(restriction.requiredTier);
      return tierIndex >= requiredTierIndex;
    });
  }

  /**
   * Get restriction for a specific feature
   */
  static getRestriction(featureName: FeatureName): FeatureRestriction {
    if (!FeatureGate.FEATURE_RESTRICTIONS[featureName]) {
      throw new Error(`Unknown feature: ${featureName}`);
    }
    return FeatureGate.FEATURE_RESTRICTIONS[featureName];
  }

  private validateFeature(featureName: FeatureName): void {
    if (!FeatureGate.FEATURE_RESTRICTIONS[featureName]) {
      throw new Error(`Unknown feature: ${featureName}`);
    }
  }

  equals(other: FeatureGate): boolean {
    return this._featureName === other._featureName &&
           this._userTier === other._userTier;
  }

  toString(): string {
    return `FeatureGate(${this._featureName}, ${this._userTier}, access: ${this.hasAccess()})`;
  }

  toJSON(): {
    featureName: FeatureName;
    userTier: SubscriptionTier;
    hasAccess: boolean;
    restriction: FeatureRestriction;
    usage: { count: number; daily: number; remaining: number; remainingDaily: number };
  } {
    return {
      featureName: this._featureName,
      userTier: this._userTier,
      hasAccess: this.hasAccess(),
      restriction: this.restriction,
      usage: {
        count: this._usageCount,
        daily: this._dailyUsageCount,
        remaining: this.getRemainingUsage(),
        remainingDaily: this.getRemainingDailyUsage()
      }
    };
  }
}