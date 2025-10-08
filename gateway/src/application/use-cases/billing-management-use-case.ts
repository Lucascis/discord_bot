/**
 * Billing Management Use Case
 * Orchestrates billing operations, invoicing, payment processing structure, and financial analytics
 * NOTE: This is the structure design only - no actual payment gateway implementation
 */

import { SubscriptionTier } from '@discord-bot/config';
import { PaymentPlan, PriceChange, BillingTrigger } from '../../domain/entities/payment-plan.js';
import { FeatureSubscription } from '../../domain/entities/feature-subscription.js';
import { BillingPeriod, PeriodType } from '../../domain/value-objects/billing-period.js';
import { BillingDomainService, BillingCalculation, PriceAdjustment, InvoiceGeneration } from '../../domain/services/billing-domain-service.js';

export interface BillingRepository {
  saveBillingRecord(record: BillingRecord): Promise<void>;
  findBillingHistory(userId: string, limit?: number): Promise<BillingRecord[]>;
  findPendingCharges(userId: string): Promise<BillingRecord[]>;
  findRefundableTransactions(userId: string): Promise<BillingRecord[]>;
  generateInvoiceId(): Promise<string>;
}

export interface PaymentPlanRepository {
  findByTierAndPeriod(tier: SubscriptionTier, period: PeriodType): Promise<PaymentPlan | null>;
  findPromotionalPlans(userId: string): Promise<PaymentPlan[]>;
  findAllActive(): Promise<PaymentPlan[]>;
  save(plan: PaymentPlan): Promise<void>;
}

export interface TaxCalculationService {
  calculateTax(amount: number, country: string, state?: string): Promise<TaxCalculation>;
  validateTaxId(taxId: string, country: string): Promise<boolean>;
  getTaxRateForLocation(country: string, state?: string): Promise<number>;
}

export interface PaymentGatewayStructure {
  // NOTE: Structure only - no actual payment processing
  createPaymentIntent(amount: number, currency: string, metadata: PaymentMetadata): Promise<PaymentIntent>;
  capturePayment(paymentIntentId: string): Promise<PaymentResult>;
  refundPayment(paymentIntentId: string, amount?: number, reason?: string): Promise<RefundResult>;
  createCustomer(customerData: CustomerData): Promise<PaymentCustomer>;
  attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;
  subscribeCustomer(customerId: string, priceId: string): Promise<PaymentSubscription>;
}

export interface InvoiceService {
  generateInvoice(billingData: InvoiceData): Promise<Invoice>;
  sendInvoice(invoice: Invoice, recipientEmail: string): Promise<void>;
  markInvoiceAsPaid(invoiceId: string, paymentData: PaymentResult): Promise<void>;
  generateReceipt(paymentData: PaymentResult): Promise<Receipt>;
}

export interface BillingNotificationService {
  sendPaymentSuccessful(userId: string, amount: number, plan: PaymentPlan): Promise<void>;
  sendPaymentFailed(userId: string, reason: string, retryDate?: Date): Promise<void>;
  sendInvoiceGenerated(userId: string, invoice: Invoice): Promise<void>;
  sendRefundProcessed(userId: string, amount: number, reason: string): Promise<void>;
  sendBillingIssue(userId: string, issue: string, resolution: string): Promise<void>;
}

export interface BillingAnalyticsService {
  recordRevenue(amount: number, tier: SubscriptionTier, period: PeriodType): Promise<void>;
  recordChurn(userId: string, tier: SubscriptionTier, reason: string): Promise<void>;
  trackPaymentFailure(userId: string, reason: string, amount: number): Promise<void>;
  calculateMetrics(timeframe: 'day' | 'week' | 'month'): Promise<BillingMetrics>;
}

export interface BillingRecord {
  id: string;
  userId: string;
  guildId?: string;
  type: 'charge' | 'refund' | 'adjustment' | 'credit';
  amount: number;
  currency: string;
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  description: string;
  planId?: string;
  invoiceId?: string;
  paymentIntentId?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  processedAt?: Date;
  failureReason?: string;
}

export interface TaxCalculation {
  taxAmount: number;
  taxRate: number;
  totalAmount: number;
  taxRegion: string;
  exemptionApplied: boolean;
}

