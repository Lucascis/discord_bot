/**
 * @discord-bot/subscription
 *
 * Enterprise subscription management system
 * Provides tier-based features, usage limits, and billing integration
 *
 * @packageDocumentation
 */
// Core service
export { SubscriptionService } from './subscription-service.js';
// Plan definitions
export { PLANS, getPlanByTier, getAllPlans, getPublicPlans, needsUpgrade, getNextTier, formatPrice, calculateYearlySavings, } from './plans.js';
// Feature flags
export { FEATURES, tierHasFeature, getFeatureValue, getAllFeatures, getFeaturesByCategory, getFeaturesByTier, } from './features.js';
// Usage limits
export { LIMITS, getLimit, getAllLimits, getLimitValue, isWithinLimit, calculateLimitPercentage, calculateNextReset, formatLimitValue, } from './limits.js';
export { PaymentProcessorFactory, getPaymentProcessorFactory, resetPaymentProcessorFactory, createPaymentProcessorFactoryFromEnv, } from './payment-processor-factory.js';
export { StripeProcessor } from './processors/stripe-processor.js';
export { MercadoPagoProcessor } from './processors/mercadopago-processor.js';
// Legacy Stripe integration (deprecated - use PaymentProcessorFactory instead)
export { StripeIntegration } from './stripe-integration.js';
// Middleware (exports class)
export { SubscriptionMiddleware } from './middleware.js';
// Re-export Prisma enums for convenience
export { SubscriptionTier, SubscriptionStatus, BillingCycle, InvoiceStatus, FeatureCategory, FeatureType, ResetPeriod, SubscriptionEventType, } from '@prisma/client';
