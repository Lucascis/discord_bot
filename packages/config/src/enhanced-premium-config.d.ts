/**
 * Enhanced Premium Configuration
 * Extends the existing premium features with the new architecture
 */
import { z } from 'zod';
import type { SubscriptionTier, AudioQuality } from './premium-features.js';
export type Tier = SubscriptionTier;
export type Quality = AudioQuality;
export declare const FeatureName: z.ZodEnum<["high_quality_audio", "lossless_audio", "spatial_audio", "adaptive_streaming", "equalizer_presets", "spotify_integration", "apple_music_integration", "deezer_integration", "soundcloud_integration", "bandcamp_integration", "advanced_search", "smart_recommendations", "playlist_management", "autoplay_features", "crossfade_support", "lyrics_display", "sponsor_block", "audio_normalization", "bass_boost", "nightcore_effect", "extended_queue", "queue_history", "shuffle_algorithms", "repeat_modes", "priority_queue", "custom_branding", "priority_support", "analytics_dashboard", "webhook_integrations", "api_access"]>;
export type FeatureName = z.infer<typeof FeatureName>;
export declare const PeriodType: z.ZodEnum<["monthly", "quarterly", "yearly", "lifetime", "trial"]>;
export type PeriodType = z.infer<typeof PeriodType>;
export declare const FeatureCategory: z.ZodEnum<["audio_quality", "music_sources", "advanced_features", "enhancements", "queue_management", "premium_perks"]>;
export type FeatureCategory = z.infer<typeof FeatureCategory>;
export declare const AudioQualityLevel: z.ZodEnum<["standard", "high", "lossless", "spatial"]>;
export type AudioQualityLevel = z.infer<typeof AudioQualityLevel>;
export declare const ENHANCED_PREMIUM_FEATURES: {
    readonly free: {
        readonly features: FeatureName[];
        readonly maxAudioQuality: AudioQualityLevel;
        readonly quotas: {
            readonly queueSize: 50;
            readonly trackDuration: 1800;
            readonly monthlyPlaytime: 36000;
            readonly concurrentSessions: 1;
            readonly apiCallsPerDay: 100;
            readonly searchesPerDay: 50;
            readonly playlistsMax: 5;
        };
        readonly restrictions: {
            readonly volumeLimit: 100;
            readonly premiumServers: 0;
            readonly skipLimit: 5;
            readonly canSkipSponsorBlocks: true;
            readonly canUseNightcore: false;
            readonly canUseBassBoost: false;
        };
    };
    readonly basic: {
        readonly features: FeatureName[];
        readonly maxAudioQuality: AudioQualityLevel;
        readonly quotas: {
            readonly queueSize: 100;
            readonly trackDuration: 3600;
            readonly monthlyPlaytime: 108000;
            readonly concurrentSessions: 2;
            readonly apiCallsPerDay: 500;
            readonly searchesPerDay: 200;
            readonly playlistsMax: 20;
        };
        readonly restrictions: {
            readonly volumeLimit: 150;
            readonly premiumServers: 3;
            readonly skipLimit: 20;
            readonly canSkipSponsorBlocks: true;
            readonly canUseNightcore: false;
            readonly canUseBassBoost: true;
        };
    };
    readonly premium: {
        readonly features: FeatureName[];
        readonly maxAudioQuality: AudioQualityLevel;
        readonly quotas: {
            readonly queueSize: 500;
            readonly trackDuration: 7200;
            readonly monthlyPlaytime: 432000;
            readonly concurrentSessions: 5;
            readonly apiCallsPerDay: 2000;
            readonly searchesPerDay: 1000;
            readonly playlistsMax: 100;
        };
        readonly restrictions: {
            readonly volumeLimit: 200;
            readonly premiumServers: 10;
            readonly skipLimit: 100;
            readonly canSkipSponsorBlocks: true;
            readonly canUseNightcore: true;
            readonly canUseBassBoost: true;
        };
    };
    readonly enterprise: {
        readonly features: FeatureName[];
        readonly maxAudioQuality: AudioQualityLevel;
        readonly quotas: {
            readonly queueSize: 1000;
            readonly trackDuration: 14400;
            readonly monthlyPlaytime: -1;
            readonly concurrentSessions: -1;
            readonly apiCallsPerDay: -1;
            readonly searchesPerDay: -1;
            readonly playlistsMax: -1;
        };
        readonly restrictions: {
            readonly volumeLimit: 200;
            readonly premiumServers: -1;
            readonly skipLimit: -1;
            readonly canSkipSponsorBlocks: true;
            readonly canUseNightcore: true;
            readonly canUseBassBoost: true;
        };
    };
};
export declare const FEATURE_CATEGORIES: Record<FeatureName, FeatureCategory>;
export declare const FEATURE_TIER_REQUIREMENTS: Record<FeatureName, SubscriptionTier>;
export declare const BILLING_PERIODS: {
    readonly monthly: {
        readonly displayName: "Monthly";
        readonly multiplier: 1;
        readonly discountPercentage: 0;
        readonly description: "Billed monthly";
    };
    readonly quarterly: {
        readonly displayName: "Quarterly";
        readonly multiplier: 3;
        readonly discountPercentage: 5;
        readonly description: "Billed every 3 months - Save 5%";
    };
    readonly yearly: {
        readonly displayName: "Yearly";
        readonly multiplier: 12;
        readonly discountPercentage: 15;
        readonly description: "Billed annually - Save 15%";
    };
    readonly lifetime: {
        readonly displayName: "Lifetime";
        readonly multiplier: 60;
        readonly discountPercentage: 50;
        readonly description: "One-time payment - Save 50%";
    };
    readonly trial: {
        readonly displayName: "Trial";
        readonly multiplier: 0;
        readonly discountPercentage: 100;
        readonly description: "Free trial period";
    };
};
export declare const ENHANCED_PRICING: {
    readonly free: {
        readonly name: "Free";
        readonly basePrice: 0;
        readonly periods: PeriodType[];
        readonly description: "Basic music bot with YouTube support";
    };
    readonly basic: {
        readonly name: "Basic";
        readonly basePrice: 4.99;
        readonly periods: PeriodType[];
        readonly description: "Enhanced music experience with Spotify";
    };
    readonly premium: {
        readonly name: "Premium";
        readonly basePrice: 9.99;
        readonly periods: PeriodType[];
        readonly description: "Full-featured music bot with all platforms";
    };
    readonly enterprise: {
        readonly name: "Enterprise";
        readonly basePrice: 24.99;
        readonly periods: PeriodType[];
        readonly description: "Enterprise-grade solution with unlimited features";
    };
};
export declare function hasFeatureAccess(tier: SubscriptionTier, feature: FeatureName): boolean;
export declare function getAvailableFeatures(tier: SubscriptionTier): FeatureName[];
export declare function getQuotaForTier(tier: SubscriptionTier, quota: keyof typeof ENHANCED_PREMIUM_FEATURES.free.quotas): number;
export declare function getRestrictionForTier(tier: SubscriptionTier, restriction: keyof typeof ENHANCED_PREMIUM_FEATURES.free.restrictions): any;
export declare function calculatePriceWithPeriod(tier: SubscriptionTier, period: PeriodType): number;
export declare function getFeaturesByCategory(tier: SubscriptionTier): Record<FeatureCategory, FeatureName[]>;
export declare function validateUsageQuota(tier: SubscriptionTier, quota: keyof typeof ENHANCED_PREMIUM_FEATURES.free.quotas, currentUsage: number): {
    allowed: boolean;
    limit: number;
    remaining: number;
};
export declare const FEATURE_ROLLOUT: {
    readonly spatial_audio: {
        readonly enabled: true;
        readonly rolloutPercentage: 50;
        readonly betaUsers: SubscriptionTier[];
        readonly regions: readonly ["US", "EU", "CA"];
    };
    readonly smart_recommendations: {
        readonly enabled: true;
        readonly rolloutPercentage: 80;
        readonly betaUsers: SubscriptionTier[];
        readonly regions: readonly ["US", "EU", "CA", "AU", "JP"];
    };
    readonly webhook_integrations: {
        readonly enabled: true;
        readonly rolloutPercentage: 100;
        readonly betaUsers: SubscriptionTier[];
        readonly regions: readonly ["US", "EU"];
    };
};
export type FeatureRollout = typeof FEATURE_ROLLOUT;
export type RolloutFeature = keyof FeatureRollout;
//# sourceMappingURL=enhanced-premium-config.d.ts.map