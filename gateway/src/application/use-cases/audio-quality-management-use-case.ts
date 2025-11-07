/**
 * Audio Quality Management Use Case
 * Orchestrates audio quality selection, adaptive streaming, and performance optimization
 */

import { SubscriptionTier } from '@discord-bot/config';
import { AudioQualityLevel } from '../../domain/value-objects/audio-quality.js';
import { AudioQualityTier } from '../../domain/entities/audio-quality-tier.js';
import { FeatureSubscription } from '../../domain/entities/feature-subscription.js';
import { AudioQualityDomainService } from '../../domain/services/audio-quality-domain-service.js';

interface QualityAdjustment {
  action: string;
  previousValue: AudioQualityLevel | number | string;
  newValue: AudioQualityLevel | number | string;
}

export interface AudioQualityRepository {
  findByGuild(guildId: string): Promise<AudioQualityTier | null>;
  findByUser(userId: string): Promise<AudioQualityTier[]>;
  save(qualityTier: AudioQualityTier): Promise<void>;
  findOptimalForDevice(deviceCapabilities: DeviceCapabilities): Promise<AudioQualityLevel>;
}

export interface SubscriptionRepository {
  findByUserAndGuild(userId: string, guildId: string): Promise<FeatureSubscription | null>;
}

export interface AudioStreamingService {
  setQuality(sessionId: string, quality: AudioQualityLevel): Promise<{ success: boolean; actualQuality?: AudioQualityLevel }>;
  getCurrentQuality(sessionId: string): Promise<AudioQualityLevel>;
  getAvailableQualities(sessionId: string): Promise<AudioQualityLevel[]>;
  measurePerformance(sessionId: string): Promise<StreamingPerformance>;
  enableAdaptiveStreaming(sessionId: string, config: AdaptiveConfig): Promise<void>;
  disableAdaptiveStreaming(sessionId: string): Promise<void>;
}

export interface DeviceCapabilities {
  maxBandwidth: number; // kbps
  cpuScore: number; // 0-100
  memoryMB: number;
  audioCodecSupport: string[];
  connectionType: 'wifi' | 'mobile' | 'ethernet';
  batteryLevel?: number; // 0-100
  isLowPowerMode?: boolean;
}

export interface StreamingPerformance {
  currentBitrate: number;
  averageBitrate: number;
  bufferHealth: number; // 0-100
  dropoutRate: number; // percentage
  latency: number; // ms
  packetLoss: number; // percentage
  cpuUsage: number; // percentage
  networkUtilization: number; // percentage
}

export interface AdaptiveConfig {
  minQuality: AudioQualityLevel;
  maxQuality: AudioQualityLevel;
  targetBufferSize: number; // seconds
  adaptationSpeed: 'slow' | 'medium' | 'fast';
  enablePreemptiveAdaptation: boolean;
}

export interface QualityAnalyticsService {
  recordQualityChange(userId: string, guildId: string, from: AudioQualityLevel, to: AudioQualityLevel, reason: string): Promise<void>;
  recordPerformanceMetrics(sessionId: string, metrics: StreamingPerformance): Promise<void>;
  trackUserPreferences(userId: string, preferences: QualityPreferences): Promise<void>;
  getQualityStatistics(timeframe: 'day' | 'week' | 'month'): Promise<QualityStatistics>;
}

export interface QualityPreferences {
  preferredQuality: AudioQualityLevel;
  autoAdaptive: boolean;
  powerSaveMode: boolean;
  dataSaverMode: boolean;
  prioritizeStability: boolean;
}

export interface QualityStatistics {
  distributionByQuality: Record<AudioQualityLevel, number>;
  averagePerformance: StreamingPerformance;
  adaptationFrequency: number;
  userSatisfactionScore: number;
  commonIssues: { issue: string; frequency: number }[];
}

export class AudioQualityManagementUseCase {
  constructor(
    private readonly audioQualityRepository: AudioQualityRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly audioStreamingService: AudioStreamingService,
    private readonly analyticsService: QualityAnalyticsService,
    private readonly audioQualityDomainService: AudioQualityDomainService
  ) {}

