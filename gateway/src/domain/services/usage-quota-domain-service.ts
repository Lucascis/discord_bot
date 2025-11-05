/**
 * Usage Quota Domain Service
 * Contains domain logic for quota management, validation, and optimization
 */

import { SubscriptionTier } from '@discord-bot/config';
import { UsageQuota, QuotaType } from '../value-objects/usage-quota.js';

export interface QuotaValidationResult {
  readonly isValid: boolean;
  readonly violations: QuotaViolation[];
  readonly warnings: QuotaWarning[];
  readonly recommendations: string[];
}

export interface QuotaViolation {
  readonly quotaType: QuotaType;
  readonly current: number;
  readonly limit: number;
  readonly severity: 'warning' | 'error' | 'critical';
  readonly message: string;
}

export interface QuotaWarning {
  readonly quotaType: QuotaType;
  readonly usagePercentage: number;
  readonly message: string;
  readonly timeUntilReset: number;
}

export interface QuotaOptimization {
  readonly quotaType: QuotaType;
  readonly currentLimit: number;
  readonly recommendedLimit: number;
  readonly reason: string;
  readonly impact: 'positive' | 'neutral' | 'negative';
  readonly confidenceScore: number;
}

export interface QuotaForecast {
  readonly quotaType: QuotaType;
  readonly predictedUsage: number;
  readonly timeframe: 'week' | 'month' | 'quarter';
  readonly exceedsLimit: boolean;
  readonly recommendedAction: string;
}

export class UsageQuotaDomainService {

  /**
   * Validates quota usage for a subscription before action
   */
  validateQuotaUsage(
    quotas: Map<QuotaType, UsageQuota>,
    plannedUsage: Map<QuotaType, number>
  ): QuotaValidationResult {
    const violations: QuotaViolation[] = [];
    const warnings: QuotaWarning[] = [];
    const recommendations: string[] = [];

    for (const [quotaType, usage] of plannedUsage.entries()) {
      const quota = quotas.get(quotaType);
      if (!quota) continue;

      const result = this.validateSingleQuota(quota, usage);
      violations.push(...result.violations);
      warnings.push(...result.warnings);
    }

    // Generate optimization recommendations
    if (violations.length > 0) {
      recommendations.push('Consider upgrading subscription tier for higher limits');
    }

    if (warnings.length > 0) {
      recommendations.push('Monitor usage to avoid hitting limits');
    }

    return {
      isValid: violations.filter(v => v.severity === 'error' || v.severity === 'critical').length === 0,
      violations,
      warnings,
      recommendations
    };
  }

  /**
   * Calculates optimal quota allocation for a subscription tier
   */
  calculateOptimalQuotas(
    tier: SubscriptionTier,
    historicalUsage: Map<QuotaType, number[]>,
    growthProjection: number = 1.2
  ): Map<QuotaType, QuotaOptimization> {
    const optimizations = new Map<QuotaType, QuotaOptimization>();

    const quotaTypes: QuotaType[] = [
      'queue_size',
      'track_duration',
      'monthly_playtime',
      'api_requests',
      'ai_recommendations',
      'voice_commands',
      'custom_playlists',
      'concurrent_sessions',
      'premium_servers',
      'storage_mb'
    ];

    for (const quotaType of quotaTypes) {
      const currentQuota = UsageQuota.forTierAndType(tier, quotaType);
      const usage = historicalUsage.get(quotaType) || [];

      if (usage.length === 0) continue;

      const avgUsage = usage.reduce((sum, val) => sum + val, 0) / usage.length;
      const maxUsage = Math.max(...usage);
      const projectedUsage = Math.ceil(maxUsage * growthProjection);

      let recommendedLimit = currentQuota.limit;
      let reason = 'Current limit is appropriate';
      let impact: 'positive' | 'neutral' | 'negative' = 'neutral';
      let confidenceScore = 70;

      // Analyze usage patterns
      if (currentQuota.isUnlimited) {
        reason = 'Unlimited quota - no changes needed';
        confidenceScore = 100;
      } else if (projectedUsage > currentQuota.limit) {
        recommendedLimit = this.calculateNewLimit(projectedUsage, quotaType);
        reason = `Current limit too low for projected usage (${projectedUsage})`;
        impact = 'negative';
        confidenceScore = 85;
      } else if (avgUsage < currentQuota.limit * 0.3) {
        recommendedLimit = Math.max(avgUsage * 2, this.getMinimumLimit(quotaType));
        reason = 'Low usage suggests limit could be reduced for cost optimization';
        impact = 'positive';
        confidenceScore = 75;
      }

      optimizations.set(quotaType, {
        quotaType,
        currentLimit: currentQuota.limit,
        recommendedLimit,
        reason,
        impact,
        confidenceScore
      });
    }

    return optimizations;
  }

