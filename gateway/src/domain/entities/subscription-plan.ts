/**
 * Subscription Plan Entity - Commercial Feature
 * Represents different pricing tiers for the music bot service
 */

export type PlanType = 'free' | 'premium' | 'pro' | 'enterprise';
export type BillingPeriod = 'monthly' | 'yearly';

export interface PlanLimits {
  maxGuilds: number;
  maxQueueSize: number;
  maxTrackDuration: number; // in milliseconds
  canSkipAds: boolean;
  highQualityAudio: boolean;
  customBranding: boolean;
  prioritySupport: boolean;
  analyticsAccess: boolean;
  apiAccess: boolean;
  maxConcurrentStreams: number;
}

export class SubscriptionPlan {
  constructor(
    private readonly _id: string,
    private readonly _name: string,
    private readonly _type: PlanType,
    private readonly _price: number,
    private readonly _billingPeriod: BillingPeriod,
    private readonly _limits: PlanLimits,
    private readonly _features: string[],
    private readonly _isActive: boolean = true
  ) {}

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get type(): PlanType {
    return this._type;
  }

  get price(): number {
    return this._price;
  }

  get billingPeriod(): BillingPeriod {
    return this._billingPeriod;
  }

  get limits(): PlanLimits {
    return this._limits;
  }

  get features(): string[] {
    return [...this._features];
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get monthlyPrice(): number {
    return this._billingPeriod === 'yearly' ? this._price / 12 : this._price;
  }

  canUseFeature(featureName: string): boolean {
    return this._features.includes(featureName);
  }

  exceedsLimit(usage: { guilds?: number; queueSize?: number; trackDuration?: number }): string[] {
    const violations: string[] = [];

    if (usage.guilds !== undefined && usage.guilds > this._limits.maxGuilds) {
      violations.push(`Guild limit exceeded: ${usage.guilds}/${this._limits.maxGuilds}`);
    }

    if (usage.queueSize !== undefined && usage.queueSize > this._limits.maxQueueSize) {
      violations.push(`Queue size limit exceeded: ${usage.queueSize}/${this._limits.maxQueueSize}`);
    }

    if (usage.trackDuration !== undefined && usage.trackDuration > this._limits.maxTrackDuration) {
      violations.push(`Track duration limit exceeded: ${usage.trackDuration}ms/${this._limits.maxTrackDuration}ms`);
    }

    return violations;
  }

  static createFreePlan(): SubscriptionPlan {
    return new SubscriptionPlan(
      'free',
      'Free Plan',
      'free',
      0,
      'monthly',
      {
        maxGuilds: 1,
        maxQueueSize: 10,
        maxTrackDuration: 300000, // 5 minutes
        canSkipAds: false,
        highQualityAudio: false,
        customBranding: false,
        prioritySupport: false,
        analyticsAccess: false,
        apiAccess: false,
        maxConcurrentStreams: 1
      },
      ['basic_playback', 'queue_management', 'basic_controls']
    );
  }

  static createPremiumPlan(): SubscriptionPlan {
    return new SubscriptionPlan(
      'premium',
      'Premium Plan',
      'premium',
      9.99,
      'monthly',
      {
        maxGuilds: 5,
        maxQueueSize: 100,
        maxTrackDuration: 1800000, // 30 minutes
        canSkipAds: true,
        highQualityAudio: true,
        customBranding: false,
        prioritySupport: false,
        analyticsAccess: true,
        apiAccess: false,
        maxConcurrentStreams: 3
      },
      ['basic_playback', 'queue_management', 'basic_controls', 'high_quality_audio', 'analytics', 'extended_queue']
    );
  }

  static createProPlan(): SubscriptionPlan {
    return new SubscriptionPlan(
      'pro',
      'Pro Plan',
      'pro',
      19.99,
      'monthly',
      {
        maxGuilds: 25,
        maxQueueSize: 500,
        maxTrackDuration: 3600000, // 1 hour
        canSkipAds: true,
        highQualityAudio: true,
        customBranding: true,
        prioritySupport: true,
        analyticsAccess: true,
        apiAccess: true,
        maxConcurrentStreams: 10
      },
      ['basic_playback', 'queue_management', 'basic_controls', 'high_quality_audio', 'analytics', 'extended_queue', 'custom_branding', 'api_access', 'priority_support']
    );
  }

  static createEnterprisePlan(): SubscriptionPlan {
    return new SubscriptionPlan(
      'enterprise',
      'Enterprise Plan',
      'enterprise',
      99.99,
      'monthly',
      {
        maxGuilds: -1, // Unlimited
        maxQueueSize: -1, // Unlimited
        maxTrackDuration: -1, // Unlimited
        canSkipAds: true,
        highQualityAudio: true,
        customBranding: true,
        prioritySupport: true,
        analyticsAccess: true,
        apiAccess: true,
        maxConcurrentStreams: -1 // Unlimited
      },
      ['basic_playback', 'queue_management', 'basic_controls', 'high_quality_audio', 'analytics', 'extended_queue', 'custom_branding', 'api_access', 'priority_support', 'white_labeling', 'dedicated_support', 'sla_guarantee']
    );
  }
}