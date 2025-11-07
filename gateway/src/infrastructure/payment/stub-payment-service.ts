import { PaymentService } from '../../application/use-cases/subscription-management-use-case.js';

/**
 * Stub Payment Service - For Development/Testing
 * In production, this would integrate with Stripe, PayPal, or similar
 */
export class StubPaymentService implements PaymentService {
  async createSubscription(_customerId: string, _planId: string): Promise<{ subscriptionId: string; paymentUrl: string }> {
    // Simulate payment processing
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const paymentUrl = `https://payments.discord-bot.example.com/checkout/${subscriptionId}`;

    // In production, this would create actual payment subscription
    return {
      subscriptionId,
      paymentUrl
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    // Simulate subscription cancellation
    console.log(`[StubPaymentService] Cancelling subscription: ${subscriptionId}`);
  }

  async upgradeSubscription(subscriptionId: string, newPlanId: string): Promise<void> {
    // Simulate subscription upgrade
    console.log(`[StubPaymentService] Upgrading subscription ${subscriptionId} to plan ${newPlanId}`);
  }

  async processPayment(customerId: string, amount: number): Promise<{ success: boolean; transactionId?: string }> {
    // Simulate payment processing - always succeeds in development
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[StubPaymentService] Processing payment for customer ${customerId}: $${amount}`);

    return {
      success: true,
      transactionId
    };
  }
}