export interface PaymentMetadata {
  userId: string;
  guildId?: string;
  subscriptionId?: string;
  planId: string;
  billingPeriod: string;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  clientSecret: string;
  metadata: PaymentMetadata;
}

export interface PaymentResult {
  id: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed';
  paymentMethodId: string;
  receiptUrl?: string;
  failureReason?: string;
}

export interface RefundResult {
  id: string;
  amount: number;
  status: 'succeeded' | 'failed';
  reason?: string;
}

export interface CustomerData {
  email: string;
  name: string;
  address?: Address;
  taxId?: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface PaymentCustomer {
  id: string;
  email: string;
  name: string;
}

export interface PaymentSubscription {
  id: string;
  customerId: string;
  priceId: string;
  status: 'active' | 'inactive' | 'cancelled';
}

export interface InvoiceData {
  customerId: string;
  amount: number;
  tax: TaxCalculation;
  lineItems: InvoiceLineItem[];
  billingPeriod: { start: Date; end: Date };
  dueDate: Date;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Invoice {
  id: string;
  customerId: string;
  amount: number;
  tax: TaxCalculation;
  totalAmount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  dueDate: Date;
  pdfUrl?: string;
}

export interface Receipt {
  id: string;
  paymentId: string;
  amount: number;
  pdfUrl: string;
  sentAt: Date;
}

export interface BillingMetrics {
  totalRevenue: number;
  monthlyRecurringRevenue: number;
  averageRevenuePerUser: number;
  churnRate: number;
  paymentFailureRate: number;
  revenueByTier: Record<SubscriptionTier, number>;
  revenueGrowth: number;
  customerLifetimeValue: number;
}

export interface AnalyticsService {
  recordRevenue(amount: number, tier: SubscriptionTier, period: string): Promise<void>;
  recordChurn(userId: string, tier: SubscriptionTier, reason: string): Promise<void>;
  trackPaymentFailure(userId: string, reason: string, amount: number): Promise<void>;
  calculateMetrics(timeframe: 'day' | 'week' | 'month'): Promise<BillingMetrics>;
}

export interface BillingService {
  calculateProration(oldPlan: any, newPlan: any, remainingDays: number): Promise<number>;
  processUpgrade(subscription: FeatureSubscription, newTier: SubscriptionTier): Promise<{ success: boolean; chargeAmount?: number }>;
  processDowngrade(subscription: FeatureSubscription, newTier: SubscriptionTier): Promise<{ success: boolean; creditAmount?: number }>;
  cancelSubscription(subscriptionId: string, reason: string): Promise<{ success: boolean }>;
  issueRefund(subscriptionId: string, amount: number, reason: string): Promise<{ success: boolean; refundId?: string }>;
}

export class BillingManagementUseCase {
  constructor(
    private readonly billingRepository: BillingRepository,
    private readonly paymentPlanRepository: PaymentPlanRepository,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly paymentGateway: PaymentGatewayStructure,
    private readonly invoiceService: InvoiceService,
    private readonly notificationService: BillingNotificationService,
    private readonly analyticsService: BillingAnalyticsService,
    private readonly billingDomainService: BillingDomainService
  ) {}