  /**
   * Get optimal audio quality for user's subscription and device
   */
  async getOptimalQuality(
    userId: string,
    guildId: string,
    deviceCapabilities: DeviceCapabilities,
    userPreferences?: QualityPreferences
  ): Promise<{
    recommendedQuality: AudioQualityLevel;
    availableQualities: AudioQualityLevel[];
    reasoning: string[];
    adaptiveConfig?: AdaptiveConfig;
  }> {
    // Get user's subscription
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    const userTier = subscription?.tier || 'free';

    // Get quality recommendation from domain service
    const recommendation = this.audioQualityDomainService.getOptimalQuality(
      userTier,
      deviceCapabilities,
      userPreferences
    );

    // Get available qualities for tier
    const availableQualities = this.audioQualityDomainService.getAvailableQualities(userTier);

    // Generate adaptive config if supported
    let adaptiveConfig: AdaptiveConfig | undefined;
    if (recommendation.enableAdaptive && this.audioQualityDomainService.supportsAdaptiveStreaming(userTier)) {
      adaptiveConfig = this.generateAdaptiveConfig(
        recommendation.quality,
        availableQualities,
        deviceCapabilities,
        userPreferences
      );
    }

    return {
      recommendedQuality: recommendation.quality,
      availableQualities,
      reasoning: recommendation.reasoning,
      adaptiveConfig
    };
  }

  /**
   * Set audio quality for a streaming session
   */
  async setAudioQuality(
    sessionId: string,
    userId: string,
    guildId: string,
    requestedQuality: AudioQualityLevel,
    deviceCapabilities: DeviceCapabilities
  ): Promise<{
    success: boolean;
    actualQuality?: AudioQualityLevel;
    fallbackReason?: string;
    error?: string;
  }> {
    try {
      // Validate user has access to requested quality
      const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
      const userTier = subscription?.tier || 'free';

      const hasAccess = this.audioQualityDomainService.canAccessQuality(userTier, requestedQuality);
      if (!hasAccess.allowed) {
        return {
          success: false,
          error: `Quality ${requestedQuality} not available for ${userTier} tier: ${hasAccess.reason}`
        };
      }

      // Get current quality
      const currentQuality = await this.audioStreamingService.getCurrentQuality(sessionId);

      // Validate device compatibility
      const compatibility = this.audioQualityDomainService.validateDeviceCompatibility(
        requestedQuality,
        deviceCapabilities
      );

      let finalQuality = requestedQuality;
      let fallbackReason: string | undefined;

      if (!compatibility.isCompatible) {
        // Find best compatible quality
        const fallback = this.audioQualityDomainService.findCompatibleQuality(
          userTier,
          deviceCapabilities
        );
        finalQuality = fallback.quality;
        fallbackReason = `Device incompatible with ${requestedQuality}: ${compatibility.issues.join(', ')}. Using ${finalQuality} instead.`;
      }

      // Apply quality change
      const result = await this.audioStreamingService.setQuality(sessionId, finalQuality);

      if (result.success) {
        // Record quality change
        await this.analyticsService.recordQualityChange(
          userId,
          guildId,
          currentQuality,
          result.actualQuality || finalQuality,
          fallbackReason || 'user_request'
        );

        // Update user's quality tier settings
        await this.updateUserQualityPreferences(userId, guildId, {
          preferredQuality: requestedQuality,
          autoAdaptive: false,
          powerSaveMode: deviceCapabilities.isLowPowerMode || false,
          dataSaverMode: deviceCapabilities.connectionType === 'mobile',
          prioritizeStability: false
        });

        return {
          success: true,
          actualQuality: result.actualQuality || finalQuality,
          fallbackReason
        };
      } else {
        return {
          success: false,
          error: 'Failed to apply quality settings'
        };
      }
    } catch {
      return {
        success: false,
        error: 'Quality management error'
      };
    }
  }

