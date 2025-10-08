/**
 * Usage Quota Value Object
 * Manages usage limits and tracking for subscription tiers
 */

import { SubscriptionTier } from '@discord-bot/config';

export type QuotaType =
  | 'queue_size'
  | 'track_duration'
  | 'monthly_playtime'
  | 'api_requests'
  | 'ai_recommendations'
  | 'voice_commands'
  | 'custom_playlists'
  | 'concurrent_sessions'
  | 'premium_servers'
  | 'storage_mb';

export interface QuotaLimit {
  readonly type: QuotaType;
  readonly limit: number;           // -1 for unlimited
  readonly period: 'hour' | 'day' | 'month' | 'lifetime';
  readonly resetTime?: Date;        // When quota resets
  readonly hardLimit: boolean;      // If true, blocks usage when exceeded
  readonly gracePeriod?: number;    // Minutes of grace period after limit
}

export interface QuotaUsage {
  readonly type: QuotaType;
  readonly used: number;
  readonly lastUsedAt: Date;
  readonly resetAt: Date;
}

export class UsageQuota {
  private static readonly TIER_QUOTAS: Record<SubscriptionTier, QuotaLimit[]> = {
    free: [
      {
        type: 'queue_size',
        limit: 50,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'track_duration',
        limit: 1800, // 30 minutes
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'monthly_playtime',
        limit: 3600, // 1 hour
        period: 'month',
        hardLimit: false,
        gracePeriod: 30
      },
      {
        type: 'api_requests',
        limit: 0,
        period: 'day',
        hardLimit: true
      },
      {
        type: 'concurrent_sessions',
        limit: 1,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'premium_servers',
        limit: 1,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'storage_mb',
        limit: 0,
        period: 'lifetime',
        hardLimit: true
      }
    ],

    basic: [
      {
        type: 'queue_size',
        limit: 100,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'track_duration',
        limit: 3600, // 1 hour
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'monthly_playtime',
        limit: 36000, // 10 hours
        period: 'month',
        hardLimit: false,
        gracePeriod: 60
      },
      {
        type: 'api_requests',
        limit: 1000,
        period: 'day',
        hardLimit: false,
        gracePeriod: 60
      },
      {
        type: 'ai_recommendations',
        limit: 0,
        period: 'day',
        hardLimit: true
      },
      {
        type: 'voice_commands',
        limit: 0,
        period: 'day',
        hardLimit: true
      },
      {
        type: 'custom_playlists',
        limit: 5,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'concurrent_sessions',
        limit: 3,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'premium_servers',
        limit: 3,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'storage_mb',
        limit: 100,
        period: 'lifetime',
        hardLimit: true
      }
    ],

    premium: [
      {
        type: 'queue_size',
        limit: 500,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'track_duration',
        limit: 7200, // 2 hours
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'monthly_playtime',
        limit: 180000, // 50 hours
        period: 'month',
        hardLimit: false,
        gracePeriod: 120
      },
      {
        type: 'api_requests',
        limit: 10000,
        period: 'day',
        hardLimit: false,
        gracePeriod: 120
      },
      {
        type: 'ai_recommendations',
        limit: 500,
        period: 'day',
        hardLimit: false,
        gracePeriod: 30
      },
      {
        type: 'voice_commands',
        limit: 200,
        period: 'day',
        hardLimit: false,
        gracePeriod: 30
      },
      {
        type: 'custom_playlists',
        limit: 50,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'concurrent_sessions',
        limit: 10,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'premium_servers',
        limit: 10,
        period: 'lifetime',
        hardLimit: true
      },
      {
        type: 'storage_mb',
        limit: 1000,
        period: 'lifetime',
        hardLimit: true
      }
    ],

    enterprise: [
      {
        type: 'queue_size',
        limit: -1, // Unlimited
        period: 'lifetime',
        hardLimit: false
      },
      {
        type: 'track_duration',
        limit: -1, // Unlimited
        period: 'lifetime',
        hardLimit: false
      },
      {
        type: 'monthly_playtime',
        limit: -1, // Unlimited
        period: 'month',
        hardLimit: false
      },
      {
        type: 'api_requests',
        limit: 100000,
        period: 'day',
        hardLimit: false,
        gracePeriod: 240
      },
      {
        type: 'ai_recommendations',
        limit: -1, // Unlimited
        period: 'day',
        hardLimit: false
      },
      {
        type: 'voice_commands',
        limit: -1, // Unlimited
        period: 'day',
        hardLimit: false
      },
      {
        type: 'custom_playlists',
        limit: -1, // Unlimited
        period: 'lifetime',
        hardLimit: false
      },
      {
        type: 'concurrent_sessions',
        limit: -1, // Unlimited
        period: 'lifetime',
        hardLimit: false
      },
      {
        type: 'premium_servers',
        limit: -1, // Unlimited
        period: 'lifetime',
        hardLimit: false
      },
      {
        type: 'storage_mb',
        limit: 10000,
        period: 'lifetime',
        hardLimit: false,
        gracePeriod: 1440 // 24 hours
      }
    ]
  };

