/**
 * Feature Subscription Entity
 * Manages a user's subscription to specific premium features
 */

import { SubscriptionTier } from '@discord-bot/config';
import { FeatureName } from '../value-objects/feature-gate.js';
import { UsageQuota, QuotaType } from '../value-objects/usage-quota.js';
import { BillingPeriod, PeriodType } from '../value-objects/billing-period.js';

export type SubscriptionStatus = 'active' | 'suspended' | 'cancelled' | 'expired' | 'trial' | 'pending';

export interface FeatureUsageRecord {
  readonly featureName: FeatureName;
  readonly usageCount: number;
  readonly dailyUsageCount: number;
  readonly lastUsedAt: Date;
  readonly quota: UsageQuota;
}

export interface SubscriptionMetrics {
  readonly totalFeatureUsage: number;
  readonly mostUsedFeature: FeatureName | null;
  readonly leastUsedFeature: FeatureName | null;
  readonly averageDailyUsage: number;
  readonly lastActivityAt: Date;
}

export class FeatureSubscription {
  constructor(
    private readonly _id: string,
    private readonly _userId: string,
    private readonly _guildId: string,
    private readonly _tier: SubscriptionTier,
    private readonly _billingPeriod: BillingPeriod,
    private _status: SubscriptionStatus = 'active',
    private _featuresAccess: Map<FeatureName, FeatureUsageRecord> = new Map(),
    private _quotas: Map<QuotaType, UsageQuota> = new Map(),
    private readonly _createdAt: Date = new Date(),
    private _updatedAt: Date = new Date(),
    private _lastBillingAt: Date = new Date(),
    private _nextBillingAt: Date | null = null,
    private _trialEndsAt: Date | null = null,
    private _suspendedUntil: Date | null = null
  ) {
    this.validateSubscription();
    this.calculateNextBilling();
  }

  get id(): string {
    return this._id;
  }

  get userId(): string {
    return this._userId;
  }

  get guildId(): string {
    return this._guildId;
  }

  get tier(): SubscriptionTier {
    return this._tier;
  }

  get billingPeriod(): BillingPeriod {
    return this._billingPeriod;
  }

