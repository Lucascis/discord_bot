import { z } from 'zod';
export const SubscriptionTier = z.enum(['free', 'basic', 'premium', 'enterprise']);
export const AudioQuality = z.enum(['standard', 'high', 'lossless', 'spatial']);
export const PeriodType = z.enum(['monthly', 'quarterly', 'yearly', 'lifetime', 'trial']);
export const FeatureName = z.enum([
    'high_quality_audio',
    'lossless_audio',
    'spatial_audio',
    'audio_effects',
    'custom_equalizer',
    'ai_recommendations',
    'mood_detection',
    'voice_commands',
    'unlimited_queue',
    'playlist_collaboration',
    'cross_server_sync',
    'lyrics_display',
    'sponsor_block',
    'advanced_search',
    'custom_branding',
    'white_labeling',
    'priority_support',
    'dedicated_support',
    'analytics_access',
    'api_access',
    'webhook_integration',
    'custom_integrations'
]);
// Premium feature configuration with defaults per tier
export const PREMIUM_FEATURES = {
    free: {
        spotifyEnabled: false,
        appleMusicEnabled: false,
        deezerEnabled: false,
        lyricsEnabled: false,
        sponsorBlockEnabled: true,
        advancedSearchEnabled: false,
        maxAudioQuality: 'medium',
        volumeLimit: 100,
        maxQueueSize: 50,
        maxSongDuration: 1800, // 30 minutes
        allowExplicitContent: true,
        premiumServers: 0,
        customBotEnabled: false,
        prioritySupport: false,
    },
    basic: {
        spotifyEnabled: true,
        appleMusicEnabled: false,
        deezerEnabled: false,
        lyricsEnabled: true,
        sponsorBlockEnabled: true,
        advancedSearchEnabled: true,
        maxAudioQuality: 'high',
        volumeLimit: 150,
        maxQueueSize: 100,
        maxSongDuration: 3600, // 1 hour
        allowExplicitContent: true,
        premiumServers: 3,
        customBotEnabled: false,
        prioritySupport: false,
    },
    premium: {
        spotifyEnabled: true,
        appleMusicEnabled: true,
        deezerEnabled: true,
        lyricsEnabled: true,
        sponsorBlockEnabled: true,
        advancedSearchEnabled: true,
        maxAudioQuality: 'lossless',
        volumeLimit: 200,
        maxQueueSize: 500,
        maxSongDuration: 7200, // 2 hours
        allowExplicitContent: true,
        premiumServers: 10,
        customBotEnabled: true,
        prioritySupport: true,
    },
    enterprise: {
        spotifyEnabled: true,
        appleMusicEnabled: true,
        deezerEnabled: true,
        lyricsEnabled: true,
        sponsorBlockEnabled: true,
        advancedSearchEnabled: true,
        maxAudioQuality: 'lossless',
        volumeLimit: 200,
        maxQueueSize: 1000,
        maxSongDuration: 14400, // 4 hours
        allowExplicitContent: true,
        premiumServers: -1, // unlimited
        customBotEnabled: true,
        prioritySupport: true,
    },
};
// Plugin integration mapping
export const PLUGIN_SOURCE_MAPPING = {
    spotify: {
        searchPrefix: 'spsearch:',
        playlistPrefix: 'spplaylist:',
        albumPrefix: 'spalbum:',
        artistPrefix: 'spartist:',
    },
    applemusic: {
        searchPrefix: 'amsearch:',
        playlistPrefix: 'amplaylist:',
        albumPrefix: 'amalbum:',
        artistPrefix: 'amartist:',
    },
    deezer: {
        searchPrefix: 'dzsearch:',
        playlistPrefix: 'dzplaylist:',
        albumPrefix: 'dzalbum:',
        artistPrefix: 'dzartist:',
    },
    youtube: {
        searchPrefix: 'ytsearch:',
        playlistPrefix: 'ytplaylist:',
    },
    youtubemusicSearch: {
        searchPrefix: 'ytmsearch:',
    },
};
export function getFeatureGatesForTier(tier) {
    const config = PREMIUM_FEATURES[tier];
    return {
        canUseSpotify: config.spotifyEnabled,
        canUseAppleMusic: config.appleMusicEnabled,
        canUseDeezer: config.deezerEnabled,
        canUseLyrics: config.lyricsEnabled,
        canUseSponsorBlock: config.sponsorBlockEnabled,
        canUseAdvancedSearch: config.advancedSearchEnabled,
        maxAudioQuality: config.maxAudioQuality,
        maxVolumeLimit: config.volumeLimit,
        maxQueueSize: config.maxQueueSize,
        maxSongDurationSeconds: config.maxSongDuration,
        hasCustomBot: config.customBotEnabled,
        hasPrioritySupport: config.prioritySupport,
        maxPremiumServers: config.premiumServers,
    };
}
// Helper to check if a feature is available for a tier
export function canAccessFeature(tier, feature) {
    const gates = getFeatureGatesForTier(tier);
    return Boolean(gates[feature]);
}
// Pricing information (for web dashboard)
export const PRICING_TIERS = {
    free: {
        name: 'Free',
        price: 0,
        period: 'forever',
        description: 'Basic music bot with YouTube support',
        features: [
            'YouTube music playback',
            'Basic queue management',
            'Volume control up to 100%',
            'Up to 50 songs in queue',
            'Songs up to 30 minutes',
            'SponsorBlock ad skipping',
        ],
    },
    basic: {
        name: 'Basic',
        price: 4.99,
        period: 'month',
        description: 'Enhanced music experience with Spotify',
        features: [
            'Everything in Free',
            'Spotify integration',
            'Lyrics display',
            'Advanced search',
            'High quality audio',
            'Volume up to 150%',
            'Up to 100 songs in queue',
            'Songs up to 1 hour',
            'Use on up to 3 servers',
        ],
    },
    premium: {
        name: 'Premium',
        price: 9.99,
        period: 'month',
        description: 'Full-featured music bot with all platforms',
        features: [
            'Everything in Basic',
            'Apple Music integration',
            'Deezer integration',
            'Lossless audio quality',
            'Volume up to 200%',
            'Up to 500 songs in queue',
            'Songs up to 2 hours',
            'Custom bot branding',
            'Priority support',
            'Use on up to 10 servers',
        ],
    },
    enterprise: {
        name: 'Enterprise',
        price: 24.99,
        period: 'month',
        description: 'Enterprise-grade solution with unlimited features',
        features: [
            'Everything in Premium',
            'Up to 1000 songs in queue',
            'Songs up to 4 hours',
            'Unlimited servers',
            'Dedicated support',
            'Custom integrations',
            'Analytics dashboard',
            'White-label options',
        ],
    },
};
