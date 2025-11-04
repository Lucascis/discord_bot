/**
 * Subscription Plan Definitions
 * Defines all available subscription tiers and their features
 */

import { SubscriptionTier } from '@prisma/client';
import type { PlanDefinition } from './types.js';

/**
 * Complete plan definitions for all subscription tiers
 */
export const PLANS: Record<SubscriptionTier, PlanDefinition> = {
  FREE: {
    tier: SubscriptionTier.FREE,
    name: 'free',
    displayName: 'Free',
    description: 'Perfect for trying out the bot',
    price: {
      monthly: 0,
      yearly: 0,
    },
    features: {
      concurrentPlaybacks: 1,
      audioQuality: 'standard',
      basicCommands: true,
      advancedCommands: false,
      premiumCommands: false,
      autoplayEnabled: false,
      autoplayModes: [],
      customPrefix: false,
      customBranding: false,
      whiteLabel: false,
      supportLevel: 'community',
      analyticsEnabled: false,
      advancedAnalytics: false,
      dedicatedInstance: false,
      slaGuarantee: false,
      noAds: false,
    },
    limits: {
      maxQueueSize: 50,
      maxSongDuration: 3600, // 1 hour
      monthlyTracks: 1000,
      apiRateLimit: 10, // requests per minute
      maxGuilds: 1,
    },
  },

  BASIC: {
    tier: SubscriptionTier.BASIC,
    name: 'basic',
    displayName: 'Basic',
    description: 'Great for small communities',
    price: {
      monthly: 499, // $4.99
      yearly: 4990, // $49.90 (2 months free)
    },
    features: {
      concurrentPlaybacks: 3,
      audioQuality: 'high',
      basicCommands: true,
      advancedCommands: true,
      premiumCommands: false,
      autoplayEnabled: true,
      autoplayModes: ['similar'],
      customPrefix: true,
      customBranding: false,
      whiteLabel: false,
      supportLevel: 'priority',
      responseTime: '24 hours',
      analyticsEnabled: true,
      advancedAnalytics: false,
      dedicatedInstance: false,
      slaGuarantee: false,
      noAds: true,
    },
    limits: {
      maxQueueSize: 200,
      maxSongDuration: 7200, // 2 hours
      monthlyTracks: 10000,
      apiRateLimit: 30,
      maxGuilds: 3,
    },
    stripePriceIds: {
      // These would be set from Stripe dashboard
      monthly: process.env.STRIPE_PRICE_BASIC_MONTHLY,
      yearly: process.env.STRIPE_PRICE_BASIC_YEARLY,
    },
    stripeProductId: process.env.STRIPE_PRODUCT_BASIC,
  },

  PREMIUM: {
    tier: SubscriptionTier.PREMIUM,
    name: 'premium',
    displayName: 'Premium',
    description: 'Perfect for active communities',
    price: {
      monthly: 999, // $9.99
      yearly: 9990, // $99.90 (2 months free)
    },
    features: {
      concurrentPlaybacks: 10,
      audioQuality: 'highest',
      basicCommands: true,
      advancedCommands: true,
      premiumCommands: true,
      autoplayEnabled: true,
      autoplayModes: ['similar', 'artist', 'genre', 'mixed'],
      customPrefix: true,
      customBranding: true,
      whiteLabel: false,
      supportLevel: '24/7',
      responseTime: '4 hours',
      analyticsEnabled: true,
      advancedAnalytics: true,
      dedicatedInstance: false,
      slaGuarantee: false,
      noAds: true,
    },
    limits: {
      maxQueueSize: 1000,
      maxSongDuration: 14400, // 4 hours
      monthlyTracks: 100000,
      apiRateLimit: 100,
      maxGuilds: 10,
    },
    stripePriceIds: {
      monthly: process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
      yearly: process.env.STRIPE_PRICE_PREMIUM_YEARLY,
    },
    stripeProductId: process.env.STRIPE_PRODUCT_PREMIUM,
  },

  ENTERPRISE: {
    tier: SubscriptionTier.ENTERPRISE,
    name: 'enterprise',
    displayName: 'Enterprise',
    description: 'For large communities and businesses',
    price: {
      monthly: 0, // Custom pricing
      yearly: 0,
    },
    features: {
      concurrentPlaybacks: -1, // unlimited
      audioQuality: 'lossless',
      basicCommands: true,
      advancedCommands: true,
      premiumCommands: true,
      autoplayEnabled: true,
      autoplayModes: ['similar', 'artist', 'genre', 'mixed'],
      customPrefix: true,
      customBranding: true,
      whiteLabel: true,
      supportLevel: 'dedicated',
      responseTime: '1 hour',
      analyticsEnabled: true,
      advancedAnalytics: true,
      dedicatedInstance: true,
      slaGuarantee: true,
      noAds: true,
    },
    limits: {
      maxQueueSize: -1, // unlimited
      maxSongDuration: -1, // unlimited
      monthlyTracks: -1, // unlimited
      apiRateLimit: -1, // unlimited
      maxGuilds: -1, // unlimited
    },
  },
};

/**
 * Get plan definition by tier
 */
export function getPlanByTier(tier: SubscriptionTier): PlanDefinition {
  return PLANS[tier];
}

/**
 * Get all available plans
 */
export function getAllPlans(): PlanDefinition[] {
  return Object.values(PLANS);
}

/**
 * Get plans suitable for public display (excluding internal tiers)
 */
export function getPublicPlans(): PlanDefinition[] {
  return getAllPlans();
}

/**
 * Compare two tiers and determine if upgrade is needed
 */
export function needsUpgrade(currentTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  const tierOrder = [
    SubscriptionTier.FREE,
    SubscriptionTier.BASIC,
    SubscriptionTier.PREMIUM,
    SubscriptionTier.ENTERPRISE,
  ];

  const currentIndex = tierOrder.indexOf(currentTier);
  const requiredIndex = tierOrder.indexOf(requiredTier);

  return currentIndex < requiredIndex;
}

/**
 * Get the next higher tier
 */
export function getNextTier(currentTier: SubscriptionTier): SubscriptionTier | null {
  const tierOrder = [
    SubscriptionTier.FREE,
    SubscriptionTier.BASIC,
    SubscriptionTier.PREMIUM,
    SubscriptionTier.ENTERPRISE,
  ];

  const currentIndex = tierOrder.indexOf(currentTier);
  if (currentIndex === -1 || currentIndex === tierOrder.length - 1) {
    return null;
  }

  return tierOrder[currentIndex + 1];
}

/**
 * Format price for display
 */
export function formatPrice(cents: number, cycle: 'monthly' | 'yearly'): string {
  if (cents === 0) {
    return 'Free';
  }

  const dollars = cents / 100;
  const formatted = `$${dollars.toFixed(2)}`;

  return cycle === 'yearly' ? `${formatted}/year` : `${formatted}/month`;
}

/**
 * Calculate yearly savings
 */
export function calculateYearlySavings(plan: PlanDefinition): number {
  const monthlyAnnual = plan.price.monthly * 12;
  return monthlyAnnual - plan.price.yearly;
}
