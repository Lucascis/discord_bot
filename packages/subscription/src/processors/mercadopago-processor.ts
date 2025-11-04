/**
 * Mercado Pago Payment Processor
 *
 * Mercado Pago implementation of the IPaymentProcessor interface.
 * Handles Mercado Pago-specific payment processing logic.
 *
 * @module packages/subscription/processors/mercadopago-processor
 * @status NOT_IMPLEMENTED - Placeholder for future implementation
 */

import { SubscriptionTier, BillingCycle } from '@prisma/client';
import { logger } from '@discord-bot/logger';
import {
  IPaymentProcessor,
  PaymentCustomer,
  CheckoutSession,
  PaymentSubscription,
  WebhookEvent,
} from '../payment-processor-interface.js';

export class MercadoPagoProcessor implements IPaymentProcessor {
  readonly providerName = 'mercadopago' as const;

  constructor(accessToken: string) {
    if (!accessToken) {
      throw new Error('Mercado Pago access token is required');
    }

    logger.warn('Mercado Pago payment processor is not implemented yet');
    throw new Error('Mercado Pago integration is not implemented yet');
  }

  async createCustomer(guildId: string, email?: string): Promise<PaymentCustomer> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async createCheckoutSession(
    guildId: string,
    tier: SubscriptionTier,
    billingCycle: BillingCycle,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSession> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async cancelSubscription(
    subscriptionId: string,
    immediately?: boolean
  ): Promise<PaymentSubscription> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async resumeSubscription(subscriptionId: string): Promise<PaymentSubscription> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async getSubscription(subscriptionId: string): Promise<PaymentSubscription> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async createBillingPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<{ url: string }> {
    throw new Error('Mercado Pago integration not implemented');
  }

  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    secret: string
  ): boolean {
    throw new Error('Mercado Pago integration not implemented');
  }

  async parseWebhookEvent(
    payload: string | Buffer,
    signature: string,
    secret: string
  ): Promise<WebhookEvent> {
    throw new Error('Mercado Pago integration not implemented');
  }

  getPriceId(tier: SubscriptionTier, billingCycle: BillingCycle): string | null {
    throw new Error('Mercado Pago integration not implemented');
  }
}
