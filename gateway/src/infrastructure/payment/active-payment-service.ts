import { PaymentService } from '../../application/use-cases/subscription-management-use-case.js';
import { PaymentProviderFactory, getPaymentFactory } from './payment-provider-factory.js';
import { getPlanByTier } from '@discord-bot/subscription';
import { SubscriptionTier } from '@prisma/client';

const SUCCESS_STATUSES = new Set(['succeeded', 'requires_capture', 'processing']);

/**
 * Payment service backed by the configured payment provider factory.
 * Falls back to the stub provider when no real credentials are present.
 */
export class ActivePaymentService implements PaymentService {
  constructor(
    private readonly factory: PaymentProviderFactory = getPaymentFactory(),
    private readonly billingCurrency: string = (process.env.BILLING_CURRENCY || 'USD').toLowerCase()
  ) {}

  private get provider() {
    return this.factory.getProvider();
  }

  private resolveBillingCycle(planId: string): 'monthly' | 'yearly' {
    const normalized = planId.toLowerCase();
    if (normalized.includes('year') || normalized.includes('annual')) {
      return 'yearly';
    }
    return 'monthly';
  }

  private resolveTier(planId: string): SubscriptionTier {
    const normalized = planId.replace(/[:\s-]+/g, '_').toUpperCase();
    const tierMatch = Object.values(SubscriptionTier).find((tier) =>
      normalized === tier ||
      normalized === `${tier}_MONTHLY` ||
      normalized === `${tier}_YEARLY`
    );

    if (!tierMatch) {
      throw new Error(`Unsupported plan identifier: ${planId}`);
    }

    return tierMatch as SubscriptionTier;
  }

  private resolvePriceId(planId: string): string {
    const tier = this.resolveTier(planId);
    const cycle = this.resolveBillingCycle(planId);
    const plan = getPlanByTier(tier);
    const priceId = plan.stripePriceIds?.[cycle];
    if (priceId) {
      return priceId;
    }

    throw new Error(
      `Missing ${cycle} price for ${tier}. Ensure subscription_prices contains the Stripe price ID.`
    );
  }

  async createSubscription(customerId: string, planId: string): Promise<{ subscriptionId: string; paymentUrl: string }> {
    const priceId = this.resolvePriceId(planId);
    const subscription = await this.provider.createSubscription({
      customerId,
      priceId,
      metadata: { planId }
    });

    return {
      subscriptionId: subscription.id,
      paymentUrl: process.env.BILLING_PORTAL_URL || ''
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.provider.cancelSubscription(subscriptionId, true);
  }

  async upgradeSubscription(subscriptionId: string, newPlanId: string): Promise<void> {
    const priceId = this.resolvePriceId(newPlanId);
    await this.provider.updateSubscription(subscriptionId, {
      priceId,
      metadata: { planId: newPlanId }
    });
  }

  async processPayment(customerId: string, amount: number): Promise<{ success: boolean; transactionId?: string }> {
    const intent = await this.provider.createPaymentIntent({
      amount: Math.max(0, Math.round(amount * 100)),
      currency: this.billingCurrency,
      customerId,
      metadata: { customerId }
    });

    return {
      success: SUCCESS_STATUSES.has(intent.status),
      transactionId: intent.id
    };
  }
}
