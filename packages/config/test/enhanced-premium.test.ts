/**
 * Enhanced Premium Configuration Tests
 */

import { describe, it, expect } from 'vitest';
import {
  FeatureName,
  PeriodType,
  SubscriptionTier,
  hasFeatureAccess,
  getAvailableFeatures,
  getQuotaForTier,
  calculatePriceWithPeriod,
  validateUsageQuota,
  ENHANCED_PREMIUM_FEATURES,
  FEATURE_TIER_REQUIREMENTS,
  BILLING_PERIODS
} from '../src/enhanced-premium-config';

describe('Enhanced Premium Configuration', () => {
  describe('Feature Access Control', () => {
    it('should allow free tier access to basic features', () => {
      expect(hasFeatureAccess('free', 'sponsor_block')).toBe(true);
    });

    it('should deny free tier access to premium features', () => {
      expect(hasFeatureAccess('free', 'spotify_integration')).toBe(false);
      expect(hasFeatureAccess('free', 'lossless_audio')).toBe(false);
      expect(hasFeatureAccess('free', 'spatial_audio')).toBe(false);
    });

    it('should allow basic tier access to its features', () => {
      expect(hasFeatureAccess('basic', 'spotify_integration')).toBe(true);
      expect(hasFeatureAccess('basic', 'high_quality_audio')).toBe(true);
      expect(hasFeatureAccess('basic', 'lyrics_display')).toBe(true);
    });

    it('should allow premium tier access to advanced features', () => {
      expect(hasFeatureAccess('premium', 'lossless_audio')).toBe(true);
      expect(hasFeatureAccess('premium', 'apple_music_integration')).toBe(true);
      expect(hasFeatureAccess('premium', 'smart_recommendations')).toBe(true);
    });

    it('should allow enterprise tier access to all features', () => {
      expect(hasFeatureAccess('enterprise', 'spatial_audio')).toBe(true);
      expect(hasFeatureAccess('enterprise', 'analytics_dashboard')).toBe(true);
      expect(hasFeatureAccess('enterprise', 'api_access')).toBe(true);
    });
  });

  describe('Feature Lists by Tier', () => {
    it('should return correct features for free tier', () => {
      const features = getAvailableFeatures('free');
      expect(features).toContain('sponsor_block');
      expect(features).not.toContain('spotify_integration');
      expect(features.length).toBeGreaterThan(0);
    });

    it('should return more features for higher tiers', () => {
      const freeFeatures = getAvailableFeatures('free');
      const basicFeatures = getAvailableFeatures('basic');
      const premiumFeatures = getAvailableFeatures('premium');
      const enterpriseFeatures = getAvailableFeatures('enterprise');

      expect(basicFeatures.length).toBeGreaterThan(freeFeatures.length);
      expect(premiumFeatures.length).toBeGreaterThan(basicFeatures.length);
      expect(enterpriseFeatures.length).toBeGreaterThan(premiumFeatures.length);
    });
  });

  describe('Quota Management', () => {
    it('should return correct quotas for each tier', () => {
      expect(getQuotaForTier('free', 'queueSize')).toBe(50);
      expect(getQuotaForTier('basic', 'queueSize')).toBe(100);
      expect(getQuotaForTier('premium', 'queueSize')).toBe(500);
      expect(getQuotaForTier('enterprise', 'queueSize')).toBe(1000);
    });

    it('should return unlimited (-1) for enterprise monthly playtime', () => {
      expect(getQuotaForTier('enterprise', 'monthlyPlaytime')).toBe(-1);
    });

    it('should validate quota usage correctly', () => {
      const result = validateUsageQuota('free', 'queueSize', 25);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(50);
      expect(result.remaining).toBe(25);
    });

    it('should deny quota when exceeded', () => {
      const result = validateUsageQuota('free', 'queueSize', 55);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should allow unlimited usage for enterprise', () => {
      const result = validateUsageQuota('enterprise', 'monthlyPlaytime', 999999);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
      expect(result.remaining).toBe(-1);
    });
  });

  describe('Pricing Calculations', () => {
    it('should return 0 for free tier', () => {
      expect(calculatePriceWithPeriod('free', 'monthly')).toBe(0);
    });

    it('should calculate monthly pricing correctly', () => {
      expect(calculatePriceWithPeriod('basic', 'monthly')).toBe(4.99);
      expect(calculatePriceWithPeriod('premium', 'monthly')).toBe(9.99);
      expect(calculatePriceWithPeriod('enterprise', 'monthly')).toBe(24.99);
    });

    it('should apply discounts for longer periods', () => {
      const monthlyPrice = calculatePriceWithPeriod('premium', 'monthly');
      const yearlyPrice = calculatePriceWithPeriod('premium', 'yearly');
      const lifetimePrice = calculatePriceWithPeriod('premium', 'lifetime');

      // Yearly should be less than 12x monthly due to discount
      expect(yearlyPrice).toBeLessThan(monthlyPrice * 12);

      // Lifetime should be significantly discounted
      expect(lifetimePrice).toBeLessThan(monthlyPrice * 60);
    });
  });

  describe('Feature Configuration Structure', () => {
    it('should have valid feature tier requirements', () => {
      const features: FeatureName[] = [
        'spotify_integration',
        'lossless_audio',
        'spatial_audio',
        'analytics_dashboard'
      ];

      features.forEach(feature => {
        expect(FEATURE_TIER_REQUIREMENTS[feature]).toBeDefined();
        expect(['free', 'basic', 'premium', 'enterprise']).toContain(
          FEATURE_TIER_REQUIREMENTS[feature]
        );
      });
    });

    it('should have valid billing periods', () => {
      const periods: PeriodType[] = ['monthly', 'quarterly', 'yearly', 'lifetime', 'trial'];

      periods.forEach(period => {
        expect(BILLING_PERIODS[period]).toBeDefined();
        expect(BILLING_PERIODS[period].multiplier).toBeGreaterThanOrEqual(0);
        expect(BILLING_PERIODS[period].discountPercentage).toBeGreaterThanOrEqual(0);
        expect(BILLING_PERIODS[period].discountPercentage).toBeLessThanOrEqual(100);
      });
    });

    it('should have consistent feature configuration', () => {
      const tiers: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];

      tiers.forEach(tier => {
        const config = ENHANCED_PREMIUM_FEATURES[tier];
        expect(config).toBeDefined();
        expect(Array.isArray(config.features)).toBe(true);
        expect(config.quotas).toBeDefined();
        expect(config.restrictions).toBeDefined();
        expect(['standard', 'high', 'lossless', 'spatial']).toContain(config.maxAudioQuality);
      });
    });
  });

  describe('Audio Quality Levels', () => {
    it('should have progressive audio quality by tier', () => {
      expect(ENHANCED_PREMIUM_FEATURES.free.maxAudioQuality).toBe('standard');
      expect(ENHANCED_PREMIUM_FEATURES.basic.maxAudioQuality).toBe('high');
      expect(ENHANCED_PREMIUM_FEATURES.premium.maxAudioQuality).toBe('lossless');
      expect(ENHANCED_PREMIUM_FEATURES.enterprise.maxAudioQuality).toBe('spatial');
    });
  });

  describe('Business Logic Validation', () => {
    it('should ensure higher tiers include all lower tier features', () => {
      const freeFeatures = new Set(getAvailableFeatures('free'));
      const basicFeatures = new Set(getAvailableFeatures('basic'));
      const premiumFeatures = new Set(getAvailableFeatures('premium'));

      // Basic should include all free features
      freeFeatures.forEach(feature => {
        expect(basicFeatures.has(feature)).toBe(true);
      });

      // Premium should include all basic features
      basicFeatures.forEach(feature => {
        expect(premiumFeatures.has(feature)).toBe(true);
      });
    });

    it('should have increasing quotas for higher tiers', () => {
      const quotas = ['queueSize', 'apiCallsPerDay', 'searchesPerDay'] as const;

      quotas.forEach(quota => {
        const freeQuota = getQuotaForTier('free', quota);
        const basicQuota = getQuotaForTier('basic', quota);
        const premiumQuota = getQuotaForTier('premium', quota);

        if (freeQuota !== -1 && basicQuota !== -1) {
          expect(basicQuota).toBeGreaterThanOrEqual(freeQuota);
        }

        if (basicQuota !== -1 && premiumQuota !== -1) {
          expect(premiumQuota).toBeGreaterThanOrEqual(basicQuota);
        }
      });
    });
  });
});