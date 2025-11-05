/**
 * Enhanced Premium Configuration
 * Extends the existing premium features with the new architecture
 */

import { z } from 'zod';

// Import and use existing types
import type { SubscriptionTier, AudioQuality } from './premium-features.js';

// Create type aliases for consistency
export type Tier = SubscriptionTier;
export type Quality = AudioQuality;

// Enhanced feature types for the new premium system
export const FeatureName = z.enum([
  // Audio Quality Features
  'high_quality_audio',
  'lossless_audio',
  'spatial_audio',
  'adaptive_streaming',
  'equalizer_presets',

  // Music Source Features
  'spotify_integration',
  'apple_music_integration',
  'deezer_integration',
  'soundcloud_integration',
  'bandcamp_integration',

  // Advanced Features
  'advanced_search',
  'smart_recommendations',
  'playlist_management',
  'autoplay_features',
  'crossfade_support',

  // Enhancement Features
  'lyrics_display',
  'sponsor_block',
  'audio_normalization',
  'bass_boost',
  'nightcore_effect',

  // Queue Features
  'extended_queue',
  'queue_history',
  'shuffle_algorithms',
  'repeat_modes',
  'priority_queue',

  // Premium Perks
  'custom_branding',
  'priority_support',
  'analytics_dashboard',
  'webhook_integrations',
  'api_access'
]);
// eslint-disable-next-line no-redeclare
export type FeatureName = z.infer<typeof FeatureName>;

export const PeriodType = z.enum(['monthly', 'quarterly', 'yearly', 'lifetime', 'trial']);
// eslint-disable-next-line no-redeclare
export type PeriodType = z.infer<typeof PeriodType>;

// Feature category groupings
export const FeatureCategory = z.enum([
  'audio_quality',
  'music_sources',
  'advanced_features',
  'enhancements',
  'queue_management',
  'premium_perks'
]);
// eslint-disable-next-line no-redeclare
export type FeatureCategory = z.infer<typeof FeatureCategory>;

// Quality levels with technical specifications
export const AudioQualityLevel = z.enum(['standard', 'high', 'lossless', 'spatial']);
// eslint-disable-next-line no-redeclare
export type AudioQualityLevel = z.infer<typeof AudioQualityLevel>;

// Enhanced feature configuration with new architecture
export const ENHANCED_PREMIUM_FEATURES = {
  free: {
    features: ['sponsor_block'] as FeatureName[],
    maxAudioQuality: 'standard' as AudioQualityLevel,
    quotas: {
      queueSize: 50,
      trackDuration: 1800, // 30 minutes
      monthlyPlaytime: 36000, // 10 hours
      concurrentSessions: 1,
      apiCallsPerDay: 100,
      searchesPerDay: 50,
      playlistsMax: 5
    },
    restrictions: {
      volumeLimit: 100,
      premiumServers: 0,
      skipLimit: 5,
      canSkipSponsorBlocks: true,
      canUseNightcore: false,
      canUseBassBoost: false
    }
  },
  basic: {
    features: [
      'high_quality_audio',
      'spotify_integration',
      'lyrics_display',
      'advanced_search',
      'sponsor_block',
      'autoplay_features'
    ] as FeatureName[],
    maxAudioQuality: 'high' as AudioQualityLevel,
    quotas: {
      queueSize: 100,
      trackDuration: 3600, // 1 hour
      monthlyPlaytime: 108000, // 30 hours
      concurrentSessions: 2,
      apiCallsPerDay: 500,
      searchesPerDay: 200,
      playlistsMax: 20
    },
    restrictions: {
      volumeLimit: 150,
      premiumServers: 3,
      skipLimit: 20,
      canSkipSponsorBlocks: true,
      canUseNightcore: false,
      canUseBassBoost: true
    }
  },
  premium: {
    features: [
      'high_quality_audio',
      'lossless_audio',
      'adaptive_streaming',
      'spotify_integration',
      'apple_music_integration',
      'deezer_integration',
      'lyrics_display',
      'advanced_search',
      'smart_recommendations',
      'playlist_management',
      'sponsor_block',
      'audio_normalization',
      'autoplay_features',
      'extended_queue',
      'queue_history',
      'custom_branding',
      'priority_support'
    ] as FeatureName[],
    maxAudioQuality: 'lossless' as AudioQualityLevel,
    quotas: {
      queueSize: 500,
      trackDuration: 7200, // 2 hours
      monthlyPlaytime: 432000, // 120 hours
      concurrentSessions: 5,
      apiCallsPerDay: 2000,
      searchesPerDay: 1000,
      playlistsMax: 100
    },
    restrictions: {
      volumeLimit: 200,
      premiumServers: 10,
      skipLimit: 100,
      canSkipSponsorBlocks: true,
      canUseNightcore: true,
      canUseBassBoost: true
    }
  },
  enterprise: {
    features: [
      'high_quality_audio',
      'lossless_audio',
      'spatial_audio',
      'adaptive_streaming',
      'equalizer_presets',
      'spotify_integration',
      'apple_music_integration',
      'deezer_integration',
      'soundcloud_integration',
      'bandcamp_integration',
      'lyrics_display',
      'advanced_search',
      'smart_recommendations',
      'playlist_management',
      'sponsor_block',
      'audio_normalization',
      'bass_boost',
      'nightcore_effect',
      'autoplay_features',
      'crossfade_support',
      'extended_queue',
      'queue_history',
      'shuffle_algorithms',
      'repeat_modes',
      'priority_queue',
      'custom_branding',
      'priority_support',
      'analytics_dashboard',
      'webhook_integrations',
      'api_access'
    ] as FeatureName[],
    maxAudioQuality: 'spatial' as AudioQualityLevel,
    quotas: {
      queueSize: 1000,
      trackDuration: 14400, // 4 hours
      monthlyPlaytime: -1, // unlimited
      concurrentSessions: -1, // unlimited
      apiCallsPerDay: -1, // unlimited
      searchesPerDay: -1, // unlimited
      playlistsMax: -1 // unlimited
    },
    restrictions: {
      volumeLimit: 200,
      premiumServers: -1, // unlimited
      skipLimit: -1, // unlimited
      canSkipSponsorBlocks: true,
      canUseNightcore: true,
      canUseBassBoost: true
    }
  }
} as const;

