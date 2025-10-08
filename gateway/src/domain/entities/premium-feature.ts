/**
 * Premium Feature Entity
 * Represents a premium feature available in the subscription system
 */

import { SubscriptionTier } from '@discord-bot/config';
import { FeatureName, FeatureRestriction } from '../value-objects/feature-gate.js';

export type FeatureCategory = 'audio' | 'content' | 'queue' | 'ai' | 'branding' | 'analytics' | 'enterprise';
export type FeatureStatus = 'active' | 'beta' | 'deprecated' | 'coming_soon';

export interface FeatureMetrics {
  readonly totalUsage: number;
  readonly activeUsers: number;
  readonly lastUsedAt: Date;
  readonly popularityScore: number; // 0-100
}

export class PremiumFeature {
  constructor(
    private readonly _id: string,
    private readonly _name: FeatureName,
    private readonly _displayName: string,
    private readonly _description: string,
    private readonly _category: FeatureCategory,
    private readonly _restriction: FeatureRestriction,
    private _status: FeatureStatus = 'active',
    private _metrics: FeatureMetrics = {
      totalUsage: 0,
      activeUsers: 0,
      lastUsedAt: new Date(),
      popularityScore: 0
    },
    private readonly _createdAt: Date = new Date(),
    private _updatedAt: Date = new Date()
  ) {
    this.validateFeature();
  }

  get id(): string {
    return this._id;
  }

  get name(): FeatureName {
    return this._name;
  }

  get displayName(): string {
    return this._displayName;
  }

  get description(): string {
    return this._description;
  }

  get category(): FeatureCategory {
    return this._category;
  }

  get restriction(): FeatureRestriction {
    return this._restriction;
  }

  get status(): FeatureStatus {
    return this._status;
  }

  get metrics(): FeatureMetrics {
    return { ...this._metrics };
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get isActive(): boolean {
    return this._status === 'active';
  }

  get isBeta(): boolean {
    return this._restriction.betaFeature || this._status === 'beta';
  }

  get requiresPayment(): boolean {
    return this._restriction.requiresPayment;
  }

  get minimumTier(): SubscriptionTier {
    return this._restriction.requiredTier;
  }

  /**
   * Check if feature is available for a specific tier
   */
  isAvailableForTier(tier: SubscriptionTier): boolean {
    if (!this.isActive) return false;

    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const requiredTierIndex = tierOrder.indexOf(this._restriction.requiredTier);
    const userTierIndex = tierOrder.indexOf(tier);

    return userTierIndex >= requiredTierIndex;
  }

  /**
   * Check if feature has usage limits
   */
  hasUsageLimits(): boolean {
    return this._restriction.usageLimit !== undefined && this._restriction.usageLimit !== -1;
  }

  /**
   * Check if feature has daily limits
   */
  hasDailyLimits(): boolean {
    return this._restriction.dailyLimit !== undefined && this._restriction.dailyLimit !== -1;
  }

  /**
   * Update feature status
   */
  updateStatus(status: FeatureStatus): void {
    this._status = status;
    this._updatedAt = new Date();
  }

  /**
   * Record feature usage
   */
  recordUsage(userId: string): void {
    this._metrics = {
      ...this._metrics,
      totalUsage: this._metrics.totalUsage + 1,
      lastUsedAt: new Date()
    };
    this._updatedAt = new Date();
  }

  /**
   * Update user metrics
   */
  updateUserMetrics(activeUsers: number): void {
    this._metrics = {
      ...this._metrics,
      activeUsers,
      popularityScore: Math.min(100, (activeUsers / 1000) * 100) // Simple popularity calculation
    };
    this._updatedAt = new Date();
  }

  /**
   * Check if feature is popular (high usage)
   */
  isPopular(): boolean {
    return this._metrics.popularityScore > 70;
  }

  /**
   * Get feature age in days
   */
  getAgeInDays(): number {
    const diffMs = new Date().getTime() - this._createdAt.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Check if feature is new (less than 30 days old)
   */
  isNew(): boolean {
    return this.getAgeInDays() < 30;
  }

  /**
   * Create premium feature with validation
   */
  static create(
    name: FeatureName,
    displayName: string,
    description: string,
    category: FeatureCategory,
    restriction: FeatureRestriction
  ): PremiumFeature {
    const id = `feature_${name}_${Date.now()}`;
    return new PremiumFeature(id, name, displayName, description, category, restriction);
  }

  /**
   * Create audio quality feature
   */
  static createAudioFeature(
    name: FeatureName,
    displayName: string,
    description: string,
    requiredTier: SubscriptionTier,
    betaFeature: boolean = false
  ): PremiumFeature {
    return PremiumFeature.create(
      name,
      displayName,
      description,
      'audio',
      {
        requiredTier,
        usageLimit: -1,
        requiresPayment: requiredTier !== 'free',
        betaFeature,
        description
      }
    );
  }

  /**
   * Create AI feature with usage limits
   */
  static createAIFeature(
    name: FeatureName,
    displayName: string,
    description: string,
    requiredTier: SubscriptionTier,
    usageLimit: number,
    dailyLimit: number = -1
  ): PremiumFeature {
    return PremiumFeature.create(
      name,
      displayName,
      description,
      'ai',
      {
        requiredTier,
        usageLimit,
        dailyLimit,
        requiresPayment: true,
        betaFeature: true,
        description
      }
    );
  }

  private validateFeature(): void {
    if (!this._name || this._name.trim().length === 0) {
      throw new Error('Feature name cannot be empty');
    }

    if (!this._displayName || this._displayName.trim().length === 0) {
      throw new Error('Feature display name cannot be empty');
    }

    if (!this._description || this._description.trim().length === 0) {
      throw new Error('Feature description cannot be empty');
    }

    if (this._restriction.usageLimit !== undefined && this._restriction.usageLimit < -1) {
      throw new Error('Usage limit must be -1 (unlimited) or positive number');
    }

    if (this._restriction.dailyLimit !== undefined && this._restriction.dailyLimit < -1) {
      throw new Error('Daily limit must be -1 (unlimited) or positive number');
    }
  }

  equals(other: PremiumFeature): boolean {
    return this._id === other._id && this._name === other._name;
  }

  toString(): string {
    return `PremiumFeature(${this._name}, ${this._restriction.requiredTier}+, ${this._status})`;
  }

  toJSON(): {
    id: string;
    name: FeatureName;
    displayName: string;
    description: string;
    category: FeatureCategory;
    restriction: FeatureRestriction;
    status: FeatureStatus;
    metrics: FeatureMetrics;
    isActive: boolean;
    isBeta: boolean;
    requiresPayment: boolean;
    minimumTier: SubscriptionTier;
    isPopular: boolean;
    isNew: boolean;
    ageInDays: number;
  } {
    return {
      id: this._id,
      name: this._name,
      displayName: this._displayName,
      description: this._description,
      category: this._category,
      restriction: this._restriction,
      status: this._status,
      metrics: this._metrics,
      isActive: this.isActive,
      isBeta: this.isBeta,
      requiresPayment: this.requiresPayment,
      minimumTier: this.minimumTier,
      isPopular: this.isPopular(),
      isNew: this.isNew(),
      ageInDays: this.getAgeInDays()
    };
  }
}