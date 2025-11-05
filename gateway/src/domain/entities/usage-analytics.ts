/**
 * Usage Analytics Entity
 * Tracks and analyzes usage patterns for premium features and subscription optimization
 */

import { SubscriptionTier } from '@discord-bot/config';
import { FeatureName } from '../value-objects/feature-gate.js';
import { QuotaType } from '../value-objects/usage-quota.js';

export type AnalyticsTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year';
export type UsageEventType = 'feature_used' | 'quota_reached' | 'upgrade' | 'downgrade' | 'cancellation' | 'trial_started' | 'trial_ended' | 'quality_changed' | 'subscription_upgraded' | 'trial_converted' | 'trial_expired';

export interface UsageEvent {
  readonly id: string;
  readonly type: UsageEventType;
  readonly userId: string;
  readonly guildId: string;
  readonly tier: SubscriptionTier;
  readonly featureName?: FeatureName;
  readonly quotaType?: QuotaType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly metadata: Record<string, any>;
  readonly timestamp: Date;
}

export interface FeatureUsageStats {
  readonly featureName: FeatureName;
  readonly totalUsage: number;
  readonly uniqueUsers: number;
  readonly averageUsagePerUser: number;
  readonly peakUsageHour: number;
  readonly mostActiveDay: string;
  readonly conversionRate: number; // trial to paid
}

export interface TierAnalytics {
  readonly tier: SubscriptionTier;
  readonly activeUsers: number;
  readonly totalRevenue: number;
  readonly averageUsagePerUser: number;
  readonly churnRate: number;
  readonly mostUsedFeatures: FeatureName[];
  readonly quotaUtilization: Map<QuotaType, number>;
}

export interface ConversionMetrics {
  readonly trialToBasic: number;
  readonly basicToPremium: number;
  readonly premiumToEnterprise: number;
  readonly totalConversions: number;
  readonly averageTrialDuration: number;
  readonly conversionTriggers: Map<FeatureName, number>;
}

export class UsageAnalytics {
  constructor(
    private readonly _id: string,
    private readonly _timeframe: AnalyticsTimeframe,
    private readonly _startDate: Date,
    private readonly _endDate: Date,
    private _events: UsageEvent[] = [],
    private _featureStats: Map<FeatureName, FeatureUsageStats> = new Map(),
    private _tierAnalytics: Map<SubscriptionTier, TierAnalytics> = new Map(),
    private _conversionMetrics: ConversionMetrics | null = null,
    private readonly _createdAt: Date = new Date(),
    private _updatedAt: Date = new Date(),
    private _computedAt: Date | null = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _trendsData: Record<string, any> = {}
  ) {
    this.validateAnalytics();
  }

  get id(): string {
    return this._id;
  }

  get timeframe(): AnalyticsTimeframe {
    return this._timeframe;
  }

  get startDate(): Date {
    return this._startDate;
  }

  get endDate(): Date {
    return this._endDate;
  }

  get events(): UsageEvent[] {
    return [...this._events];
  }

  get featureStats(): Map<FeatureName, FeatureUsageStats> {
    return new Map(this._featureStats);
  }

  get tierAnalytics(): Map<SubscriptionTier, TierAnalytics> {
    return new Map(this._tierAnalytics);
  }

