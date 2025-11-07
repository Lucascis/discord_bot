/**
 * Customer Management Service
 *
 * Enterprise CRM for customer lifecycle management.
 * Handles customer registration, payment methods, subscriptions, and billing.
 *
 * @module CustomerManagementService
 * @category Domain
 */

import type { IPaymentProvider } from '../../infrastructure/payment/payment-provider.interface.js';
import { PaymentProviderFactory } from '../../infrastructure/payment/payment-provider-factory.js';

// PrismaClient type replaced with any to avoid Docker build issues with type-only imports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaClient = any;

/**
 * Customer registration data
 */
export interface CustomerRegistrationData {
  // Discord information
  discordUserId: string;
  discordUsername?: string;
  discordDiscriminator?: string;

  // Contact information
  email: string;
  name?: string;
  phone?: string;

  // Billing address
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    country: string;
    postalCode: string;
  };

  // Tax information
  taxId?: string;
  taxIdType?: string; // 'vat', 'cpf', 'cuit', etc.
  country?: string; // ISO country code

  // Metadata
  metadata?: Record<string, string>;
}

/**
 * Customer record
 */
export interface Customer {
  id: string;
  discordUserId: string;
  email: string;
  name?: string;

  // Provider IDs
  stripeCustomerId?: string;
  mercadopagoCustomerId?: string;
  paypalCustomerId?: string;

  // Metadata
  metadata?: Record<string, string>;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Subscription creation data
 */
export interface SubscriptionCreationData {
  customerId: string;
  planId: string; // 'premium', 'pro', 'enterprise'
  priceId: string; // Provider-specific price ID
  paymentMethodId?: string;
  trialPeriodDays?: number;
  metadata?: Record<string, string>;
}

/**
 * Customer Management Service
 *
 * Provides comprehensive customer lifecycle management:
 * - Customer registration and profile management
 * - Payment method management
 * - Subscription creation and management
 * - Billing history and invoices
 * - Analytics and metrics
 */
export class CustomerManagementService {
  constructor(
    private paymentFactory: PaymentProviderFactory,
    private readonly database: PrismaClient
  ) {}

  // ============================================================================
  // CUSTOMER REGISTRATION & MANAGEMENT
  // ============================================================================

  /**
   * Register new customer
   *
   * Creates customer records in:
   * 1. Local database
   * 2. Payment provider(s) based on region
   *
   * @param data Customer registration data
   * @returns Created customer record
   */
  async registerCustomer(data: CustomerRegistrationData): Promise<Customer> {
    // Check if customer already exists by discordUserId or email
    const existingCustomer = await this.database.customer.findFirst({
      where: {
        OR: [
          { discordUserId: data.discordUserId },
          { email: data.email }
        ]
      }
    });

    if (existingCustomer) {
      throw new Error(`Customer already registered for Discord user ${data.discordUserId} or email ${data.email}`);
    }

    // Determine which payment provider(s) to use based on country
    const provider = data.country
      ? this.paymentFactory.getProviderForCountry(data.country)
      : this.paymentFactory.getProvider();

    // Create customer in payment provider
    const providerCustomer = await provider.createCustomer({
      email: data.email,
      name: data.name,
      metadata: {
        discordUserId: data.discordUserId,
        discordUsername: data.discordUsername || '',
        ...data.metadata,
      },
    });

    // Store provider-specific customer ID
    const providerFields: {
      stripeCustomerId?: string;
      mercadopagoCustomerId?: string;
      paypalCustomerId?: string;
    } = {};

    if (provider.name === 'stripe') {
      providerFields.stripeCustomerId = providerCustomer.id;
    } else if (provider.name === 'mercadopago') {
      providerFields.mercadopagoCustomerId = providerCustomer.id;
    } else if (provider.name === 'paypal') {
      providerFields.paypalCustomerId = providerCustomer.id;
    }

    // Create customer in database
    const customer = await this.database.customer.create({
      data: {
        discordUserId: data.discordUserId,
        discordUsername: data.discordUsername,
        discordDiscriminator: data.discordDiscriminator,
        email: data.email,
        name: data.name,
        phone: data.phone,
        address: data.address as any,
        taxId: data.taxId,
        taxIdType: data.taxIdType,
        country: data.country,
        metadata: data.metadata as any,
        ...providerFields,
      },
    });

    // Log customer creation to billing history
    await this.database.billingHistory.create({
      data: {
        customerId: customer.id,
        eventType: 'CUSTOMER_CREATED',
        provider: provider.name,
        description: `Customer registered: ${customer.email}`,
        actor: 'system',
        metadata: {
          discordUserId: data.discordUserId,
          provider: provider.name,
          providerCustomerId: providerCustomer.id,
        } as any,
      },
    });

    console.log(`[CustomerManagement] Registered customer: ${customer.id} (${customer.email})`);

    return customer as Customer;
  }

