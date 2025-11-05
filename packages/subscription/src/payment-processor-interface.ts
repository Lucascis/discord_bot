/**
 * Payment Processor Interface
 *
 * Defines the contract for all payment provider integrations.
 * Supports Stripe, Mercado Pago, and future payment processors.
 *
 * @module packages/subscription/payment-processor-interface
 */

import { SubscriptionTier, BillingCycle } from '@prisma/client';

export interface PaymentCustomer {
  /** Unique ID from payment provider */
  id: string;
  /** Customer email (optional) */
  email?: string;
  /** Provider-specific metadata */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface CheckoutSession {
  /** Unique session ID */
  id: string;
  /** Checkout URL to redirect user */
  url: string;
  /** Session status */
  status: 'open' | 'complete' | 'expired';
  /** Provider-specific metadata */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface PaymentSubscription {
  /** Unique subscription ID from provider */
  id: string;
  /** Customer ID */
  customerId: string;
  /** Subscription status */
  status: 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid';
  /** Current period start (Unix timestamp) */
  currentPeriodStart: number;
  /** Current period end (Unix timestamp) */
  currentPeriodEnd: number;
  /** Whether to cancel at period end */
  cancelAtPeriodEnd: boolean;
  /** Provider-specific metadata */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface WebhookEvent {
  /** Event type (e.g., 'payment_intent.succeeded') */
  type: string;
  /** Event data */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  /** Provider-specific raw event */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawEvent?: any;
}

/**
 * Payment Processor Interface
 * All payment providers must implement this interface
 */
export interface IPaymentProcessor {
  /** Payment provider name */
  readonly providerName: 'stripe' | 'mercadopago';

  /**
   * Create customer in payment provider
   * @param guildId - Discord guild ID
   * @param email - Customer email (optional)
   * @returns Customer object
   */
  createCustomer(guildId: string, email?: string): Promise<PaymentCustomer>;

  /**
   * Create checkout session for subscription
   * @param guildId - Discord guild ID
   * @param tier - Subscription tier
   * @param billingCycle - Billing cycle (monthly/yearly)
   * @param successUrl - Redirect URL on success
   * @param cancelUrl - Redirect URL on cancellation
   * @returns Checkout session with URL
   */
  createCheckoutSession(
    guildId: string,
    tier: SubscriptionTier,
    billingCycle: BillingCycle,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSession>;

  /**
   * Cancel subscription
   * @param subscriptionId - Provider subscription ID
   * @param immediately - Cancel immediately or at period end
   * @returns Updated subscription object
   */
  cancelSubscription(
    subscriptionId: string,
    immediately?: boolean
  ): Promise<PaymentSubscription>;

  /**
   * Resume canceled subscription
   * @param subscriptionId - Provider subscription ID
   * @returns Updated subscription object
   */
  resumeSubscription(subscriptionId: string): Promise<PaymentSubscription>;

  /**
   * Get subscription details
   * @param subscriptionId - Provider subscription ID
   * @returns Subscription object
   */
  getSubscription(subscriptionId: string): Promise<PaymentSubscription>;

  /**
   * Create billing portal session
   * @param customerId - Provider customer ID
   * @param returnUrl - URL to return to after managing subscription
   * @returns Portal session with URL
   */
  createBillingPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<{ url: string }>;

  /**
   * Verify webhook signature
   * @param payload - Raw webhook payload
   * @param signature - Webhook signature header
   * @param secret - Webhook secret
   * @returns True if signature is valid
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    secret: string
  ): boolean;

  /**
   * Parse webhook event
   * @param payload - Raw webhook payload
   * @param signature - Webhook signature header
   * @param secret - Webhook secret
   * @returns Parsed webhook event
   * @throws Error if signature verification fails
   */
  parseWebhookEvent(
    payload: string | Buffer,
    signature: string,
    secret: string
  ): Promise<WebhookEvent>;

  /**
   * Get price ID for tier and billing cycle
   * @param tier - Subscription tier
   * @param billingCycle - Billing cycle
   * @returns Price ID or null if not configured
   */
  getPriceId(tier: SubscriptionTier, billingCycle: BillingCycle): string | null;
}

/**
 * Payment Processor Factory
 * Creates the appropriate payment processor based on configuration
 */
export interface IPaymentProcessorFactory {
  /**
   * Create payment processor instance
   * @param provider - Payment provider name
   * @returns Payment processor instance
   */
  createProcessor(provider: 'stripe' | 'mercadopago'): IPaymentProcessor;

  /**
   * Get active payment processor
   * @returns Currently configured payment processor
   */
  getActiveProcessor(): IPaymentProcessor;
}