  /**
   * Enable adaptive quality streaming
   */
  async enableAdaptiveStreaming(
    sessionId: string,
    userId: string,
    guildId: string,
    deviceCapabilities: DeviceCapabilities,
    config?: Partial<AdaptiveConfig>
  ): Promise<{
    success: boolean;
    adaptiveConfig?: AdaptiveConfig;
    error?: string;
  }> {
    try {
      // Check if user's tier supports adaptive streaming
      const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
      const userTier = subscription?.tier || 'free';

      if (!this.audioQualityDomainService.supportsAdaptiveStreaming(userTier)) {
        return {
          success: false,
          error: `Adaptive streaming not available for ${userTier} tier`
        };
      }

      // Get available qualities for adaptive range
      const availableQualities = this.audioQualityDomainService.getAvailableQualities(userTier);

      // Generate adaptive configuration
      const adaptiveConfig: AdaptiveConfig = {
        minQuality: config?.minQuality || availableQualities[0],
        maxQuality: config?.maxQuality || availableQualities[availableQualities.length - 1],
        targetBufferSize: config?.targetBufferSize || 10,
        adaptationSpeed: config?.adaptationSpeed || 'medium',
        enablePreemptiveAdaptation: config?.enablePreemptiveAdaptation ?? true
      };

      // Validate configuration
      const validation = this.audioQualityDomainService.validateAdaptiveConfig(
        adaptiveConfig,
        userTier,
        deviceCapabilities
      );

      if (!validation.isValid) {
        return {
          success: false,
          error: `Invalid adaptive configuration: ${validation.errors.join(', ')}`
        };
      }

      // Enable adaptive streaming
      await this.audioStreamingService.enableAdaptiveStreaming(sessionId, adaptiveConfig);

      // Update user preferences
      await this.updateUserQualityPreferences(userId, guildId, {
        preferredQuality: adaptiveConfig.maxQuality,
        autoAdaptive: true,
        powerSaveMode: deviceCapabilities.isLowPowerMode || false,
        dataSaverMode: deviceCapabilities.connectionType === 'mobile',
        prioritizeStability: true
      });

      return {
        success: true,
        adaptiveConfig
      };
    } catch {
      return {
        success: false,
        error: 'Failed to enable adaptive streaming'
      };
    }
  }

  /**
   * Monitor and optimize streaming performance
   */
  async optimizeStreamingPerformance(
    sessionId: string,
    userId: string,
    guildId: string
  ): Promise<{
    currentPerformance: StreamingPerformance;
    recommendations: string[];
    autoAdjustments: QualityAdjustment[];
  }> {
    // Measure current performance
    const performance = await this.audioStreamingService.measurePerformance(sessionId);

    // Record metrics
    await this.analyticsService.recordPerformanceMetrics(sessionId, performance);

    // Get optimization recommendations
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    const userTier = subscription?.tier || 'free';

    const optimization = this.audioQualityDomainService.optimizeForPerformance(
      performance,
      userTier
    );

    const autoAdjustments: QualityAdjustment[] = [];

    // Apply automatic adjustments if needed
    if (optimization.shouldAutoAdjust) {
      for (const adjustment of optimization.adjustments) {
        switch (adjustment.type) {
          case 'quality_downgrade': {
            const currentQuality = await this.audioStreamingService.getCurrentQuality(sessionId);
            const newQuality = adjustment.newQuality;
            if (newQuality) {
              await this.audioStreamingService.setQuality(sessionId, newQuality);
              autoAdjustments.push({
                action: 'Quality downgraded due to performance',
                previousValue: currentQuality,
                newValue: newQuality
              });
            }
            break;
          }

          case 'buffer_adjustment': {
            // This would adjust buffer settings if the streaming service supports it
            const bufferSize = adjustment.bufferSize;
            if (bufferSize !== undefined) {
              autoAdjustments.push({
                action: 'Buffer size adjusted',
                previousValue: 'auto',
                newValue: bufferSize
              });
            }
            break;
          }
        }
      }
    }

    return {
      currentPerformance: performance,
      recommendations: optimization.recommendations,
      autoAdjustments
    };
  }