// Feature to category mapping
export const FEATURE_CATEGORIES: Record<FeatureName, FeatureCategory> = {
  // Audio Quality Features
  high_quality_audio: 'audio_quality',
  lossless_audio: 'audio_quality',
  spatial_audio: 'audio_quality',
  adaptive_streaming: 'audio_quality',
  equalizer_presets: 'audio_quality',

  // Music Source Features
  spotify_integration: 'music_sources',
  apple_music_integration: 'music_sources',
  deezer_integration: 'music_sources',
  soundcloud_integration: 'music_sources',
  bandcamp_integration: 'music_sources',

  // Advanced Features
  advanced_search: 'advanced_features',
  smart_recommendations: 'advanced_features',
  playlist_management: 'advanced_features',
  autoplay_features: 'advanced_features',
  crossfade_support: 'advanced_features',

  // Enhancement Features
  lyrics_display: 'enhancements',
  sponsor_block: 'enhancements',
  audio_normalization: 'enhancements',
  bass_boost: 'enhancements',
  nightcore_effect: 'enhancements',

  // Queue Features
  extended_queue: 'queue_management',
  queue_history: 'queue_management',
  shuffle_algorithms: 'queue_management',
  repeat_modes: 'queue_management',
  priority_queue: 'queue_management',

  // Premium Perks
  custom_branding: 'premium_perks',
  priority_support: 'premium_perks',
  analytics_dashboard: 'premium_perks',
  webhook_integrations: 'premium_perks',
  api_access: 'premium_perks'
};

// Minimum tier required for each feature
export const FEATURE_TIER_REQUIREMENTS: Record<FeatureName, SubscriptionTier> = {
  // Audio Quality Features
  high_quality_audio: 'basic',
  lossless_audio: 'premium',
  spatial_audio: 'enterprise',
  adaptive_streaming: 'premium',
  equalizer_presets: 'enterprise',

  // Music Source Features
  spotify_integration: 'basic',
  apple_music_integration: 'premium',
  deezer_integration: 'premium',
  soundcloud_integration: 'enterprise',
  bandcamp_integration: 'enterprise',

  // Advanced Features
  advanced_search: 'basic',
  smart_recommendations: 'premium',
  playlist_management: 'premium',
  autoplay_features: 'basic',
  crossfade_support: 'enterprise',

  // Enhancement Features
  lyrics_display: 'basic',
  sponsor_block: 'free',
  audio_normalization: 'premium',
  bass_boost: 'basic',
  nightcore_effect: 'premium',

  // Queue Features
  extended_queue: 'premium',
  queue_history: 'premium',
  shuffle_algorithms: 'enterprise',
  repeat_modes: 'enterprise',
  priority_queue: 'enterprise',

  // Premium Perks
  custom_branding: 'premium',
  priority_support: 'premium',
  analytics_dashboard: 'enterprise',
  webhook_integrations: 'enterprise',
  api_access: 'enterprise'
};

