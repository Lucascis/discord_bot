/**
 * Payment Provider Interface
 *
 * This interface defines the contract for all payment providers (Stripe, MercadoPago, PayPal, etc.)
 *
 * @module PaymentProvider
 * @category Infrastructure
 */

export interface PaymentProviderConfig {
  /** Provider name identifier */
  name: 'stripe' | 'mercadopago' | 'paypal' | 'stub' | 'custom';

  /** API credentials */
  apiKey: string;
  apiSecret?: string;

  /** Webhook configuration */
  webhookSecret: string;
  webhookEndpoint?: string;

  /** Provider capabilities */
  supportedCurrencies: string[];
  supportedCountries: string[];

  /** Feature flags */
  supportsSubscriptions: boolean;
  supportsRefunds: boolean;
  supportsPartialRefunds: boolean;
  supportsPaymentMethods: boolean;

  /** Testing configuration */
  testMode: boolean;
}

export interface PaymentCustomer {
  /** Provider-specific customer ID */
  id: string;

  /** Customer details */
  email: string;
  name?: string;

  /** Metadata */
  metadata?: Record<string, string>;

  /** Creation timestamp */
  createdAt: Date;
}

export interface PaymentMethod {
  /** Provider-specific payment method ID */
  id: string;

  /** Type of payment method */
  type: 'card' | 'bank_account' | 'wallet' | 'other';

  /** Card details (if applicable) */
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };

  /** Is this the default payment method? */
  isDefault: boolean;
}

export interface PaymentIntent {
  /** Provider-specific payment intent ID */
  id: string;

  /** Amount in smallest currency unit (e.g., cents) */
  amount: number;
  currency: string;

  /** Status of the payment */
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';

  /** Client secret for frontend confirmation (if needed) */
  clientSecret?: string;

  /** Metadata */
  metadata?: Record<string, string>;

  /** Error information if failed */
  error?: {
    code: string;
    message: string;
  };
}

export interface Subscription {
  /** Provider-specific subscription ID */
  id: string;

  /** Customer and pricing */
  customerId: string;
  priceId: string;

  /** Subscription status */
  status: 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing';

  /** Billing details */
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;

  /** Trial information */
  trialStart?: Date;
  trialEnd?: Date;

  /** Metadata */
  metadata?: Record<string, string>;
}

export interface RefundResult {
  /** Provider-specific refund ID */
  id: string;

  /** Refund amount */
  amount: number;
  currency: string;

  /** Status */
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';

  /** Reason for refund */
  reason?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Error information if failed */
  error?: {
    code: string;
    message: string;
  };
}

export interface Invoice {
  /** Provider-specific invoice ID */
  id: string;

  /** Customer information */
  customerId: string;

  /** Amount details */
  amountDue: number;
  amountPaid: number;
  currency: string;

  /** Status */
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

  /** Dates */
  createdAt: Date;
  dueDate?: Date;
  paidAt?: Date;

  /** Invoice URL (if available) */
  invoiceUrl?: string;

  /** Line items */
  lineItems: InvoiceLineItem[];
}

export interface InvoiceLineItem {
  description: string;
  amount: number;
  quantity: number;
  priceId?: string;
}

/**
 * Main Payment Provider Interface
 *
 * All payment providers must implement this interface to ensure
 * they can be used interchangeably in the system.
 */
export interface IPaymentProvider {
  /** Provider configuration */
  readonly config: PaymentProviderConfig;

  /** Provider name for logging/identification */
  readonly name: string;

  /**
   * Customer Management
   */