  /**
   * Create billing structure for subscription (no actual payment processing)
   */
  async createSubscriptionBilling(
    userId: string,
    guildId: string,
    subscription: FeatureSubscription,
    customerData: CustomerData
  ): Promise<{
    success: boolean;
    billingSetup?: {
      customerId: string;
      paymentPlan: PaymentPlan;
      taxCalculation: TaxCalculation;
      totalAmount: number;
    };
    error?: string;
  }> {
    try {
      // Get payment plan
      const paymentPlan = await this.paymentPlanRepository.findByTierAndPeriod(
        subscription.tier,
        subscription.billingPeriod.type
      );

      if (!paymentPlan) {
        return { success: false, error: 'Payment plan not found' };
      }

      // Calculate tax
      const taxCalculation = await this.taxCalculationService.calculateTax(
        paymentPlan.finalPrice,
        customerData.address?.country || 'US',
        customerData.address?.state
      );

      // Create customer structure (no actual gateway call)
      const paymentCustomer = await this.paymentGateway.createCustomer(customerData);

      // Record billing setup
      const billingRecord: BillingRecord = {
        id: `bill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        guildId,
        type: 'charge',
        amount: taxCalculation.totalAmount,
        currency: 'USD',
        status: 'pending',
        description: `${subscription.tier} subscription - ${subscription.billingPeriod.type}`,
        planId: paymentPlan.id,
        metadata: {
          subscriptionId: subscription.id,
          customerId: paymentCustomer.id,
          tier: subscription.tier,
          period: subscription.billingPeriod.type
        },
        createdAt: new Date()
      };

      await this.billingRepository.saveBillingRecord(billingRecord);

      return {
        success: true,
        billingSetup: {
          customerId: paymentCustomer.id,
          paymentPlan,
          taxCalculation,
          totalAmount: taxCalculation.totalAmount
        }
      };
    } catch (error) {
      return { success: false, error: 'Failed to create billing setup' };
    }
  }

  /**
   * Process subscription upgrade billing
   */
  async processUpgradeBilling(
    userId: string,
    currentSubscription: FeatureSubscription,
    newPlan: PaymentPlan
  ): Promise<{
    success: boolean;
    billingCalculation?: BillingCalculation;
    prorationAmount?: number;
    error?: string;
  }> {
    try {
      // Calculate upgrade cost with proration
      const billingCalculation = this.billingDomainService.calculateUpgradeCost(
        currentSubscription.paymentPlan,
        newPlan,
        currentSubscription.getRemainingDays()
      );

      // Calculate tax on proration amount
      const taxCalculation = await this.taxCalculationService.calculateTax(
        billingCalculation.prorationAmount,
        'US' // Default country - would be retrieved from customer data
      );

      // Create billing record for upgrade
      const billingRecord: BillingRecord = {
        id: `upgrade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type: 'charge',
        amount: taxCalculation.totalAmount,
        currency: 'USD',
        status: 'pending',
        description: `Upgrade to ${newPlan.tier} - Prorated amount`,
        planId: newPlan.id,
        metadata: {
          upgradeFrom: currentSubscription.tier,
          upgradeTo: newPlan.tier,
          prorationDays: currentSubscription.getRemainingDays(),
          baseAmount: billingCalculation.prorationAmount,
          taxAmount: taxCalculation.taxAmount
        },
        createdAt: new Date()
      };

      await this.billingRepository.saveBillingRecord(billingRecord);

      // Record analytics
      await this.analyticsService.recordRevenue(
        taxCalculation.totalAmount,
        newPlan.tier,
        newPlan.billingPeriod.type
      );

      return {
        success: true,
        billingCalculation,
        prorationAmount: taxCalculation.totalAmount
      };
    } catch (error) {
      return { success: false, error: 'Failed to process upgrade billing' };
    }
  }

  /**
   * Process refund structure
   */
  async processRefund(
    userId: string,
    subscriptionId: string,
    refundAmount: number,
    reason: string
  ): Promise<{
    success: boolean;
    refundId?: string;
    processedAmount?: number;
    error?: string;
  }> {
    try {
      // Find refundable transactions
      const refundableTransactions = await this.billingRepository.findRefundableTransactions(userId);

      if (refundableTransactions.length === 0) {
        return { success: false, error: 'No refundable transactions found' };
      }

      // Calculate maximum refundable amount
      const maxRefundable = refundableTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
      const finalRefundAmount = Math.min(refundAmount, maxRefundable);

      // Process refund structure (no actual gateway call)
      const refundResult: RefundResult = {
        id: `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        amount: finalRefundAmount,
        status: 'succeeded',
        reason
      };

      // Create refund billing record
      const refundRecord: BillingRecord = {
        id: `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type: 'refund',
        amount: -finalRefundAmount, // Negative amount for refund
        currency: 'USD',
        status: 'successful',
        description: `Refund: ${reason}`,
        metadata: {
          subscriptionId,
          refundReason: reason,
          originalTransactions: refundableTransactions.map(t => t.id)
        },
        createdAt: new Date(),
        processedAt: new Date()
      };

      await this.billingRepository.saveBillingRecord(refundRecord);

      // Send notification
      await this.notificationService.sendRefundProcessed(userId, finalRefundAmount, reason);

      return {
        success: true,
        refundId: refundResult.id,
        processedAmount: finalRefundAmount
      };
    } catch (error) {
      return { success: false, error: 'Failed to process refund' };
    }
  }

