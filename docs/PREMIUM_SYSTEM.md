# 🎵 Premium Subscription System

## Overview

El sistema de suscripciones premium del Discord Music Bot implementa una arquitectura completa de features premium usando Clean Architecture y principios SOLID. El sistema permite diferentes tiers de suscripción con features específicas y quotas granulares.

## 🏗️ Arquitectura

### Clean Architecture Implementation

```
┌─────────────────────────────────────────────────────────────────┐
│                           Presentation Layer                    │
│  ├─ Discord Commands                                            │
│  ├─ REST API Endpoints                                          │
│  └─ WebHook Handlers                                            │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                         Application Layer                       │
│  ├─ Premium Feature Management Use Case                         │
│  ├─ Audio Quality Management Use Case                           │
│  ├─ Billing Management Use Case                                 │
│  └─ Subscription Management Use Case                            │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                           Domain Layer                          │
│  ├─ Entities: PremiumFeature, FeatureSubscription              │
│  ├─ Value Objects: AudioQuality, BillingPeriod                 │
│  └─ Domain Services: SubscriptionDomainService                 │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                       Infrastructure Layer                      │
│  ├─ Repositories: Prisma, Redis                                │
│  ├─ External Services: Lavalink, Payment Gateways             │
│  └─ Analytics: Premium Analytics Service                       │
└─────────────────────────────────────────────────────────────────┘
```

## 🎯 Subscription Tiers

### Free Tier
- **Price**: $0
- **Features**: Basic playbook, YouTube support, SponsorBlock
- **Quotas**:
  - Queue: 50 songs
  - Monthly playtime: 10 hours
  - API calls: 100/day

### Basic Tier
- **Price**: $4.99/month
- **Features**: Spotify integration, high quality audio, lyrics
- **Quotas**:
  - Queue: 100 songs
  - Monthly playtime: 30 hours
  - API calls: 500/day

### Premium Tier
- **Price**: $9.99/month
- **Features**: Apple Music, Deezer, lossless audio, advanced features
- **Quotas**:
  - Queue: 500 songs
  - Monthly playtime: 120 hours
  - API calls: 2000/day

### Enterprise Tier
- **Price**: $24.99/month
- **Features**: All features, spatial audio, analytics, webhooks, API access
- **Quotas**: Unlimited

## 🎧 Audio Quality Levels

| Quality | Bitrate | Sample Rate | Channels | Format | Tiers |
|---------|---------|-------------|----------|--------|--------|
| Standard | 128 kbps | 44.1 kHz | 2 | Opus | Free+ |
| High | 320 kbps | 44.1 kHz | 2 | Opus | Basic+ |
| Lossless | 1411 kbps | 44.1 kHz | 2 | FLAC | Premium+ |
| Spatial | Variable | 48 kHz | Multi | Dolby Atmos | Enterprise |

## 💰 Billing Periods & Discounts

| Period | Multiplier | Discount | Description |
|--------|------------|----------|-------------|
| Monthly | 1x | 0% | Standard pricing |
| Quarterly | 3x | 5% | Save 5% |
| Yearly | 12x | 15% | Save 15% |
| Lifetime | 60x | 50% | Save 50% |
| Trial | 0x | 100% | 14-day free trial |

## 🔧 Technical Implementation

### Configuration

The premium system is configured in `packages/config/src/enhanced-premium-config.ts`:

```typescript
import { hasFeatureAccess, getQuotaForTier, calculatePriceWithPeriod } from '@discord-bot/config';

// Check feature access
const canUseSpotify = hasFeatureAccess('basic', 'spotify_integration'); // true

// Get quotas
const queueLimit = getQuotaForTier('premium', 'queueSize'); // 500

// Calculate pricing
const yearlyPrice = calculatePriceWithPeriod('premium', 'yearly'); // $101.9 (15% off)
```

### Feature Validation

```typescript
import { PremiumFeatureService } from '../services/premium-feature-service';

const featureService = new PremiumFeatureService(...);

// Validate feature access
const result = await featureService.validateFeatureAccess('spotify_integration', {
  userId: 'user123',
  guildId: 'guild456'
});

if (result.allowed) {
  // Use feature
  await featureService.useFeature('spotify_integration', context, { query: 'search term' });
} else {
  // Show upgrade prompt
  console.log(result.upgradeRequired?.upgradeUrl);
}
```