  /**
   * Predicts quota usage based on trends
   */
  forecastQuotaUsage(
    quotas: Map<QuotaType, UsageQuota>,
    usageHistory: Map<QuotaType, number[]>,
    timeframe: 'week' | 'month' | 'quarter' = 'month'
  ): Map<QuotaType, QuotaForecast> {
    const forecasts = new Map<QuotaType, QuotaForecast>();

    for (const [quotaType, quota] of quotas.entries()) {
      const history = usageHistory.get(quotaType) || [];
      if (history.length < 3) continue;

      const trend = this.calculateUsageTrend(history);
      const lastUsage = history[history.length - 1];

      let multiplier = 1;
      switch (timeframe) {
        case 'week':
          multiplier = 0.25;
          break;
        case 'month':
          multiplier = 1;
          break;
        case 'quarter':
          multiplier = 3;
          break;
      }

      const predictedUsage = Math.ceil(lastUsage * (1 + trend / 100) * multiplier);
      const exceedsLimit = !quota.isUnlimited && predictedUsage > quota.limit;

      let recommendedAction = 'Monitor usage';
      if (exceedsLimit) {
        recommendedAction = 'Upgrade subscription or optimize usage';
      } else if (predictedUsage > quota.limit * 0.8) {
        recommendedAction = 'Consider upgrading before limit is reached';
      }

      forecasts.set(quotaType, {
        quotaType,
        predictedUsage,
        timeframe,
        exceedsLimit,
        recommendedAction
      });
    }

    return forecasts;
  }

  /**
   * Determines if quota burst allowance should be granted
   */
  shouldAllowQuotaBurst(
    quota: UsageQuota,
    requestedAmount: number,
    tier: SubscriptionTier,
    accountHistory: { violations: number; goodStanding: boolean }
  ): { allowed: boolean; reason: string; conditions?: string[] } {
    // No burst for unlimited quotas
    if (quota.isUnlimited) {
      return {
        allowed: true,
        reason: 'Unlimited quota'
      };
    }

    // Hard limits cannot be burst
    if (quota.isHardLimit) {
      return {
        allowed: false,
        reason: 'Hard limit cannot be exceeded'
      };
    }

    // Check account standing
    if (!accountHistory.goodStanding || accountHistory.violations > 3) {
      return {
        allowed: false,
        reason: 'Account not in good standing'
      };
    }

    // Calculate burst amount
    const currentUsage = quota.used;
    const totalRequested = currentUsage + requestedAmount;
    const burstAmount = totalRequested - quota.limit;

    // Determine burst allowance based on tier
    const burstAllowances = {
      free: 0,
      basic: 0.1,    // 10% burst
      premium: 0.25, // 25% burst
      enterprise: 0.5 // 50% burst
    };

    const maxBurst = quota.limit * burstAllowances[tier];

    if (burstAmount <= maxBurst) {
      return {
        allowed: true,
        reason: `Burst allowance granted (${burstAmount}/${maxBurst})`,
        conditions: [
          'Will be charged overage fees',
          'Must be resolved by next billing cycle'
        ]
      };
    }

    return {
      allowed: false,
      reason: `Burst amount (${burstAmount}) exceeds allowance (${maxBurst})`
    };
  }

