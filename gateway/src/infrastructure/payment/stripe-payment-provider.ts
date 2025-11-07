/**
 * Stripe Payment Provider
 *
 * Production-ready implementation of IPaymentProvider using Stripe SDK.
 * Supports all payment operations with comprehensive error handling.
 *
 * @module StripePaymentProvider
 * @category Infrastructure
 */

import Stripe from 'stripe';
import { logger } from '@discord-bot/logger';
import {
  IPaymentProvider,
  PaymentProviderConfig,
  PaymentCustomer,
  PaymentMethod,
  PaymentIntent,
  Subscription,
  RefundResult,
  Invoice,
  InvoiceLineItem,
  WebhookEvent,
  PaymentProviderError,
  PaymentProviderNetworkError,
  PaymentProviderValidationError,
} from './payment-provider.interface.js';

/**
 * Custom error class for Stripe-specific errors
 */
export class StripeProviderError extends PaymentProviderError {
  constructor(
    message: string,
    code: string,
    public readonly stripeError?: Stripe.StripeRawError,
    public readonly statusCode?: number,
    public readonly requestId?: string
  ) {
    super(message, code, 'stripe', stripeError ? new Error(stripeError.message || message) : undefined);
    this.name = 'StripeProviderError';
  }
}

/**
 * Stripe Payment Provider
 *
 * Complete Stripe integration with:
 * - Customer lifecycle management
 * - Payment method handling
 * - Payment intent processing
 * - Subscription management
 * - Refund processing
 * - Invoice management
 * - Webhook verification
 * - Automatic retry logic for network errors
 * - Comprehensive error handling
 *
 * @example
 * ```typescript
 * const provider = new StripePaymentProvider({
 *   name: 'stripe',
 *   apiKey: 'sk_test_...',
 *   webhookSecret: 'whsec_...',
 *   supportedCurrencies: ['USD', 'EUR'],
 *   supportedCountries: ['US', 'UK'],
 *   supportsSubscriptions: true,
 *   supportsRefunds: true,
 *   supportsPartialRefunds: true,
 *   supportsPaymentMethods: true,
 *   testMode: true
 * });
 *
 * const customer = await provider.createCustomer({
 *   email: 'user@example.com',
 *   name: 'John Doe'
 * });
 * ```
 */
export class StripePaymentProvider implements IPaymentProvider {
  readonly config: PaymentProviderConfig;
  readonly name: string = 'stripe';

  private stripe: Stripe;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second base delay

  /**
   * Initialize Stripe provider with configuration
   *
   * @param config - Provider configuration including API keys and capabilities
   * @throws {StripeProviderError} If configuration is invalid
   */
  constructor(config: PaymentProviderConfig) {
    this.config = config;

    // Validate configuration
    if (!config.apiKey) {
      throw new StripeProviderError(
        'Stripe API key is required',
        'invalid_config'
      );
    }

    if (!config.webhookSecret) {
      logger.warn('[StripeProvider] No webhook secret provided - webhook verification will fail');
    }

    // Initialize Stripe client with API version and retry configuration
    this.stripe = new Stripe(config.apiKey, {
      apiVersion: '2023-10-16',
      typescript: true,
      maxNetworkRetries: 2,
      timeout: 30000, // 30 second timeout
      telemetry: false, // Disable telemetry for privacy
    });

    logger.info('[StripeProvider] Initialized', {
      testMode: this.isTestMode(),
      supportedCurrencies: config.supportedCurrencies,
      supportedCountries: config.supportedCountries,
    });
  }

  // ============================================================================
  // CUSTOMER MANAGEMENT
  // ============================================================================

