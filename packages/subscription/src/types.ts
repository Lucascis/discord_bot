/**
 * Subscription System Types
 * Complete type definitions for the Discord Music Bot subscription system
 */

import type { SubscriptionTier, SubscriptionStatus, BillingCycle, FeatureCategory } from '@prisma/client';

// ========================================
// PLAN TYPES
// ========================================

export interface PlanDefinition {
  tier: SubscriptionTier;
  name: string;
  displayName: string;
  description: string;
  price: {
    monthly: number; // in cents
    yearly: number; // in cents
  };
  features: PlanFeatures;
  limits: PlanLimits;
  stripePriceIds?: {
    monthly?: string;
    yearly?: string;
  };
  stripeProductId?: string;
}

export interface PlanFeatures {
  // Playback features
  concurrentPlaybacks: number;
  audioQuality: 'standard' | 'high' | 'highest' | 'lossless';

  // Command access
  basicCommands: boolean;
  advancedCommands: boolean;
  premiumCommands: boolean;

  // Autoplay features
  autoplayEnabled: boolean;
  autoplayModes: ('similar' | 'artist' | 'genre' | 'mixed')[];

  // Customization
  customPrefix: boolean;
  customBranding: boolean;
  whiteLabel: boolean;

  // Support
  supportLevel: 'community' | 'priority' | '24/7' | 'dedicated';
  responseTime?: string;

  // Analytics
  analyticsEnabled: boolean;
  advancedAnalytics: boolean;

  // Additional features
  dedicatedInstance: boolean;
  slaGuarantee: boolean;
  noAds: boolean;
}

export interface PlanLimits {
  maxQueueSize: number;
  maxSongDuration: number; // in seconds
  monthlyTracks: number;
  apiRateLimit: number; // requests per minute
  maxGuilds: number; // how many guilds can use this subscription
}

// ========================================
// SUBSCRIPTION TYPES
// ========================================

export interface SubscriptionInfo {
  guildId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  isActive: boolean;
  isTrialing: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  features: PlanFeatures;
  limits: PlanLimits;
}

export interface SubscriptionCheckResult {
  hasAccess: boolean;
  reason?: string;
  upgradeUrl?: string;
  currentTier: SubscriptionTier;
  requiredTier?: SubscriptionTier;
}

export interface FeatureAccessResult {
  hasAccess: boolean;
  featureKey: string;
  currentValue?: string | number | boolean;
  requiredTier?: SubscriptionTier;
  upgradeMessage?: string;
}

export interface UsageLimitResult {
  withinLimit: boolean;
  limitType: string;
  currentValue: number;
  maxValue: number;
  percentageUsed: number;
  resetDate?: Date;
  upgradeMessage?: string;
}

// ========================================
// STRIPE TYPES
// ========================================

export interface StripeWebhookEvent {
  type: string;
  data: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    object: any;
  };
}

export interface CreateSubscriptionParams {
  guildId: string;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  stripeCustomerId?: string;
  trialDays?: number;
}

export interface UpdateSubscriptionParams {
  tier?: SubscriptionTier;
  billingCycle?: BillingCycle;
  cancelAtPeriodEnd?: boolean;
}

// ========================================
// USAGE TRACKING TYPES
// ========================================

export interface UsageTrackingUpdate {
  tracksPlayed?: number;
  playbackMinutes?: number;
  apiRequests?: number;
}

export interface UsageStats {
  current: {
    tracksPlayed: number;
    playbackMinutes: number;
    apiRequests: number;
    periodStart: Date;
    periodEnd: Date;
  };
  lifetime: {
    totalTracksPlayed: number;
    totalPlaybackMinutes: number;
    totalApiRequests: number;
  };
}

// ========================================
// MIDDLEWARE TYPES
// ========================================

export interface SubscriptionMiddlewareContext {
  guildId: string;
  userId?: string;
  requiredTier?: SubscriptionTier;
  requiredFeature?: string;
  usageLimitType?: string;
}

export interface SubscriptionMiddlewareResult {
  allowed: boolean;
  message?: string;
  subscription?: SubscriptionInfo;
}

// ========================================
// UPGRADE PROMPT TYPES
// ========================================

export interface UpgradePrompt {
  title: string;
  description: string;
  currentTier: SubscriptionTier;
  recommendedTier: SubscriptionTier;
  benefits: string[];
  ctaText: string;
  upgradeUrl: string;
}

// ========================================
// FEATURE FLAG TYPES
// ========================================

export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  category: FeatureCategory;
  availableTiers: SubscriptionTier[];
  defaultValue: string | number | boolean;
  valuesByTier: Partial<Record<SubscriptionTier, string | number | boolean>>;
}

// ========================================
// EXPORT TYPES
// ========================================

export type { SubscriptionTier, SubscriptionStatus, BillingCycle, FeatureCategory };
