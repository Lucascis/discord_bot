/**
 * Audio Quality Domain Service
 * Contains domain logic for intelligent audio quality selection and optimization
 */

import { SubscriptionTier } from '@discord-bot/config';
import { AudioQuality, AudioQualityLevel } from '../value-objects/audio-quality.js';

export interface QualitySelectionCriteria {
  readonly userTier: SubscriptionTier;
  readonly connectionType: 'wifi' | 'mobile' | 'ethernet';
  readonly bandwidth: number; // kbps
  readonly deviceType: 'mobile' | 'desktop' | 'server';
  readonly batteryLevel?: number; // 0-100
  readonly dataLimit?: number; // MB per month
  readonly userPreference?: AudioQualityLevel;
}

export interface QualityRecommendation {
  readonly recommendedLevel: AudioQualityLevel;
  readonly reasons: string[];
  readonly confidence: number; // 0-100
  readonly alternatives: AudioQualityLevel[];
  readonly dataUsageEstimate: number; // MB per hour
  readonly upgradeBenefits?: string[];
}

export interface QualityAdaptationResult {
  readonly newQuality: AudioQualityLevel;
  readonly adapted: boolean;
  readonly reason: string;
  readonly impactDescription: string;
  readonly revertConditions?: string[];
}

export interface AudioCompatibilityCheck {
  readonly compatible: boolean;
  readonly supportedFormats: string[];
  readonly limitations: string[];
  readonly recommendations: string[];
}

export interface AdaptiveQualityResult {
  readonly quality: AudioQualityLevel;
  readonly enableAdaptive: boolean;
  readonly reasoning: string[];
}

export interface PerformanceMetrics {
  readonly currentBitrate: number;
  readonly averageBitrate: number;
  readonly bufferHealth: number;
  readonly dropoutRate: number;
  readonly latency: number;
  readonly packetLoss: number;
  readonly cpuUsage: number;
  readonly networkUtilization: number;
}

export class AudioQualityDomainService {

  /**
   * Intelligently selects optimal audio quality based on multiple criteria
   */
  selectOptimalQuality(criteria: QualitySelectionCriteria): QualityRecommendation {
    const availableQualities = this.getAvailableQualities(criteria.userTier);
    let recommendedLevel: AudioQualityLevel = 'standard';
    const reasons: string[] = [];
    let confidence = 70;

    // Start with tier-based maximum
    const maxTierQuality = this.getMaxQualityForTier(criteria.userTier);
    recommendedLevel = maxTierQuality;
    reasons.push(`Maximum quality for ${criteria.userTier} tier`);

    // Adjust based on connection type and bandwidth
    const connectionQuality = this.getQualityForConnection(
      criteria.connectionType,
      criteria.bandwidth
    );

    if (this.isQualityLower(connectionQuality, recommendedLevel)) {
      recommendedLevel = connectionQuality;
      reasons.push(`Limited by ${criteria.connectionType} connection (${criteria.bandwidth}kbps)`);
      confidence = 85;
    }

    // Consider device capabilities
    const deviceQuality = this.getQualityForDevice(criteria.deviceType, criteria.batteryLevel);
    if (this.isQualityLower(deviceQuality, recommendedLevel)) {
      recommendedLevel = deviceQuality;
      reasons.push(`Optimized for ${criteria.deviceType} device`);
      confidence = 80;
    }

    // Apply data usage constraints
    if (criteria.dataLimit) {
      const dataOptimizedQuality = this.getDataOptimizedQuality(
        criteria.dataLimit,
        recommendedLevel
      );
      if (this.isQualityLower(dataOptimizedQuality, recommendedLevel)) {
        recommendedLevel = dataOptimizedQuality;
        reasons.push(`Data usage optimization (${criteria.dataLimit}MB limit)`);
        confidence = 90;
      }
    }

    // Honor user preference if possible
    if (criteria.userPreference && availableQualities.includes(criteria.userPreference)) {
      if (this.canSupportQuality(criteria.userPreference, criteria)) {
        recommendedLevel = criteria.userPreference;
        reasons.push('User preference honored');
        confidence = 95;
      } else {
        reasons.push(`User preference (${criteria.userPreference}) not feasible with current constraints`);
      }
    }

    const alternatives = availableQualities.filter(q => q !== recommendedLevel);
    const dataUsageEstimate = this.calculateDataUsage(recommendedLevel);
    const upgradeBenefits = this.getUpgradeBenefits(criteria.userTier, recommendedLevel);

    return {
      recommendedLevel,
      reasons,
      confidence,
      alternatives,
      dataUsageEstimate,
      upgradeBenefits
    };
  }