  /**
   * Create a new Stripe customer
   *
   * @param data - Customer information
   * @returns Promise resolving to created customer
   * @throws {StripeProviderError} If customer creation fails
   *
   * @example
   * ```typescript
   * const customer = await provider.createCustomer({
   *   email: 'user@example.com',
   *   name: 'John Doe',
   *   metadata: { userId: '12345' }
   * });
   * ```
   */
  async createCustomer(data: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentCustomer> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Creating customer', { email: data.email });

      try {
        const customer = await this.stripe.customers.create({
          email: data.email,
          name: data.name,
          metadata: data.metadata || {},
        });

        logger.info('[StripeProvider] Customer created', { customerId: customer.id });

        return this.mapStripeCustomer(customer);
      } catch (error) {
        throw this.handleStripeError(error, 'create_customer');
      }
    }, 'createCustomer');
  }

  /**
   * Get an existing Stripe customer
   *
   * @param customerId - Stripe customer ID
   * @returns Promise resolving to customer data
   * @throws {StripeProviderError} If customer not found or retrieval fails
   */
  async getCustomer(customerId: string): Promise<PaymentCustomer> {
    return this.executeWithRetry(async () => {
      logger.debug('[StripeProvider] Getting customer', { customerId });

      try {
        const customer = await this.stripe.customers.retrieve(customerId);

        if (customer.deleted) {
          throw new StripeProviderError(
            `Customer ${customerId} has been deleted`,
            'customer_deleted'
          );
        }

        return this.mapStripeCustomer(customer as Stripe.Customer);
      } catch (error) {
        throw this.handleStripeError(error, 'get_customer');
      }
    }, 'getCustomer');
  }

  /**
   * Update an existing Stripe customer
   *
   * @param customerId - Stripe customer ID
   * @param data - Fields to update
   * @returns Promise resolving to updated customer
   * @throws {StripeProviderError} If update fails
   */
  async updateCustomer(
    customerId: string,
    data: {
      email?: string;
      name?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<PaymentCustomer> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Updating customer', { customerId });

      try {
        const customer = await this.stripe.customers.update(customerId, {
          email: data.email,
          name: data.name,
          metadata: data.metadata,
        });

        logger.info('[StripeProvider] Customer updated', { customerId });

        return this.mapStripeCustomer(customer);
      } catch (error) {
        throw this.handleStripeError(error, 'update_customer');
      }
    }, 'updateCustomer');
  }

  /**
   * Delete a Stripe customer
   *
   * Note: This is a soft delete in Stripe. The customer record remains but is marked as deleted.
   *
   * @param customerId - Stripe customer ID
   * @throws {StripeProviderError} If deletion fails
   */
  async deleteCustomer(customerId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Deleting customer', { customerId });

      try {
        await this.stripe.customers.del(customerId);
        logger.info('[StripeProvider] Customer deleted', { customerId });
      } catch (error) {
        throw this.handleStripeError(error, 'delete_customer');
      }
    }, 'deleteCustomer');
  }

  // ============================================================================
  // PAYMENT METHODS
  // ============================================================================

  /**
   * Attach a payment method to a customer
   *
   * @param customerId - Stripe customer ID
   * @param paymentMethodId - Stripe payment method ID
   * @throws {StripeProviderError} If attachment fails
   *
   * @example
   * ```typescript
   * await provider.attachPaymentMethod('cus_123', 'pm_456');
   * ```
   */
  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Attaching payment method', { customerId, paymentMethodId });

      try {
        await this.stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        });

        logger.info('[StripeProvider] Payment method attached', { customerId, paymentMethodId });
      } catch (error) {
        throw this.handleStripeError(error, 'attach_payment_method');
      }
    }, 'attachPaymentMethod');
  }

  /**
   * Detach a payment method from its customer
   *
   * @param paymentMethodId - Stripe payment method ID
   * @throws {StripeProviderError} If detachment fails
   */
  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Detaching payment method', { paymentMethodId });

      try {
        await this.stripe.paymentMethods.detach(paymentMethodId);
        logger.info('[StripeProvider] Payment method detached', { paymentMethodId });
      } catch (error) {
        throw this.handleStripeError(error, 'detach_payment_method');
      }
    }, 'detachPaymentMethod');
  }

  /**
   * List all payment methods for a customer
   *
   * @param customerId - Stripe customer ID
   * @returns Promise resolving to array of payment methods
   * @throws {StripeProviderError} If listing fails
   */
  async listPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    return this.executeWithRetry(async () => {
      logger.debug('[StripeProvider] Listing payment methods', { customerId });

      try {
        // Get customer to check default payment method
        const customer = await this.stripe.customers.retrieve(customerId);
        const defaultPaymentMethodId =
          typeof customer !== 'string' && !customer.deleted && 'invoice_settings' in customer
            ? (customer as Stripe.Customer).invoice_settings.default_payment_method
            : null;

        // List all card payment methods
        const paymentMethods = await this.stripe.paymentMethods.list({
          customer: customerId,
          type: 'card',
          limit: 100,
        });

        return paymentMethods.data.map((pm) =>
          this.mapStripePaymentMethod(pm, pm.id === defaultPaymentMethodId)
        );
      } catch (error) {
        throw this.handleStripeError(error, 'list_payment_methods');
      }
    }, 'listPaymentMethods');
  }

  /**
   * Set default payment method for a customer
   *
   * @param customerId - Stripe customer ID
   * @param paymentMethodId - Stripe payment method ID
   * @throws {StripeProviderError} If setting default fails
   */
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Setting default payment method', { customerId, paymentMethodId });

      try {
        await this.stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });

        logger.info('[StripeProvider] Default payment method set', { customerId, paymentMethodId });
      } catch (error) {
        throw this.handleStripeError(error, 'set_default_payment_method');
      }
    }, 'setDefaultPaymentMethod');
  }

  // ============================================================================
  // PAYMENT PROCESSING
  // ============================================================================

  /**
   * Create a payment intent
   *
   * @param data - Payment intent parameters
   * @returns Promise resolving to created payment intent
   * @throws {StripeProviderError} If creation fails
   *
   * @example
   * ```typescript
   * const intent = await provider.createPaymentIntent({
   *   amount: 1000, // $10.00
   *   currency: 'usd',
   *   customerId: 'cus_123',
   *   metadata: { orderId: '789' }
   * });
   * ```
   */
  async createPaymentIntent(data: {
    amount: number;
    currency: string;
    customerId?: string;
    paymentMethodId?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Creating payment intent', {
        amount: data.amount,
        currency: data.currency,
        customerId: data.customerId,
      });

      try {
        const params: Stripe.PaymentIntentCreateParams = {
          amount: data.amount,
          currency: data.currency.toLowerCase(),
          metadata: data.metadata || {},
          automatic_payment_methods: {
            enabled: true,
          },
        };

        if (data.customerId) {
          params.customer = data.customerId;
        }

        if (data.paymentMethodId) {
          params.payment_method = data.paymentMethodId;
          params.confirm = true;
        }

        const intent = await this.stripe.paymentIntents.create(params);

        logger.info('[StripeProvider] Payment intent created', {
          paymentIntentId: intent.id,
          status: intent.status,
        });

        return this.mapStripePaymentIntent(intent);
      } catch (error) {
        throw this.handleStripeError(error, 'create_payment_intent');
      }
    }, 'createPaymentIntent');
  }

  /**
   * Capture a payment intent (for manual capture flows)
   *
   * @param paymentIntentId - Stripe payment intent ID
   * @returns Promise resolving to captured payment intent
   * @throws {StripeProviderError} If capture fails
   */
  async capturePaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Capturing payment intent', { paymentIntentId });

      try {
        const intent = await this.stripe.paymentIntents.capture(paymentIntentId);

        logger.info('[StripeProvider] Payment intent captured', {
          paymentIntentId,
          status: intent.status,
        });

        return this.mapStripePaymentIntent(intent);
      } catch (error) {
        throw this.handleStripeError(error, 'capture_payment_intent');
      }
    }, 'capturePaymentIntent');
  }

  /**
   * Cancel a payment intent
   *
   * @param paymentIntentId - Stripe payment intent ID
   * @returns Promise resolving to canceled payment intent
   * @throws {StripeProviderError} If cancellation fails
   */
  async cancelPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Canceling payment intent', { paymentIntentId });

      try {
        const intent = await this.stripe.paymentIntents.cancel(paymentIntentId);

        logger.info('[StripeProvider] Payment intent canceled', { paymentIntentId });

        return this.mapStripePaymentIntent(intent);
      } catch (error) {
        throw this.handleStripeError(error, 'cancel_payment_intent');
      }
    }, 'cancelPaymentIntent');
  }

  /**
   * Get a payment intent
   *
   * @param paymentIntentId - Stripe payment intent ID
   * @returns Promise resolving to payment intent
   * @throws {StripeProviderError} If retrieval fails
   */
  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    return this.executeWithRetry(async () => {
      logger.debug('[StripeProvider] Getting payment intent', { paymentIntentId });

      try {
        const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
        return this.mapStripePaymentIntent(intent);
      } catch (error) {
        throw this.handleStripeError(error, 'get_payment_intent');
      }
    }, 'getPaymentIntent');
  }

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================================================

  /**
   * Create a subscription
   *
   * @param data - Subscription parameters
   * @returns Promise resolving to created subscription
   * @throws {StripeProviderError} If creation fails
   *
   * @example
   * ```typescript
   * const subscription = await provider.createSubscription({
   *   customerId: 'cus_123',
   *   priceId: 'price_456',
   *   trialPeriodDays: 7,
   *   metadata: { plan: 'premium' }
   * });
   * ```
   */
  async createSubscription(data: {
    customerId: string;
    priceId: string;
    paymentMethodId?: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Subscription> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Creating subscription', {
        customerId: data.customerId,
        priceId: data.priceId,
      });

      try {
        const params: Stripe.SubscriptionCreateParams = {
          customer: data.customerId,
          items: [{ price: data.priceId }],
          metadata: data.metadata || {},
        };

        if (data.paymentMethodId) {
          params.default_payment_method = data.paymentMethodId;
        }

        if (data.trialPeriodDays) {
          params.trial_period_days = data.trialPeriodDays;
        }

        // Expand to get full price data
        params.expand = ['latest_invoice.payment_intent'];

        const subscription = await this.stripe.subscriptions.create(params);

        logger.info('[StripeProvider] Subscription created', {
          subscriptionId: subscription.id,
          status: subscription.status,
        });

        return this.mapStripeSubscription(subscription);
      } catch (error) {
        throw this.handleStripeError(error, 'create_subscription');
      }
    }, 'createSubscription');
  }

  /**
   * Get a subscription
   *
   * @param subscriptionId - Stripe subscription ID
   * @returns Promise resolving to subscription
   * @throws {StripeProviderError} If retrieval fails
   */
  async getSubscription(subscriptionId: string): Promise<Subscription> {
    return this.executeWithRetry(async () => {
      logger.debug('[StripeProvider] Getting subscription', { subscriptionId });

      try {
        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        return this.mapStripeSubscription(subscription);
      } catch (error) {
        throw this.handleStripeError(error, 'get_subscription');
      }
    }, 'getSubscription');
  }

  /**
   * Update a subscription
   *
   * @param subscriptionId - Stripe subscription ID
   * @param data - Fields to update
   * @returns Promise resolving to updated subscription
   * @throws {StripeProviderError} If update fails
   */
  async updateSubscription(
    subscriptionId: string,
    data: {
      priceId?: string;
      cancelAtPeriodEnd?: boolean;
      metadata?: Record<string, string>;
    }
  ): Promise<Subscription> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Updating subscription', { subscriptionId });

      try {
        const params: Stripe.SubscriptionUpdateParams = {};

        if (data.priceId) {
          // Get current subscription to update items
          const currentSub = await this.stripe.subscriptions.retrieve(subscriptionId);
          params.items = [
            {
              id: currentSub.items.data[0].id,
              price: data.priceId,
            },
          ];
        }

        if (data.cancelAtPeriodEnd !== undefined) {
          params.cancel_at_period_end = data.cancelAtPeriodEnd;
        }

        if (data.metadata) {
          params.metadata = data.metadata;
        }

        const subscription = await this.stripe.subscriptions.update(subscriptionId, params);

        logger.info('[StripeProvider] Subscription updated', { subscriptionId });

        return this.mapStripeSubscription(subscription);
      } catch (error) {
        throw this.handleStripeError(error, 'update_subscription');
      }
    }, 'updateSubscription');
  }

  /**
   * Cancel a subscription
   *
   * @param subscriptionId - Stripe subscription ID
   * @param cancelImmediately - If true, cancel immediately; if false, cancel at period end
   * @returns Promise resolving to canceled subscription
   * @throws {StripeProviderError} If cancellation fails
   */
  async cancelSubscription(subscriptionId: string, cancelImmediately = false): Promise<Subscription> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Canceling subscription', { subscriptionId, cancelImmediately });

      try {
        let subscription: Stripe.Subscription;

        if (cancelImmediately) {
          subscription = await this.stripe.subscriptions.cancel(subscriptionId);
        } else {
          subscription = await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
          });
        }

        logger.info('[StripeProvider] Subscription canceled', {
          subscriptionId,
          status: subscription.status,
        });

        return this.mapStripeSubscription(subscription);
      } catch (error) {
        throw this.handleStripeError(error, 'cancel_subscription');
      }
    }, 'cancelSubscription');
  }

  /**
   * List all subscriptions for a customer
   *
   * @param customerId - Stripe customer ID
   * @returns Promise resolving to array of subscriptions
   * @throws {StripeProviderError} If listing fails
   */
  async listSubscriptions(customerId: string): Promise<Subscription[]> {
    return this.executeWithRetry(async () => {
      logger.debug('[StripeProvider] Listing subscriptions', { customerId });

      try {
        const subscriptions = await this.stripe.subscriptions.list({
          customer: customerId,
          limit: 100,
        });

        return subscriptions.data.map((sub) => this.mapStripeSubscription(sub));
      } catch (error) {
        throw this.handleStripeError(error, 'list_subscriptions');
      }
    }, 'listSubscriptions');
  }

  // ============================================================================
  // REFUNDS
  // ============================================================================

  /**
   * Create a refund
   *
   * @param data - Refund parameters
   * @returns Promise resolving to refund result
   * @throws {StripeProviderError} If refund fails
   *
   * @example
   * ```typescript
   * const refund = await provider.createRefund({
   *   paymentIntentId: 'pi_123',
   *   amount: 500, // Partial refund $5.00
   *   reason: 'requested_by_customer'
   * });
   * ```
   */
  async createRefund(data: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
    metadata?: Record<string, string>;
  }): Promise<RefundResult> {
    return this.executeWithRetry(async () => {
      logger.info('[StripeProvider] Creating refund', {
        paymentIntentId: data.paymentIntentId,
        amount: data.amount,
      });

      try {
        const params: Stripe.RefundCreateParams = {
          payment_intent: data.paymentIntentId,
          metadata: data.metadata || {},
        };

        if (data.amount) {
          params.amount = data.amount;
        }

        if (data.reason) {
          params.reason = data.reason as Stripe.RefundCreateParams.Reason;
        }

        const refund = await this.stripe.refunds.create(params);

        logger.info('[StripeProvider] Refund created', {
          refundId: refund.id,
          status: refund.status,
        });

        return this.mapStripeRefund(refund);
      } catch (error) {
        throw this.handleStripeError(error, 'create_refund');
      }
    }, 'createRefund');
  }

  /**
   * Get a refund
   *
   * @param refundId - Stripe refund ID
   * @returns Promise resolving to refund data
   * @throws {StripeProviderError} If retrieval fails
   */
  async getRefund(refundId: string): Promise<RefundResult> {
    return this.executeWithRetry(async () => {
      logger.debug('[StripeProvider] Getting refund', { refundId });

      try {
        const refund = await this.stripe.refunds.retrieve(refundId);
        return this.mapStripeRefund(refund);
      } catch (error) {
        throw this.handleStripeError(error, 'get_refund');
      }
    }, 'getRefund');
  }

  // ============================================================================
  // INVOICES
  // ============================================================================

  /**
   * Get an invoice
   *
   * @param invoiceId - Stripe invoice ID
   * @returns Promise resolving to invoice data
   * @throws {StripeProviderError} If retrieval fails
   */
  async getInvoice(invoiceId: string): Promise<Invoice> {
    return this.executeWithRetry(async () => {
      logger.debug('[StripeProvider] Getting invoice', { invoiceId });

      try {
        const invoice = await this.stripe.invoices.retrieve(invoiceId, {
          expand: ['lines.data'],
        });

        return this.mapStripeInvoice(invoice);
      } catch (error) {
        throw this.handleStripeError(error, 'get_invoice');
      }
    }, 'getInvoice');
  }

  /**
   * List invoices for a customer
   *
   * @param customerId - Stripe customer ID
   * @param options - Filtering options
   * @returns Promise resolving to array of invoices
   * @throws {StripeProviderError} If listing fails
   */
  async listInvoices(
    customerId: string,
    options?: {
      limit?: number;
      status?: Invoice['status'];
    }
  ): Promise<Invoice[]> {
    return this.executeWithRetry(async () => {
      logger.debug('[StripeProvider] Listing invoices', { customerId, options });

      try {
        const params: Stripe.InvoiceListParams = {
          customer: customerId,
          limit: options?.limit || 100,
          expand: ['data.lines'],
        };

        if (options?.status) {
          params.status = this.mapInvoiceStatusToStripe(options.status);
        }

        const invoices = await this.stripe.invoices.list(params);

        return invoices.data.map((inv) => this.mapStripeInvoice(inv));
      } catch (error) {
        throw this.handleStripeError(error, 'list_invoices');
      }
    }, 'listInvoices');
  }

  // ============================================================================
  // WEBHOOKS
  // ============================================================================

  /**
   * Verify webhook signature
   *
   * @param payload - Raw webhook payload string
   * @param signature - Stripe-Signature header value
   * @returns True if signature is valid, false otherwise
   *
   * @example
   * ```typescript
   * const isValid = provider.verifyWebhookSignature(
   *   request.body,
   *   request.headers['stripe-signature']
   * );
   * ```
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      if (!this.config.webhookSecret) {
        logger.warn('[StripeProvider] No webhook secret configured - cannot verify signature');
        return false;
      }

      this.stripe.webhooks.constructEvent(payload, signature, this.config.webhookSecret);

      logger.debug('[StripeProvider] Webhook signature verified');
      return true;
    } catch (error) {
      logger.error('[StripeProvider] Webhook signature verification failed', { error });
      return false;
    }
  }

  /**
   * Parse webhook event
   *
   * @param payload - Raw webhook payload string
   * @returns Parsed webhook event
   * @throws {StripeProviderError} If parsing fails
   *
   * @example
   * ```typescript
   * const event = provider.parseWebhookEvent(request.body);
   * if (event.type === 'payment_intent.succeeded') {
   *   const paymentIntent = event.data.object as PaymentIntent;
   *   // Handle successful payment
   * }
   * ```
   */
  parseWebhookEvent(payload: string): WebhookEvent {
    try {
      const stripeEvent = JSON.parse(payload) as Stripe.Event;

      logger.debug('[StripeProvider] Parsing webhook event', { type: stripeEvent.type });

      return {
        id: stripeEvent.id,
        type: stripeEvent.type,
        created: stripeEvent.created,
        data: {
          object: this.mapWebhookObject(stripeEvent.data.object),
        },
        previousAttributes: stripeEvent.data.previous_attributes as any,
      };
    } catch (error) {
      throw new StripeProviderError(
        'Failed to parse webhook event',
        'invalid_webhook_payload'
      );
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Check if provider is in test mode
   *
   * @returns True if using test API keys
   */
  isTestMode(): boolean {
    return this.config.testMode || this.config.apiKey.startsWith('sk_test_');
  }

  /**
   * Check if a currency is supported
   *
   * @param currency - Three-letter ISO currency code
   * @returns True if currency is supported
   */
  supportsCurrency(currency: string): boolean {
    return this.config.supportedCurrencies.includes(currency.toUpperCase());
  }

  /**
   * Check if a country is supported
   *
   * @param country - Two-letter ISO country code
   * @returns True if country is supported
   */
  supportsCountry(country: string): boolean {
    return this.config.supportedCountries.includes(country.toUpperCase());
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Execute operation with retry logic for network errors
   *
   * Automatically retries operations that fail due to network issues.
   * Does not retry validation or business logic errors.
   *
   * @param operation - Async operation to execute
   * @param operationName - Name for logging
   * @returns Promise resolving to operation result
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Don't retry validation or authentication errors
        if (error instanceof PaymentProviderValidationError || error instanceof StripeProviderError) {
          if (
            (error as StripeProviderError).statusCode &&
            [(error as StripeProviderError).statusCode === 400,
            (error as StripeProviderError).statusCode === 401,
            (error as StripeProviderError).statusCode === 403,
            (error as StripeProviderError).statusCode === 404].some(Boolean)
          ) {
            throw error;
          }
        }

        // Retry on network errors or rate limits
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.warn(`[StripeProvider] ${operationName} failed, retrying in ${delay}ms`, {
            attempt,
            error: lastError.message,
          });
          await this.sleep(delay);
        }
      }
    }

    throw new PaymentProviderNetworkError('stripe', lastError!);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Handle Stripe errors and convert to provider errors
   *
   * @param error - Error from Stripe SDK
   * @param operation - Operation that failed
   * @returns Formatted provider error
   */
  private handleStripeError(error: unknown, operation: string): never {
    if (error instanceof Stripe.errors.StripeError) {
      const stripeError = error;

      logger.error(`[StripeProvider] ${operation} failed`, {
        type: stripeError.type,
        code: stripeError.code,
        message: stripeError.message,
        statusCode: stripeError.statusCode,
        requestId: stripeError.requestId,
      });

      // Map to validation error if applicable
      if (stripeError.type === 'StripeInvalidRequestError') {
        throw new PaymentProviderValidationError('stripe', stripeError.message);
      }

      // Map to network error if applicable
      if (stripeError.type === 'StripeConnectionError') {
        throw new PaymentProviderNetworkError('stripe', stripeError);
      }

      throw new StripeProviderError(
        stripeError.message,
        stripeError.code || 'stripe_error',
        stripeError.raw as Stripe.StripeRawError | undefined,
        stripeError.statusCode,
        stripeError.requestId
      );
    }

    // Unknown error
    logger.error(`[StripeProvider] ${operation} failed with unknown error`, { error });
    throw new StripeProviderError(
      error instanceof Error ? error.message : 'Unknown error',
      'unknown_error'
    );
  }

  // ============================================================================
  // MAPPING METHODS
  // ============================================================================

  /**
   * Map Stripe customer to provider format
   */
  private mapStripeCustomer(customer: Stripe.Customer): PaymentCustomer {
    return {
      id: customer.id,
      email: customer.email || '',
      name: customer.name || undefined,
      metadata: customer.metadata,
      createdAt: new Date(customer.created * 1000),
    };
  }

  /**
   * Map Stripe payment method to provider format
   */
  private mapStripePaymentMethod(
    pm: Stripe.PaymentMethod,
    isDefault: boolean
  ): PaymentMethod {
    return {
      id: pm.id,
      type: this.mapPaymentMethodType(pm.type),
      card: pm.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          }
        : undefined,
      isDefault,
    };
  }

  /**
   * Map Stripe payment intent to provider format
   */
  private mapStripePaymentIntent(intent: Stripe.PaymentIntent): PaymentIntent {
    return {
      id: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      status: this.mapPaymentIntentStatus(intent.status),
      clientSecret: intent.client_secret || undefined,
      metadata: intent.metadata,
      error: intent.last_payment_error
        ? {
            code: intent.last_payment_error.code || 'unknown',
            message: intent.last_payment_error.message || 'Unknown error',
          }
        : undefined,
    };
  }

  /**
   * Map Stripe subscription to provider format
   */
  private mapStripeSubscription(sub: Stripe.Subscription): Subscription {
    return {
      id: sub.id,
      customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      priceId: sub.items.data[0].price.id,
      status: this.mapSubscriptionStatus(sub.status),
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : undefined,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : undefined,
      metadata: sub.metadata,
    };
  }

  /**
   * Map Stripe refund to provider format
   */
  private mapStripeRefund(refund: Stripe.Refund): RefundResult {
    return {
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      status: this.mapRefundStatus(refund.status || null),
      reason: refund.reason || undefined,
      createdAt: new Date(refund.created * 1000),
    };
  }

  /**
   * Map Stripe invoice to provider format
   */
  private mapStripeInvoice(invoice: Stripe.Invoice): Invoice {
    return {
      id: invoice.id,
      customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      status: this.mapInvoiceStatus(invoice.status),
      createdAt: new Date(invoice.created * 1000),
      dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : undefined,
      paidAt: invoice.status_transitions.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : undefined,
      invoiceUrl: invoice.hosted_invoice_url || undefined,
      lineItems: invoice.lines?.data.map((line) => this.mapStripeInvoiceLineItem(line)) || [],
    };
  }

  /**
   * Map Stripe invoice line item to provider format
   */
  private mapStripeInvoiceLineItem(line: Stripe.InvoiceLineItem): InvoiceLineItem {
    return {
      description: line.description || '',
      amount: line.amount,
      quantity: line.quantity || 1,
      priceId: typeof line.price === 'object' ? line.price?.id : undefined,
    };
  }

  /**
   * Map webhook object based on type
   */
  private mapWebhookObject(obj: Stripe.Event.Data.Object): any {
    const type = (obj as any).object;

    switch (type) {
      case 'payment_intent':
        return this.mapStripePaymentIntent(obj as Stripe.PaymentIntent);
      case 'subscription':
        return this.mapStripeSubscription(obj as Stripe.Subscription);
      case 'invoice':
        return this.mapStripeInvoice(obj as Stripe.Invoice);
      case 'refund':
        return this.mapStripeRefund(obj as Stripe.Refund);
      case 'customer':
        return this.mapStripeCustomer(obj as Stripe.Customer);
      default:
        return obj;
    }
  }

  // ============================================================================
  // STATUS MAPPING METHODS
  // ============================================================================

  /**
   * Map Stripe payment method type to provider format
   */
  private mapPaymentMethodType(type: string): PaymentMethod['type'] {
    switch (type) {
      case 'card':
        return 'card';
      case 'us_bank_account':
      case 'sepa_debit':
        return 'bank_account';
      case 'paypal':
      case 'klarna':
      case 'afterpay_clearpay':
        return 'wallet';
      default:
        return 'other';
    }
  }

  /**
   * Map Stripe payment intent status to provider format
   */
  private mapPaymentIntentStatus(status: Stripe.PaymentIntent.Status): PaymentIntent['status'] {
    switch (status) {
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'processing':
        return 'pending';
      case 'requires_action':
        return 'requires_action';
      case 'succeeded':
        return 'succeeded';
      case 'canceled':
        return 'canceled';
      default:
        return 'failed';
    }
  }

  /**
   * Map Stripe subscription status to provider format
   */
  private mapSubscriptionStatus(status: Stripe.Subscription.Status): Subscription['status'] {
    switch (status) {
      case 'active':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'canceled':
      case 'unpaid':
        return 'canceled';
      case 'incomplete':
      case 'incomplete_expired':
        return 'incomplete';
      case 'trialing':
        return 'trialing';
      default:
        return 'incomplete';
    }
  }

  /**
   * Map Stripe refund status to provider format
   */
  private mapRefundStatus(status: string | null): RefundResult['status'] {
    switch (status) {
      case 'succeeded':
        return 'succeeded';
      case 'pending':
        return 'pending';
      case 'failed':
        return 'failed';
      case 'canceled':
        return 'canceled';
      default:
        return 'pending';
    }
  }

  /**
   * Map Stripe invoice status to provider format
   */
  private mapInvoiceStatus(status: Stripe.Invoice.Status | null): Invoice['status'] {
    switch (status) {
      case 'draft':
        return 'draft';
      case 'open':
        return 'open';
      case 'paid':
        return 'paid';
      case 'void':
        return 'void';
      case 'uncollectible':
        return 'uncollectible';
      default:
        return 'draft';
    }
  }

  /**
   * Map provider invoice status to Stripe format
   */
  private mapInvoiceStatusToStripe(status: Invoice['status']): Stripe.InvoiceListParams.Status {
    switch (status) {
      case 'draft':
        return 'draft';
      case 'open':
        return 'open';
      case 'paid':
        return 'paid';
      case 'void':
        return 'void';
      case 'uncollectible':
        return 'uncollectible';
      default:
        return 'draft';
    }
  }
}