  get status(): SubscriptionStatus {
    return this._status;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get lastBillingAt(): Date {
    return this._lastBillingAt;
  }

  get nextBillingAt(): Date | null {
    return this._nextBillingAt;
  }

  get trialEndsAt(): Date | null {
    return this._trialEndsAt;
  }

  get suspendedUntil(): Date | null {
    return this._suspendedUntil;
  }

  get isActive(): boolean {
    if (this._status !== 'active' && this._status !== 'trial') return false;
    if (this._suspendedUntil && this._suspendedUntil > new Date()) return false;
    if (this._trialEndsAt && this._trialEndsAt < new Date() && this._status === 'trial') return false;
    return true;
  }

  get isOnTrial(): boolean {
    return this._status === 'trial' &&
           this._trialEndsAt !== null &&
           this._trialEndsAt > new Date();
  }

  get isSuspended(): boolean {
    return this._status === 'suspended' ||
           (this._suspendedUntil !== null && this._suspendedUntil > new Date());
  }

  get daysUntilBilling(): number {
    if (!this._nextBillingAt) return -1;
    const diffMs = this._nextBillingAt.getTime() - new Date().getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  get daysUntilTrialEnd(): number {
    if (!this._trialEndsAt) return -1;
    const diffMs = this._trialEndsAt.getTime() - new Date().getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Check if user has access to a specific feature
   */
  hasFeatureAccess(featureName: FeatureName): boolean {
    if (!this.isActive) return false;

    const usage = this._featuresAccess.get(featureName);
    if (!usage) return false;

    return !usage.quota.isBlocked();
  }

  /**
   * Get usage record for a feature
   */
  getFeatureUsage(featureName: FeatureName): FeatureUsageRecord | null {
    return this._featuresAccess.get(featureName) || null;
  }

  /**
   * Get quota for a specific quota type
   */
  getQuota(quotaType: QuotaType): UsageQuota | null {
    return this._quotas.get(quotaType) || null;
  }

  /**
   * Record feature usage
   */
  recordFeatureUsage(featureName: FeatureName, amount: number = 1): void {
    if (!this.isActive) {
      throw new Error('Cannot record usage on inactive subscription');
    }

    const usage = this._featuresAccess.get(featureName);
    if (!usage) {
      throw new Error(`Feature ${featureName} not available in subscription`);
    }

    const updatedQuota = usage.quota.withUpdatedUsage(amount);

    if (updatedQuota.isBlocked()) {
      throw new Error(`Feature ${featureName} usage limit exceeded`);
    }

    const updatedUsage: FeatureUsageRecord = {
      ...usage,
      usageCount: usage.usageCount + amount,
      lastUsedAt: new Date(),
      quota: updatedQuota
    };

    this._featuresAccess.set(featureName, updatedUsage);
    this._updatedAt = new Date();
  }

  /**
   * Record quota usage
   */
  recordQuotaUsage(quotaType: QuotaType, amount: number): void {
    if (!this.isActive) {
      throw new Error('Cannot record usage on inactive subscription');
    }

    const quota = this._quotas.get(quotaType);
    if (!quota) {
      throw new Error(`Quota ${quotaType} not found in subscription`);
    }

    const updatedQuota = quota.withUpdatedUsage(amount);
    this._quotas.set(quotaType, updatedQuota);
    this._updatedAt = new Date();
  }

  /**
   * Add feature access to subscription
   */
  addFeatureAccess(featureName: FeatureName, quota: UsageQuota): void {
    const usage: FeatureUsageRecord = {
      featureName,
      usageCount: 0,
      dailyUsageCount: 0,
      lastUsedAt: new Date(),
      quota
    };

    this._featuresAccess.set(featureName, usage);
    this._updatedAt = new Date();
  }

  /**
   * Remove feature access from subscription
   */
  removeFeatureAccess(featureName: FeatureName): void {
    this._featuresAccess.delete(featureName);
    this._updatedAt = new Date();
  }

  /**
   * Add quota to subscription
   */
  addQuota(quotaType: QuotaType, quota: UsageQuota): void {
    this._quotas.set(quotaType, quota);
    this._updatedAt = new Date();
  }

  /**
   * Suspend subscription
   */
  suspend(until: Date, reason: string): void {
    this._status = 'suspended';
    this._suspendedUntil = until;
    this._updatedAt = new Date();
  }

  /**
   * Resume suspended subscription
   */
  resume(): void {
    if (this._status !== 'suspended') {
      throw new Error('Cannot resume non-suspended subscription');
    }

    this._status = 'active';
    this._suspendedUntil = null;
    this._updatedAt = new Date();
  }

  /**
   * Cancel subscription
   */
  cancel(): void {
    this._status = 'cancelled';
    this._updatedAt = new Date();
  }

  /**
   * Start trial period
   */
  startTrial(duration: number = 14): void {
    if (this._status === 'trial') {
      throw new Error('Subscription is already on trial');
    }

    this._status = 'trial';
    this._trialEndsAt = new Date(Date.now() + (duration * 24 * 60 * 60 * 1000));
    this._updatedAt = new Date();
  }

  /**
   * End trial and activate subscription
   */
  endTrial(): void {
    if (this._status !== 'trial') {
      throw new Error('Subscription is not on trial');
    }

    this._status = 'active';
    this._trialEndsAt = null;
    this._updatedAt = new Date();
  }

  /**
   * Process billing cycle
   */
  processBilling(): void {
    if (!this.isActive) {
      throw new Error('Cannot process billing for inactive subscription');
    }

    this._lastBillingAt = new Date();
    this.calculateNextBilling();
    this.resetPeriodBasedQuotas();
    this._updatedAt = new Date();
  }

  /**
   * Reset quotas that are period-based
   */
  resetPeriodBasedQuotas(): void {
    for (const [quotaType, quota] of this._quotas.entries()) {
      if (quota.isExpired()) {
        this._quotas.set(quotaType, quota.reset());
      }
    }

    // Reset daily usage counts for features
    for (const [featureName, usage] of this._featuresAccess.entries()) {
      if (usage.quota.isExpired()) {
        const resetQuota = usage.quota.reset();
        this._featuresAccess.set(featureName, {
          ...usage,
          dailyUsageCount: 0,
          quota: resetQuota
        });
      }
    }
  }

  /**
   * Get subscription metrics
   */
  getMetrics(): SubscriptionMetrics {
    let totalUsage = 0;
    let mostUsedFeature: FeatureName | null = null;
    let leastUsedFeature: FeatureName | null = null;
    let maxUsage = 0;
    let minUsage = Infinity;
    let lastActivity = this._createdAt;

    for (const [featureName, usage] of this._featuresAccess.entries()) {
      totalUsage += usage.usageCount;

      if (usage.usageCount > maxUsage) {
        maxUsage = usage.usageCount;
        mostUsedFeature = featureName;
      }

      if (usage.usageCount < minUsage) {
        minUsage = usage.usageCount;
        leastUsedFeature = featureName;
      }

      if (usage.lastUsedAt > lastActivity) {
        lastActivity = usage.lastUsedAt;
      }
    }

    const daysSinceCreation = (new Date().getTime() - this._createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const averageDailyUsage = daysSinceCreation > 0 ? totalUsage / daysSinceCreation : 0;

    return {
      totalFeatureUsage: totalUsage,
      mostUsedFeature: mostUsedFeature,
      leastUsedFeature: minUsage === Infinity ? null : leastUsedFeature,
      averageDailyUsage,
      lastActivityAt: lastActivity
    };
  }

  /**
   * Get all available features
   */
  getAvailableFeatures(): FeatureName[] {
    return Array.from(this._featuresAccess.keys());
  }

  /**
   * Get blocked features
   */
  getBlockedFeatures(): FeatureName[] {
    return Array.from(this._featuresAccess.entries())
      .filter(([_, usage]) => usage.quota.isBlocked())
      .map(([featureName, _]) => featureName);
  }

  private calculateNextBilling(): void {
    if (this._billingPeriod.isRecurring) {
      this._nextBillingAt = this._billingPeriod.getNextBillingDate(this._lastBillingAt);
    } else {
      this._nextBillingAt = null;
    }
  }

  private validateSubscription(): void {
    if (!this._userId || this._userId.trim().length === 0) {
      throw new Error('User ID cannot be empty');
    }

    if (!this._guildId || this._guildId.trim().length === 0) {
      throw new Error('Guild ID cannot be empty');
    }

    if (this._trialEndsAt && this._trialEndsAt <= new Date()) {
      throw new Error('Trial end date cannot be in the past');
    }

    if (this._suspendedUntil && this._suspendedUntil <= new Date()) {
      throw new Error('Suspension end date cannot be in the past');
    }
  }

  /**
   * Create feature subscription for a user
   */
  static create(
    userId: string,
    guildId: string,
    tier: SubscriptionTier,
    billingPeriod: BillingPeriod,
    features: Map<FeatureName, UsageQuota> = new Map(),
    quotas: Map<QuotaType, UsageQuota> = new Map()
  ): FeatureSubscription {
    const id = `sub_${userId}_${guildId}_${Date.now()}`;
    const subscription = new FeatureSubscription(id, userId, guildId, tier, billingPeriod);

    // Add features
    for (const [featureName, quota] of features.entries()) {
      subscription.addFeatureAccess(featureName, quota);
    }

    // Add quotas
    for (const [quotaType, quota] of quotas.entries()) {
      subscription.addQuota(quotaType, quota);
    }

    return subscription;
  }

  /**
   * Create trial subscription
   */
  static createTrial(
    userId: string,
    guildId: string,
    tier: SubscriptionTier,
    trialDays: number = 14
  ): FeatureSubscription {
    const billingPeriod = BillingPeriod.create('trial', 0);
    const subscription = FeatureSubscription.create(userId, guildId, tier, billingPeriod);
    subscription.startTrial(trialDays);
    return subscription;
  }

  /**
   * Get payment plan (stub)
   */
  get paymentPlan(): any {
    return {
      id: `plan_${this._tier}_${this._billingPeriod.type}`,
      tier: this._tier,
      billingPeriod: this._billingPeriod,
      basePrice: this.getEstimatedPrice()
    };
  }

  /**
   * Get subscription start date
   */
  get startDate(): Date {
    return this._createdAt;
  }

  /**
   * Get remaining days in current period
   */
  getRemainingDays(): number {
    if (!this._nextBillingAt) return 0;
    const diffMs = this._nextBillingAt.getTime() - new Date().getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  /**
   * Get next billing date (alias for compatibility)
   */
  getNextBillingDate(): Date | null {
    return this._nextBillingAt;
  }

  private getEstimatedPrice(): number {
    const tierPrices = {
      free: 0,
      basic: 9.99,
      premium: 19.99,
      enterprise: 99.99
    };
    return tierPrices[this._tier] || 0;
  }

  equals(other: FeatureSubscription): boolean {
    return this._id === other._id;
  }

  toString(): string {
    return `FeatureSubscription(${this._tier}, ${this._status}, ${this._featuresAccess.size} features)`;
  }

  toJSON(): {
    id: string;
    userId: string;
    guildId: string;
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    billingPeriod: any;
    isActive: boolean;
    isOnTrial: boolean;
    daysUntilBilling: number;
    featuresCount: number;
    quotasCount: number;
    metrics: SubscriptionMetrics;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: this._id,
      userId: this._userId,
      guildId: this._guildId,
      tier: this._tier,
      status: this._status,
      billingPeriod: this._billingPeriod.toJSON(),
      isActive: this.isActive,
      isOnTrial: this.isOnTrial,
      daysUntilBilling: this.daysUntilBilling,
      featuresCount: this._featuresAccess.size,
      quotasCount: this._quotas.size,
      metrics: this.getMetrics(),
      createdAt: this._createdAt,
      updatedAt: this._updatedAt
    };
  }
}