// Billing period configurations with discounts
export const BILLING_PERIODS = {
  monthly: {
    displayName: 'Monthly',
    multiplier: 1,
    discountPercentage: 0,
    description: 'Billed monthly'
  },
  quarterly: {
    displayName: 'Quarterly',
    multiplier: 3,
    discountPercentage: 5,
    description: 'Billed every 3 months - Save 5%'
  },
  yearly: {
    displayName: 'Yearly',
    multiplier: 12,
    discountPercentage: 15,
    description: 'Billed annually - Save 15%'
  },
  lifetime: {
    displayName: 'Lifetime',
    multiplier: 60, // 5 years worth
    discountPercentage: 50,
    description: 'One-time payment - Save 50%'
  },
  trial: {
    displayName: 'Trial',
    multiplier: 0,
    discountPercentage: 100,
    description: 'Free trial period'
  }
} as const;

// Enhanced pricing with periods
export const ENHANCED_PRICING = {
  free: {
    name: 'Free',
    basePrice: 0,
    periods: ['monthly'] as PeriodType[],
    description: 'Basic music bot with YouTube support'
  },
  basic: {
    name: 'Basic',
    basePrice: 4.99,
    periods: ['monthly', 'quarterly', 'yearly'] as PeriodType[],
    description: 'Enhanced music experience with Spotify'
  },
  premium: {
    name: 'Premium',
    basePrice: 9.99,
    periods: ['monthly', 'quarterly', 'yearly', 'lifetime'] as PeriodType[],
    description: 'Full-featured music bot with all platforms'
  },
  enterprise: {
    name: 'Enterprise',
    basePrice: 24.99,
    periods: ['monthly', 'quarterly', 'yearly'] as PeriodType[],
    description: 'Enterprise-grade solution with unlimited features'
  }
} as const;

// Helper functions for the enhanced system
export function hasFeatureAccess(tier: SubscriptionTier, feature: FeatureName): boolean {
  const requiredTier = FEATURE_TIER_REQUIREMENTS[feature];
  const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];

  const userTierIndex = tierOrder.indexOf(tier);
  const requiredTierIndex = tierOrder.indexOf(requiredTier);

  return userTierIndex >= requiredTierIndex;
}

export function getAvailableFeatures(tier: SubscriptionTier): FeatureName[] {
  return ENHANCED_PREMIUM_FEATURES[tier].features;
}

export function getQuotaForTier(tier: SubscriptionTier, quota: keyof typeof ENHANCED_PREMIUM_FEATURES.free.quotas): number {
  return ENHANCED_PREMIUM_FEATURES[tier].quotas[quota];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRestrictionForTier(tier: SubscriptionTier, restriction: keyof typeof ENHANCED_PREMIUM_FEATURES.free.restrictions): any {
  return ENHANCED_PREMIUM_FEATURES[tier].restrictions[restriction];
}

export function calculatePriceWithPeriod(tier: SubscriptionTier, period: PeriodType): number {
  if (tier === 'free') return 0;

  const basePrice = ENHANCED_PRICING[tier].basePrice;
  const periodConfig = BILLING_PERIODS[period];

  const totalPrice = basePrice * periodConfig.multiplier;
  const discount = totalPrice * (periodConfig.discountPercentage / 100);

  return totalPrice - discount;
}

export function getFeaturesByCategory(tier: SubscriptionTier): Record<FeatureCategory, FeatureName[]> {
  const features = getAvailableFeatures(tier);
  const categorized: Record<FeatureCategory, FeatureName[]> = {
    audio_quality: [],
    music_sources: [],
    advanced_features: [],
    enhancements: [],
    queue_management: [],
    premium_perks: []
  };

  features.forEach(feature => {
    const category = FEATURE_CATEGORIES[feature];
    categorized[category].push(feature);
  });

  return categorized;
}

// Usage quota validation
export function validateUsageQuota(
  tier: SubscriptionTier,
  quota: keyof typeof ENHANCED_PREMIUM_FEATURES.free.quotas,
  currentUsage: number
): { allowed: boolean; limit: number; remaining: number } {
  const limit = getQuotaForTier(tier, quota);

  if (limit === -1) {
    return { allowed: true, limit: -1, remaining: -1 };
  }

  const remaining = Math.max(0, limit - currentUsage);
  return {
    allowed: currentUsage < limit,
    limit,
    remaining
  };
}

// Feature rollout configuration
export const FEATURE_ROLLOUT = {
  spatial_audio: {
    enabled: true,
    rolloutPercentage: 50,
    betaUsers: ['premium', 'enterprise'] as SubscriptionTier[],
    regions: ['US', 'EU', 'CA']
  },
  smart_recommendations: {
    enabled: true,
    rolloutPercentage: 80,
    betaUsers: ['premium', 'enterprise'] as SubscriptionTier[],
    regions: ['US', 'EU', 'CA', 'AU', 'JP']
  },
  webhook_integrations: {
    enabled: true,
    rolloutPercentage: 100,
    betaUsers: ['enterprise'] as SubscriptionTier[],
    regions: ['US', 'EU']
  }
} as const;

export type FeatureRollout = typeof FEATURE_ROLLOUT;
export type RolloutFeature = keyof FeatureRollout;