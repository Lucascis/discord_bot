import { z } from 'zod';
export declare const SubscriptionTier: z.ZodEnum<["free", "basic", "premium", "enterprise"]>;
export type SubscriptionTier = z.infer<typeof SubscriptionTier>;
export declare const AudioQuality: z.ZodEnum<["standard", "high", "lossless", "spatial"]>;
export type AudioQuality = z.infer<typeof AudioQuality>;
export declare const PeriodType: z.ZodEnum<["monthly", "quarterly", "yearly", "lifetime", "trial"]>;
export type PeriodType = z.infer<typeof PeriodType>;
export declare const FeatureName: z.ZodEnum<["high_quality_audio", "lossless_audio", "spatial_audio", "audio_effects", "custom_equalizer", "ai_recommendations", "mood_detection", "voice_commands", "unlimited_queue", "playlist_collaboration", "cross_server_sync", "lyrics_display", "sponsor_block", "advanced_search", "custom_branding", "white_labeling", "priority_support", "dedicated_support", "analytics_access", "api_access", "webhook_integration", "custom_integrations"]>;
export type FeatureName = z.infer<typeof FeatureName>;
export declare const PREMIUM_FEATURES: {
    readonly free: {
        readonly spotifyEnabled: false;
        readonly appleMusicEnabled: false;
        readonly deezerEnabled: false;
        readonly lyricsEnabled: false;
        readonly sponsorBlockEnabled: true;
        readonly advancedSearchEnabled: false;
        readonly maxAudioQuality: AudioQuality;
        readonly volumeLimit: 100;
        readonly maxQueueSize: 50;
        readonly maxSongDuration: 1800;
        readonly allowExplicitContent: true;
        readonly premiumServers: 0;
        readonly customBotEnabled: false;
        readonly prioritySupport: false;
    };
    readonly basic: {
        readonly spotifyEnabled: true;
        readonly appleMusicEnabled: false;
        readonly deezerEnabled: false;
        readonly lyricsEnabled: true;
        readonly sponsorBlockEnabled: true;
        readonly advancedSearchEnabled: true;
        readonly maxAudioQuality: AudioQuality;
        readonly volumeLimit: 150;
        readonly maxQueueSize: 100;
        readonly maxSongDuration: 3600;
        readonly allowExplicitContent: true;
        readonly premiumServers: 3;
        readonly customBotEnabled: false;
        readonly prioritySupport: false;
    };
    readonly premium: {
        readonly spotifyEnabled: true;
        readonly appleMusicEnabled: true;
        readonly deezerEnabled: true;
        readonly lyricsEnabled: true;
        readonly sponsorBlockEnabled: true;
        readonly advancedSearchEnabled: true;
        readonly maxAudioQuality: AudioQuality;
        readonly volumeLimit: 200;
        readonly maxQueueSize: 500;
        readonly maxSongDuration: 7200;
        readonly allowExplicitContent: true;
        readonly premiumServers: 10;
        readonly customBotEnabled: true;
        readonly prioritySupport: true;
    };
    readonly enterprise: {
        readonly spotifyEnabled: true;
        readonly appleMusicEnabled: true;
        readonly deezerEnabled: true;
        readonly lyricsEnabled: true;
        readonly sponsorBlockEnabled: true;
        readonly advancedSearchEnabled: true;
        readonly maxAudioQuality: AudioQuality;
        readonly volumeLimit: 200;
        readonly maxQueueSize: 1000;
        readonly maxSongDuration: 14400;
        readonly allowExplicitContent: true;
        readonly premiumServers: -1;
        readonly customBotEnabled: true;
        readonly prioritySupport: true;
    };
};
export declare const PLUGIN_SOURCE_MAPPING: {
    readonly spotify: {
        readonly searchPrefix: "spsearch:";
        readonly playlistPrefix: "spplaylist:";
        readonly albumPrefix: "spalbum:";
        readonly artistPrefix: "spartist:";
    };
    readonly applemusic: {
        readonly searchPrefix: "amsearch:";
        readonly playlistPrefix: "amplaylist:";
        readonly albumPrefix: "amalbum:";
        readonly artistPrefix: "amartist:";
    };
    readonly deezer: {
        readonly searchPrefix: "dzsearch:";
        readonly playlistPrefix: "dzplaylist:";
        readonly albumPrefix: "dzalbum:";
        readonly artistPrefix: "dzartist:";
    };
    readonly youtube: {
        readonly searchPrefix: "ytsearch:";
        readonly playlistPrefix: "ytplaylist:";
    };
    readonly youtubemusicSearch: {
        readonly searchPrefix: "ytmsearch:";
    };
};
export type PluginSource = keyof typeof PLUGIN_SOURCE_MAPPING;
export interface FeatureGates {
    canUseSpotify: boolean;
    canUseAppleMusic: boolean;
    canUseDeezer: boolean;
    canUseLyrics: boolean;
    canUseSponsorBlock: boolean;
    canUseAdvancedSearch: boolean;
    maxAudioQuality: AudioQuality;
    maxVolumeLimit: number;
    maxQueueSize: number;
    maxSongDurationSeconds: number;
    hasCustomBot: boolean;
    hasPrioritySupport: boolean;
    maxPremiumServers: number;
}
export declare function getFeatureGatesForTier(tier: SubscriptionTier): FeatureGates;
export declare function canAccessFeature(tier: SubscriptionTier, feature: keyof FeatureGates): boolean;
export declare const PRICING_TIERS: {
    readonly free: {
        readonly name: "Free";
        readonly price: 0;
        readonly period: "forever";
        readonly description: "Basic music bot with YouTube support";
        readonly features: readonly ["YouTube music playback", "Basic queue management", "Volume control up to 100%", "Up to 50 songs in queue", "Songs up to 30 minutes", "SponsorBlock ad skipping"];
    };
    readonly basic: {
        readonly name: "Basic";
        readonly price: 4.99;
        readonly period: "month";
        readonly description: "Enhanced music experience with Spotify";
        readonly features: readonly ["Everything in Free", "Spotify integration", "Lyrics display", "Advanced search", "High quality audio", "Volume up to 150%", "Up to 100 songs in queue", "Songs up to 1 hour", "Use on up to 3 servers"];
    };
    readonly premium: {
        readonly name: "Premium";
        readonly price: 9.99;
        readonly period: "month";
        readonly description: "Full-featured music bot with all platforms";
        readonly features: readonly ["Everything in Basic", "Apple Music integration", "Deezer integration", "Lossless audio quality", "Volume up to 200%", "Up to 500 songs in queue", "Songs up to 2 hours", "Custom bot branding", "Priority support", "Use on up to 10 servers"];
    };
    readonly enterprise: {
        readonly name: "Enterprise";
        readonly price: 24.99;
        readonly period: "month";
        readonly description: "Enterprise-grade solution with unlimited features";
        readonly features: readonly ["Everything in Premium", "Up to 1000 songs in queue", "Songs up to 4 hours", "Unlimited servers", "Dedicated support", "Custom integrations", "Analytics dashboard", "White-label options"];
    };
};
//# sourceMappingURL=premium-features.d.ts.map