  constructor(
    private readonly _quotaLimit: QuotaLimit,
    private readonly _usage: QuotaUsage
  ) {
    this.validateQuota(_quotaLimit, _usage);
  }

  get quotaLimit(): QuotaLimit {
    return this._quotaLimit;
  }

  get usage(): QuotaUsage {
    return this._usage;
  }

  get type(): QuotaType {
    return this._quotaLimit.type;
  }

  get limit(): number {
    return this._quotaLimit.limit;
  }

  get used(): number {
    return this._usage.used;
  }

  get isUnlimited(): boolean {
    return this._quotaLimit.limit === -1;
  }

  get isHardLimit(): boolean {
    return this._quotaLimit.hardLimit;
  }

  get hasGracePeriod(): boolean {
    return this._quotaLimit.gracePeriod !== undefined && this._quotaLimit.gracePeriod > 0;
  }

  /**
   * Check if quota is exceeded
   */
  isExceeded(): boolean {
    if (this.isUnlimited) return false;
    if (this.isExpired()) return false; // Reset expired quotas

    return this._usage.used >= this._quotaLimit.limit;
  }

  /**
   * Check if quota is in grace period
   */
  isInGracePeriod(): boolean {
    if (!this.hasGracePeriod || !this.isExceeded()) return false;

    const gracePeriodEnd = new Date(this._usage.lastUsedAt.getTime() + (this._quotaLimit.gracePeriod! * 60 * 1000));
    return new Date() <= gracePeriodEnd;
  }

  /**
   * Check if quota period has expired and should reset
   */
  isExpired(): boolean {
    if (this._quotaLimit.period === 'lifetime') return false;

    return new Date() >= this._usage.resetAt;
  }

  /**
   * Check if usage is blocked
   */
  isBlocked(): boolean {
    if (this.isUnlimited) return false;
    if (this.isExpired()) return false;

    const exceeded = this.isExceeded();

    if (!exceeded) return false;
    if (!this.isHardLimit) return false;
    if (this.isInGracePeriod()) return false;

    return true;
  }

  /**
   * Get remaining quota
   */
  getRemaining(): number {
    if (this.isUnlimited) return -1;
    if (this.isExpired()) return this._quotaLimit.limit;

    return Math.max(0, this._quotaLimit.limit - this._usage.used);
  }

  /**
   * Get usage percentage (0-100)
   */
  getUsagePercentage(): number {
    if (this.isUnlimited) return 0;
    if (this.isExpired()) return 0;

    return Math.min(100, (this._usage.used / this._quotaLimit.limit) * 100);
  }

  /**
   * Get time until reset
   */
  getTimeUntilReset(): number {
    if (this._quotaLimit.period === 'lifetime') return -1;

    const now = new Date();
    if (now >= this._usage.resetAt) return 0;

    return this._usage.resetAt.getTime() - now.getTime();
  }

  /**
   * Get warning level based on usage
   */
  getWarningLevel(): 'green' | 'yellow' | 'orange' | 'red' {
    const percentage = this.getUsagePercentage();

    if (percentage >= 95) return 'red';
    if (percentage >= 80) return 'orange';
    if (percentage >= 60) return 'yellow';
    return 'green';
  }

