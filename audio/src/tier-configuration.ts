import { SubscriptionTier } from '@discord-bot/config';

export interface TierAudioConfiguration {
  bufferDurationMs: number;
  opusEncodingQuality: number;
  resamplingQuality: 'LOW' | 'MEDIUM' | 'HIGH';
  maxVolume: number;
  queueLimit: number;
  supportedSources: string[];
  audioEffectsEnabled: boolean;
  priorityProcessing: boolean;
}

/**
 * Tier-based audio configuration
 * Optimized for different subscription levels
 */
export const TIER_AUDIO_CONFIG: Record<SubscriptionTier, TierAudioConfiguration> = {
  free: {
    bufferDurationMs: 400,        // Standard latency
    opusEncodingQuality: 7,       // Good quality
    resamplingQuality: 'MEDIUM',
    maxVolume: 100,
    queueLimit: 10,
    supportedSources: ['youtube'],
    audioEffectsEnabled: false,
    priorityProcessing: false,
  },

  basic: {
    bufferDurationMs: 300,        // Better latency
    opusEncodingQuality: 8,       // High quality
    resamplingQuality: 'HIGH',
    maxVolume: 150,
    queueLimit: 25,
    supportedSources: ['youtube', 'spotify'],
    audioEffectsEnabled: false,
    priorityProcessing: false,
  },

  premium: {
    bufferDurationMs: 250,        // Low latency
    opusEncodingQuality: 9,       // Very high quality
    resamplingQuality: 'HIGH',
    maxVolume: 200,
    queueLimit: 50,
    supportedSources: ['youtube', 'spotify', 'soundcloud', 'applemusic', 'deezer'],
    audioEffectsEnabled: true,
    priorityProcessing: true,
  },

  enterprise: {
    bufferDurationMs: 200,        // Ultra-low latency
    opusEncodingQuality: 10,      // Maximum quality
    resamplingQuality: 'HIGH',
    maxVolume: 200,
    queueLimit: 100,
    supportedSources: ['youtube', 'spotify', 'soundcloud', 'applemusic', 'deezer'],
    audioEffectsEnabled: true,
    priorityProcessing: true,
  },
};

/**
 * Get audio configuration for a specific subscription tier
 */
export function getAudioConfigForTier(tier: SubscriptionTier): TierAudioConfiguration {
  return TIER_AUDIO_CONFIG[tier];
}

/**
 * Check if a source is supported for a tier
 */
export function isSourceSupportedForTier(source: string, tier: SubscriptionTier): boolean {
  const config = getAudioConfigForTier(tier);
  return config.supportedSources.includes(source.toLowerCase());
}

/**
 * Get maximum allowed volume for a tier
 */
export function getMaxVolumeForTier(tier: SubscriptionTier): number {
  const config = getAudioConfigForTier(tier);
  return config.maxVolume;
}

/**
 * Check if audio effects are enabled for a tier
 */
export function areAudioEffectsEnabledForTier(tier: SubscriptionTier): boolean {
  const config = getAudioConfigForTier(tier);
  return config.audioEffectsEnabled;
}

/**
 * Get queue limit for a tier
 */
export function getQueueLimitForTier(tier: SubscriptionTier): number {
  const config = getAudioConfigForTier(tier);
  return config.queueLimit;
}

/**
 * Check if priority processing is enabled for a tier
 */
export function isPriorityProcessingEnabledForTier(tier: SubscriptionTier): boolean {
  const config = getAudioConfigForTier(tier);
  return config.priorityProcessing;
}