  /**
   * Generate invoice for subscription
   */
  async generateInvoice(
    userId: string,
    subscription: FeatureSubscription,
    customerData: CustomerData
  ): Promise<{
    success: boolean;
    invoice?: Invoice;
    error?: string;
  }> {
    try {
      const paymentPlan = subscription.paymentPlan;

      // Calculate tax
      const taxCalculation = await this.taxCalculationService.calculateTax(
        paymentPlan.finalPrice,
        customerData.address?.country || 'US',
        customerData.address?.state
      );

      // Prepare invoice data
      const invoiceData: InvoiceData = {
        customerId: userId,
        amount: paymentPlan.finalPrice,
        tax: taxCalculation,
        lineItems: [
          {
            description: `${subscription.tier} Subscription - ${subscription.billingPeriod.type}`,
            quantity: 1,
            unitPrice: paymentPlan.finalPrice,
            totalPrice: paymentPlan.finalPrice
          }
        ],
        billingPeriod: {
          start: subscription.startDate,
          end: subscription.getNextBillingDate()
        },
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
      };

      // Generate invoice
      const invoice = await this.invoiceService.generateInvoice(invoiceData);

      // Send invoice
      await this.invoiceService.sendInvoice(invoice, customerData.email);
      await this.notificationService.sendInvoiceGenerated(userId, invoice);

      return {
        success: true,
        invoice
      };
    } catch (error) {
      return { success: false, error: 'Failed to generate invoice' };
    }
  }

  /**
   * Get billing history for user
   */
  async getBillingHistory(
    userId: string,
    limit: number = 10
  ): Promise<{
    billingRecords: BillingRecord[];
    totalSpent: number;
    pendingCharges: number;
    nextBillingDate?: Date;
  }> {
    const billingHistory = await this.billingRepository.findBillingHistory(userId, limit);
    const pendingCharges = await this.billingRepository.findPendingCharges(userId);

    const totalSpent = billingHistory
      .filter(record => record.status === 'successful' && record.amount > 0)
      .reduce((sum, record) => sum + record.amount, 0);

    const pendingAmount = pendingCharges
      .reduce((sum, record) => sum + record.amount, 0);

    // Calculate next billing date (simplified)
    const nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    return {
      billingRecords: billingHistory,
      totalSpent,
      pendingCharges: pendingAmount,
      nextBillingDate
    };
  }

  /**
   * Calculate pricing with discounts and promotions
   */
  async calculatePricing(
    tier: SubscriptionTier,
    period: PeriodType,
    userId: string,
    promoCode?: string
  ): Promise<{
    basePrice: number;
    discounts: PriceAdjustment[];
    taxCalculation: TaxCalculation;
    finalPrice: number;
    savings: number;
  }> {
    // Get base payment plan
    const paymentPlan = await this.paymentPlanRepository.findByTierAndPeriod(tier, period);
    if (!paymentPlan) {
      throw new Error('Payment plan not found');
    }

    let finalPrice = paymentPlan.basePrice;
    const discounts: PriceAdjustment[] = [];
    let savings = 0;

    // Apply billing period discounts
    const periodDiscount = this.billingDomainService.calculatePeriodDiscount(period, paymentPlan.basePrice);
    if (periodDiscount.amount > 0) {
      discounts.push(periodDiscount);
      finalPrice -= periodDiscount.amount;
      savings += periodDiscount.amount;
    }

    // Apply promotional codes
    if (promoCode) {
      const promoDiscount = this.billingDomainService.validateAndApplyPromoCode(
        promoCode,
        finalPrice,
        tier
      );
      if (promoDiscount.isValid) {
        discounts.push(promoDiscount.adjustment);
        finalPrice -= promoDiscount.adjustment.amount;
        savings += promoDiscount.adjustment.amount;
      }
    }

    // Check for loyalty discounts
    const loyaltyDiscount = await this.calculateLoyaltyDiscount(userId, finalPrice);
    if (loyaltyDiscount.amount > 0) {
      discounts.push(loyaltyDiscount);
      finalPrice -= loyaltyDiscount.amount;
      savings += loyaltyDiscount.amount;
    }

    // Calculate tax on final price
    const taxCalculation = await this.taxCalculationService.calculateTax(finalPrice, 'US');

    return {
      basePrice: paymentPlan.basePrice,
      discounts,
      taxCalculation,
      finalPrice: taxCalculation.totalAmount,
      savings
    };
  }

