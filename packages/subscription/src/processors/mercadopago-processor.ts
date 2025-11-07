/**
 * Mercado Pago Payment Processor
 *
 * Mercado Pago implementation of the IPaymentProcessor interface.
 * Handles Mercado Pago-specific payment processing logic.
 *
 * @module packages/subscription/processors/mercadopago-processor
 * @status NOT_IMPLEMENTED - Placeholder for future implementation
 */

import { SubscriptionTier, BillingInterval } from '@prisma/client';
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

  async createCustomer(_guildId: string, _email?: string): Promise<PaymentCustomer> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async createCheckoutSession(
    _guildId: string,
    _tier: SubscriptionTier,
    _billingCycle: BillingInterval,
    _successUrl: string,
    _cancelUrl: string
  ): Promise<CheckoutSession> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async cancelSubscription(
    _subscriptionId: string,
    _immediately?: boolean
  ): Promise<PaymentSubscription> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async resumeSubscription(_subscriptionId: string): Promise<PaymentSubscription> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async getSubscription(_subscriptionId: string): Promise<PaymentSubscription> {
    throw new Error('Mercado Pago integration not implemented');
  }

  async createBillingPortalSession(
    _customerId: string,
    _returnUrl: string
  ): Promise<{ url: string }> {
    throw new Error('Mercado Pago integration not implemented');
  }

  verifyWebhookSignature(
    _payload: string | Buffer,
    _signature: string,
    _secret: string
  ): boolean {
    throw new Error('Mercado Pago integration not implemented');
  }

  async parseWebhookEvent(
    _payload: string | Buffer,
    _signature: string,
    _secret: string
  ): Promise<WebhookEvent> {
    throw new Error('Mercado Pago integration not implemented');
  }

  getPriceId(_tier: SubscriptionTier, _billingCycle: BillingInterval): string | null {
    throw new Error('Mercado Pago integration not implemented');
  }
}
