/**
 * @discord-bot/subscription
 *
 * Enterprise subscription management system
 * Provides tier-based features, usage limits, and billing integration
 *
 * @packageDocumentation
 */

// Core services
export { SubscriptionService } from './subscription-service.js';
export { GuildService } from './guild-service.js';
export type { GuildInfo } from './guild-service.js';

// Plan definitions
export {
  PLAN_TEMPLATES,
  getPlanByTier,
  getAllPlans,
  getPublicPlans,
  needsUpgrade,
  getNextTier,
  formatPrice,
  calculateYearlySavings,
  loadPlansFromDatabase,
  setPlanOverrides,
} from './plans.js';

// Feature flags
export {
  FEATURES,
  tierHasFeature,
  getFeatureValue,
  getAllFeatures,
  getFeaturesByCategory,
  getFeaturesByTier,
} from './features.js';

// Usage limits
export {
  LIMITS,
  getLimit,
  getAllLimits,
  getLimitValue,
  isWithinLimit,
  calculateLimitPercentage,
  calculateNextReset,
  formatLimitValue,
} from './limits.js';

// Payment processor architecture
export type {
  IPaymentProcessor,
  IPaymentProcessorFactory,
  PaymentCustomer,
  CheckoutSession,
  PaymentSubscription,
  WebhookEvent,
} from './payment-processor-interface.js';

export {
  PaymentProcessorFactory,
  getPaymentProcessorFactory,
  resetPaymentProcessorFactory,
  createPaymentProcessorFactoryFromEnv,
} from './payment-processor-factory.js';

export { StripeProcessor } from './processors/stripe-processor.js';
export { MercadoPagoProcessor } from './processors/mercadopago-processor.js';

// Legacy Stripe integration (deprecated - use PaymentProcessorFactory instead)
export { StripeIntegration } from './stripe-integration.js';

// Middleware (exports class)
export { SubscriptionMiddleware } from './middleware.js';

// Types
export type {
  PlanDefinition,
  PlanFeatures,
  PlanLimits,
  FeatureFlag,
  SubscriptionInfo,
  SubscriptionCheckResult,
  FeatureAccessResult,
  UsageLimitResult,
  CreateSubscriptionParams,
  UpdateSubscriptionParams,
  UsageTrackingUpdate,
  UsageStats,
  StripeWebhookEvent,
  SubscriptionMiddlewareContext,
  SubscriptionMiddlewareResult,
  UpgradePrompt,
} from './types.js';

// Re-export Prisma enums for convenience
export {
  SubscriptionTier,
  SubscriptionStatus,
  BillingInterval,
  InvoiceStatus,
  FeatureCategory,
  FeatureType,
  ResetPeriod,
  SubscriptionEventType,
} from '@prisma/client';