  /**
   * Calculates quota efficiency score for optimization
   */
  calculateQuotaEfficiency(
    quotas: Map<QuotaType, UsageQuota>,
    actualUsage: Map<QuotaType, number>
  ): { overallScore: number; quotaScores: Map<QuotaType, number>; recommendations: string[] } {
    const quotaScores = new Map<QuotaType, number>();
    const recommendations: string[] = [];
    let totalScore = 0;
    let quotaCount = 0;

    for (const [quotaType, quota] of quotas.entries()) {
      const usage = actualUsage.get(quotaType) || 0;
      let efficiency = 0;

      if (quota.isUnlimited) {
        // For unlimited quotas, efficiency based on reasonable usage
        const reasonableLimit = this.getReasonableUsageLimit(quotaType);
        efficiency = Math.min(100, (usage / reasonableLimit) * 100);
      } else {
        // For limited quotas, efficiency is utilization percentage
        efficiency = Math.min(100, (usage / quota.limit) * 100);
      }

      quotaScores.set(quotaType, efficiency);
      totalScore += efficiency;
      quotaCount++;

      // Generate recommendations
      if (efficiency < 25) {
        recommendations.push(`${quotaType} is underutilized - consider exploring features`);
      } else if (efficiency > 90) {
        recommendations.push(`${quotaType} usage is high - consider upgrading`);
      }
    }

    const overallScore = quotaCount > 0 ? totalScore / quotaCount : 0;

    return {
      overallScore,
      quotaScores,
      recommendations
    };
  }

  /**
   * Determines if graceful degradation should be applied
   */
  shouldApplyGracefulDegradation(
    quota: UsageQuota,
    systemLoad: number,
    userPriority: number
  ): { apply: boolean; degradationLevel: number; alternatives: string[] } {
    // No degradation for enterprise tier during normal load
    if (systemLoad < 70 || quota.type === 'premium_servers') {
      return {
        apply: false,
        degradationLevel: 0,
        alternatives: []
      };
    }

    // Calculate degradation level based on system load and user priority
    let degradationLevel = 0;

    if (systemLoad > 90) {
      degradationLevel = 3; // Severe degradation
    } else if (systemLoad > 80) {
      degradationLevel = 2; // Moderate degradation
    } else {
      degradationLevel = 1; // Light degradation
    }

    // Adjust for user priority
    if (userPriority > 80) {
      degradationLevel = Math.max(0, degradationLevel - 1);
    } else if (userPriority < 30) {
      degradationLevel = Math.min(3, degradationLevel + 1);
    }

    const alternatives = this.getGracefulAlternatives(quota.type, degradationLevel);

    return {
      apply: degradationLevel > 0,
      degradationLevel,
      alternatives
    };
  }

  private validateSingleQuota(quota: UsageQuota, plannedUsage: number): {
    violations: QuotaViolation[];
    warnings: QuotaWarning[];
  } {
    const violations: QuotaViolation[] = [];
    const warnings: QuotaWarning[] = [];

    const totalUsage = quota.used + plannedUsage;
    const usagePercentage = quota.isUnlimited ? 0 : (totalUsage / quota.limit) * 100;

    // Check for violations
    if (quota.isBlocked()) {
      violations.push({
        quotaType: quota.type,
        current: quota.used,
        limit: quota.limit,
        severity: 'critical',
        message: `Quota already exceeded - no additional usage allowed`
      });
    } else if (!quota.isUnlimited && totalUsage > quota.limit) {
      const severity = quota.isHardLimit ? 'error' : 'warning';
      violations.push({
        quotaType: quota.type,
        current: totalUsage,
        limit: quota.limit,
        severity,
        message: `Planned usage would exceed limit by ${totalUsage - quota.limit}`
      });
    }

    // Check for warnings
    if (!quota.isUnlimited && usagePercentage > 80) {
      warnings.push({
        quotaType: quota.type,
        usagePercentage,
        message: `Usage at ${usagePercentage.toFixed(1)}% of limit`,
        timeUntilReset: quota.getTimeUntilReset()
      });
    }

    return { violations, warnings };
  }

