/**
 * Stripe Payment Processor
 *
 * Stripe implementation of the IPaymentProcessor interface.
 * Handles Stripe-specific payment processing logic.
 *
 * @module packages/subscription/processors/stripe-processor
 */
import Stripe from 'stripe';
import { logger } from '@discord-bot/logger';
import { PLANS } from '../plans.js';
export class StripeProcessor {
    constructor(apiKey) {
        this.providerName = 'stripe';
        if (!apiKey) {
            throw new Error('Stripe API key is required');
        }
        this.stripe = new Stripe(apiKey, {
            apiVersion: '2023-10-16',
        });
        logger.info('Stripe payment processor initialized');
    }
    async createCustomer(guildId, email) {
        const customer = await this.stripe.customers.create({
            metadata: { guildId },
            email,
        });
        logger.info({ guildId, customerId: customer.id }, 'Stripe customer created');
        return {
            id: customer.id,
            email: customer.email || undefined,
            metadata: customer.metadata || undefined,
        };
    }
    async createCheckoutSession(guildId, tier, billingCycle, successUrl, cancelUrl) {
        const priceId = this.getPriceId(tier, billingCycle);
        if (!priceId) {
            throw new Error(`No Stripe price ID configured for ${tier} ${billingCycle}`);
        }
        const session = await this.stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: { guildId, tier, billingCycle },
            subscription_data: {
                metadata: { guildId, tier },
            },
        });
        logger.info({ guildId, sessionId: session.id, tier, billingCycle }, 'Stripe checkout session created');
        return {
            id: session.id,
            url: session.url || '',
            status: session.status,
            metadata: session.metadata || undefined,
        };
    }
    async cancelSubscription(subscriptionId, immediately = false) {
        const subscription = await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: !immediately,
        });
        if (immediately) {
            await this.stripe.subscriptions.cancel(subscriptionId);
        }
        logger.info({ subscriptionId, immediately }, 'Stripe subscription cancel requested');
        return this.mapStripeSubscription(subscription);
    }
    async resumeSubscription(subscriptionId) {
        const subscription = await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: false,
        });
        logger.info({ subscriptionId }, 'Stripe subscription resumed');
        return this.mapStripeSubscription(subscription);
    }
    async getSubscription(subscriptionId) {
        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        return this.mapStripeSubscription(subscription);
    }
    async createBillingPortalSession(customerId, returnUrl) {
        const session = await this.stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });
        logger.info({ customerId }, 'Stripe billing portal session created');
        return { url: session.url };
    }
    verifyWebhookSignature(payload, signature, secret) {
        try {
            this.stripe.webhooks.constructEvent(payload, signature, secret);
            return true;
        }
        catch (error) {
            logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Stripe webhook signature verification failed');
            return false;
        }
    }
    async parseWebhookEvent(payload, signature, secret) {
        const event = this.stripe.webhooks.constructEvent(payload, signature, secret);
        return {
            type: event.type,
            data: event.data.object,
            rawEvent: event,
        };
    }
    getPriceId(tier, billingCycle) {
        const plan = PLANS[tier];
        if (!plan?.stripePriceIds) {
            return null;
        }
        return billingCycle === 'MONTHLY'
            ? plan.stripePriceIds.monthly || null
            : plan.stripePriceIds.yearly || null;
    }
    /**
     * Map Stripe subscription to internal format
     */
    mapStripeSubscription(subscription) {
        let status;
        switch (subscription.status) {
            case 'active':
                status = 'active';
                break;
            case 'past_due':
                status = 'past_due';
                break;
            case 'canceled':
                status = 'canceled';
                break;
            case 'incomplete':
                status = 'incomplete';
                break;
            case 'unpaid':
                status = 'unpaid';
                break;
            default:
                status = 'canceled';
        }
        return {
            id: subscription.id,
            customerId: subscription.customer,
            status,
            currentPeriodStart: subscription.current_period_start,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            metadata: subscription.metadata,
        };
    }
}