  /**
   * Get customer by Discord user ID
   */
  async getCustomerByDiscordId(discordUserId: string): Promise<Customer | null> {
    const customer = await this.database.customer.findUnique({
      where: { discordUserId },
      include: {
        paymentMethods: true,
        subscriptions: {
          include: {
            plan: true,
            price: true,
          },
        },
      },
    });

    console.log(`[CustomerManagement] Fetching customer for Discord user: ${discordUserId}`);
    return customer as Customer | null;
  }

  /**
   * Update customer information
   */
  async updateCustomer(
    customerId: string,
    data: Partial<CustomerRegistrationData>
  ): Promise<Customer> {
    const customer = await this.database.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    // Update in payment provider
    const provider = this.getProviderForCustomer(customer);
    const providerCustomerId = this.getProviderCustomerId(customer, provider.name);

    if (providerCustomerId) {
      await provider.updateCustomer(providerCustomerId, {
        email: data.email,
        name: data.name,
        metadata: data.metadata,
      });
    }

    // Update in database
    const updatedCustomer = await this.database.customer.update({
      where: { id: customerId },
      data: {
        email: data.email,
        name: data.name,
        phone: data.phone,
        address: data.address as any,
        taxId: data.taxId,
        taxIdType: data.taxIdType,
        country: data.country,
        metadata: data.metadata as any,
        discordUsername: data.discordUsername,
        discordDiscriminator: data.discordDiscriminator,
      }
    });

    // Log update to billing history
    await this.database.billingHistory.create({
      data: {
        customerId,
        eventType: 'CUSTOMER_UPDATED',
        provider: provider.name,
        description: `Customer information updated`,
        actor: 'system',
      },
    });

    console.log(`[CustomerManagement] Updated customer: ${customerId}`);

    return updatedCustomer as Customer;
  }

  // ============================================================================
  // PAYMENT METHODS
  // ============================================================================

  /**
   * Add payment method to customer
   */
  async addPaymentMethod(
    customerId: string,
    paymentMethodId: string,
    setAsDefault = false
  ): Promise<void> {
    const customer = await this.database.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const provider = this.getProviderForCustomer(customer);
    const providerCustomerId = this.getProviderCustomerId(customer, provider.name);

    if (!providerCustomerId) {
      throw new Error(`Customer ${customerId} not set up with provider ${provider.name}`);
    }

    // Attach payment method in provider
    await provider.attachPaymentMethod(providerCustomerId, paymentMethodId);

    if (setAsDefault) {
      await provider.setDefaultPaymentMethod(providerCustomerId, paymentMethodId);

      // Unset other payment methods as default
      await this.database.paymentMethod.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
    }

    // Retrieve payment method details from provider
    const paymentMethods = await provider.listPaymentMethods(providerCustomerId);
    const paymentMethodDetails = paymentMethods.find((pm: any) => pm.id === paymentMethodId);

    // Store payment method in database
    await this.database.paymentMethod.create({
      data: {
        customerId,
        provider: provider.name,
        providerPaymentMethodId: paymentMethodId,
        type: (paymentMethodDetails?.type?.toUpperCase() || 'OTHER') as any,
        cardBrand: paymentMethodDetails?.card?.brand,
        cardLast4: paymentMethodDetails?.card?.last4,
        cardExpMonth: paymentMethodDetails?.card?.expMonth,
        cardExpYear: paymentMethodDetails?.card?.expYear,
        isDefault: setAsDefault,
      },
    });

    // Log payment method addition to billing history
    await this.database.billingHistory.create({
      data: {
        customerId,
        eventType: 'PAYMENT_METHOD_ADDED',
        provider: provider.name,
        description: `Payment method added${setAsDefault ? ' (set as default)' : ''}`,
        actor: 'system',
        metadata: {
          paymentMethodId,
          isDefault: setAsDefault,
        } as any,
      },
    });

    console.log(`[CustomerManagement] Added payment method for customer ${customerId}`);
  }

