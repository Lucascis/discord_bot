/**
 * Premium Analytics Service
 * Infrastructure adapter for premium features analytics using multiple data sources
 */

import { Redis } from 'ioredis';
import { PrismaClient } from '@discord-bot/database';
import { FeatureName } from '../../domain/value-objects/feature-gate.js';
import { SubscriptionTier } from '@discord-bot/config';
import {
  QualityAnalyticsService,
  QualityPreferences,
  QualityStatistics,
  StreamingPerformance
} from '../../application/use-cases/audio-quality-management-use-case';
import {
  AnalyticsService,
  BillingAnalyticsService,
  BillingMetrics
} from '../../application/use-cases/billing-management-use-case';
import { AnalyticsRepository } from '../../application/use-cases/premium-feature-management-use-case.js';
import { UsageAnalytics, UsageEvent } from '../../domain/entities/usage-analytics';

export class PremiumAnalyticsService implements AnalyticsService, QualityAnalyticsService, BillingAnalyticsService, AnalyticsRepository {
  private readonly ANALYTICS_TTL = 86400; // 24 hours
  private readonly METRICS_PREFIX = 'metrics:';

  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaClient
  ) {}

  // === Analytics Repository Implementation ===

  async save(analytics: UsageAnalytics): Promise<void> {
    const analyticsData = {
      id: analytics.id,
      timeframe: analytics.timeframe,
      totalEvents: analytics.totalEvents,
      featureStats: JSON.stringify(Array.from(analytics.featureStats.entries())),
      conversionMetrics: JSON.stringify(analytics.conversionMetrics),
      trendsData: JSON.stringify(analytics.trendsData),
      createdAt: analytics.createdAt,
      updatedAt: new Date()
    };

    // TODO: Implement when usageAnalytics model is added to Prisma schema
    // await this.prisma.usageAnalytics.upsert({
    //   where: { id: analytics.id },
    //   create: analyticsData,
    //   update: analyticsData
    // });

    // Cache frequently accessed analytics
    const cacheKey = `${this.METRICS_PREFIX}analytics:${analytics.id}`;
    await this.redis.setex(cacheKey, this.ANALYTICS_TTL, JSON.stringify(analyticsData));
  }

  async findByTimeframe(start: Date, end: Date): Promise<UsageAnalytics | null> {
    const timeframeKey = `${start.toISOString()}_${end.toISOString()}`;
    const cacheKey = `${this.METRICS_PREFIX}timeframe:${timeframeKey}`;

    // Check cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      return this.deserializeUsageAnalytics(data);
    }

    // TODO: Query database when usageAnalytics model is available
    // const analytics = await this.prisma.usageAnalytics.findFirst({
    //   where: {
    //     createdAt: { gte: start },
    //     updatedAt: { lte: end }
    //   },
    //   orderBy: { updatedAt: 'desc' }
    // });

    // if (!analytics) return null;

    // const domainAnalytics = this.deserializeUsageAnalytics(analytics);

    // // Cache result
    // await this.redis.setex(cacheKey, this.ANALYTICS_TTL / 2, JSON.stringify(analytics));

    // return domainAnalytics;
    return null; // Placeholder until database models are implemented
  }

  async recordEvent(event: UsageEvent): Promise<void> {
    // TODO: Store event in database when usageEvent model is available
    // await this.prisma.usageEvent.create({
    //   data: {
    //     id: event.id,
    //     type: event.type,
    //     userId: event.userId,
    //     guildId: event.guildId || null,
    //     tier: event.tier,
    //     featureName: event.featureName || null,
    //     metadata: JSON.stringify(event.metadata || {}),
    //     timestamp: event.timestamp
    //   }
    // });

    // Update real-time metrics in Redis
    await this.updateRealTimeMetrics(event);
  }

  // === Quality Analytics Service Implementation ===

  async recordQualityChange(
    userId: string,
    guildId: string,
    from: string,
    to: string,
    reason: string
  ): Promise<void> {
    const event: UsageEvent = {
      id: `quality_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'quality_changed',
      userId,
      guildId,
      tier: 'free', // Default tier, should be determined from actual user subscription
      metadata: { from, to, reason },
      timestamp: new Date()
    };

    await this.recordEvent(event);

    // Update quality metrics
    const qualityKey = `${this.METRICS_PREFIX}quality:${guildId}`;
    await this.redis.hincrby(qualityKey, `${from}_to_${to}`, 1);
    await this.redis.expire(qualityKey, this.ANALYTICS_TTL);
  }

  async recordPerformanceMetrics(sessionId: string, metrics: StreamingPerformance): Promise<void> {
    const performanceKey = `${this.METRICS_PREFIX}performance:${sessionId}`;

    await this.redis.hmset(performanceKey, {
      currentBitrate: metrics.currentBitrate,
      averageBitrate: metrics.averageBitrate,
      bufferHealth: metrics.bufferHealth,
      dropoutRate: metrics.dropoutRate,
      latency: metrics.latency,
      packetLoss: metrics.packetLoss,
      cpuUsage: metrics.cpuUsage,
      networkUtilization: metrics.networkUtilization,
      timestamp: Date.now()
    });

    await this.redis.expire(performanceKey, this.ANALYTICS_TTL);

    // TODO: Store historical performance data when performanceMetrics model is available
    // await this.prisma.performanceMetrics.create({
    //   data: {
    //     sessionId,
    //     currentBitrate: metrics.currentBitrate,
    //     averageBitrate: metrics.averageBitrate,
    //     bufferHealth: metrics.bufferHealth,
    //     dropoutRate: metrics.dropoutRate,
    //     latency: metrics.latency,
    //     packetLoss: metrics.packetLoss,
    //     cpuUsage: metrics.cpuUsage,
    //     networkUtilization: metrics.networkUtilization,
    //     recordedAt: new Date()
    //   }
    // });
  }

  async trackUserPreferences(userId: string, preferences: QualityPreferences): Promise<void> {
    const preferencesKey = `${this.METRICS_PREFIX}preferences:${userId}`;

    await this.redis.hmset(preferencesKey, {
      preferredQuality: preferences.preferredQuality,
      autoAdaptive: preferences.autoAdaptive.toString(),
      powerSaveMode: preferences.powerSaveMode.toString(),
      dataSaverMode: preferences.dataSaverMode.toString(),
      prioritizeStability: preferences.prioritizeStability.toString(),
      updatedAt: Date.now()
    });

    await this.redis.expire(preferencesKey, this.ANALYTICS_TTL * 7); // Keep for a week

    // TODO: Store in database for long-term analysis when userPreferences model is available
    // await this.prisma.userPreferences.upsert({
    //   where: { userId },
    //   create: {
    //     userId,
    //     preferredQuality: preferences.preferredQuality,
    //     autoAdaptive: preferences.autoAdaptive,
    //     powerSaveMode: preferences.powerSaveMode,
    //     dataSaverMode: preferences.dataSaverMode,
    //     prioritizeStability: preferences.prioritizeStability,
    //     updatedAt: new Date()
    //   },
    //   update: {
    //     preferredQuality: preferences.preferredQuality,
    //     autoAdaptive: preferences.autoAdaptive,
    //     powerSaveMode: preferences.powerSaveMode,
    //     dataSaverMode: preferences.dataSaverMode,
    //     prioritizeStability: preferences.prioritizeStability,
    //     updatedAt: new Date()
    //   }
    // });
  }

  async getQualityStatistics(timeframe: 'day' | 'week' | 'month'): Promise<QualityStatistics> {
    const cacheKey = `${this.METRICS_PREFIX}quality_stats:${timeframe}`;

    // Check cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Calculate statistics from database
    const _endDate = new Date();
    const startDate = new Date();

    switch (timeframe) {
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    // TODO: Query performance metrics when models are available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const performanceMetrics: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qualityEvents: any[] = [];

    // const performanceMetrics = await this.prisma.performanceMetrics.findMany({
    //   where: {
    //     recordedAt: {
    //       gte: startDate,
    //       lte: endDate
    //     }
    //   }
    // });

    // const qualityEvents = await this.prisma.usageEvent.findMany({
    //   where: {
    //     type: 'quality_changed',
    //     timestamp: {
    //       gte: startDate,
    //       lte: endDate
    //     }
    //   }
    // });

    // Calculate distribution by quality
    const distributionByQuality: Record<string, number> = {
      standard: 0,
      high: 0,
      lossless: 0,
      spatial: 0
    };

    qualityEvents.forEach(event => {
      const metadata = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
      if (metadata.to && distributionByQuality[metadata.to] !== undefined) {
        distributionByQuality[metadata.to]++;
      }
    });

    // Calculate average performance
    const averagePerformance: StreamingPerformance = {
      currentBitrate: this.calculateAverage(performanceMetrics, 'currentBitrate'),
      averageBitrate: this.calculateAverage(performanceMetrics, 'averageBitrate'),
      bufferHealth: this.calculateAverage(performanceMetrics, 'bufferHealth'),
      dropoutRate: this.calculateAverage(performanceMetrics, 'dropoutRate'),
      latency: this.calculateAverage(performanceMetrics, 'latency'),
      packetLoss: this.calculateAverage(performanceMetrics, 'packetLoss'),
      cpuUsage: this.calculateAverage(performanceMetrics, 'cpuUsage'),
      networkUtilization: this.calculateAverage(performanceMetrics, 'networkUtilization')
    };

    const statistics: QualityStatistics = {
      distributionByQuality,
      averagePerformance,
      adaptationFrequency: qualityEvents.length,
      userSatisfactionScore: this.calculateSatisfactionScore(averagePerformance),
      commonIssues: this.identifyCommonIssues(performanceMetrics)
    };

    // Cache result
    await this.redis.setex(cacheKey, 3600, JSON.stringify(statistics)); // Cache for 1 hour

    return statistics;
  }

  // === Billing Analytics Service Implementation ===

  async recordRevenue(amount: number, tier: SubscriptionTier, _period: string): Promise<void> {
    const revenueKey = `${this.METRICS_PREFIX}revenue:${new Date().toISOString().split('T')[0]}`;

    await this.redis.hincrby(revenueKey, 'total', Math.round(amount * 100)); // Store in cents
    await this.redis.hincrby(revenueKey, `tier_${tier}`, Math.round(amount * 100));
    await this.redis.expire(revenueKey, this.ANALYTICS_TTL * 30); // Keep for 30 days

    // TODO: Store in database when revenueRecord model is available
    // await this.prisma.revenueRecord.create({
    //   data: {
    //     amount,
    //     tier,
    //     period,
    //     recordedAt: new Date()
    //   }
    // });
  }

  async recordChurn(userId: string, tier: SubscriptionTier, reason: string): Promise<void> {
    const churnKey = `${this.METRICS_PREFIX}churn:${new Date().toISOString().split('T')[0]}`;

    await this.redis.hincrby(churnKey, 'total', 1);
    await this.redis.hincrby(churnKey, `tier_${tier}`, 1);
    await this.redis.hincrby(churnKey, `reason_${reason}`, 1);
    await this.redis.expire(churnKey, this.ANALYTICS_TTL * 30);

    // TODO: Store in database when churnRecord model is available
    // await this.prisma.churnRecord.create({
    //   data: {
    //     userId,
    //     tier,
    //     reason,
    //     recordedAt: new Date()
    //   }
    // });
  }

  async trackPaymentFailure(userId: string, reason: string, amount: number): Promise<void> {
    const failureKey = `${this.METRICS_PREFIX}payment_failures:${new Date().toISOString().split('T')[0]}`;

    await this.redis.hincrby(failureKey, 'total', 1);
    await this.redis.hincrby(failureKey, `reason_${reason}`, 1);
    await this.redis.hincrby(failureKey, 'failed_amount', Math.round(amount * 100));
    await this.redis.expire(failureKey, this.ANALYTICS_TTL * 30);

    // TODO: Store in database when paymentFailure model is available
    // await this.prisma.paymentFailure.create({
    //   data: {
    //     userId,
    //     reason,
    //     amount,
    //     recordedAt: new Date()
    //   }
    // });
  }

  async calculateMetrics(timeframe: 'day' | 'week' | 'month'): Promise<BillingMetrics> {
    const cacheKey = `${this.METRICS_PREFIX}billing_metrics:${timeframe}`;

    // Check cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Calculate metrics from database
    const _endDate = new Date();
    const startDate = new Date();

    switch (timeframe) {
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    // TODO: Query records when models are available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const revenueRecords: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const churnRecords: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paymentFailures: any[] = [];

    // const [revenueRecords, churnRecords, paymentFailures] = await Promise.all([
    //   this.prisma.revenueRecord.findMany({
    //     where: { recordedAt: { gte: startDate, lte: endDate } }
    //   }),
    //   this.prisma.churnRecord.findMany({
    //     where: { recordedAt: { gte: startDate, lte: endDate } }
    //   }),
    //   this.prisma.paymentFailure.findMany({
    //     where: { recordedAt: { gte: startDate, lte: endDate } }
    //   })
    // ]);

    const metrics: BillingMetrics = {
      totalRevenue: revenueRecords.reduce((sum, record) => sum + (record.amount || 0), 0),
      monthlyRecurringRevenue: this.calculateMRR(revenueRecords),
      averageRevenuePerUser: this.calculateARPU(revenueRecords),
      churnRate: this.calculateChurnRate(churnRecords, revenueRecords),
      paymentFailureRate: this.calculatePaymentFailureRate(paymentFailures, revenueRecords),
      revenueByTier: this.calculateRevenueByTier(revenueRecords),
      revenueGrowth: this.calculateRevenueGrowth(timeframe),
      customerLifetimeValue: this.calculateCLV(revenueRecords, churnRecords)
    };

    // Cache result
    await this.redis.setex(cacheKey, 3600, JSON.stringify(metrics)); // Cache for 1 hour

    return metrics;
  }

  // === Subscription Analytics Implementation ===

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async recordSubscriptionEvent(event: any): Promise<void> {
    await this.recordEvent({
      id: `subscription_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: event.type,
      userId: event.userId,
      guildId: event.guildId,
      tier: event.tier,
      metadata: event,
      timestamp: event.timestamp || new Date()
    });
  }

  async trackUpgradeConversion(
    userId: string,
    fromTier: SubscriptionTier,
    toTier: SubscriptionTier,
    trigger: string,
    guildId: string = 'global'
  ): Promise<void> {
    const event: UsageEvent = {
      id: `upgrade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'subscription_upgraded',
      userId,
      guildId,
      tier: toTier,
      metadata: { fromTier, toTier, trigger },
      timestamp: new Date()
    };

    await this.recordEvent(event);
  }

  async trackChurnRisk(userId: string, riskScore: number, factors: string[]): Promise<void> {
    const riskKey = `${this.METRICS_PREFIX}churn_risk:${userId}`;

    await this.redis.hmset(riskKey, {
      riskScore: riskScore.toString(),
      factors: JSON.stringify(factors),
      lastUpdated: Date.now()
    });

    await this.redis.expire(riskKey, this.ANALYTICS_TTL * 7); // Keep for a week
  }

  async recordTrialConversion(userId: string, converted: boolean, daysUsed: number, guildId: string = 'global'): Promise<void> {
    const event: UsageEvent = {
      id: `trial_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: converted ? 'trial_converted' : 'trial_expired',
      userId,
      guildId,
      tier: 'free', // Trial represented as free tier for analytics
      metadata: { converted, daysUsed },
      timestamp: new Date()
    };

    await this.recordEvent(event);
  }

  // === Private Helper Methods ===

  private async updateRealTimeMetrics(event: UsageEvent): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const hourKey = `${this.METRICS_PREFIX}realtime:${today}:${new Date().getHours()}`;

    await this.redis.hincrby(hourKey, 'total_events', 1);
    await this.redis.hincrby(hourKey, `${event.type}_events`, 1);

    if (event.featureName) {
      await this.redis.hincrby(hourKey, `feature_${event.featureName}`, 1);
    }

    await this.redis.expire(hourKey, this.ANALYTICS_TTL);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deserializeUsageAnalytics(data: any): UsageAnalytics {
    const featureStatsArray = JSON.parse(data.featureStats || '[]');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const featureStats = new Map<FeatureName, any>(featureStatsArray);

    return UsageAnalytics.reconstitute(
      data.id,
      data.timeframe,
      data.totalEvents,
      featureStats,
      JSON.parse(data.conversionMetrics || '{}'),
      JSON.parse(data.trendsData || '{}'),
      data.createdAt,
      data.updatedAt
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculateAverage(metrics: any[], field: string): number {
    if (metrics.length === 0) return 0;
    const sum = metrics.reduce((total, metric) => total + (metric[field] || 0), 0);
    return sum / metrics.length;
  }

  private calculateSatisfactionScore(performance: StreamingPerformance): number {
    // Calculate satisfaction based on performance metrics
    const bufferScore = Math.min(100, performance.bufferHealth);
    const latencyScore = Math.max(0, 100 - performance.latency / 2);
    const dropoutScore = Math.max(0, 100 - performance.dropoutRate * 10);

    return Math.round((bufferScore + latencyScore + dropoutScore) / 3);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private identifyCommonIssues(metrics: any[]): { issue: string; frequency: number }[] {
    const issues: { issue: string; frequency: number }[] = [];

    const highLatency = metrics.filter(m => m.latency > 100).length;
    const highDropout = metrics.filter(m => m.dropoutRate > 5).length;
    const lowBuffer = metrics.filter(m => m.bufferHealth < 70).length;

    if (highLatency > 0) issues.push({ issue: 'High Latency', frequency: highLatency });
    if (highDropout > 0) issues.push({ issue: 'High Dropout Rate', frequency: highDropout });
    if (lowBuffer > 0) issues.push({ issue: 'Low Buffer Health', frequency: lowBuffer });

    return issues.sort((a, b) => b.frequency - a.frequency);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculateMRR(revenueRecords: any[]): number {
    // Calculate Monthly Recurring Revenue
    const monthlyRevenue = revenueRecords
      .filter(record => record.period === 'monthly')
      .reduce((sum, record) => sum + record.amount, 0);

    return monthlyRevenue;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculateARPU(revenueRecords: any[]): number {
    // Calculate Average Revenue Per User
    const uniqueUsers = new Set(revenueRecords.map(record => record.userId).filter(Boolean));
    const totalRevenue = revenueRecords.reduce((sum, record) => sum + (record.amount || 0), 0);

    return uniqueUsers.size > 0 ? totalRevenue / uniqueUsers.size : 0;
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculateChurnRate(churnRecords: any[], revenueRecords: any[]): number {
    const uniqueUsers = new Set(revenueRecords.map(record => record.userId).filter(Boolean));
    const churnedUsers = churnRecords.length;

    return uniqueUsers.size > 0 ? (churnedUsers / uniqueUsers.size) * 100 : 0;
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculatePaymentFailureRate(failures: any[], revenue: any[]): number {
    const totalTransactions = revenue.length + failures.length;
    return totalTransactions > 0 ? (failures.length / totalTransactions) * 100 : 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculateRevenueByTier(revenueRecords: any[]): Record<SubscriptionTier, number> {
    const revenueByTier: Record<SubscriptionTier, number> = {
      free: 0,
      basic: 0,
      premium: 0,
      enterprise: 0
    };

    revenueRecords.forEach(record => {
      const tier = record.tier as SubscriptionTier;
      if (tier && revenueByTier[tier] !== undefined) {
        revenueByTier[tier] += record.amount || 0;
      }
    });

    return revenueByTier;
  }

  private calculateRevenueGrowth(_timeframe: 'day' | 'week' | 'month'): number {
    // Simplified growth calculation - would compare with previous period
    return Math.random() * 20 - 5; // -5% to +15% random for demonstration
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculateCLV(revenueRecords: any[], churnRecords: any[]): number {
    // Simplified Customer Lifetime Value calculation
    const averageRevenue = this.calculateARPU(revenueRecords);
    const churnRate = this.calculateChurnRate(churnRecords, revenueRecords) / 100;

    return churnRate > 0 ? averageRevenue / churnRate : averageRevenue * 12; // 12 months default
  }
}