/**
 * Stub Payment Provider
 *
 * Testing/development implementation of IPaymentProvider.
 * Returns realistic mock data without making actual payment API calls.
 *
 * @module StubPaymentProvider
 * @category Infrastructure
 */

import {
  IPaymentProvider,
  PaymentProviderConfig,
  PaymentCustomer,
  PaymentMethod,
  PaymentIntent,
  Subscription,
  RefundResult,
  Invoice,
  WebhookEvent,
  PaymentProviderError,
} from './payment-provider.interface.js';

/**
 * Stub Payment Provider for testing
 *
 * Simulates a payment provider without making real API calls.
 * Useful for development, testing, and demos.
 */
export class StubPaymentProvider implements IPaymentProvider {
  readonly config: PaymentProviderConfig;
  readonly name: string;

  private customers: Map<string, PaymentCustomer> = new Map();
  private paymentMethods: Map<string, PaymentMethod> = new Map();
  private paymentIntents: Map<string, PaymentIntent> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private refunds: Map<string, RefundResult> = new Map();
  private invoices: Map<string, Invoice> = new Map();

  constructor(config: PaymentProviderConfig) {
    this.config = config;
    this.name = 'stub';
  }

  // ============================================================================
  // CUSTOMER MANAGEMENT
  // ============================================================================

  async createCustomer(data: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentCustomer> {
    const customer: PaymentCustomer = {
      id: `cus_stub_${this.generateId()}`,
      email: data.email,
      name: data.name,
      metadata: data.metadata,
      createdAt: new Date(),
    };

    this.customers.set(customer.id, customer);
    console.log(`[StubPayment] Created customer: ${customer.id}`);

    return customer;
  }

  async getCustomer(customerId: string): Promise<PaymentCustomer> {
    const customer = this.customers.get(customerId);
    if (!customer) {
      throw new PaymentProviderError(
        `Customer ${customerId} not found`,
        'customer_not_found',
        'stub'
      );
    }
    return customer;
  }

  async updateCustomer(
    customerId: string,
    data: {
      email?: string;
      name?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<PaymentCustomer> {
    const customer = await this.getCustomer(customerId);

    if (data.email) customer.email = data.email;
    if (data.name) customer.name = data.name;
    if (data.metadata) customer.metadata = { ...customer.metadata, ...data.metadata };

    this.customers.set(customerId, customer);
    console.log(`[StubPayment] Updated customer: ${customerId}`);

    return customer;
  }

  async deleteCustomer(customerId: string): Promise<void> {
    await this.getCustomer(customerId); // Verify customer exists
    this.customers.delete(customerId);
    console.log(`[StubPayment] Deleted customer: ${customerId}`);
  }

  // ============================================================================
  // PAYMENT METHODS
  // ============================================================================

  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    await this.getCustomer(customerId); // Verify customer exists

    const paymentMethod = this.paymentMethods.get(paymentMethodId);
    if (!paymentMethod) {
      throw new PaymentProviderError(
        `Payment method ${paymentMethodId} not found`,
        'payment_method_not_found',
        'stub'
      );
    }

    console.log(`[StubPayment] Attached payment method ${paymentMethodId} to customer ${customerId}`);
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    const paymentMethod = this.paymentMethods.get(paymentMethodId);
    if (!paymentMethod) {
      throw new PaymentProviderError(
        `Payment method ${paymentMethodId} not found`,
        'payment_method_not_found',
        'stub'
      );
    }

    this.paymentMethods.delete(paymentMethodId);
    console.log(`[StubPayment] Detached payment method ${paymentMethodId}`);
  }

  async listPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    await this.getCustomer(customerId); // Verify customer exists

    // Return mock payment method
    const mockMethod: PaymentMethod = {
      id: `pm_stub_${this.generateId()}`,
      type: 'card',
      card: {
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      },
      isDefault: true,
    };

    return [mockMethod];
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    await this.getCustomer(customerId);
    console.log(`[StubPayment] Set default payment method ${paymentMethodId} for customer ${customerId}`);
  }

  // ============================================================================
  // PAYMENT PROCESSING
  // ============================================================================

  async createPaymentIntent(data: {
    amount: number;
    currency: string;
    customerId?: string;
    paymentMethodId?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    if (data.customerId) {
      await this.getCustomer(data.customerId); // Verify customer exists
    }

    const paymentIntent: PaymentIntent = {
      id: `pi_stub_${this.generateId()}`,
      amount: data.amount,
      currency: data.currency,
      status: 'succeeded', // Auto-succeed for stub
      clientSecret: `pi_stub_${this.generateId()}_secret_${this.generateId()}`,
      metadata: data.metadata,
    };

    this.paymentIntents.set(paymentIntent.id, paymentIntent);
    console.log(`[StubPayment] Created payment intent: ${paymentIntent.id} for ${data.amount} ${data.currency}`);

    return paymentIntent;
  }

  async capturePaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(paymentIntentId);
    if (!intent) {
      throw new PaymentProviderError(
        `Payment intent ${paymentIntentId} not found`,
        'payment_intent_not_found',
        'stub'
      );
    }

    intent.status = 'succeeded';
    this.paymentIntents.set(paymentIntentId, intent);
    console.log(`[StubPayment] Captured payment intent: ${paymentIntentId}`);

    return intent;
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(paymentIntentId);
    if (!intent) {
      throw new PaymentProviderError(
        `Payment intent ${paymentIntentId} not found`,
        'payment_intent_not_found',
        'stub'
      );
    }

    intent.status = 'canceled';
    this.paymentIntents.set(paymentIntentId, intent);
    console.log(`[StubPayment] Canceled payment intent: ${paymentIntentId}`);

    return intent;
  }

  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(paymentIntentId);
    if (!intent) {
      throw new PaymentProviderError(
        `Payment intent ${paymentIntentId} not found`,
        'payment_intent_not_found',
        'stub'
      );
    }
    return intent;
  }

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================================================

