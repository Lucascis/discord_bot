/**
 * Audio Quality Tier Entity
 * Manages audio quality tiers and their configurations for different subscription levels
 */

import { SubscriptionTier } from '@discord-bot/config';
import { AudioQuality, AudioQualityLevel } from '../value-objects/audio-quality.js';

export type QualityTierStatus = 'available' | 'limited' | 'unavailable' | 'beta' | 'deprecated';
export type AudioCodec = 'opus' | 'aac' | 'mp3' | 'flac' | 'ogg';

export interface QualityConfiguration {
  readonly bitrate: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly codec: AudioCodec;
  readonly compressionLevel: number; // 0-10
  readonly spatialAudio: boolean;
  readonly noiseCancellation: boolean;
  readonly enhancedBass: boolean;
  readonly dynamicRange: boolean;
}

export interface QualityMetrics {
  readonly avgBitrate: number;
  readonly peakBitrate: number;
  readonly compressionRatio: number;
  readonly latency: number; // milliseconds
  readonly cpuUsage: number; // percentage
  readonly bandwidthUsage: number; // MB/hour
}

export interface QualityLimitations {
  readonly maxDuration: number; // seconds, -1 for unlimited
  readonly maxConcurrentStreams: number; // -1 for unlimited
  readonly dailyLimit: number; // minutes, -1 for unlimited
  readonly requiresWiFi: boolean;
  readonly bufferSize: number; // seconds
}

export class AudioQualityTier {
  constructor(
    private readonly _id: string,
    private readonly _tier: SubscriptionTier,
    private readonly _qualityLevel: AudioQualityLevel,
    private readonly _audioQuality: AudioQuality,
    private readonly _configuration: QualityConfiguration,
    private _status: QualityTierStatus = 'available',
    private _limitations: QualityLimitations | null = null,
    private _metrics: QualityMetrics | null = null,
    private readonly _createdAt: Date = new Date(),
    private _updatedAt: Date = new Date(),
    private _lastUsedAt: Date | null = null,
    private _usageCount: number = 0,
    private _preferredQuality: AudioQualityLevel = _qualityLevel,
    private _adaptiveStreaming: boolean = false,
    private readonly _userId?: string,
    private readonly _guildId?: string
  ) {
    this.validateTier();
  }

  get id(): string {
    return this._id;
  }

  get tier(): SubscriptionTier {
    return this._tier;
  }

  get qualityLevel(): AudioQualityLevel {
    return this._qualityLevel;
  }

  get audioQuality(): AudioQuality {
    return this._audioQuality;
  }

  get configuration(): QualityConfiguration {
    return this._configuration;
  }

  get status(): QualityTierStatus {
    return this._status;
  }

  get limitations(): QualityLimitations | null {
    return this._limitations;
  }