  /**
   * List customer payment methods
   */
  async listPaymentMethods(customerId: string) {
    const customer = await this.database.customer.findUnique({
      where: { id: customerId },
      include: {
        paymentMethods: true,
      },
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    // Return payment methods from database
    return customer.paymentMethods;
  }

  // ============================================================================
  // SUBSCRIPTIONS
  // ============================================================================

  /**
   * Create subscription for customer
   */
  async createSubscription(data: SubscriptionCreationData) {
    const customer = await this.database.customer.findUnique({
      where: { id: data.customerId }
    });

    if (!customer) {
      throw new Error(`Customer ${data.customerId} not found`);
    }

    const provider = this.getProviderForCustomer(customer);
    const providerCustomerId = this.getProviderCustomerId(customer, provider.name);

    if (!providerCustomerId) {
      throw new Error(`Customer ${data.customerId} not set up with provider ${provider.name}`);
    }

    // Create subscription in provider
    const subscription = await provider.createSubscription({
      customerId: providerCustomerId,
      priceId: data.priceId,
      paymentMethodId: data.paymentMethodId,
      trialPeriodDays: data.trialPeriodDays,
      metadata: data.metadata,
    });

    // Get or create subscription plan and price in database
    let plan = await this.database.subscriptionPlan.findUnique({
      where: { name: data.planId }
    });

    if (!plan) {
      // Create plan if it doesn't exist
      plan = await this.database.subscriptionPlan.create({
        data: {
          name: data.planId,
          displayName: data.planId.charAt(0).toUpperCase() + data.planId.slice(1),
          features: [] as any,
          limits: {} as any,
        }
      });
    }

    let price = await this.database.subscriptionPrice.findUnique({
      where: {
        provider_providerPriceId: {
          provider: provider.name,
          providerPriceId: data.priceId,
        }
      }
    });

    if (!price) {
      // Create price if it doesn't exist
      price = await this.database.subscriptionPrice.create({
        data: {
          planId: plan.id,
          provider: provider.name,
          providerPriceId: data.priceId,
          amount: 0, // Amount will be set by provider
          currency: 'USD',
          interval: 'MONTH',
        }
      });
    }

    // Store subscription in database
    const dbSubscription = await this.database.subscription.create({
      data: {
        customerId: data.customerId,
        planId: plan.id,
        priceId: price.id,
        provider: provider.name,
        providerSubscriptionId: subscription.id,
        status: subscription.status as any,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        paymentMethodId: data.paymentMethodId,
        trialStart: data.trialPeriodDays ? new Date() : null,
        trialEnd: data.trialPeriodDays ? new Date(Date.now() + data.trialPeriodDays * 24 * 60 * 60 * 1000) : null,
        metadata: data.metadata as any,
      },
    });

    // Log subscription creation to billing history
    await this.database.billingHistory.create({
      data: {
        customerId: data.customerId,
        subscriptionId: dbSubscription.id,
        eventType: data.trialPeriodDays ? 'SUBSCRIPTION_TRIAL_STARTED' : 'SUBSCRIPTION_CREATED',
        provider: provider.name,
        description: `Subscription created for plan ${data.planId}`,
        actor: 'system',
        metadata: {
          planId: data.planId,
          priceId: data.priceId,
          providerSubscriptionId: subscription.id,
          trialPeriodDays: data.trialPeriodDays,
        } as any,
      },
    });

    console.log(`[CustomerManagement] Created subscription for customer ${data.customerId}`);

    return subscription;
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    customerId: string,
    subscriptionId: string,
    cancelImmediately = false,
    reason?: string
  ) {
    const subscription = await this.database.subscription.findUnique({
      where: { id: subscriptionId }
    });

    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} not found`);
    }

    // Verify ownership
    if (subscription.customerId !== customerId) {
      throw new Error(`Subscription ${subscriptionId} does not belong to customer ${customerId}`);
    }

    const provider = this.paymentFactory.getProvider(subscription.provider as any);
    const providerSubscriptionId = subscription.providerSubscriptionId;

    // Cancel in provider
    const canceledSubscription = await provider.cancelSubscription(
      providerSubscriptionId,
      cancelImmediately
    );

    // Update subscription status in database
    await this.database.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: cancelImmediately ? 'CANCELED' : subscription.status,
        cancelAtPeriodEnd: !cancelImmediately,
        canceledAt: new Date(),
        cancelReason: reason,
      }
    });

    // Log subscription cancellation to billing history
    await this.database.billingHistory.create({
      data: {
        customerId,
        subscriptionId,
        eventType: 'SUBSCRIPTION_CANCELED',
        provider: subscription.provider,
        description: `Subscription canceled${cancelImmediately ? ' immediately' : ' at period end'}${reason ? `: ${reason}` : ''}`,
        actor: 'system',
        metadata: {
          cancelImmediately,
          reason,
          canceledAt: new Date(),
        } as any,
      },
    });

    console.log(`[CustomerManagement] Canceled subscription ${subscriptionId}. Reason: ${reason || 'None'}`);

    return canceledSubscription;
  }

  // ============================================================================
  // BILLING & INVOICES
  // ============================================================================

  /**
   * Get customer invoices
   */
  async getCustomerInvoices(customerId: string, options?: { limit?: number; status?: string }) {
    const customer = await this.database.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    // Fetch invoices from database
    const invoices = await this.database.invoice.findMany({
      where: {
        customerId,
        ...(options?.status ? { status: options.status as any } : {}),
      },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
        lineItems: true,
        payments: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: options?.limit || 100,
    });

    return invoices;
  }

  /**
   * Process refund for customer
   */
  async processRefund(
    customerId: string,
    paymentIntentId: string,
    amount?: number,
    reason?: string
  ) {
    // Fetch customer
    const customer = await this.database.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    // Fetch payment record by provider payment intent ID
    const payment = await this.database.payment.findFirst({
      where: {
        customerId,
        OR: [
          { providerPaymentId: paymentIntentId },
          { providerIntentId: paymentIntentId },
        ],
      },
    });

    if (!payment) {
      throw new Error(`Payment ${paymentIntentId} not found for customer ${customerId}`);
    }

    const provider = this.paymentFactory.getProvider(payment.provider as any);

    // Create refund in provider
    const refund = await provider.createRefund({
      paymentIntentId,
      amount,
      reason,
      metadata: {
        customerId,
        processedBy: 'system',
      },
    });

    // Store refund record in database
    const dbRefund = await this.database.refund.create({
      data: {
        customerId,
        paymentId: payment.id,
        provider: payment.provider,
        providerRefundId: refund.id,
        amount: amount || payment.amount,
        currency: payment.currency,
        reason: reason as any,
        reasonNote: reason,
        status: refund.status as any,
        processedBy: 'system',
      },
    });

    // Update payment status
    const refundedAmount = payment.amountRefunded + (amount || payment.amount);
    const isFullyRefunded = refundedAmount >= payment.amount;

    await this.database.payment.update({
      where: { id: payment.id },
      data: {
        amountRefunded: refundedAmount,
        status: isFullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      },
    });

    // Log refund to billing history
    await this.database.billingHistory.create({
      data: {
        customerId,
        paymentId: payment.id,
        refundId: dbRefund.id,
        eventType: 'REFUND_PROCESSED',
        provider: payment.provider,
        description: `Refund processed for payment ${payment.providerPaymentId}${reason ? `: ${reason}` : ''}`,
        amount: amount || payment.amount,
        currency: payment.currency,
        actor: 'system',
        metadata: {
          paymentIntentId,
          refundAmount: amount || payment.amount,
          reason,
          providerRefundId: refund.id,
        } as any,
      },
    });

    console.log(`[CustomerManagement] Processed refund for customer ${customerId}. Reason: ${reason || 'None'}`);

    return refund;
  }

  // ============================================================================
  // ANALYTICS & METRICS
  // ============================================================================

  /**
   * Calculate customer lifetime value
   */
  async calculateCustomerLTV(customerId: string): Promise<{
    totalRevenue: number;
    totalPayments: number;
    totalRefunds: number;
    netRevenue: number;
    monthsSubscribed: number;
    averageMonthlyValue: number;
  }> {
    // Check if cached LTV exists
    const cachedLTV = await this.database.customerLifetimeValue.findUnique({
      where: { customerId }
    });

    if (cachedLTV) {
      console.log(`[CustomerManagement] Using cached LTV for customer ${customerId}`);
      return {
        totalRevenue: cachedLTV.totalRevenue,
        totalPayments: cachedLTV.totalPayments,
        totalRefunds: cachedLTV.totalRefunds,
        netRevenue: cachedLTV.netRevenue,
        monthsSubscribed: cachedLTV.monthsSubscribed,
        averageMonthlyValue: cachedLTV.averageMonthlyValue,
      };
    }

    // Calculate from payments
    const paymentsAgg = await this.database.payment.aggregate({
      where: {
        customerId,
        status: { in: ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
      },
      _sum: {
        amount: true,
        amountRefunded: true,
      },
      _count: {
        id: true,
      },
    });

    const totalRevenue = paymentsAgg._sum.amount || 0;
    const totalRefunds = paymentsAgg._sum.amountRefunded || 0;
    const totalPayments = paymentsAgg._count.id || 0;
    const netRevenue = totalRevenue - totalRefunds;

    // Calculate months subscribed
    const subscriptions = await this.database.subscription.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    });

    let monthsSubscribed = 0;
    for (const sub of subscriptions) {
      const start = sub.createdAt;
      const end = sub.canceledAt || new Date();
      const months = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)));
      monthsSubscribed += months;
    }

    const averageMonthlyValue = monthsSubscribed > 0 ? Math.floor(netRevenue / monthsSubscribed) : 0;

    // Cache the calculated LTV
    await this.database.customerLifetimeValue.upsert({
      where: { customerId },
      create: {
        customerId,
        totalRevenue,
        totalPayments,
        totalRefunds,
        netRevenue,
        monthsSubscribed,
        averageMonthlyValue,
      },
      update: {
        totalRevenue,
        totalPayments,
        totalRefunds,
        netRevenue,
        monthsSubscribed,
        averageMonthlyValue,
      },
    });

    console.log(`[CustomerManagement] Calculated LTV for customer ${customerId}`);

    return {
      totalRevenue,
      totalPayments,
      totalRefunds,
      netRevenue,
      monthsSubscribed,
      averageMonthlyValue,
    };
  }

  /**
   * Get customer subscription history
   */
  async getSubscriptionHistory(customerId: string) {
    const history = await this.database.billingHistory.findMany({
      where: {
        customerId,
        eventType: {
          in: [
            'SUBSCRIPTION_CREATED',
            'SUBSCRIPTION_STARTED',
            'SUBSCRIPTION_RENEWED',
            'SUBSCRIPTION_UPGRADED',
            'SUBSCRIPTION_DOWNGRADED',
            'SUBSCRIPTION_PAUSED',
            'SUBSCRIPTION_RESUMED',
            'SUBSCRIPTION_CANCELED',
            'SUBSCRIPTION_EXPIRED',
            'SUBSCRIPTION_TRIAL_STARTED',
            'SUBSCRIPTION_TRIAL_ENDED',
          ],
        },
      },
      include: {
        subscription: {
          include: {
            plan: true,
            price: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`[CustomerManagement] Fetching subscription history for customer ${customerId}`);

    return history;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Get appropriate payment provider for customer
   */
  private getProviderForCustomer(customer: any): IPaymentProvider {
    // If customer has Stripe ID, use Stripe
    if (customer.stripeCustomerId) {
      return this.paymentFactory.getProvider('stripe');
    }

    // If customer has MercadoPago ID, use MercadoPago
    if (customer.mercadopagoCustomerId) {
      return this.paymentFactory.getProvider('mercadopago');
    }

    // If customer has PayPal ID, use PayPal
    if (customer.paypalCustomerId) {
      return this.paymentFactory.getProvider('paypal');
    }

    // Default: use stub or default provider
    return this.paymentFactory.getProvider();
  }

  /**
   * Get provider-specific customer ID
   */
  private getProviderCustomerId(customer: any, providerName: string): string | undefined {
    switch (providerName) {
      case 'stripe':
        return customer.stripeCustomerId;
      case 'mercadopago':
        return customer.mercadopagoCustomerId;
      case 'paypal':
        return customer.paypalCustomerId;
      default:
        return undefined;
    }
  }
}