  async createSubscription(data: {
    customerId: string;
    priceId: string;
    paymentMethodId?: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Subscription> {
    await this.getCustomer(data.customerId); // Verify customer exists

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const subscription: Subscription = {
      id: `sub_stub_${this.generateId()}`,
      customerId: data.customerId,
      priceId: data.priceId,
      status: data.trialPeriodDays ? 'trialing' : 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      trialStart: data.trialPeriodDays ? now : undefined,
      trialEnd: data.trialPeriodDays
        ? new Date(now.getTime() + data.trialPeriodDays * 24 * 60 * 60 * 1000)
        : undefined,
      metadata: data.metadata,
    };

    this.subscriptions.set(subscription.id, subscription);
    console.log(`[StubPayment] Created subscription: ${subscription.id}`);

    return subscription;
  }

  async getSubscription(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new PaymentProviderError(
        `Subscription ${subscriptionId} not found`,
        'subscription_not_found',
        'stub'
      );
    }
    return subscription;
  }

  async updateSubscription(
    subscriptionId: string,
    data: {
      priceId?: string;
      cancelAtPeriodEnd?: boolean;
      metadata?: Record<string, string>;
    }
  ): Promise<Subscription> {
    const subscription = await this.getSubscription(subscriptionId);

    if (data.priceId) subscription.priceId = data.priceId;
    if (data.cancelAtPeriodEnd !== undefined) subscription.cancelAtPeriodEnd = data.cancelAtPeriodEnd;
    if (data.metadata) subscription.metadata = { ...subscription.metadata, ...data.metadata };

    this.subscriptions.set(subscriptionId, subscription);
    console.log(`[StubPayment] Updated subscription: ${subscriptionId}`);

    return subscription;
  }

  async cancelSubscription(subscriptionId: string, cancelImmediately = false): Promise<Subscription> {
    const subscription = await this.getSubscription(subscriptionId);

    if (cancelImmediately) {
      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = false;
    } else {
      subscription.cancelAtPeriodEnd = true;
    }

    this.subscriptions.set(subscriptionId, subscription);
    console.log(`[StubPayment] Canceled subscription: ${subscriptionId} (immediate: ${cancelImmediately})`);

    return subscription;
  }

  async listSubscriptions(customerId: string): Promise<Subscription[]> {
    await this.getCustomer(customerId); // Verify customer exists

    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.customerId === customerId
    );
  }

  // ============================================================================
  // REFUNDS
  // ============================================================================

  async createRefund(data: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
    metadata?: Record<string, string>;
  }): Promise<RefundResult> {
    const intent = await this.getPaymentIntent(data.paymentIntentId);

    const refund: RefundResult = {
      id: `re_stub_${this.generateId()}`,
      amount: data.amount || intent.amount,
      currency: intent.currency,
      status: 'succeeded',
      reason: data.reason,
      createdAt: new Date(),
    };

    this.refunds.set(refund.id, refund);
    console.log(`[StubPayment] Created refund: ${refund.id} for ${refund.amount} ${refund.currency}`);

    return refund;
  }

  async getRefund(refundId: string): Promise<RefundResult> {
    const refund = this.refunds.get(refundId);
    if (!refund) {
      throw new PaymentProviderError(
        `Refund ${refundId} not found`,
        'refund_not_found',
        'stub'
      );
    }
    return refund;
  }

  // ============================================================================
  // INVOICES
  // ============================================================================

  async getInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new PaymentProviderError(
        `Invoice ${invoiceId} not found`,
        'invoice_not_found',
        'stub'
      );
    }
    return invoice;
  }

  async listInvoices(
    customerId: string,
    options?: {
      limit?: number;
      status?: Invoice['status'];
    }
  ): Promise<Invoice[]> {
    await this.getCustomer(customerId); // Verify customer exists

    let invoices = Array.from(this.invoices.values()).filter(
      (inv) => inv.customerId === customerId
    );

    if (options?.status) {
      invoices = invoices.filter((inv) => inv.status === options.status);
    }

    if (options?.limit) {
      invoices = invoices.slice(0, options.limit);
    }

    return invoices;
  }

  // ============================================================================
  // WEBHOOKS
  // ============================================================================

  verifyWebhookSignature(_payload: string, _signature: string): boolean {
    // Stub implementation always returns true
    console.log(`[StubPayment] Verifying webhook signature (stub - always valid)`);
    return true;
  }

  parseWebhookEvent(payload: string): WebhookEvent {
    try {
      const event = JSON.parse(payload);
      console.log(`[StubPayment] Parsed webhook event: ${event.type}`);
      return event as WebhookEvent;
    } catch {
      throw new PaymentProviderError(
        'Invalid webhook payload',
        'invalid_webhook_payload',
        'stub'
      );
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  isTestMode(): boolean {
    return this.config.testMode;
  }

  supportsCurrency(currency: string): boolean {
    return this.config.supportedCurrencies.includes(currency.toUpperCase());
  }

  supportsCountry(country: string): boolean {
    return this.config.supportedCountries.includes(country.toUpperCase());
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}