  get conversionMetrics(): ConversionMetrics | null {
    return this._conversionMetrics;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get computedAt(): Date | null {
    return this._computedAt;
  }

  get isComputed(): boolean {
    return this._computedAt !== null;
  }

  get totalEvents(): number {
    return this._events.length;
  }

  get uniqueUsers(): number {
    const userIds = new Set(this._events.map(event => event.userId));
    return userIds.size;
  }

  get uniqueGuilds(): number {
    const guildIds = new Set(this._events.map(event => event.guildId));
    return guildIds.size;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get trendsData(): Record<string, any> {
    return { ...this._trendsData };
  }

  /**
   * Add usage event
   */
  addEvent(event: UsageEvent): void {
    if (event.timestamp < this._startDate || event.timestamp > this._endDate) {
      throw new Error('Event timestamp is outside analytics timeframe');
    }

    this._events.push(event);
    this._updatedAt = new Date();
    this._computedAt = null; // Mark as needs recomputation
  }

  /**
   * Add multiple events
   */
  addEvents(events: UsageEvent[]): void {
    for (const event of events) {
      this.addEvent(event);
    }
  }

  /**
   * Get events by type
   */
  getEventsByType(type: UsageEventType): UsageEvent[] {
    return this._events.filter(event => event.type === type);
  }

  /**
   * Get events by feature
   */
  getEventsByFeature(featureName: FeatureName): UsageEvent[] {
    return this._events.filter(event => event.featureName === featureName);
  }

  /**
   * Get events by tier
   */
  getEventsByTier(tier: SubscriptionTier): UsageEvent[] {
    return this._events.filter(event => event.tier === tier);
  }

  /**
   * Get events by user
   */
  getEventsByUser(userId: string): UsageEvent[] {
    return this._events.filter(event => event.userId === userId);
  }

  /**
   * Get events by guild
   */
  getEventsByGuild(guildId: string): UsageEvent[] {
    return this._events.filter(event => event.guildId === guildId);
  }

  /**
   * Compute analytics from events
   */
  compute(): void {
    this.computeFeatureStats();
    this.computeTierAnalytics();
    this.computeConversionMetrics();
    this._computedAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Get most popular features
   */
  getMostPopularFeatures(limit: number = 10): FeatureUsageStats[] {
    return Array.from(this._featureStats.values())
      .sort((a, b) => b.totalUsage - a.totalUsage)
      .slice(0, limit);
  }

  /**
   * Get least used features
   */
  getLeastUsedFeatures(limit: number = 10): FeatureUsageStats[] {
    return Array.from(this._featureStats.values())
      .sort((a, b) => a.totalUsage - b.totalUsage)
      .slice(0, limit);
  }

  /**
   * Get tier with highest revenue
   */
  getHighestRevenueTier(): SubscriptionTier | null {
    let maxRevenue = 0;
    let highestTier: SubscriptionTier | null = null;

    for (const [tier, analytics] of this._tierAnalytics.entries()) {
      if (analytics.totalRevenue > maxRevenue) {
        maxRevenue = analytics.totalRevenue;
        highestTier = tier;
      }
    }

    return highestTier;
  }

  /**
   * Get conversion rate for specific path
   */
  getConversionRate(fromTier: SubscriptionTier, toTier: SubscriptionTier): number {
    if (!this._conversionMetrics) return 0;

    const key = `${fromTier}To${toTier.charAt(0).toUpperCase() + toTier.slice(1)}` as keyof ConversionMetrics;
    return (this._conversionMetrics[key] as number) || 0;
  }

  /**
   * Get churn analysis
   */
  getChurnAnalysis(): { tier: SubscriptionTier; churnRate: number }[] {
    return Array.from(this._tierAnalytics.entries())
      .map(([tier, analytics]) => ({
        tier,
        churnRate: analytics.churnRate
      }))
      .sort((a, b) => b.churnRate - a.churnRate);
  }

  /**
   * Get usage trends by hour
   */
  getHourlyUsageTrends(): Map<number, number> {
    const hourlyUsage = new Map<number, number>();

    for (let hour = 0; hour < 24; hour++) {
      hourlyUsage.set(hour, 0);
    }

    for (const event of this._events) {
      if (event.type === 'feature_used') {
        const hour = event.timestamp.getHours();
        hourlyUsage.set(hour, (hourlyUsage.get(hour) || 0) + 1);
      }
    }

    return hourlyUsage;
  }

  /**
   * Get feature adoption timeline
   */
  getFeatureAdoptionTimeline(featureName: FeatureName): Map<string, number> {
    const timeline = new Map<string, number>();
    const events = this.getEventsByFeature(featureName);

    for (const event of events) {
      const dateKey = event.timestamp.toISOString().split('T')[0];
      timeline.set(dateKey, (timeline.get(dateKey) || 0) + 1);
    }

    return timeline;
  }

  /**
   * Get revenue forecast based on trends
   */
  getRevenueForecast(months: number = 6): number {
    if (!this._conversionMetrics) return 0;

    const totalRevenue = Array.from(this._tierAnalytics.values())
      .reduce((sum, analytics) => sum + analytics.totalRevenue, 0);

    const growthRate = this._conversionMetrics.totalConversions / this.uniqueUsers;
    return totalRevenue * Math.pow(1 + growthRate, months);
  }

  private computeFeatureStats(): void {
    const featureUsage = new Map<FeatureName, {
      totalUsage: number;
      users: Set<string>;
      hourlyUsage: Map<number, number>;
      dailyUsage: Map<string, number>;
    }>();

    // Initialize feature usage tracking
    for (const event of this._events) {
      if (event.type === 'feature_used' && event.featureName) {
        if (!featureUsage.has(event.featureName)) {
          featureUsage.set(event.featureName, {
            totalUsage: 0,
            users: new Set(),
            hourlyUsage: new Map(),
            dailyUsage: new Map()
          });
        }

        const usage = featureUsage.get(event.featureName)!;
        usage.totalUsage++;
        usage.users.add(event.userId);

        const hour = event.timestamp.getHours();
        usage.hourlyUsage.set(hour, (usage.hourlyUsage.get(hour) || 0) + 1);

        const day = event.timestamp.toISOString().split('T')[0];
        usage.dailyUsage.set(day, (usage.dailyUsage.get(day) || 0) + 1);
      }
    }

    // Compute stats
    for (const [featureName, usage] of featureUsage.entries()) {
      const peakUsageHour = Array.from(usage.hourlyUsage.entries())
        .reduce((max, [hour, count]) => count > max[1] ? [hour, count] : max, [0, 0])[0];

      const mostActiveDay = Array.from(usage.dailyUsage.entries())
        .reduce((max, [day, count]) => count > max[1] ? [day, count] : max, ['', 0])[0];

      // Calculate conversion rate (simplified)
      const trialEvents = this.getEventsByType('trial_started').length;
      const conversionRate = trialEvents > 0 ? (usage.users.size / trialEvents) * 100 : 0;

      const stats: FeatureUsageStats = {
        featureName,
        totalUsage: usage.totalUsage,
        uniqueUsers: usage.users.size,
        averageUsagePerUser: usage.users.size > 0 ? usage.totalUsage / usage.users.size : 0,
        peakUsageHour,
        mostActiveDay,
        conversionRate
      };

      this._featureStats.set(featureName, stats);
    }
  }

  private computeTierAnalytics(): void {
    const tierData = new Map<SubscriptionTier, {
      users: Set<string>;
      revenue: number;
      totalUsage: number;
      featureUsage: Map<FeatureName, number>;
      quotaUsage: Map<QuotaType, number>;
      churns: number;
    }>();

    // Initialize tier data
    const tiers: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    for (const tier of tiers) {
      tierData.set(tier, {
        users: new Set(),
        revenue: 0,
        totalUsage: 0,
        featureUsage: new Map(),
        quotaUsage: new Map(),
        churns: 0
      });
    }

    // Process events
    for (const event of this._events) {
      const data = tierData.get(event.tier)!;
      data.users.add(event.userId);

      if (event.type === 'feature_used') {
        data.totalUsage++;
        if (event.featureName) {
          data.featureUsage.set(
            event.featureName,
            (data.featureUsage.get(event.featureName) || 0) + 1
          );
        }
      }

      if (event.type === 'quota_reached' && event.quotaType) {
        data.quotaUsage.set(
          event.quotaType,
          (data.quotaUsage.get(event.quotaType) || 0) + 1
        );
      }

      if (event.type === 'cancellation' || event.type === 'downgrade') {
        data.churns++;
      }

      // Revenue calculation (simplified)
      if (event.type === 'upgrade' || event.type === 'trial_ended') {
        const tierRevenue = this.getTierMonthlyRevenue(event.tier);
        data.revenue += tierRevenue;
      }
    }

    // Compute analytics
    for (const [tier, data] of tierData.entries()) {
      const mostUsedFeatures = Array.from(data.featureUsage.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([feature]) => feature);

      const quotaUtilization = new Map<QuotaType, number>();
      for (const [quotaType, usage] of data.quotaUsage.entries()) {
        quotaUtilization.set(quotaType, (usage / data.users.size) * 100);
      }

      const churnRate = data.users.size > 0 ? (data.churns / data.users.size) * 100 : 0;

      const analytics: TierAnalytics = {
        tier,
        activeUsers: data.users.size,
        totalRevenue: data.revenue,
        averageUsagePerUser: data.users.size > 0 ? data.totalUsage / data.users.size : 0,
        churnRate,
        mostUsedFeatures,
        quotaUtilization
      };

      this._tierAnalytics.set(tier, analytics);
    }
  }

  private computeConversionMetrics(): void {
    const upgrades = this.getEventsByType('upgrade');
    const trialStarts = this.getEventsByType('trial_started');
    const trialEnds = this.getEventsByType('trial_ended');

    let trialToBasic = 0;
    let basicToPremium = 0;
    let premiumToEnterprise = 0;

    for (const event of upgrades) {
      const previousTier = event.metadata.previousTier as SubscriptionTier;
      const newTier = event.tier;

      if (previousTier === 'free' && newTier === 'basic') trialToBasic++;
      if (previousTier === 'basic' && newTier === 'premium') basicToPremium++;
      if (previousTier === 'premium' && newTier === 'enterprise') premiumToEnterprise++;
    }

    const totalConversions = trialToBasic + basicToPremium + premiumToEnterprise;

    // Calculate average trial duration
    const trialDurations: number[] = [];
    for (const endEvent of trialEnds) {
      const startEvent = trialStarts.find(e => e.userId === endEvent.userId);
      if (startEvent) {
        const duration = endEvent.timestamp.getTime() - startEvent.timestamp.getTime();
        trialDurations.push(duration / (1000 * 60 * 60 * 24)); // Convert to days
      }
    }

    const averageTrialDuration = trialDurations.length > 0
      ? trialDurations.reduce((sum, duration) => sum + duration, 0) / trialDurations.length
      : 0;

    // Calculate conversion triggers
    const conversionTriggers = new Map<FeatureName, number>();
    for (const event of upgrades) {
      const triggerFeature = event.metadata.triggerFeature as FeatureName;
      if (triggerFeature) {
        conversionTriggers.set(
          triggerFeature,
          (conversionTriggers.get(triggerFeature) || 0) + 1
        );
      }
    }

    this._conversionMetrics = {
      trialToBasic,
      basicToPremium,
      premiumToEnterprise,
      totalConversions,
      averageTrialDuration,
      conversionTriggers
    };
  }

  private getTierMonthlyRevenue(tier: SubscriptionTier): number {
    // Simplified revenue calculation
    const prices = {
      free: 0,
      basic: 9.99,
      premium: 19.99,
      enterprise: 99.99
    };
    return prices[tier] || 0;
  }

  private validateAnalytics(): void {
    if (this._startDate >= this._endDate) {
      throw new Error('Start date must be before end date');
    }

    if (this._endDate > new Date()) {
      throw new Error('End date cannot be in the future');
    }

    const validTimeframes: AnalyticsTimeframe[] = ['hour', 'day', 'week', 'month', 'year'];
    if (!validTimeframes.includes(this._timeframe)) {
      throw new Error(`Invalid timeframe: ${this._timeframe}`);
    }
  }

  /**
   * Create usage analytics for timeframe
   */
  static create(
    timeframe: AnalyticsTimeframe,
    startDate: Date,
    endDate: Date
  ): UsageAnalytics {
    const id = `analytics_${timeframe}_${startDate.getTime()}_${endDate.getTime()}`;
    return new UsageAnalytics(id, timeframe, startDate, endDate);
  }

  /**
   * Create daily analytics
   */
  static createDaily(date: Date): UsageAnalytics {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    return UsageAnalytics.create('day', startDate, endDate);
  }

  /**
   * Create weekly analytics
   */
  static createWeekly(startDate: Date): UsageAnalytics {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);

    return UsageAnalytics.create('week', startDate, endDate);
  }

  /**
   * Create monthly analytics
   */
  static createMonthly(year: number, month: number): UsageAnalytics {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

    return UsageAnalytics.create('month', startDate, endDate);
  }

  /**
   * Reconstitute analytics from stored data
   */
  static reconstitute(
    id: string,
    timeframe: AnalyticsTimeframe,
    totalEvents: number,
    featureStats: Map<FeatureName, FeatureUsageStats>,
    conversionMetrics: ConversionMetrics,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trendsData: Record<string, any>,
    createdAt: Date,
    updatedAt: Date
  ): UsageAnalytics {
    // Calculate start and end dates based on timeframe and created date
    const startDate = new Date(createdAt);
    const endDate = new Date(createdAt);

    switch (timeframe) {
      case 'day':
        endDate.setDate(endDate.getDate() + 1);
        break;
      case 'week':
        endDate.setDate(endDate.getDate() + 7);
        break;
      case 'month':
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case 'year':
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
    }

    const analytics = new UsageAnalytics(id, timeframe, startDate, endDate);
    analytics._featureStats = featureStats;
    analytics._conversionMetrics = conversionMetrics;
    analytics._trendsData = trendsData;
    analytics._updatedAt = updatedAt;
    analytics._computedAt = updatedAt;

    return analytics;
  }

  equals(other: UsageAnalytics): boolean {
    return this._id === other._id;
  }

  toString(): string {
    return `UsageAnalytics(${this._timeframe}, ${this.totalEvents} events, ${this.uniqueUsers} users)`;
  }

  toJSON(): {
    id: string;
    timeframe: AnalyticsTimeframe;
    startDate: Date;
    endDate: Date;
    totalEvents: number;
    uniqueUsers: number;
    uniqueGuilds: number;
    isComputed: boolean;
    mostPopularFeatures: FeatureUsageStats[];
    highestRevenueTier: SubscriptionTier | null;
    totalRevenue: number;
    computedAt: Date | null;
  } {
    const totalRevenue = Array.from(this._tierAnalytics.values())
      .reduce((sum, analytics) => sum + analytics.totalRevenue, 0);

    return {
      id: this._id,
      timeframe: this._timeframe,
      startDate: this._startDate,
      endDate: this._endDate,
      totalEvents: this.totalEvents,
      uniqueUsers: this.uniqueUsers,
      uniqueGuilds: this.uniqueGuilds,
      isComputed: this.isComputed,
      mostPopularFeatures: this.getMostPopularFeatures(5),
      highestRevenueTier: this.getHighestRevenueTier(),
      totalRevenue,
      computedAt: this._computedAt
    };
  }
}