  /**
   * Get billing analytics and metrics
   */
  async getBillingAnalytics(timeframe: 'day' | 'week' | 'month'): Promise<{
    metrics: BillingMetrics;
    trends: { metric: string; change: number; direction: 'up' | 'down' | 'stable' }[];
    forecasts: { revenue: number; churn: number; growth: number };
    recommendations: string[];
  }> {
    const metrics = await this.analyticsService.calculateMetrics(timeframe);

    // Calculate trends (simplified)
    const trends = [
      { metric: 'Revenue', change: 15.2, direction: 'up' as const },
      { metric: 'Churn Rate', change: -2.1, direction: 'down' as const },
      { metric: 'ARPU', change: 8.7, direction: 'up' as const }
    ];

    // Generate forecasts
    const forecasts = {
      revenue: metrics.totalRevenue * 1.15, // 15% growth
      churn: metrics.churnRate * 0.95, // 5% improvement
      growth: 12.5 // 12.5% projected growth
    };

    // Generate recommendations
    const recommendations: string[] = [];

    if (metrics.churnRate > 5) {
      recommendations.push('High churn rate detected - implement retention campaigns');
    }

    if (metrics.paymentFailureRate > 3) {
      recommendations.push('Payment failure rate above threshold - review payment flows');
    }

    if (metrics.revenueGrowth < 10) {
      recommendations.push('Revenue growth below target - consider pricing optimization');
    }

    return {
      metrics,
      trends,
      forecasts,
      recommendations
    };
  }

  /**
   * Handle payment failure recovery
   */
  async handlePaymentFailure(
    userId: string,
    paymentIntentId: string,
    failureReason: string
  ): Promise<{
    recoveryPlan: {
      retryAttempts: number;
      nextRetryDate: Date;
      alternativePaymentMethods: string[];
      gracePeriodEnd: Date;
    };
    notificationSent: boolean;
  }> {
    // Update billing record with failure
    const billingRecord = await this.billingRepository.findBillingHistory(userId, 1);
    if (billingRecord.length > 0) {
      billingRecord[0].status = 'failed';
      billingRecord[0].failureReason = failureReason;
      await this.billingRepository.saveBillingRecord(billingRecord[0]);
    }

    // Create recovery plan
    const recoveryPlan = {
      retryAttempts: 3,
      nextRetryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      alternativePaymentMethods: ['card', 'bank_transfer', 'paypal'],
      gracePeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days grace period
    };

    // Send failure notification
    await this.notificationService.sendPaymentFailed(userId, failureReason, recoveryPlan.nextRetryDate);

    // Track failure analytics
    await this.analyticsService.trackPaymentFailure(userId, failureReason, billingRecord[0]?.amount || 0);

    return {
      recoveryPlan,
      notificationSent: true
    };
  }

  private async calculateLoyaltyDiscount(userId: string, amount: number): Promise<PriceAdjustment> {
    // Get user's billing history to determine loyalty level
    const billingHistory = await this.billingRepository.findBillingHistory(userId, 50);
    const successfulPayments = billingHistory.filter(record =>
      record.status === 'successful' && record.amount > 0
    );

    // Calculate loyalty discount based on payment history
    if (successfulPayments.length >= 12) {
      // Loyal customer (1+ year) - 10% discount
      return {
        type: 'loyalty_discount',
        description: 'Loyal Customer Discount (1+ year)',
        amount: amount * 0.1,
        percentage: 10
      };
    } else if (successfulPayments.length >= 6) {
      // Regular customer (6+ months) - 5% discount
      return {
        type: 'loyalty_discount',
        description: 'Regular Customer Discount (6+ months)',
        amount: amount * 0.05,
        percentage: 5
      };
    }

    return {
      type: 'loyalty_discount',
      description: 'No loyalty discount applicable',
      amount: 0,
      percentage: 0
    };
  }