  get metrics(): QualityMetrics | null {
    return this._metrics;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get lastUsedAt(): Date | null {
    return this._lastUsedAt;
  }

  get usageCount(): number {
    return this._usageCount;
  }

  get preferredQuality(): AudioQualityLevel {
    return this._preferredQuality;
  }

  get adaptiveStreaming(): boolean {
    return this._adaptiveStreaming;
  }

  get userId(): string | undefined {
    return this._userId;
  }

  get guildId(): string | undefined {
    return this._guildId;
  }

  get isAvailable(): boolean {
    return this._status === 'available' || this._status === 'limited';
  }

  get isBeta(): boolean {
    return this._status === 'beta';
  }

  get isLossless(): boolean {
    return this._qualityLevel === 'lossless' || this._qualityLevel === 'spatial';
  }

  get hasSpatialAudio(): boolean {
    return this._configuration.spatialAudio;
  }

  get hasAdvancedFeatures(): boolean {
    return this._configuration.noiseCancellation ||
           this._configuration.enhancedBass ||
           this._configuration.dynamicRange;
  }

  get estimatedBandwidth(): number {
    // Estimate bandwidth usage in MB/hour
    const bitsPerSecond = this._configuration.bitrate * 1000;
    const bytesPerSecond = bitsPerSecond / 8;
    const mbPerHour = (bytesPerSecond * 3600) / (1024 * 1024);
    return Math.round(mbPerHour * 100) / 100;
  }

  /**
   * Check if tier is available for specific subscription level
   */
  isAvailableForTier(userTier: SubscriptionTier): boolean {
    if (!this.isAvailable) return false;

    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const requiredTierIndex = tierOrder.indexOf(this._tier);
    const userTierIndex = tierOrder.indexOf(userTier);

    return userTierIndex >= requiredTierIndex;
  }

  /**
   * Check if quality meets minimum requirements
   */
  meetsMinimumRequirements(minBitrate: number, minSampleRate: number): boolean {
    return this._configuration.bitrate >= minBitrate &&
           this._configuration.sampleRate >= minSampleRate;
  }

  /**
   * Check if quality exceeds bandwidth limit
   */
  exceedsBandwidthLimit(maxMbPerHour: number): boolean {
    return this.estimatedBandwidth > maxMbPerHour;
  }

  /**
   * Update tier status
   */
  updateStatus(status: QualityTierStatus): void {
    this._status = status;
    this._updatedAt = new Date();
  }

  /**
   * Set quality limitations
   */
  setLimitations(limitations: QualityLimitations): void {
    this._limitations = limitations;
    this._updatedAt = new Date();
  }

  /**
   * Update quality metrics
   */
  updateMetrics(metrics: QualityMetrics): void {
    this._metrics = metrics;
    this._updatedAt = new Date();
  }

  /**
   * Record quality tier usage
   */
  recordUsage(): void {
    this._usageCount++;
    this._lastUsedAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Set preferred quality level
   */
  setPreferredQuality(quality: AudioQualityLevel): void {
    this._preferredQuality = quality;
    this._updatedAt = new Date();
  }

  /**
   * Set adaptive streaming preference
   */
  setAdaptiveStreaming(enabled: boolean): void {
    this._adaptiveStreaming = enabled;
    this._updatedAt = new Date();
  }

  /**
   * Get quality description
   */
  getQualityDescription(): string {
    const { bitrate, sampleRate, channels, codec } = this._configuration;
    const channelDesc = channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : `${channels}.1 Surround`;

    let description = `${bitrate}kbps ${codec.toUpperCase()}, ${sampleRate}Hz ${channelDesc}`;

    if (this.hasSpatialAudio) {
      description += ', Spatial Audio';
    }

    if (this.hasAdvancedFeatures) {
      const features = [];
      if (this._configuration.noiseCancellation) features.push('Noise Cancellation');
      if (this._configuration.enhancedBass) features.push('Enhanced Bass');
      if (this._configuration.dynamicRange) features.push('Dynamic Range');
      description += `, ${features.join(', ')}`;
    }

    return description;
  }

  /**
   * Get recommended use cases
   */
  getRecommendedUseCases(): string[] {
    const useCases: string[] = [];

    switch (this._qualityLevel) {
      case 'standard':
        useCases.push('Casual listening', 'Voice chat', 'Mobile data usage');
        break;
      case 'high':
        useCases.push('Music appreciation', 'Good headphones', 'Wi-Fi streaming');
        break;
      case 'lossless':
        useCases.push('Audiophile listening', 'Studio monitors', 'High-end headphones');
        break;
      case 'spatial':
        useCases.push('Immersive experience', 'Surround sound systems', 'Gaming');
        break;
    }

    if (this.hasAdvancedFeatures) {
      useCases.push('Professional audio work');
    }

    return useCases;
  }

  /**
   * Calculate quality score (0-100)
   */
  calculateQualityScore(): number {
    let score = 0;

    // Bitrate contribution (0-40 points)
    score += Math.min(40, (this._configuration.bitrate / 1411) * 40);

    // Sample rate contribution (0-20 points)
    score += Math.min(20, (this._configuration.sampleRate / 96000) * 20);

    // Channels contribution (0-15 points)
    score += Math.min(15, (this._configuration.channels / 8) * 15);

    // Codec contribution (0-10 points)
    const codecScores = { opus: 8, aac: 7, mp3: 5, flac: 10, ogg: 6 };
    score += codecScores[this._configuration.codec] || 5;

    // Advanced features contribution (0-15 points)
    if (this._configuration.spatialAudio) score += 5;
    if (this._configuration.noiseCancellation) score += 3;
    if (this._configuration.enhancedBass) score += 3;
    if (this._configuration.dynamicRange) score += 4;

    return Math.min(100, Math.round(score));
  }

  /**
   * Compare with another quality tier
   */
  compareWith(other: AudioQualityTier): {
    better: string[];
    worse: string[];
    same: string[];
  } {
    const comparison: { better: string[]; worse: string[]; same: string[] } = { better: [], worse: [], same: [] };

    // Compare bitrate
    if (this._configuration.bitrate > other._configuration.bitrate) {
      comparison.better.push(`Higher bitrate (${this._configuration.bitrate}kbps vs ${other._configuration.bitrate}kbps)`);
    } else if (this._configuration.bitrate < other._configuration.bitrate) {
      comparison.worse.push(`Lower bitrate (${this._configuration.bitrate}kbps vs ${other._configuration.bitrate}kbps)`);
    } else {
      comparison.same.push(`Same bitrate (${this._configuration.bitrate}kbps)`);
    }

    // Compare sample rate
    if (this._configuration.sampleRate > other._configuration.sampleRate) {
      comparison.better.push(`Higher sample rate (${this._configuration.sampleRate}Hz vs ${other._configuration.sampleRate}Hz)`);
    } else if (this._configuration.sampleRate < other._configuration.sampleRate) {
      comparison.worse.push(`Lower sample rate (${this._configuration.sampleRate}Hz vs ${other._configuration.sampleRate}Hz)`);
    } else {
      comparison.same.push(`Same sample rate (${this._configuration.sampleRate}Hz)`);
    }

    // Compare features
    if (this.hasSpatialAudio && !other.hasSpatialAudio) {
      comparison.better.push('Has spatial audio');
    } else if (!this.hasSpatialAudio && other.hasSpatialAudio) {
      comparison.worse.push('No spatial audio');
    }

    return comparison;
  }

  /**
   * Get tier upgrade path
   */
  getUpgradePath(): AudioQualityLevel[] {
    const levels: AudioQualityLevel[] = ['standard', 'high', 'lossless', 'spatial'];
    const currentIndex = levels.indexOf(this._qualityLevel);
    return levels.slice(currentIndex + 1);
  }

  private validateTier(): void {
    if (this._configuration.bitrate <= 0) {
      throw new Error('Bitrate must be positive');
    }

    if (this._configuration.sampleRate <= 0) {
      throw new Error('Sample rate must be positive');
    }

    if (this._configuration.channels <= 0) {
      throw new Error('Channel count must be positive');
    }

    if (this._configuration.compressionLevel < 0 || this._configuration.compressionLevel > 10) {
      throw new Error('Compression level must be between 0 and 10');
    }

    if (this._limitations) {
      if (this._limitations.maxDuration < -1) {
        throw new Error('Max duration must be -1 (unlimited) or positive');
      }
      if (this._limitations.maxConcurrentStreams < -1) {
        throw new Error('Max concurrent streams must be -1 (unlimited) or positive');
      }
      if (this._limitations.dailyLimit < -1) {
        throw new Error('Daily limit must be -1 (unlimited) or positive');
      }
    }
  }

  /**
   * Create audio quality tier for subscription level
   */
  static createForTier(
    tier: SubscriptionTier,
    qualityLevel: AudioQualityLevel,
    customConfig?: Partial<QualityConfiguration>
  ): AudioQualityTier {
    const audioQuality = new AudioQuality(qualityLevel);
    const baseConfig = audioQuality.config;

    const configuration: QualityConfiguration = {
      bitrate: baseConfig.bitrate,
      sampleRate: baseConfig.sampleRate,
      channels: baseConfig.channels,
      codec: baseConfig.format as AudioCodec,
      compressionLevel: qualityLevel === 'lossless' ? 0 : qualityLevel === 'spatial' ? 0 : 5,
      spatialAudio: baseConfig.spatialEnabled,
      noiseCancellation: tier !== 'free',
      enhancedBass: tier === 'premium' || tier === 'enterprise',
      dynamicRange: tier === 'enterprise',
      ...customConfig
    };

    const id = `quality_${tier}_${qualityLevel}_${Date.now()}`;
    return new AudioQualityTier(id, tier, qualityLevel, audioQuality, configuration);
  }

  /**
   * Create audio quality tier for user and guild
   */
  static create(
    userId: string,
    guildId: string,
    tier: SubscriptionTier,
    qualityLevel: AudioQualityLevel,
    customConfig?: Partial<QualityConfiguration>
  ): AudioQualityTier {
    const audioQuality = new AudioQuality(qualityLevel);
    const baseConfig = audioQuality.config;

    const configuration: QualityConfiguration = {
      bitrate: baseConfig.bitrate,
      sampleRate: baseConfig.sampleRate,
      channels: baseConfig.channels,
      codec: baseConfig.format as AudioCodec,
      compressionLevel: qualityLevel === 'lossless' ? 0 : qualityLevel === 'spatial' ? 0 : 5,
      spatialAudio: baseConfig.spatialEnabled,
      noiseCancellation: tier !== 'free',
      enhancedBass: tier === 'premium' || tier === 'enterprise',
      dynamicRange: tier === 'enterprise',
      ...customConfig
    };

    const id = `quality_${tier}_${qualityLevel}_${userId}_${guildId}_${Date.now()}`;
    return new AudioQualityTier(
      id,
      tier,
      qualityLevel,
      audioQuality,
      configuration,
      'available',
      null,
      null,
      new Date(),
      new Date(),
      null,
      0,
      qualityLevel,
      false,
      userId,
      guildId
    );
  }

  /**
   * Create standard tier configurations
   */
  static createStandardTiers(): AudioQualityTier[] {
    return [
      // Free tier - Standard quality only
      AudioQualityTier.createForTier('free', 'standard'),

      // Basic tier - Standard and High quality
      AudioQualityTier.createForTier('basic', 'standard'),
      AudioQualityTier.createForTier('basic', 'high'),

      // Premium tier - All qualities
      AudioQualityTier.createForTier('premium', 'standard'),
      AudioQualityTier.createForTier('premium', 'high'),
      AudioQualityTier.createForTier('premium', 'lossless'),

      // Enterprise tier - All qualities with enhanced features
      AudioQualityTier.createForTier('enterprise', 'standard'),
      AudioQualityTier.createForTier('enterprise', 'high'),
      AudioQualityTier.createForTier('enterprise', 'lossless'),
      AudioQualityTier.createForTier('enterprise', 'spatial')
    ];
  }

  equals(other: AudioQualityTier): boolean {
    return this._id === other._id;
  }

  toString(): string {
    return `AudioQualityTier(${this._tier}, ${this._qualityLevel}, ${this._configuration.bitrate}kbps)`;
  }

  toJSON(): {
    id: string;
    tier: SubscriptionTier;
    qualityLevel: AudioQualityLevel;
    configuration: QualityConfiguration;
    status: QualityTierStatus;
    limitations: QualityLimitations | null;
    metrics: QualityMetrics | null;
    isAvailable: boolean;
    isBeta: boolean;
    isLossless: boolean;
    hasSpatialAudio: boolean;
    hasAdvancedFeatures: boolean;
    estimatedBandwidth: number;
    qualityScore: number;
    description: string;
    recommendedUseCases: string[];
    usageCount: number;
    lastUsedAt: Date | null;
  } {
    return {
      id: this._id,
      tier: this._tier,
      qualityLevel: this._qualityLevel,
      configuration: this._configuration,
      status: this._status,
      limitations: this._limitations,
      metrics: this._metrics,
      isAvailable: this.isAvailable,
      isBeta: this.isBeta,
      isLossless: this.isLossless,
      hasSpatialAudio: this.hasSpatialAudio,
      hasAdvancedFeatures: this.hasAdvancedFeatures,
      estimatedBandwidth: this.estimatedBandwidth,
      qualityScore: this.calculateQualityScore(),
      description: this.getQualityDescription(),
      recommendedUseCases: this.getRecommendedUseCases(),
      usageCount: this._usageCount,
      lastUsedAt: this._lastUsedAt
    };
  }
}