  createCustomer(data: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentCustomer>;

  getCustomer(customerId: string): Promise<PaymentCustomer>;

  updateCustomer(customerId: string, data: {
    email?: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentCustomer>;

  deleteCustomer(customerId: string): Promise<void>;

  /**
   * Payment Methods Management
   */

  attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;

  detachPaymentMethod(paymentMethodId: string): Promise<void>;

  listPaymentMethods(customerId: string): Promise<PaymentMethod[]>;

  setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;

  /**
   * Payment Processing
   */

  createPaymentIntent(data: {
    amount: number;
    currency: string;
    customerId?: string;
    paymentMethodId?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent>;

  capturePaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;

  cancelPaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;

  getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;

  /**
   * Subscription Management
   */

  createSubscription(data: {
    customerId: string;
    priceId: string;
    paymentMethodId?: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Subscription>;

  getSubscription(subscriptionId: string): Promise<Subscription>;

  updateSubscription(subscriptionId: string, data: {
    priceId?: string;
    cancelAtPeriodEnd?: boolean;
    metadata?: Record<string, string>;
  }): Promise<Subscription>;

  cancelSubscription(subscriptionId: string, cancelImmediately?: boolean): Promise<Subscription>;

  listSubscriptions(customerId: string): Promise<Subscription[]>;

  /**
   * Refunds
   */

  createRefund(data: {
    paymentIntentId: string;
    amount?: number; // Partial refund if specified
    reason?: string;
    metadata?: Record<string, string>;
  }): Promise<RefundResult>;

  getRefund(refundId: string): Promise<RefundResult>;

  /**
   * Invoices
   */

  getInvoice(invoiceId: string): Promise<Invoice>;

  listInvoices(customerId: string, options?: {
    limit?: number;
    status?: Invoice['status'];
  }): Promise<Invoice[]>;

  /**
   * Webhooks
   */

  verifyWebhookSignature(payload: string, signature: string): boolean;

  parseWebhookEvent(payload: string): WebhookEvent;

  /**
   * Utility Methods
   */

  isTestMode(): boolean;

  supportsCurrency(currency: string): boolean;

  supportsCountry(country: string): boolean;
}

/**
 * Webhook Event Types
 */
export interface WebhookEvent {
  /** Event type */
  type: string;

  /** Event data */
  data: {
    object: PaymentIntent | Subscription | Invoice | RefundResult | PaymentCustomer;
  };

  /** Event metadata */
  id: string;
  created: number;

  /** Previous attributes (for update events) */
  previousAttributes?: Record<string, unknown>;
}

/**
 * Common webhook event types
 */
export const WebhookEventType = {
  // Payment events
  PAYMENT_INTENT_SUCCEEDED: 'payment_intent.succeeded',
  PAYMENT_INTENT_FAILED: 'payment_intent.payment_failed',
  PAYMENT_INTENT_CANCELED: 'payment_intent.canceled',

  // Subscription events
  SUBSCRIPTION_CREATED: 'customer.subscription.created',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  SUBSCRIPTION_TRIAL_ENDING: 'customer.subscription.trial_will_end',

  // Invoice events
  INVOICE_CREATED: 'invoice.created',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  INVOICE_UPCOMING: 'invoice.upcoming',

  // Refund events
  REFUND_CREATED: 'charge.refund.created',
  REFUND_UPDATED: 'charge.refund.updated',

  // Customer events
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DELETED: 'customer.deleted',
} as const;

/**
 * Error types for better error handling
 */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly providerName: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export class PaymentProviderConfigError extends PaymentProviderError {
  constructor(providerName: string, message: string) {
    super(message, 'config_error', providerName);
    this.name = 'PaymentProviderConfigError';
  }
}

export class PaymentProviderNetworkError extends PaymentProviderError {
  constructor(providerName: string, originalError: Error) {
    super('Network error communicating with payment provider', 'network_error', providerName, originalError);
    this.name = 'PaymentProviderNetworkError';
  }
}

export class PaymentProviderValidationError extends PaymentProviderError {
  constructor(providerName: string, message: string, public readonly fieldErrors?: Record<string, string>) {
    super(message, 'validation_error', providerName);
    this.name = 'PaymentProviderValidationError';
  }
}
