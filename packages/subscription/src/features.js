/**
 * Feature Definitions
 * Defines all features available in the subscription system
 */
import { SubscriptionTier, FeatureCategory } from '@prisma/client';
/**
 * All available features in the system
 */
export const FEATURES = {
    // PLAYBACK FEATURES
    CONCURRENT_PLAYBACKS: {
        key: 'concurrent_playbacks',
        name: 'Concurrent Playbacks',
        description: 'Number of simultaneous music playbacks allowed',
        category: FeatureCategory.PLAYBACK,
        availableTiers: [SubscriptionTier.FREE, SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: 1,
        valuesByTier: {
            [SubscriptionTier.FREE]: 1,
            [SubscriptionTier.BASIC]: 3,
            [SubscriptionTier.PREMIUM]: 10,
            [SubscriptionTier.ENTERPRISE]: -1, // unlimited
        },
    },
    // AUDIO QUALITY FEATURES
    AUDIO_QUALITY: {
        key: 'audio_quality',
        name: 'Audio Quality',
        description: 'Maximum audio quality for playback',
        category: FeatureCategory.AUDIO_QUALITY,
        availableTiers: [SubscriptionTier.FREE, SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: 'standard',
        valuesByTier: {
            [SubscriptionTier.FREE]: 'standard',
            [SubscriptionTier.BASIC]: 'high',
            [SubscriptionTier.PREMIUM]: 'highest',
            [SubscriptionTier.ENTERPRISE]: 'lossless',
        },
    },
    // COMMAND FEATURES
    ADVANCED_COMMANDS: {
        key: 'advanced_commands',
        name: 'Advanced Commands',
        description: 'Access to advanced music commands',
        category: FeatureCategory.COMMANDS,
        availableTiers: [SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: true,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    PREMIUM_COMMANDS: {
        key: 'premium_commands',
        name: 'Premium Commands',
        description: 'Access to premium-only commands',
        category: FeatureCategory.COMMANDS,
        availableTiers: [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: false,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    // AUTOPLAY FEATURES
    AUTOPLAY_ENABLED: {
        key: 'autoplay_enabled',
        name: 'Autoplay',
        description: 'Automatic track queueing when queue is empty',
        category: FeatureCategory.PLAYBACK,
        availableTiers: [SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: true,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    AUTOPLAY_ADVANCED_MODES: {
        key: 'autoplay_advanced_modes',
        name: 'Advanced Autoplay Modes',
        description: 'Access to all autoplay recommendation modes',
        category: FeatureCategory.PLAYBACK,
        availableTiers: [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: false,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    // CUSTOMIZATION FEATURES
    CUSTOM_PREFIX: {
        key: 'custom_prefix',
        name: 'Custom Prefix',
        description: 'Set custom command prefix for the bot',
        category: FeatureCategory.CUSTOMIZATION,
        availableTiers: [SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: true,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    CUSTOM_BRANDING: {
        key: 'custom_branding',
        name: 'Custom Branding',
        description: 'Customize bot name, avatar, and embeds',
        category: FeatureCategory.CUSTOMIZATION,
        availableTiers: [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: false,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    WHITE_LABEL: {
        key: 'white_label',
        name: 'White Label',
        description: 'Complete white-label solution',
        category: FeatureCategory.CUSTOMIZATION,
        availableTiers: [SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: false,
            [SubscriptionTier.PREMIUM]: false,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    // ANALYTICS FEATURES
    BASIC_ANALYTICS: {
        key: 'basic_analytics',
        name: 'Basic Analytics',
        description: 'Basic usage statistics and insights',
        category: FeatureCategory.ANALYTICS,
        availableTiers: [SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: true,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    ADVANCED_ANALYTICS: {
        key: 'advanced_analytics',
        name: 'Advanced Analytics',
        description: 'Detailed analytics dashboard with custom reports',
        category: FeatureCategory.ANALYTICS,
        availableTiers: [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: false,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    // SUPPORT FEATURES
    PRIORITY_SUPPORT: {
        key: 'priority_support',
        name: 'Priority Support',
        description: 'Priority customer support',
        category: FeatureCategory.SUPPORT,
        availableTiers: [SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: true,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    DEDICATED_SUPPORT: {
        key: 'dedicated_support',
        name: 'Dedicated Support',
        description: 'Dedicated support team with SLA',
        category: FeatureCategory.SUPPORT,
        availableTiers: [SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: false,
            [SubscriptionTier.PREMIUM]: false,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
    // LIMIT FEATURES
    NO_ADS: {
        key: 'no_ads',
        name: 'Ad-Free Experience',
        description: 'Remove all advertisements',
        category: FeatureCategory.CUSTOMIZATION,
        availableTiers: [SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
        defaultValue: false,
        valuesByTier: {
            [SubscriptionTier.FREE]: false,
            [SubscriptionTier.BASIC]: true,
            [SubscriptionTier.PREMIUM]: true,
            [SubscriptionTier.ENTERPRISE]: true,
        },
    },
};
/**
 * Get feature definition by key
 */
export function getFeature(key) {
    return FEATURES[key];
}
/**
 * Get all features
 */
export function getAllFeatures() {
    return Object.values(FEATURES);
}
/**
 * Get features by category
 */
export function getFeaturesByCategory(category) {
    return getAllFeatures().filter(f => f.category === category);
}
/**
 * Get features available for a specific tier
 */
export function getFeaturesByTier(tier) {
    return getAllFeatures().filter(f => f.availableTiers.includes(tier));
}
/**
 * Check if a tier has access to a feature
 */
export function tierHasFeature(tier, featureKey) {
    const feature = getFeature(featureKey);
    if (!feature)
        return false;
    return feature.availableTiers.includes(tier);
}
/**
 * Get feature value for a specific tier
 */
export function getFeatureValue(featureKey, tier) {
    const feature = getFeature(featureKey);
    if (!feature)
        return undefined;
    return feature.valuesByTier[tier] ?? feature.defaultValue;
}
