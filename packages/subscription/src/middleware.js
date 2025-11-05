/**
 * Subscription Middleware
 * Middleware for verifying subscription access and limits
 */
import { SubscriptionTier } from '@prisma/client';
import { needsUpgrade } from './plans.js';
export class SubscriptionMiddleware {
    constructor(subscriptionService) {
        this.subscriptionService = subscriptionService;
    }
    /**
     * Check if guild has required subscription tier
     */
    async checkTier(guildId, requiredTier) {
        const subscription = await this.subscriptionService.getSubscription(guildId);
        if (!subscription.isActive) {
            return {
                allowed: false,
                message: '⚠️ Your subscription is not active. Please renew to continue using this feature.',
                subscription,
            };
        }
        if (needsUpgrade(subscription.tier, requiredTier)) {
            const upgradePrompt = this.generateUpgradePrompt(subscription.tier, requiredTier);
            return {
                allowed: false,
                message: upgradePrompt.description,
                subscription,
            };
        }
        return {
            allowed: true,
            subscription,
        };
    }
    /**
     * Check if guild has access to a specific feature
     */
    async checkFeature(guildId, featureKey) {
        const featureAccess = await this.subscriptionService.checkFeatureAccess(guildId, featureKey);
        const subscription = await this.subscriptionService.getSubscription(guildId);
        if (!featureAccess.hasAccess) {
            return {
                allowed: false,
                message: featureAccess.upgradeMessage || 'This feature is not available in your current plan.',
                subscription,
            };
        }
        return {
            allowed: true,
            subscription,
        };
    }
    /**
     * Check if guild is within usage limit
     */
    async checkLimit(guildId, limitType) {
        const limitCheck = await this.subscriptionService.checkUsageLimit(guildId, limitType);
        const subscription = await this.subscriptionService.getSubscription(guildId);
        if (!limitCheck.withinLimit) {
            return {
                allowed: false,
                message: limitCheck.upgradeMessage || `You've reached your ${limitType} limit.`,
                subscription,
            };
        }
        return {
            allowed: true,
            subscription,
        };
    }
    /**
     * Check and increment usage limit atomically
     */
    async checkAndIncrementLimit(guildId, limitType, amount = 1) {
        const limitCheck = await this.checkLimit(guildId, limitType);
        if (limitCheck.allowed) {
            await this.subscriptionService.incrementUsage(guildId, limitType, amount);
        }
        return limitCheck;
    }
    /**
     * Comprehensive check for command execution
     * Checks tier, features, and limits
     */
    async checkCommandAccess(context) {
        const { guildId, requiredTier, requiredFeature, usageLimitType } = context;
        // Check tier if required
        if (requiredTier) {
            const tierCheck = await this.checkTier(guildId, requiredTier);
            if (!tierCheck.allowed) {
                return tierCheck;
            }
        }
        // Check feature if required
        if (requiredFeature) {
            const featureCheck = await this.checkFeature(guildId, requiredFeature);
            if (!featureCheck.allowed) {
                return featureCheck;
            }
        }
        // Check usage limit if required
        if (usageLimitType) {
            const limitCheck = await this.checkLimit(guildId, usageLimitType);
            if (!limitCheck.allowed) {
                return limitCheck;
            }
        }
        const subscription = await this.subscriptionService.getSubscription(guildId);
        return {
            allowed: true,
            subscription,
        };
    }
    /**
     * Generate upgrade prompt message
     */
    generateUpgradePrompt(currentTier, requiredTier) {
        const benefits = this.getTierBenefits(requiredTier);
        return {
            title: `Upgrade to ${requiredTier}`,
            description: `This feature requires ${requiredTier} tier or higher. Upgrade now to unlock!`,
            currentTier,
            recommendedTier: requiredTier,
            benefits,
            ctaText: `Upgrade to ${requiredTier}`,
            upgradeUrl: process.env.UPGRADE_URL || 'https://discord-music-bot.com/upgrade',
        };
    }
    /**
     * Format upgrade message for Discord
     */
    formatUpgradeMessage(prompt) {
        let message = `🔒 **${prompt.title}**\n\n`;
        message += `${prompt.description}\n\n`;
        message += '**Benefits:**\n';
        for (const benefit of prompt.benefits) {
            message += `✅ ${benefit}\n`;
        }
        message += `\n🚀 [${prompt.ctaText}](${prompt.upgradeUrl})`;
        return message;
    }
    /**
     * Get tier benefits for display
     */
    getTierBenefits(tier) {
        const benefits = {
            [SubscriptionTier.FREE]: [
                '1 concurrent playback',
                'Basic commands',
                'Community support',
            ],
            [SubscriptionTier.BASIC]: [
                '3 concurrent playbacks',
                'High audio quality',
                'All commands',
                'Priority support',
                'Basic autoplay',
                'Custom prefix',
            ],
            [SubscriptionTier.PREMIUM]: [
                '10 concurrent playbacks',
                'Highest audio quality (320kbps)',
                'All commands + advanced',
                '24/7 priority support',
                'Advanced autoplay (all modes)',
                'Custom prefix & branding',
                'Analytics dashboard',
                'No ads',
            ],
            [SubscriptionTier.ENTERPRISE]: [
                'Unlimited concurrent playbacks',
                'Lossless audio quality',
                'Dedicated instance',
                'Custom features',
                'Dedicated support team',
                'SLA guarantee',
                'White-label option',
            ],
        };
        return benefits[tier] || [];
    }
}