  /**
   * Create usage quota for a tier and type
   */
  static forTierAndType(
    tier: SubscriptionTier,
    type: QuotaType,
    currentUsage: number = 0,
    lastUsedAt: Date = new Date()
  ): UsageQuota {
    const quotaLimit = UsageQuota.getQuotaLimit(tier, type);
    const resetAt = UsageQuota.calculateResetTime(quotaLimit.period);

    const usage: QuotaUsage = {
      type,
      used: currentUsage,
      lastUsedAt,
      resetAt
    };

    return new UsageQuota(quotaLimit, usage);
  }

  /**
   * Get quota limit for tier and type
   */
  static getQuotaLimit(tier: SubscriptionTier, type: QuotaType): QuotaLimit {
    const tierQuotas = UsageQuota.TIER_QUOTAS[tier];
    const quota = tierQuotas.find(q => q.type === type);

    if (!quota) {
      throw new Error(`No quota defined for tier '${tier}' and type '${type}'`);
    }

    return quota;
  }

  /**
   * Get all quotas for a tier
   */
  static getQuotasForTier(tier: SubscriptionTier): QuotaLimit[] {
    return [...UsageQuota.TIER_QUOTAS[tier]];
  }

  /**
   * Calculate reset time based on period
   */
  static calculateResetTime(period: QuotaLimit['period']): Date {
    const now = new Date();

    switch (period) {
      case 'hour':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);

      case 'day':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

      case 'month':
        return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

      case 'lifetime':
        return new Date(2099, 11, 31); // Far future

      default:
        throw new Error(`Invalid period: ${period}`);
    }
  }

  /**
   * Create updated quota with new usage
   */
  withUpdatedUsage(additionalUsage: number): UsageQuota {
    const newUsage: QuotaUsage = {
      ...this._usage,
      used: this._usage.used + additionalUsage,
      lastUsedAt: new Date()
    };

    return new UsageQuota(this._quotaLimit, newUsage);
  }

  /**
   * Reset quota (for period-based quotas)
   */
  reset(): UsageQuota {
    if (this._quotaLimit.period === 'lifetime') {
      throw new Error('Cannot reset lifetime quota');
    }

    const newUsage: QuotaUsage = {
      ...this._usage,
      used: 0,
      resetAt: UsageQuota.calculateResetTime(this._quotaLimit.period)
    };

    return new UsageQuota(this._quotaLimit, newUsage);
  }

  private validateQuota(quotaLimit: QuotaLimit, usage: QuotaUsage): void {
    if (quotaLimit.type !== usage.type) {
      throw new Error(`Quota type mismatch: ${quotaLimit.type} !== ${usage.type}`);
    }

    if (usage.used < 0) {
      throw new Error(`Usage cannot be negative: ${usage.used}`);
    }

    if (quotaLimit.limit < -1) {
      throw new Error(`Invalid limit: ${quotaLimit.limit}`);
    }
  }

  equals(other: UsageQuota): boolean {
    return this._quotaLimit.type === other._quotaLimit.type &&
           this._quotaLimit.limit === other._quotaLimit.limit &&
           this._usage.used === other._usage.used;
  }

  toString(): string {
    const remaining = this.getRemaining();
    const remainingStr = remaining === -1 ? '∞' : remaining.toString();
    return `UsageQuota(${this.type}: ${this.used}/${this.limit === -1 ? '∞' : this.limit}, remaining: ${remainingStr})`;
  }

  toJSON(): {
    type: QuotaType;
    limit: number;
    used: number;
    remaining: number;
    percentage: number;
    isBlocked: boolean;
    warningLevel: string;
    timeUntilReset: number;
  } {
    return {
      type: this.type,
      limit: this.limit,
      used: this.used,
      remaining: this.getRemaining(),
      percentage: this.getUsagePercentage(),
      isBlocked: this.isBlocked(),
      warningLevel: this.getWarningLevel(),
      timeUntilReset: this.getTimeUntilReset()
    };
  }
}