  /**
   * Determines if quality should be adapted based on real-time conditions
   */
  shouldAdaptQuality(
    currentQuality: AudioQualityLevel,
    networkConditions: {
      latency: number;
      jitter: number;
      packetLoss: number;
      throughput: number;
    },
    systemResources: {
      cpuUsage: number;
      memoryUsage: number;
      batteryLevel?: number;
    }
  ): QualityAdaptationResult {
    let shouldAdapt = false;
    let newQuality = currentQuality;
    let reason = 'No adaptation needed';
    let impactDescription = 'Quality maintained';

    // Check network conditions
    if (networkConditions.packetLoss > 5 || networkConditions.latency > 200) {
      shouldAdapt = true;
      newQuality = this.degradeQuality(currentQuality, 1);
      reason = 'Poor network conditions detected';
      impactDescription = 'Reduced quality to improve stability';
    }

    // Check system resources
    if (systemResources.cpuUsage > 80 || systemResources.memoryUsage > 85) {
      shouldAdapt = true;
      newQuality = this.degradeQuality(newQuality, 1);
      reason += (reason === 'No adaptation needed' ? '' : ' and ') + 'high system resource usage';
      impactDescription = 'Reduced quality to conserve resources';
    }

    // Battery optimization
    if (systemResources.batteryLevel !== undefined && systemResources.batteryLevel < 20) {
      shouldAdapt = true;
      newQuality = this.degradeQuality(newQuality, 2);
      reason += (reason === 'No adaptation needed' ? '' : ' and ') + 'low battery level';
      impactDescription = 'Significantly reduced quality to preserve battery';
    }

    const revertConditions = shouldAdapt ? this.getRevertConditions(reason) : undefined;

    return {
      newQuality,
      adapted: shouldAdapt,
      reason,
      impactDescription,
      revertConditions
    };
  }

  /**
   * Validates audio format compatibility with client capabilities
   */
  validateAudioCompatibility(
    requestedQuality: AudioQualityLevel,
    clientCapabilities: {
      supportedFormats: string[];
      maxBitrate: number;
      maxSampleRate: number;
      maxChannels: number;
    }
  ): AudioCompatibilityCheck {
    const audioQuality = new AudioQuality(requestedQuality);
    const config = audioQuality.config;

    const compatible =
      clientCapabilities.supportedFormats.includes(config.format) &&
      clientCapabilities.maxBitrate >= config.bitrate &&
      clientCapabilities.maxSampleRate >= config.sampleRate &&
      clientCapabilities.maxChannels >= config.channels;

    const limitations: string[] = [];
    const recommendations: string[] = [];

    if (!clientCapabilities.supportedFormats.includes(config.format)) {
      limitations.push(`Format ${config.format} not supported`);
      recommendations.push(`Use ${clientCapabilities.supportedFormats[0]} format instead`);
    }

    if (clientCapabilities.maxBitrate < config.bitrate) {
      limitations.push(`Bitrate ${config.bitrate}kbps exceeds client limit (${clientCapabilities.maxBitrate}kbps)`);
      recommendations.push('Use lower quality setting');
    }

    if (clientCapabilities.maxSampleRate < config.sampleRate) {
      limitations.push(`Sample rate ${config.sampleRate}Hz exceeds client limit (${clientCapabilities.maxSampleRate}Hz)`);
      recommendations.push('Use standard sample rate');
    }

    if (clientCapabilities.maxChannels < config.channels) {
      limitations.push(`${config.channels} channels not supported (max: ${clientCapabilities.maxChannels})`);
      recommendations.push('Use stereo or mono audio');
    }

    return {
      compatible,
      supportedFormats: clientCapabilities.supportedFormats,
      limitations,
      recommendations
    };
  }

