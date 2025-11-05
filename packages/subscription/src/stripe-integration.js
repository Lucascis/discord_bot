/**
 * Stripe Integration
 * Handles Stripe payment processing and webhook events
 */
import Stripe from 'stripe';
import { SubscriptionTier, SubscriptionStatus, BillingCycle, InvoiceStatus } from '@prisma/client';
import { logger } from '@discord-bot/logger';
import { SubscriptionService } from './subscription-service.js';
export class StripeIntegration {
    constructor(prisma, apiKey) {
        this.prisma = prisma;
        this.stripe = new Stripe(apiKey, {
            apiVersion: '2023-10-16',
        });
        this.subscriptionService = new SubscriptionService(prisma);
    }
    /**
     * Create Stripe customer
     */
    async createCustomer(guildId, email) {
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
    async createCheckoutSession(guildId, tier, billingCycle, successUrl, cancelUrl) {
        // Get or create customer
        let subscription = await this.prisma.subscription.findUnique({
            where: { guildId },
        });
        let customerId = subscription?.stripeCustomerId;
        if (!customerId) {
            const customer = await this.createCustomer(guildId);
            customerId = customer.id;
            if (subscription) {
                await this.prisma.subscription.update({
                    where: { guildId },
                    data: { stripeCustomerId: customerId },
                });
            }
        }
        // Get price ID based on tier and billing cycle
        const priceId = this.getPriceId(tier, billingCycle);
        if (!priceId) {
            throw new Error(`No price ID configured for ${tier} ${billingCycle}`);
        }
        // Create checkout session
        const session = await this.stripe.checkout.sessions.create({
            customer: customerId,
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
    async createPortalSession(guildId, returnUrl) {
        const subscription = await this.prisma.subscription.findUnique({
            where: { guildId },
        });
        if (!subscription?.stripeCustomerId) {
            throw new Error('No Stripe customer found for this guild');
        }
        const session = await this.stripe.billingPortal.sessions.create({
            customer: subscription.stripeCustomerId,
            return_url: returnUrl,
        });
        return session;
    }
    /**
     * Handle Stripe webhook events
     */
    async handleWebhook(event) {
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
        }
        catch (error) {
            logger.error({ error, eventType: event.type }, 'Error processing Stripe webhook');
            throw error;
        }
    }
    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(payload, signature, secret) {
        return this.stripe.webhooks.constructEvent(payload, signature, secret);
    }
    // ========================================
    // PRIVATE WEBHOOK HANDLERS
    // ========================================
    async handleCheckoutCompleted(event) {
        const session = event.data.object;
        const guildId = session.metadata?.guildId;
        const tier = session.metadata?.tier;
        if (!guildId || !tier) {
            logger.warn({ sessionId: session.id }, 'Missing metadata in checkout session');
            return;
        }
        logger.info({ guildId, tier, sessionId: session.id }, 'Checkout completed');
        // Subscription will be created/updated by the subscription.created event
    }
    async handleSubscriptionCreated(event) {
        const stripeSubscription = event.data.object;
        const guildId = stripeSubscription.metadata?.guildId;
        const tier = stripeSubscription.metadata?.tier || SubscriptionTier.BASIC;
        if (!guildId) {
            logger.warn({ subscriptionId: stripeSubscription.id }, 'Missing guildId in subscription metadata');
            return;
        }
        // Determine billing cycle from price
        const billingCycle = this.getBillingCycleFromPrice(stripeSubscription);
        // Create or update subscription
        const existingSubscription = await this.prisma.subscription.findUnique({
            where: { guildId },
        });
        if (existingSubscription) {
            await this.prisma.subscription.update({
                where: { guildId },
                data: {
                    tier,
                    status: this.mapStripeStatus(stripeSubscription.status),
                    billingCycle,
                    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
                    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                    stripeSubscriptionId: stripeSubscription.id,
                    stripeCustomerId: stripeSubscription.customer,
                    isTrialing: stripeSubscription.status === 'trialing',
                    trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
                    trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
                },
            });
        }
        else {
            await this.subscriptionService.createSubscription({
                guildId,
                tier,
                billingCycle,
                stripeCustomerId: stripeSubscription.customer,
            });
            await this.prisma.subscription.update({
                where: { guildId },
                data: {
                    stripeSubscriptionId: stripeSubscription.id,
                    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
                    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                },
            });
        }
        logger.info({ guildId, tier, subscriptionId: stripeSubscription.id }, 'Subscription created in database');
    }
    async handleSubscriptionUpdated(event) {
        const stripeSubscription = event.data.object;
        const guildId = stripeSubscription.metadata?.guildId;
        if (!guildId) {
            logger.warn({ subscriptionId: stripeSubscription.id }, 'Missing guildId in subscription metadata');
            return;
        }
        const subscription = await this.prisma.subscription.findUnique({
            where: { guildId },
        });
        if (!subscription) {
            logger.warn({ guildId }, 'Subscription not found for update');
            return;
        }
        await this.prisma.subscription.update({
            where: { guildId },
            data: {
                status: this.mapStripeStatus(stripeSubscription.status),
                currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
                currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            },
        });
        logger.info({ guildId, subscriptionId: stripeSubscription.id }, 'Subscription updated');
    }
    async handleSubscriptionDeleted(event) {
        const stripeSubscription = event.data.object;
        const guildId = stripeSubscription.metadata?.guildId;
        if (!guildId) {
            logger.warn({ subscriptionId: stripeSubscription.id }, 'Missing guildId in subscription metadata');
            return;
        }
        // Downgrade to FREE tier
        await this.subscriptionService.updateSubscription(guildId, {
            tier: SubscriptionTier.FREE,
        });
        await this.prisma.subscription.update({
            where: { guildId },
            data: {
                status: SubscriptionStatus.CANCELED,
                canceledAt: new Date(),
            },
        });
        logger.info({ guildId, subscriptionId: stripeSubscription.id }, 'Subscription canceled');
    }
    async handleInvoicePaid(event) {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId)
            return;
        const stripeSubscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        const guildId = stripeSubscription.metadata?.guildId;
        if (!guildId)
            return;
        const subscription = await this.prisma.subscription.findUnique({
            where: { guildId },
        });
        if (!subscription)
            return;
        // Create invoice record
        await this.prisma.invoice.create({
            data: {
                subscriptionId: subscription.id,
                invoiceNumber: invoice.number || `INV-${invoice.id}`,
                status: InvoiceStatus.PAID,
                amountDue: invoice.amount_due,
                amountPaid: invoice.amount_paid,
                currency: invoice.currency,
                periodStart: new Date(invoice.period_start * 1000),
                periodEnd: new Date(invoice.period_end * 1000),
                stripeInvoiceId: invoice.id,
                paymentIntentId: invoice.payment_intent,
                paymentMethod: 'stripe',
                paidAt: invoice.status_transitions.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : null,
            },
        });
        // Log event
        await this.prisma.subscriptionEvent.create({
            data: {
                guildId,
                eventType: 'PAYMENT_SUCCEEDED',
                tier: subscription.tier,
            },
        });
        logger.info({ guildId, invoiceId: invoice.id }, 'Invoice paid');
    }
    async handleInvoicePaymentFailed(event) {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId)
            return;
        const stripeSubscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        const guildId = stripeSubscription.metadata?.guildId;
        if (!guildId)
            return;
        const subscription = await this.prisma.subscription.findUnique({
            where: { guildId },
        });
        if (!subscription)
            return;
        // Update subscription status
        await this.prisma.subscription.update({
            where: { guildId },
            data: {
                status: SubscriptionStatus.PAST_DUE,
            },
        });
        // Log event
        await this.prisma.subscriptionEvent.create({
            data: {
                guildId,
                eventType: 'PAYMENT_FAILED',
                tier: subscription.tier,
            },
        });
        logger.warn({ guildId, invoiceId: invoice.id }, 'Invoice payment failed');
    }
    async handleTrialWillEnd(event) {
        const stripeSubscription = event.data.object;
        const guildId = stripeSubscription.metadata?.guildId;
        if (!guildId)
            return;
        logger.info({ guildId, trialEnd: stripeSubscription.trial_end }, 'Trial will end soon');
        // You could send a notification to the guild here
    }
    // ========================================
    // HELPER METHODS
    // ========================================
    getPriceId(tier, billingCycle) {
        const envKey = `STRIPE_PRICE_${tier}_${billingCycle}`.toUpperCase();
        return process.env[envKey];
    }
    getBillingCycleFromPrice(subscription) {
        const price = subscription.items.data[0]?.price;
        if (!price)
            return BillingCycle.MONTHLY;
        if (price.recurring?.interval === 'year') {
            return BillingCycle.YEARLY;
        }
        return BillingCycle.MONTHLY;
    }
    mapStripeStatus(status) {
        const statusMap = {
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
