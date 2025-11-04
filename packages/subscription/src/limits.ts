/**
 * Usage Limits Definitions
 * Defines all usage limits for different subscription tiers
 */

import { SubscriptionTier, ResetPeriod } from '@prisma/client';

export interface LimitDefinition {
  key: string;
  name: string;
  description: string;
  resetPeriod: ResetPeriod | null;
  valuesByTier: Partial<Record<SubscriptionTier, number>>;
}

/**
 * All available usage limits
 */
export const LIMITS: Record<string, LimitDefinition> = {
  CONCURRENT_PLAYBACKS: {
    key: 'concurrent_playbacks',
    name: 'Concurrent Playbacks',
    description: 'Maximum number of simultaneous music playbacks',
    resetPeriod: null, // No reset, always enforced
    valuesByTier: {
      [SubscriptionTier.FREE]: 1,
      [SubscriptionTier.BASIC]: 3,
      [SubscriptionTier.PREMIUM]: 10,
      [SubscriptionTier.ENTERPRISE]: -1, // unlimited
    },
  },

  MONTHLY_TRACKS: {
    key: 'monthly_tracks',
    name: 'Monthly Track Plays',
    description: 'Number of tracks that can be played per month',
    resetPeriod: ResetPeriod.MONTHLY,
    valuesByTier: {
      [SubscriptionTier.FREE]: 1000,
      [SubscriptionTier.BASIC]: 10000,
      [SubscriptionTier.PREMIUM]: 100000,
      [SubscriptionTier.ENTERPRISE]: -1, // unlimited
    },
  },

  QUEUE_SIZE: {
    key: 'queue_size',
    name: 'Queue Size',
    description: 'Maximum number of tracks in queue',
    resetPeriod: null,
    valuesByTier: {
      [SubscriptionTier.FREE]: 50,
      [SubscriptionTier.BASIC]: 200,
      [SubscriptionTier.PREMIUM]: 1000,
      [SubscriptionTier.ENTERPRISE]: -1, // unlimited
    },
  },

  MAX_SONG_DURATION: {
    key: 'max_song_duration',
    name: 'Maximum Song Duration',
    description: 'Maximum duration of a single track in seconds',
    resetPeriod: null,
    valuesByTier: {
      [SubscriptionTier.FREE]: 3600, // 1 hour
      [SubscriptionTier.BASIC]: 7200, // 2 hours
      [SubscriptionTier.PREMIUM]: 14400, // 4 hours
      [SubscriptionTier.ENTERPRISE]: -1, // unlimited
    },
  },

  API_RATE_LIMIT: {
    key: 'api_rate_limit',
    name: 'API Rate Limit',
    description: 'Maximum API requests per minute',
    resetPeriod: null, // Enforced per minute
    valuesByTier: {
      [SubscriptionTier.FREE]: 10,
      [SubscriptionTier.BASIC]: 30,
      [SubscriptionTier.PREMIUM]: 100,
      [SubscriptionTier.ENTERPRISE]: -1, // unlimited
    },
  },

  DAILY_PLAYBACK_HOURS: {
    key: 'daily_playback_hours',
    name: 'Daily Playback Hours',
    description: 'Maximum playback hours per day',
    resetPeriod: ResetPeriod.DAILY,
    valuesByTier: {
      [SubscriptionTier.FREE]: 6,
      [SubscriptionTier.BASIC]: 24,
      [SubscriptionTier.PREMIUM]: -1, // unlimited
      [SubscriptionTier.ENTERPRISE]: -1, // unlimited
    },
  },

  MAX_GUILDS: {
    key: 'max_guilds',
    name: 'Maximum Guilds',
    description: 'Number of guilds that can use this subscription',
    resetPeriod: null,
    valuesByTier: {
      [SubscriptionTier.FREE]: 1,
      [SubscriptionTier.BASIC]: 3,
      [SubscriptionTier.PREMIUM]: 10,
      [SubscriptionTier.ENTERPRISE]: -1, // unlimited
    },
  },

  PLAYLIST_SIZE: {
    key: 'playlist_size',
    name: 'Playlist Size',
    description: 'Maximum number of tracks when importing playlists',
    resetPeriod: null,
    valuesByTier: {
      [SubscriptionTier.FREE]: 25,
      [SubscriptionTier.BASIC]: 100,
      [SubscriptionTier.PREMIUM]: 500,
      [SubscriptionTier.ENTERPRISE]: -1, // unlimited
    },
  },
};

/**
 * Get limit definition by key
 */
export function getLimit(key: string): LimitDefinition | undefined {
  return LIMITS[key];
}

/**
 * Get all limit definitions
 */
export function getAllLimits(): LimitDefinition[] {
  return Object.values(LIMITS);
}

/**
 * Get limit value for a specific tier
 */
export function getLimitValue(limitKey: string, tier: SubscriptionTier): number {
  const limit = getLimit(limitKey);
  if (!limit) return 0;

  return limit.valuesByTier[tier] ?? 0;
}

/**
 * Check if a value is within the limit
 * Returns true if within limit, false if exceeded
 * Note: -1 means unlimited and always returns true
 */
export function isWithinLimit(currentValue: number, maxValue: number): boolean {
  // -1 means unlimited
  if (maxValue === -1) return true;

  return currentValue < maxValue;
}

/**
 * Calculate percentage of limit used
 */
export function calculateLimitPercentage(currentValue: number, maxValue: number): number {
  // -1 means unlimited, return 0%
  if (maxValue === -1) return 0;

  if (maxValue === 0) return 100;

  return Math.min(100, (currentValue / maxValue) * 100);
}

/**
 * Calculate next reset date based on reset period
 */
export function calculateNextReset(resetPeriod: ResetPeriod, from?: Date): Date {
  const date = from ? new Date(from) : new Date();

  switch (resetPeriod) {
    case ResetPeriod.DAILY:
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
      break;

    case ResetPeriod.WEEKLY:
      date.setDate(date.getDate() + (7 - date.getDay()));
      date.setHours(0, 0, 0, 0);
      break;

    case ResetPeriod.MONTHLY:
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
      break;

    case ResetPeriod.YEARLY:
      date.setFullYear(date.getFullYear() + 1, 0, 1);
      date.setHours(0, 0, 0, 0);
      break;
  }

  return date;
}

/**
 * Format limit value for display
 */
export function formatLimitValue(value: number, limitKey: string): string {
  // Unlimited
  if (value === -1) {
    return 'Unlimited';
  }

  // Duration limits (in seconds)
  if (limitKey.includes('duration') || limitKey.includes('hours')) {
    const hours = Math.floor(value / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  // Format large numbers
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}k`;
  }

  return value.toString();
}