  /**
   * Calculates quality upgrade impact for subscription tiers
   */
  calculateUpgradeImpact(
    currentTier: SubscriptionTier,
    targetTier: SubscriptionTier,
    currentUsage: { hoursPerMonth: number; averageSessionLength: number }
  ): {
    qualityImprovement: string[];
    dataUsageIncrease: number;
    valueScore: number;
    recommendations: string[];
  } {
    const currentMaxQuality = this.getMaxQualityForTier(currentTier);
    const targetMaxQuality = this.getMaxQualityForTier(targetTier);

    const qualityImprovement: string[] = [];
    let dataUsageIncrease = 0;
    let valueScore = 0;

    if (this.isQualityHigher(targetMaxQuality, currentMaxQuality)) {
      qualityImprovement.push(`Unlock ${targetMaxQuality} audio quality`);

      const currentDataUsage = this.calculateDataUsage(currentMaxQuality) * currentUsage.hoursPerMonth;
      const targetDataUsage = this.calculateDataUsage(targetMaxQuality) * currentUsage.hoursPerMonth;
      dataUsageIncrease = targetDataUsage - currentDataUsage;

      // Calculate value score based on usage patterns
      if (currentUsage.hoursPerMonth > 20) {
        valueScore += 40; // High usage benefits more from quality
      }
      if (currentUsage.averageSessionLength > 3600000) { // 1 hour
        valueScore += 30; // Long sessions benefit from quality
      }
      valueScore += this.getQualityValueScore(targetMaxQuality);
    }

    const recommendations = this.generateUpgradeRecommendations(
      currentTier,
      targetTier,
      currentUsage,
      valueScore
    );

    return {
      qualityImprovement,
      dataUsageIncrease,
      valueScore,
      recommendations
    };
  }

  /**
   * Optimizes quality settings for specific use cases
   */
  optimizeForUseCase(
    useCase: 'casual_listening' | 'focus_music' | 'background_ambience' | 'party_mode' | 'podcast' | 'audiobook',
    availableQualities: AudioQualityLevel[],
    constraints: { bandwidth?: number; batteryOptimization?: boolean }
  ): { quality: AudioQualityLevel; reasoning: string; optimizations: string[] } {
    let quality: AudioQualityLevel = 'standard';
    let reasoning = '';
    const optimizations: string[] = [];

    switch (useCase) {
      case 'casual_listening':
        quality = 'high';
        reasoning = 'Balanced quality for everyday music enjoyment';
        optimizations.push('Enhanced audio clarity', 'Good compression ratio');
        break;

      case 'focus_music':
        quality = 'lossless';
        reasoning = 'High quality for concentration and detailed listening';
        optimizations.push('Lossless compression', 'Full frequency range');
        break;

      case 'background_ambience':
        quality = 'standard';
        reasoning = 'Efficient quality for background audio';
        optimizations.push('Low resource usage', 'Good for multitasking');
        break;

      case 'party_mode':
        quality = 'high';
        reasoning = 'Good quality with efficient bandwidth for multiple users';
        optimizations.push('Optimized for multiple streams', 'Good bass response');
        break;

      case 'podcast':
      case 'audiobook':
        quality = 'standard';
        reasoning = 'Voice-optimized quality with data efficiency';
        optimizations.push('Speech optimization', 'Extended battery life');
        break;
    }

    // Apply constraints
    if (constraints.bandwidth && constraints.bandwidth < 320) {
      quality = 'standard';
      reasoning += ' (limited by bandwidth)';
      optimizations.push('Bandwidth optimized');
    }

    if (constraints.batteryOptimization) {
      quality = this.degradeQuality(quality, 1);
      reasoning += ' (battery optimized)';
      optimizations.push('Extended battery life');
    }

    // Ensure quality is available
    if (!availableQualities.includes(quality)) {
      quality = availableQualities[availableQualities.length - 1] || 'standard';
      reasoning += ' (adjusted to available options)';
    }

    return { quality, reasoning, optimizations };
  }