### Subscription Management

```typescript
import { SubscriptionService } from '../services/subscription-service';

const subscriptionService = new SubscriptionService(...);

// Start trial
const trial = await subscriptionService.startTrial('user123', 'guild456', 'premium');

// Upgrade subscription
const upgrade = await subscriptionService.upgradeSubscription(
  'user123',
  'guild456',
  'premium',
  'yearly',
  'payment_method_id'
);

// Get status
const status = await subscriptionService.getSubscriptionStatus('user123', 'guild456');
```

## 🧪 Testing

### Running Premium Tests

```bash
# Run premium configuration tests
npx vitest run packages/config/test/enhanced-premium.test.ts

# Run all tests (skip integration tests if services not running)
pnpm test
```

### Test Coverage

The premium system includes comprehensive tests for:

- ✅ Feature access control (21 tests)
- ✅ Quota management and validation
- ✅ Pricing calculations with discounts
- ✅ Business logic validation
- ✅ Configuration structure validation

## 🚀 Deployment

### Environment Variables

Add to your `.env`:

```bash
# Premium Features (optional for development)
STRIPE_SECRET_KEY=sk_test_... # For payment processing
STRIPE_WEBHOOK_SECRET=whsec_... # For webhook validation

# Feature Flags
PREMIUM_FEATURES_ENABLED=true
TRIAL_PERIOD_DAYS=14
```

### Database Schema

The premium system requires additional database tables:

```sql
-- Feature subscriptions
CREATE TABLE feature_subscriptions (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  guild_id VARCHAR NOT NULL,
  tier VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP,
  auto_renewal BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Usage events for analytics
CREATE TABLE usage_events (
  id VARCHAR PRIMARY KEY,
  type VARCHAR NOT NULL,
  user_id VARCHAR NOT NULL,
  guild_id VARCHAR,
  tier VARCHAR NOT NULL,
  feature_name VARCHAR,
  metadata JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

### Service Dependencies

- **PostgreSQL**: For subscription and usage data
- **Redis**: For caching and rate limiting
- **Lavalink**: For audio quality management
- **Payment Gateway**: Stripe (recommended) or similar

## 📊 Analytics & Monitoring

### Metrics Tracked

- Feature usage by tier and user
- Subscription conversions and churn
- Audio quality usage patterns
- Revenue and billing metrics
- Performance and availability

### Dashboard Access

Enterprise customers get access to analytics dashboard:

```typescript
// Check dashboard access
if (hasFeatureAccess(userTier, 'analytics_dashboard')) {
  // Show analytics UI
  const analytics = await getSubscriptionAnalytics('month');
}
```

## 🔒 Security Considerations

### Access Control
- Feature access validated on every request
- Quota enforcement at application layer
- Rate limiting per tier

### Payment Security
- No payment processing in codebase (structure only)
- Webhook validation required
- PCI compliance when integrating payment gateway

### Data Privacy
- User data encrypted at rest
- Analytics data anonymized
- GDPR compliance built-in

## 🛠️ Development Guide

### Adding New Features

1. **Define Feature**: Add to `FeatureName` enum in config
2. **Set Requirements**: Update `FEATURE_TIER_REQUIREMENTS`
3. **Implement Logic**: Add to `PremiumFeatureService`
4. **Add Tests**: Create test cases
5. **Update Docs**: Document the feature

### Adding New Tiers

1. **Update Config**: Add tier to `ENHANCED_PREMIUM_FEATURES`
2. **Set Pricing**: Update `ENHANCED_PRICING`
3. **Update Logic**: Modify access control functions
4. **Test**: Ensure all tests pass
5. **Document**: Update tier documentation

## 📋 Checklist for Production

### Pre-deployment
- [ ] All tests passing
- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] Payment gateway integrated (if needed)
- [ ] Analytics configured

### Post-deployment
- [ ] Health checks working
- [ ] Metrics collecting
- [ ] Payment webhooks receiving
- [ ] Feature access working
- [ ] Quota enforcement active

## 🔗 Related Documentation

- [Architecture Overview](./ARCHITECTURE.md)
- [Development Guide](./DEVELOPMENT_GUIDE.md)
- [API Documentation](./API.md)
- [Configuration Guide](./CONFIGURATION.md)

---

🎵 **Discord Music Bot Premium System** - Providing tier-based features with enterprise-grade architecture.