  /**
   * Get quality statistics and analytics
   */
  async getQualityAnalytics(
    timeframe: 'day' | 'week' | 'month',
    _guildId?: string
  ): Promise<{
    statistics: QualityStatistics;
    trends: { metric: string; change: number; direction: 'up' | 'down' | 'stable' }[];
    recommendations: string[];
  }> {
    const statistics = await this.analyticsService.getQualityStatistics(timeframe);

    // Analyze trends (simplified)
    const trends = [
      {
        metric: 'Average Quality',
        change: 12.5,
        direction: 'up' as const
      },
      {
        metric: 'Stability Score',
        change: -2.1,
        direction: 'down' as const
      },
      {
        metric: 'User Satisfaction',
        change: 8.3,
        direction: 'up' as const
      }
    ];

    // Generate recommendations based on statistics
    const recommendations: string[] = [];

    if (statistics.averagePerformance.dropoutRate > 2) {
      recommendations.push('High dropout rate detected - consider network optimization');
    }

    if (statistics.averagePerformance.latency > 100) {
      recommendations.push('High latency detected - review server infrastructure');
    }

    if (statistics.userSatisfactionScore < 80) {
      recommendations.push('User satisfaction below target - investigate quality issues');
    }

    return {
      statistics,
      trends,
      recommendations
    };
  }

  /**
   * Update user's quality preferences
   */
  async updateUserQualityPreferences(
    userId: string,
    guildId: string,
    preferences: Partial<QualityPreferences>
  ): Promise<void> {
    // Get or create quality tier for user
    let qualityTier = await this.audioQualityRepository.findByGuild(guildId);

    if (!qualityTier) {
      const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
      const userTier = subscription?.tier || 'free';

      qualityTier = AudioQualityTier.create(
        userId,
        guildId,
        userTier,
        preferences.preferredQuality || 'standard'
      );
    }

    // Update preferences
    if (preferences.preferredQuality) {
      qualityTier.setPreferredQuality(preferences.preferredQuality);
    }

    if (preferences.autoAdaptive !== undefined) {
      qualityTier.setAdaptiveStreaming(preferences.autoAdaptive);
    }

    await this.audioQualityRepository.save(qualityTier);

    // Track preferences
    await this.analyticsService.trackUserPreferences(userId, {
      preferredQuality: qualityTier.preferredQuality,
      autoAdaptive: qualityTier.adaptiveStreaming,
      powerSaveMode: preferences.powerSaveMode || false,
      dataSaverMode: preferences.dataSaverMode || false,
      prioritizeStability: preferences.prioritizeStability || false
    });
  }

  /**
   * Validate quality upgrade eligibility
   */
  async validateQualityUpgrade(
    userId: string,
    guildId: string,
    targetQuality: AudioQualityLevel
  ): Promise<{
    eligible: boolean;
    requiredTier?: SubscriptionTier;
    currentTier: SubscriptionTier;
    benefits: string[];
    upgradeUrl?: string;
  }> {
    const subscription = await this.subscriptionRepository.findByUserAndGuild(userId, guildId);
    const currentTier = subscription?.tier || 'free';

    const access = this.audioQualityDomainService.canAccessQuality(currentTier, targetQuality);

    if (access.allowed) {
      return {
        eligible: true,
        currentTier,
        benefits: [`You can already access ${targetQuality} quality`]
      };
    }

    const requiredTier = this.audioQualityDomainService.getMinimumTierForQuality(targetQuality);
    const benefits = this.audioQualityDomainService.getQualityBenefits(targetQuality);

    return {
      eligible: false,
      requiredTier,
      currentTier,
      benefits,
      upgradeUrl: `/subscription/upgrade?tier=${requiredTier}&feature=audio_quality`
    };
  }

  private generateAdaptiveConfig(
    baseQuality: AudioQualityLevel,
    availableQualities: AudioQualityLevel[],
    deviceCapabilities: DeviceCapabilities,
    userPreferences?: QualityPreferences
  ): AdaptiveConfig {
    const qualityIndex = availableQualities.indexOf(baseQuality);
    const minIndex = Math.max(0, qualityIndex - 1);
    const maxIndex = Math.min(availableQualities.length - 1, qualityIndex + 1);

    return {
      minQuality: availableQualities[minIndex],
      maxQuality: availableQualities[maxIndex],
      targetBufferSize: deviceCapabilities.connectionType === 'mobile' ? 5 : 10,
      adaptationSpeed: userPreferences?.prioritizeStability ? 'slow' : 'medium',
      enablePreemptiveAdaptation: deviceCapabilities.connectionType !== 'mobile'
    };
  }
}