  private getMaxQualityForTier(tier: SubscriptionTier): AudioQualityLevel {
    const availableQualities = this.getAvailableQualities(tier);
    return availableQualities[availableQualities.length - 1];
  }

  private getQualityForConnection(connectionType: string, bandwidth: number): AudioQualityLevel {
    if (connectionType === 'mobile' && bandwidth < 256) {
      return 'standard';
    }

    if (bandwidth >= 1411) return 'spatial';
    if (bandwidth >= 320) return 'lossless';
    if (bandwidth >= 256) return 'high';
    return 'standard';
  }

  private getQualityForDevice(deviceType: string, batteryLevel?: number): AudioQualityLevel {
    if (deviceType === 'mobile') {
      if (batteryLevel !== undefined && batteryLevel < 30) {
        return 'standard';
      }
      return 'high';
    }

    return 'spatial'; // Desktop/server can handle highest quality
  }

  private getDataOptimizedQuality(dataLimitMB: number, currentQuality: AudioQualityLevel): AudioQualityLevel {
    const dataUsagePerHour = this.calculateDataUsage(currentQuality);
    const hoursAvailable = dataLimitMB / dataUsagePerHour;

    // If less than 40 hours of audio with current quality, suggest downgrade
    if (hoursAvailable < 40) {
      return this.degradeQuality(currentQuality, 1);
    }

    return currentQuality;
  }

  private calculateDataUsage(quality: AudioQualityLevel): number {
    const audioQuality = new AudioQuality(quality);
    const bitsPerSecond = audioQuality.bitrate * 1000;
    const bytesPerSecond = bitsPerSecond / 8;
    const mbPerHour = (bytesPerSecond * 3600) / (1024 * 1024);
    return Math.round(mbPerHour * 100) / 100;
  }

  private canSupportQuality(quality: AudioQualityLevel, criteria: QualitySelectionCriteria): boolean {
    const audioQuality = new AudioQuality(quality);
    return criteria.bandwidth >= audioQuality.bitrate;
  }

  private isQualityLower(quality1: AudioQualityLevel, quality2: AudioQualityLevel): boolean {
    const order: AudioQualityLevel[] = ['standard', 'high', 'lossless', 'spatial'];
    return order.indexOf(quality1) < order.indexOf(quality2);
  }

  private isQualityHigher(quality1: AudioQualityLevel, quality2: AudioQualityLevel): boolean {
    const order: AudioQualityLevel[] = ['standard', 'high', 'lossless', 'spatial'];
    return order.indexOf(quality1) > order.indexOf(quality2);
  }

  private degradeQuality(quality: AudioQualityLevel, levels: number): AudioQualityLevel {
    const order: AudioQualityLevel[] = ['standard', 'high', 'lossless', 'spatial'];
    const currentIndex = order.indexOf(quality);
    const newIndex = Math.max(0, currentIndex - levels);
    return order[newIndex];
  }

  private getUpgradeBenefits(tier: SubscriptionTier, currentQuality: AudioQualityLevel): string[] | undefined {
    if (tier === 'enterprise') return undefined;

    const benefits: string[] = [];
    const tierUpgrades = {
      free: 'basic',
      basic: 'premium',
      premium: 'enterprise'
    };

    const upgradeTier = tierUpgrades[tier as keyof typeof tierUpgrades] as SubscriptionTier;
    if (!upgradeTier) return undefined;

    const upgradeMaxQuality = this.getMaxQualityForTier(upgradeTier);
    if (this.isQualityHigher(upgradeMaxQuality, currentQuality)) {
      benefits.push(`Unlock ${upgradeMaxQuality} quality`);
      benefits.push('Enhanced audio experience');
      benefits.push('Professional-grade sound');
    }

    return benefits.length > 0 ? benefits : undefined;
  }

