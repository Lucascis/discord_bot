/**
 * Stripe Integration
 * Handles Stripe payment processing and webhook events
 */

import Stripe from 'stripe';
import { PrismaClient, SubscriptionTier, SubscriptionStatus, BillingInterval, InvoiceStatus } from '@prisma/client';
import { logger } from '@discord-bot/logger';
import { SubscriptionService } from './subscription-service.js';
import type { StripeWebhookEvent } from './types.js';

export class StripeIntegration {
  private stripe: Stripe;
  private subscriptionService: SubscriptionService;

  constructor(
    private readonly prisma: PrismaClient,
    apiKey: string
  ) {
    this.stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
    });
    this.subscriptionService = new SubscriptionService(prisma);
  }

  /**
   * Create Stripe customer
   */
  async createCustomer(guildId: string, email?: string): Promise<Stripe.Customer> {
    const customer = await this.stripe.customers.create({
      metadata: {
        guildId,
      },
      email,
    });

    logger.info({ guildId, customerId: customer.id }, 'Stripe customer created');

    return customer;
  }

  /**
   * Create subscription checkout session
   */
  async createCheckoutSession(
    guildId: string,
    tier: SubscriptionTier,
    billingCycle: BillingInterval,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    // Get or create Stripe customer
    const stripeCustomerId = await this.getOrCreateStripeCustomer(guildId);

    // Get price ID based on tier and billing cycle
    const priceId = this.getPriceId(tier, billingCycle);

    if (!priceId) {
      throw new Error(`No price ID configured for ${tier} ${billingCycle}`);
    }

    // Create checkout session
    const session = await this.stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        guildId,
        tier,
        billingCycle,
      },
      subscription_data: {
        metadata: {
          guildId,
          tier,
        },
      },
    });

    logger.info({ guildId, tier, sessionId: session.id }, 'Stripe checkout session created');

    return session;
  }

  /**
   * Create customer portal session for managing subscription
   */
  async createPortalSession(guildId: string, returnUrl: string): Promise<Stripe.BillingPortal.Session> {
    // Get or create Stripe customer
    const stripeCustomerId = await this.getOrCreateStripeCustomer(guildId);

    // Create billing portal session
    const session = await this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    logger.info({ guildId, sessionId: session.id }, 'Stripe billing portal session created');

    return session;
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(event: StripeWebhookEvent): Promise<void> {
    logger.info({ eventType: event.type }, 'Processing Stripe webhook');

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event);
          break;

        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event);
          break;

        case 'invoice.paid':
          await this.handleInvoicePaid(event);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event);
          break;

        case 'customer.subscription.trial_will_end':
          await this.handleTrialWillEnd(event);
          break;

        default:
          logger.debug({ eventType: event.type }, 'Unhandled Stripe webhook event');
      }
    } catch (error) {
      logger.error({ error, eventType: event.type }, 'Error processing Stripe webhook');
      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string, secret: string): StripeWebhookEvent {
    return this.stripe.webhooks.constructEvent(payload, signature, secret) as unknown as StripeWebhookEvent;
  }

  // ========================================
  // PRIVATE WEBHOOK HANDLERS
  // ========================================

  private async handleCheckoutCompleted(event: StripeWebhookEvent): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const guildId = session.metadata?.guildId;
    const tier = session.metadata?.tier as SubscriptionTier;

    if (!guildId || !tier) {
      logger.warn({ sessionId: session.id }, 'Missing metadata in checkout session');
      return;
    }

    logger.info({ guildId, tier, sessionId: session.id }, 'Checkout completed');

    // Subscription will be created/updated by the subscription.created event
  }

  private async handleSubscriptionCreated(event: StripeWebhookEvent): Promise<void> {
    const stripeSubscription = event.data.object as Stripe.Subscription;
    const stripeCustomerId = stripeSubscription.customer as string;
    const stripePriceId = stripeSubscription.items.data[0]?.price.id;

    if (!stripeCustomerId) {
      logger.warn({ subscriptionId: stripeSubscription.id }, 'Missing customer ID in subscription');
      return;
    }

    if (!stripePriceId) {
      logger.warn({ subscriptionId: stripeSubscription.id }, 'Missing price ID in subscription');
      return;
    }

    // Find customer by Stripe customer ID
    const customer = await this.prisma.customer.findUnique({
      where: { stripeCustomerId },
    });

    if (!customer) {
      logger.warn({ stripeCustomerId, subscriptionId: stripeSubscription.id }, 'Customer not found');
      return;
    }

    // Find price to get plan association
    const price = await this.prisma.subscriptionPrice.findUnique({
      where: {
        provider_providerPriceId: {
          provider: 'stripe',
          providerPriceId: stripePriceId,
        },
      },
      include: {
        plan: true,
      },
    });

    if (!price) {
      logger.warn({ stripePriceId, subscriptionId: stripeSubscription.id }, 'Price not found in database');
      return;
    }

    // Check if subscription already exists
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: { providerSubscriptionId: stripeSubscription.id },
    });

    if (existingSubscription) {
      // Update existing subscription
      await this.prisma.subscription.update({
        where: { providerSubscriptionId: stripeSubscription.id },
        data: {
          status: this.mapStripeStatus(stripeSubscription.status),
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
          trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
        },
      });
    } else {
      // Create new subscription
      await this.prisma.subscription.create({
        data: {
          customerId: customer.id,
          planId: price.planId,
          priceId: price.id,
          provider: 'stripe',
          providerSubscriptionId: stripeSubscription.id,
          status: this.mapStripeStatus(stripeSubscription.status),
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
          trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
        },
      });
    }

    logger.info(
      {
        customerId: customer.id,
        planName: price.plan.name,
        subscriptionId: stripeSubscription.id
      },
      'Subscription created in database'
    );
  }

  private async handleSubscriptionUpdated(event: StripeWebhookEvent): Promise<void> {
    const stripeSubscription = event.data.object as Stripe.Subscription;
    const stripeCustomerId = stripeSubscription.customer as string;
    const stripePriceId = stripeSubscription.items.data[0]?.price.id;

    if (!stripeCustomerId) {
      logger.warn({ subscriptionId: stripeSubscription.id }, 'Missing customer ID in subscription');
      return;
    }

    // Find subscription by provider subscription ID
    const subscription = await this.prisma.subscription.findUnique({
      where: { providerSubscriptionId: stripeSubscription.id },
      include: {
        customer: true,
        plan: true,
        price: true,
      },
    });

    if (!subscription) {
      logger.warn({ subscriptionId: stripeSubscription.id }, 'Subscription not found for update');
      return;
    }

    // Check if plan/price changed
    let planId = subscription.planId;
    let priceId = subscription.priceId;

    if (stripePriceId && stripePriceId !== subscription.price.providerPriceId) {
      const newPrice = await this.prisma.subscriptionPrice.findUnique({
        where: {
          provider_providerPriceId: {
            provider: 'stripe',
            providerPriceId: stripePriceId,
          },
        },
      });

      if (newPrice) {
        planId = newPrice.planId;
        priceId = newPrice.id;
      }
    }

    // Update subscription
    await this.prisma.subscription.update({
      where: { providerSubscriptionId: stripeSubscription.id },
      data: {
        planId,
        priceId,
        status: this.mapStripeStatus(stripeSubscription.status),
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
        trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
      },
    });

    logger.info(
      {
        customerId: subscription.customerId,
        subscriptionId: stripeSubscription.id,
        status: stripeSubscription.status,
      },
      'Subscription updated'
    );
  }

  private async handleSubscriptionDeleted(event: StripeWebhookEvent): Promise<void> {
    const stripeSubscription = event.data.object as Stripe.Subscription;

    // Find subscription by provider subscription ID
    const subscription = await this.prisma.subscription.findUnique({
      where: { providerSubscriptionId: stripeSubscription.id },
      include: {
        customer: true,
      },
    });

    if (!subscription) {
      logger.warn({ subscriptionId: stripeSubscription.id }, 'Subscription not found for deletion');
      return;
    }

    // Update subscription status to canceled
    await this.prisma.subscription.update({
      where: { providerSubscriptionId: stripeSubscription.id },
      data: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date(),
      },
    });

    logger.info(
      {
        customerId: subscription.customerId,
        subscriptionId: stripeSubscription.id,
      },
      'Subscription canceled'
    );
  }

  private async handleInvoicePaid(event: StripeWebhookEvent): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const stripeSubscriptionId = invoice.subscription as string | null;
    const stripeCustomerId = invoice.customer as string;

    if (!stripeCustomerId) {
      logger.warn({ invoiceId: invoice.id }, 'Missing customer ID in invoice');
      return;
    }

    // Find customer by Stripe customer ID
    const customer = await this.prisma.customer.findUnique({
      where: { stripeCustomerId },
    });

    if (!customer) {
      logger.warn({ stripeCustomerId, invoiceId: invoice.id }, 'Customer not found');
      return;
    }

    // Find subscription if present
    let subscription = null;
    if (stripeSubscriptionId) {
      subscription = await this.prisma.subscription.findUnique({
        where: { providerSubscriptionId: stripeSubscriptionId },
        include: { plan: true },
      });
    }

    // Create invoice record
    await this.prisma.invoice.create({
      data: {
        customerId: customer.id,
        subscriptionId: subscription?.id,
        provider: 'stripe',
        providerInvoiceId: invoice.id,
        number: invoice.number || `INV-${invoice.id}`,
        status: InvoiceStatus.PAID,
        subtotal: invoice.subtotal || 0,
        tax: invoice.tax || 0,
        total: invoice.total || 0,
        amountPaid: invoice.amount_paid || 0,
        amountDue: invoice.amount_due || 0,
        currency: invoice.currency.toUpperCase(),
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
        paidAt: invoice.status_transitions.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : null,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdfUrl: invoice.invoice_pdf,
      },
    });

    // Log billing event
    await this.prisma.billingHistory.create({
      data: {
        customerId: customer.id,
        subscriptionId: subscription?.id,
        eventType: 'INVOICE_PAID',
        provider: 'stripe',
        description: `Invoice ${invoice.number || invoice.id} paid successfully`,
        amount: invoice.amount_paid || 0,
        currency: invoice.currency.toUpperCase(),
        actor: 'webhook',
      },
    });

    logger.info(
      {
        customerId: customer.id,
        subscriptionId: subscription?.id,
        invoiceId: invoice.id,
        amount: invoice.amount_paid,
      },
      'Invoice paid'
    );
  }

  private async handleInvoicePaymentFailed(event: StripeWebhookEvent): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const stripeSubscriptionId = invoice.subscription as string | null;
    const stripeCustomerId = invoice.customer as string;

    if (!stripeCustomerId) {
      logger.warn({ invoiceId: invoice.id }, 'Missing customer ID in invoice');
      return;
    }

    // Find customer by Stripe customer ID
    const customer = await this.prisma.customer.findUnique({
      where: { stripeCustomerId },
    });

    if (!customer) {
      logger.warn({ stripeCustomerId, invoiceId: invoice.id }, 'Customer not found');
      return;
    }

    // Find subscription if present
    let subscription = null;
    if (stripeSubscriptionId) {
      subscription = await this.prisma.subscription.findUnique({
        where: { providerSubscriptionId: stripeSubscriptionId },
        include: { plan: true },
      });

      if (subscription) {
        // Update subscription status to past due
        await this.prisma.subscription.update({
          where: { providerSubscriptionId: stripeSubscriptionId },
          data: {
            status: SubscriptionStatus.PAST_DUE,
          },
        });
      }
    }

    // Log billing event
    await this.prisma.billingHistory.create({
      data: {
        customerId: customer.id,
        subscriptionId: subscription?.id,
        eventType: 'INVOICE_PAYMENT_FAILED',
        provider: 'stripe',
        description: `Invoice ${invoice.number || invoice.id} payment failed`,
        amount: invoice.amount_due || 0,
        currency: invoice.currency.toUpperCase(),
        actor: 'webhook',
        metadata: {
          invoiceId: invoice.id,
          attemptCount: invoice.attempt_count,
        },
      },
    });

    logger.warn(
      {
        customerId: customer.id,
        subscriptionId: subscription?.id,
        invoiceId: invoice.id,
        amountDue: invoice.amount_due,
      },
      'Invoice payment failed'
    );
  }

  private async handleTrialWillEnd(event: StripeWebhookEvent): Promise<void> {
    const stripeSubscription = event.data.object as Stripe.Subscription;
    const guildId = stripeSubscription.metadata?.guildId;

    if (!guildId) return;

    logger.info({ guildId, trialEnd: stripeSubscription.trial_end }, 'Trial will end soon');

    // You could send a notification to the guild here
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  /**
   * Get active subscription by guild ID
   * @param guildId - Discord guild ID
   * @returns Active subscription or null
   */
  private async getSubscriptionByGuildId(guildId: string) {
    // Find customer by Discord user ID (using guildId)
    const customer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
      include: {
        subscriptions: {
          include: {
            plan: true,
            price: true,
          },
        },
      },
    });

    if (!customer) {
      return null;
    }

    // Filter for active subscriptions
    const activeSubscription = customer.subscriptions.find(
      (sub) => sub.status === SubscriptionStatus.ACTIVE || sub.status === SubscriptionStatus.TRIALING
    );

    return activeSubscription || null;
  }

  /**
   * Get or create Stripe customer for a guild
   * @param guildId - Discord guild ID
   * @param email - Optional email address
   * @returns Stripe customer ID
   */
  private async getOrCreateStripeCustomer(guildId: string, email?: string): Promise<string> {
    // Check if customer already exists
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { discordUserId: guildId },
    });

    if (existingCustomer?.stripeCustomerId) {
      return existingCustomer.stripeCustomerId;
    }

    // Use placeholder email if none provided
    const customerEmail = email || `guild-${guildId}@placeholder.local`;

    // Create Stripe customer
    const stripeCustomer = await this.stripe.customers.create({
      email: customerEmail,
      metadata: {
        guildId,
      },
    });

    // Save or update customer in database
    if (existingCustomer) {
      // Update existing customer with Stripe customer ID
      await this.prisma.customer.update({
        where: { discordUserId: guildId },
        data: {
          stripeCustomerId: stripeCustomer.id,
          email: customerEmail,
        },
      });
    } else {
      // Create new customer record
      await this.prisma.customer.create({
        data: {
          discordUserId: guildId,
          email: customerEmail,
          stripeCustomerId: stripeCustomer.id,
        },
      });
    }

    logger.info({ guildId, stripeCustomerId: stripeCustomer.id }, 'Stripe customer created');

    return stripeCustomer.id;
  }

  private getPriceId(tier: SubscriptionTier, billingCycle: BillingInterval): string | undefined {
    const envKey = `STRIPE_PRICE_${tier}_${billingCycle}`.toUpperCase();
    return process.env[envKey];
  }

  private getBillingCycleFromPrice(subscription: Stripe.Subscription): BillingInterval {
    const price = subscription.items.data[0]?.price;
    if (!price) return BillingInterval.MONTH;

    if (price.recurring?.interval === 'year') {
      return BillingInterval.YEAR;
    }

    return BillingInterval.MONTH;
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
    const statusMap: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELED,
      incomplete: SubscriptionStatus.INCOMPLETE,
      incomplete_expired: SubscriptionStatus.INCOMPLETE_EXPIRED,
      trialing: SubscriptionStatus.TRIALING,
      unpaid: SubscriptionStatus.UNPAID,
      paused: SubscriptionStatus.ACTIVE, // Treat paused as active
    };

    return statusMap[status] || SubscriptionStatus.ACTIVE;
  }
}
