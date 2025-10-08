/**
 * Stub Billing Service
 * Infrastructure adapter for billing operations (structure only - no actual payment processing)
 */

import { FeatureSubscription } from '../../domain/entities/feature-subscription.js';
import { SubscriptionTier } from '@discord-bot/config';
import { BillingService } from '../../application/use-cases/billing-management-use-case.js';

export class StubBillingService implements BillingService {
  private readonly simulatedLatency = 1000; // 1 second simulation

  async calculateProration(
    oldPlan: any,
    newPlan: any,
    remainingDays: number
  ): Promise<number> {
    // Simulate API call delay
    await this.delay(this.simulatedLatency);

    // Calculate proration amount
    const dailyOldRate = oldPlan.finalPrice / 30;
    const dailyNewRate = newPlan.finalPrice / 30;
    const prorationAmount = (dailyNewRate - dailyOldRate) * remainingDays;

    console.log(`Proration calculated: ${prorationAmount} for ${remainingDays} days`);
    return Math.max(0, prorationAmount);
  }

  async processUpgrade(
    subscription: FeatureSubscription,
    newTier: SubscriptionTier
  ): Promise<{ success: boolean; chargeAmount?: number }> {
    // Simulate API call delay
    await this.delay(this.simulatedLatency);

    try {
      // Simulate payment processing logic
      const upgradeAmount = this.calculateUpgradeAmount(subscription.tier, newTier);

      // Simulate different outcomes based on tier
      const success = this.simulatePaymentSuccess(upgradeAmount);

      if (success) {
        console.log(`Upgrade processed successfully: ${subscription.tier} → ${newTier}, charged: $${upgradeAmount}`);
        return {
          success: true,
          chargeAmount: upgradeAmount
        };
      } else {
        console.log(`Upgrade failed: insufficient funds or payment declined`);
        return { success: false };
      }
    } catch (error) {
      console.error('Upgrade processing error:', error);
      return { success: false };
    }
  }

  async processDowngrade(
    subscription: FeatureSubscription,
    newTier: SubscriptionTier
  ): Promise<{ success: boolean; creditAmount?: number }> {
    // Simulate API call delay
    await this.delay(this.simulatedLatency);

    try {
      // Calculate credit amount for downgrade
      const creditAmount = this.calculateDowngradeCredit(subscription.tier, newTier);

      console.log(`Downgrade processed: ${subscription.tier} → ${newTier}, credit: $${creditAmount}`);
      return {
        success: true,
        creditAmount
      };
    } catch (error) {
      console.error('Downgrade processing error:', error);
      return { success: false };
    }
  }

  async cancelSubscription(
    subscriptionId: string,
    reason: string
  ): Promise<{ success: boolean }> {
    // Simulate API call delay
    await this.delay(this.simulatedLatency);

    try {
      // Simulate cancellation processing
      console.log(`Subscription cancelled: ${subscriptionId}, reason: ${reason}`);

      // In a real implementation, this would:
      // 1. Stop recurring billing
      // 2. Update payment provider
      // 3. Process any final charges/credits
      // 4. Send confirmation

      return { success: true };
    } catch (error) {
      console.error('Cancellation processing error:', error);
      return { success: false };
    }
  }

  async issueRefund(
    subscriptionId: string,
    amount: number,
    reason: string
  ): Promise<{ success: boolean; refundId?: string }> {
    // Simulate API call delay
    await this.delay(this.simulatedLatency * 1.5); // Refunds take longer

    try {
      // Simulate refund processing
      const refundId = `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Simulate refund success/failure based on amount
      const success = this.simulateRefundSuccess(amount);

      if (success) {
        console.log(`Refund processed: $${amount} for subscription ${subscriptionId}, refund ID: ${refundId}`);
        return {
          success: true,
          refundId
        };
      } else {
        console.log(`Refund failed: amount too large or outside refund window`);
        return { success: false };
      }
    } catch (error) {
      console.error('Refund processing error:', error);
      return { success: false };
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private calculateUpgradeAmount(currentTier: SubscriptionTier, newTier: SubscriptionTier): number {
    const tierPrices: Record<SubscriptionTier, number> = {
      free: 0,
      basic: 9.99,
      premium: 19.99,
      enterprise: 49.99
    };

    const currentPrice = tierPrices[currentTier];
    const newPrice = tierPrices[newTier];

    // Calculate prorated difference for remaining billing period
    const proratedAmount = (newPrice - currentPrice) * 0.8; // 80% of difference for partial period
    return Math.max(0, proratedAmount);
  }

  private calculateDowngradeCredit(currentTier: SubscriptionTier, newTier: SubscriptionTier): number {
    const tierPrices: Record<SubscriptionTier, number> = {
      free: 0,
      basic: 9.99,
      premium: 19.99,
      enterprise: 49.99
    };

    const currentPrice = tierPrices[currentTier];
    const newPrice = tierPrices[newTier];

    // Calculate credit for unused portion
    const creditAmount = (currentPrice - newPrice) * 0.6; // 60% credit for unused portion
    return Math.max(0, creditAmount);
  }

  private simulatePaymentSuccess(amount: number): boolean {
    // Simulate payment success/failure based on amount
    if (amount <= 0) return true;
    if (amount > 100) return Math.random() > 0.1; // 90% success for large amounts
    if (amount > 50) return Math.random() > 0.05; // 95% success for medium amounts
    return Math.random() > 0.02; // 98% success for small amounts
  }

  private simulateRefundSuccess(amount: number): boolean {
    // Simulate refund success/failure
    if (amount <= 0) return false;
    if (amount > 200) return Math.random() > 0.3; // 70% success for large refunds
    if (amount > 50) return Math.random() > 0.1; // 90% success for medium refunds
    return Math.random() > 0.05; // 95% success for small refunds
  }
}