  private getRevertConditions(reason: string): string[] {
    const conditions: string[] = [];

    if (reason.includes('network')) {
      conditions.push('Network conditions improve (latency < 100ms, packet loss < 2%)');
    }

    if (reason.includes('resource')) {
      conditions.push('System resources freed up (CPU < 70%, Memory < 80%)');
    }

    if (reason.includes('battery')) {
      conditions.push('Battery level above 30% or device plugged in');
    }

    return conditions;
  }

  private getQualityValueScore(quality: AudioQualityLevel): number {
    const scores = {
      standard: 10,
      high: 25,
      lossless: 40,
      spatial: 50
    };
    return scores[quality] || 0;
  }

  private generateUpgradeRecommendations(
    currentTier: SubscriptionTier,
    targetTier: SubscriptionTier,
    usage: { hoursPerMonth: number; averageSessionLength: number },
    valueScore: number
  ): string[] {
    const recommendations: string[] = [];

    if (valueScore > 70) {
      recommendations.push('Highly recommended - significant quality improvement for your usage pattern');
    } else if (valueScore > 40) {
      recommendations.push('Good value - noticeable improvement for regular listeners');
    } else {
      recommendations.push('Consider your listening habits - may not provide significant value');
    }

    if (usage.hoursPerMonth > 50) {
      recommendations.push('Heavy usage detected - quality upgrade will be highly beneficial');
    }

    if (usage.averageSessionLength > 7200000) { // 2 hours
      recommendations.push('Long listening sessions benefit greatly from higher quality');
    }

    return recommendations;
  }

  /**
   * Get optimal quality based on tier, device capabilities, and preferences
   */
  getOptimalQuality(
    userTier: SubscriptionTier,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deviceCapabilities: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userPreferences?: any
  ): AdaptiveQualityResult {
    const criteria: QualitySelectionCriteria = {
      userTier,
      connectionType: deviceCapabilities.connectionType || 'wifi',
      bandwidth: deviceCapabilities.maxBandwidth || 1000,
      deviceType: deviceCapabilities.deviceType || 'desktop',
      batteryLevel: deviceCapabilities.batteryLevel,
      userPreference: userPreferences?.preferredQuality
    };

    const recommendation = this.selectOptimalQuality(criteria);

    return {
      quality: recommendation.recommendedLevel,
      enableAdaptive: userTier !== 'free' && deviceCapabilities.connectionType !== 'mobile',
      reasoning: recommendation.reasons
    };
  }

  /**
   * Make getAvailableQualities public
   */
  getAvailableQualities(tier: SubscriptionTier): AudioQualityLevel[] {
    const tierQualities: Record<SubscriptionTier, AudioQualityLevel[]> = {
      free: ['standard'],
      basic: ['standard', 'high'],
      premium: ['standard', 'high', 'lossless'],
      enterprise: ['standard', 'high', 'lossless', 'spatial']
    };

    return tierQualities[tier] || ['standard'];
  }

  /**
   * Check if adaptive streaming is supported for tier
   */
  supportsAdaptiveStreaming(tier: SubscriptionTier): boolean {
    return tier !== 'free';
  }

  /**
   * Check if user can access a specific quality level
   */
  canAccessQuality(tier: SubscriptionTier, quality: AudioQualityLevel): { allowed: boolean; reason?: string } {
    const availableQualities = this.getAvailableQualities(tier);
    const allowed = availableQualities.includes(quality);

    return {
      allowed,
      reason: allowed ? undefined : `Quality ${quality} not available for ${tier} tier`
    };
  }