  private calculateUsageTrend(history: number[]): number {
    if (history.length < 2) return 0;

    const recent = history.slice(-3);
    const older = history.slice(-6, -3);

    if (older.length === 0) return 0;

    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;

    return olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
  }

  private calculateNewLimit(projectedUsage: number, quotaType: QuotaType): number {
    const buffer = this.getBufferPercentage(quotaType);
    return Math.ceil(projectedUsage * (1 + buffer / 100));
  }

  private getBufferPercentage(quotaType: QuotaType): number {
    const buffers: Record<QuotaType, number> = {
      queue_size: 50,           // 50% buffer for queue spikes
      track_duration: 20,       // 20% buffer for longer tracks
      monthly_playtime: 30,     // 30% buffer for usage growth
      api_requests: 100,        // 100% buffer for API bursts
      ai_recommendations: 50,   // 50% buffer for feature adoption
      voice_commands: 75,       // 75% buffer for voice usage spikes
      custom_playlists: 25,     // 25% buffer for playlist growth
      concurrent_sessions: 40,  // 40% buffer for session spikes
      premium_servers: 20,      // 20% buffer for server growth
      storage_mb: 30           // 30% buffer for data growth
    };

    return buffers[quotaType] || 25;
  }

  private getMinimumLimit(quotaType: QuotaType): number {
    const minimums: Record<QuotaType, number> = {
      queue_size: 10,
      track_duration: 300,      // 5 minutes
      monthly_playtime: 1800,   // 30 minutes
      api_requests: 100,
      ai_recommendations: 10,
      voice_commands: 10,
      custom_playlists: 3,
      concurrent_sessions: 1,
      premium_servers: 1,
      storage_mb: 50
    };

    return minimums[quotaType] || 1;
  }

  private getReasonableUsageLimit(quotaType: QuotaType): number {
    const reasonable: Record<QuotaType, number> = {
      queue_size: 200,
      track_duration: 7200,     // 2 hours
      monthly_playtime: 86400,  // 24 hours
      api_requests: 5000,
      ai_recommendations: 200,
      voice_commands: 100,
      custom_playlists: 20,
      concurrent_sessions: 5,
      premium_servers: 10,
      storage_mb: 1000
    };

    return reasonable[quotaType] || 100;
  }

  private getGracefulAlternatives(quotaType: QuotaType, degradationLevel: number): string[] {
    const alternatives: Record<QuotaType, string[]> = {
      queue_size: ['Reduce queue length', 'Cache fewer items', 'Remove duplicates'],
      track_duration: ['Suggest shorter tracks', 'Enable track previews', 'Recommend highlights'],
      monthly_playtime: ['Suggest breaks', 'Enable data saver mode', 'Recommend offline content'],
      api_requests: ['Cache responses longer', 'Batch requests', 'Reduce update frequency'],
      ai_recommendations: ['Use cached recommendations', 'Reduce recommendation frequency', 'Use simpler algorithms'],
      voice_commands: ['Fallback to text commands', 'Reduce voice processing accuracy', 'Cache voice patterns'],
      custom_playlists: ['Limit new playlists', 'Suggest playlist merging', 'Enable read-only mode'],
      concurrent_sessions: ['Limit new sessions', 'Suggest session sharing', 'Enable session queuing'],
      premium_servers: ['Suggest server consolidation', 'Enable shared resources', 'Prioritize active servers'],
      storage_mb: ['Enable compression', 'Clear cache', 'Archive old data']
    };

    const typeAlternatives = alternatives[quotaType] || ['Reduce usage', 'Try again later'];
    return typeAlternatives.slice(0, degradationLevel);
  }
}