  /**
   * Process trial subscription
   */
  async processTrialSubscription(
    userId: string,
    guildId: string,
    tier: SubscriptionTier,
    trialDays: number = 14
  ): Promise<{ success: boolean; subscription?: FeatureSubscription; error?: string }> {
    try {
      // Create trial subscription (stub implementation)
      const subscription = FeatureSubscription.createTrial(userId, guildId, tier, trialDays);
      return { success: true, subscription };
    } catch (error) {
      return { success: false, error: 'Failed to process trial subscription' };
    }
  }

  /**
   * Process subscription upgrade
   */
  async processUpgrade(
    subscription: FeatureSubscription,
    newTier: SubscriptionTier,
    customerData: CustomerData
  ): Promise<{ success: boolean; billingCalculation?: BillingCalculation; error?: string }> {
    try {
      // Calculate upgrade cost
      const remainingDays = subscription.getRemainingDays();
      const currentPlan = subscription.paymentPlan;
      const newPlan = await this.paymentPlanRepository.findByTierAndPeriod(
        newTier,
        subscription.billingPeriod.type
      );

      if (!newPlan) {
        return { success: false, error: 'New plan not found' };
      }

      const billingCalculation = this.billingDomainService.calculateUpgradeCost(
        currentPlan,
        newPlan,
        remainingDays
      );

      return { success: true, billingCalculation };
    } catch (error) {
      return { success: false, error: 'Failed to process upgrade' };
    }
  }

  /**
   * Process subscription downgrade
   */
  async processDowngrade(
    subscription: FeatureSubscription,
    newTier: SubscriptionTier
  ): Promise<{ success: boolean; refundAmount?: number; error?: string }> {
    try {
      // Calculate refund for downgrade (stub implementation)
      const remainingValue = (subscription.paymentPlan.basePrice / 30) * subscription.getRemainingDays();
      const newPlanPrice = this.getEstimatedTierPrice(newTier);
      const refundAmount = Math.max(0, remainingValue - newPlanPrice);

      return { success: true, refundAmount };
    } catch (error) {
      return { success: false, error: 'Failed to process downgrade' };
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    subscription: FeatureSubscription,
    reason: string
  ): Promise<{ success: boolean; refundAmount?: number; error?: string }> {
    try {
      // Calculate refund for cancellation (stub implementation)
      const remainingDays = subscription.getRemainingDays();
      const dailyRate = subscription.paymentPlan.basePrice / 30;
      const refundAmount = dailyRate * remainingDays;

      // Record cancellation
      await this.analyticsService.recordChurn(
        subscription.userId,
        subscription.tier,
        reason
      );

      return { success: true, refundAmount };
    } catch (error) {
      return { success: false, error: 'Failed to cancel subscription' };
    }
  }

  /**
   * Convert trial to paid subscription
   */
  async convertTrialToPaid(
    subscription: FeatureSubscription,
    paymentMethodId: string,
    customerData: CustomerData
  ): Promise<{ success: boolean; billingSetup?: any; error?: string }> {
    try {
      // Convert trial to paid (stub implementation)
      const paymentPlan = await this.paymentPlanRepository.findByTierAndPeriod(
        subscription.tier,
        subscription.billingPeriod.type
      );

      if (!paymentPlan) {
        return { success: false, error: 'Payment plan not found' };
      }

      const billingSetup = {
        customerId: `customer_${subscription.userId}`,
        paymentPlan,
        subscriptionId: subscription.id
      };

      return { success: true, billingSetup };
    } catch (error) {
      return { success: false, error: 'Failed to convert trial to paid' };
    }
  }

  private getEstimatedTierPrice(tier: SubscriptionTier): number {
    const tierPrices = {
      free: 0,
      basic: 9.99,
      premium: 19.99,
      enterprise: 99.99
    };
    return tierPrices[tier] || 0;
  }
}