  /**
   * Validate device compatibility with quality level
   */
  validateDeviceCompatibility(
    quality: AudioQualityLevel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deviceCapabilities: any
  ): { isCompatible: boolean; issues: string[] } {
    const audioQuality = new AudioQuality(quality);
    const config = audioQuality.config;
    const issues: string[] = [];

    if (deviceCapabilities.maxBandwidth && deviceCapabilities.maxBandwidth < config.bitrate) {
      issues.push(`Bandwidth too low: ${deviceCapabilities.maxBandwidth}kbps < ${config.bitrate}kbps required`);
    }

    if (deviceCapabilities.cpuScore && deviceCapabilities.cpuScore < 50 && quality === 'spatial') {
      issues.push('CPU score too low for spatial audio');
    }

    return {
      isCompatible: issues.length === 0,
      issues
    };
  }

  /**
   * Find compatible quality for device
   */
  findCompatibleQuality(
    tier: SubscriptionTier,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deviceCapabilities: any
  ): { quality: AudioQualityLevel } {
    const availableQualities = this.getAvailableQualities(tier);

    // Start from highest and work down
    for (let i = availableQualities.length - 1; i >= 0; i--) {
      const quality = availableQualities[i];
      const compatibility = this.validateDeviceCompatibility(quality, deviceCapabilities);
      if (compatibility.isCompatible) {
        return { quality };
      }
    }

    return { quality: 'standard' };
  }

  /**
   * Validate adaptive streaming configuration
   */
  validateAdaptiveConfig(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any,
    tier: SubscriptionTier,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deviceCapabilities: any
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.supportsAdaptiveStreaming(tier)) {
      errors.push(`Adaptive streaming not supported for ${tier} tier`);
    }

    const availableQualities = this.getAvailableQualities(tier);
    if (!availableQualities.includes(config.minQuality)) {
      errors.push(`Minimum quality ${config.minQuality} not available for ${tier} tier`);
    }

    if (!availableQualities.includes(config.maxQuality)) {
      errors.push(`Maximum quality ${config.maxQuality} not available for ${tier} tier`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Optimize streaming for performance
   */
  optimizeForPerformance(
    performance: PerformanceMetrics,
    tier: SubscriptionTier
  ): {
    shouldAutoAdjust: boolean;
    adjustments: Array<{ type: string; newQuality?: AudioQualityLevel; bufferSize?: number }>;
    recommendations: string[];
  } {
    const adjustments: Array<{ type: string; newQuality?: AudioQualityLevel; bufferSize?: number }> = [];
    const recommendations: string[] = [];
    let shouldAutoAdjust = false;

    if (performance.dropoutRate > 5) {
      shouldAutoAdjust = true;
      const availableQualities = this.getAvailableQualities(tier);
      const currentIndex = availableQualities.findIndex(q => q === 'high'); // Assume current is high
      if (currentIndex > 0) {
        adjustments.push({
          type: 'quality_downgrade',
          newQuality: availableQualities[currentIndex - 1]
        });
      }
      recommendations.push('High dropout rate detected - reducing quality');
    }

    if (performance.bufferHealth < 30) {
      shouldAutoAdjust = true;
      adjustments.push({
        type: 'buffer_adjustment',
        bufferSize: 15
      });
      recommendations.push('Low buffer health - increasing buffer size');
    }

    return {
      shouldAutoAdjust,
      adjustments,
      recommendations
    };
  }

  /**
   * Get minimum tier required for quality level
   */
  getMinimumTierForQuality(quality: AudioQualityLevel): SubscriptionTier {
    const tiers: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];

    for (const tier of tiers) {
      const availableQualities = this.getAvailableQualities(tier);
      if (availableQualities.includes(quality)) {
        return tier;
      }
    }

    return 'enterprise';
  }

  /**
   * Get benefits of a quality level
   */
  getQualityBenefits(quality: AudioQualityLevel): string[] {
    const benefits: Record<AudioQualityLevel, string[]> = {
      standard: ['Good quality for casual listening', 'Efficient bandwidth usage'],
      high: ['Enhanced clarity', 'Better dynamic range', 'Improved bass response'],
      lossless: ['CD-quality audio', 'No compression artifacts', 'Professional-grade sound'],
      spatial: ['3D audio experience', 'Immersive soundstage', 'Premium audio technology']
    };

    return benefits[quality] || [];
  }
}