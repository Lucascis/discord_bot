/**
 * Payment Plan Entity
 * Represents payment plan structure for subscription billing (structure only, no actual payment logic)
 */

import { SubscriptionTier } from '@discord-bot/config';
import { BillingPeriod } from '../value-objects/billing-period.js';

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';
export type PaymentMethod = 'credit_card' | 'paypal' | 'bank_transfer' | 'crypto' | 'voucher' | 'trial';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';

export interface PriceChange {
  readonly id: string;
  readonly fromPrice: number;
  readonly toPrice: number;
  readonly effectiveDate: Date;
  readonly reason: string;
  readonly appliedAt?: Date;
}

export interface BillingTrigger {
  readonly type: 'subscription_start' | 'billing_cycle' | 'usage_threshold' | 'manual_adjustment';
  readonly description: string;
  readonly scheduledAt: Date;
  readonly executedAt?: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface PaymentSchedule {
  nextPaymentDate: Date;
  readonly amount: number;
  readonly currency: Currency;
  attempts: number;
  readonly maxAttempts: number;
  readonly retryInterval: number; // hours
}

export interface PlanPricing {
  readonly basePrice: number;
  readonly currency: Currency;
  readonly discountPercentage: number;
  readonly taxRate: number;
  readonly totalPrice: number;
  readonly effectiveMonthlyPrice: number;
}

export interface PaymentHistory {
  readonly id: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly status: PaymentStatus;
  readonly method: PaymentMethod;
  readonly processedAt: Date;
  readonly failureReason?: string;
  readonly refundedAt?: Date;
  readonly refundAmount?: number;
}

export class PaymentPlan {
  constructor(
    private readonly _id: string,
    private readonly _name: string,
    private readonly _tier: SubscriptionTier,
    private readonly _billingPeriod: BillingPeriod,
    private readonly _pricing: PlanPricing,
    private _paymentSchedule: PaymentSchedule | null = null,
    private _paymentHistory: PaymentHistory[] = [],
    private _preferredMethod: PaymentMethod = 'credit_card',
    private _status: PaymentStatus = 'pending',
    private _isActive: boolean = true,
    private readonly _createdAt: Date = new Date(),
    private _updatedAt: Date = new Date(),
    private _activatedAt: Date | null = null,
    private _cancelledAt: Date | null = null
  ) {
    this.validatePaymentPlan();
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get tier(): SubscriptionTier {
    return this._tier;
  }

  get billingPeriod(): BillingPeriod {
    return this._billingPeriod;
  }

  get pricing(): PlanPricing {
    return this._pricing;
  }

  get paymentSchedule(): PaymentSchedule | null {
    return this._paymentSchedule;
  }

  get paymentHistory(): PaymentHistory[] {
    return [...this._paymentHistory];
  }

  get preferredMethod(): PaymentMethod {
    return this._preferredMethod;
  }

  get status(): PaymentStatus {
    return this._status;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get activatedAt(): Date | null {
    return this._activatedAt;
  }

  get cancelledAt(): Date | null {
    return this._cancelledAt;
  }

  get isRecurring(): boolean {
    return this._billingPeriod.isRecurring;
  }

  get basePrice(): number {
    return this._pricing.basePrice;
  }

  get finalPrice(): number {
    return this._pricing.totalPrice;
  }

  get lastBillingAt(): Date | null {
    return this._activatedAt;
  }

  get isTrial(): boolean {
    return this._billingPeriod.isTrial;
  }

  get isLifetime(): boolean {
    return this._billingPeriod.isLifetime;
  }

  get totalAmountPaid(): number {
    return this._paymentHistory
      .filter(payment => payment.status === 'completed')
      .reduce((sum, payment) => sum + payment.amount, 0);
  }

  get failedPaymentsCount(): number {
    return this._paymentHistory.filter(payment => payment.status === 'failed').length;
  }

  get lastSuccessfulPayment(): PaymentHistory | null {
    const successfulPayments = this._paymentHistory
      .filter(payment => payment.status === 'completed')
      .sort((a, b) => b.processedAt.getTime() - a.processedAt.getTime());

    return successfulPayments[0] || null;
  }

  get nextPaymentAmount(): number {
    return this._paymentSchedule?.amount || this._pricing.totalPrice;
  }

  get daysUntilNextPayment(): number {
    if (!this._paymentSchedule) return -1;

    const diffMs = this._paymentSchedule.nextPaymentDate.getTime() - new Date().getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Update preferred payment method
   */
  updatePaymentMethod(method: PaymentMethod): void {
    this._preferredMethod = method;
    this._updatedAt = new Date();
  }

  /**
   * Schedule next payment
   */
  schedulePayment(paymentDate: Date, amount: number, currency: Currency = 'USD'): void {
    if (paymentDate <= new Date()) {
      throw new Error('Payment date must be in the future');
    }

    this._paymentSchedule = {
      nextPaymentDate: paymentDate,
      amount,
      currency,
      attempts: 0,
      maxAttempts: 3,
      retryInterval: 24
    };

    this._updatedAt = new Date();
  }

  /**
   * Add payment to history (structure only - no actual payment processing)
   */
  recordPayment(
    amount: number,
    currency: Currency,
    method: PaymentMethod,
    status: PaymentStatus = 'completed'
  ): PaymentHistory {
    const payment: PaymentHistory = {
      id: `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      amount,
      currency,
      status,
      method,
      processedAt: new Date(),
      ...(status === 'failed' && { failureReason: 'Simulated failure - no actual payment processing' })
    };

    this._paymentHistory.push(payment);
    this._status = status;
    this._updatedAt = new Date();

    if (status === 'completed' && !this._activatedAt) {
      this._activatedAt = new Date();
    }

    return payment;
  }

  /**
   * Process scheduled payment (simulation only)
   */
  processScheduledPayment(): PaymentHistory {
    if (!this._paymentSchedule) {
      throw new Error('No payment scheduled');
    }

    if (this._paymentSchedule.nextPaymentDate > new Date()) {
      throw new Error('Payment date has not arrived yet');
    }

    // Simulate payment processing
    const simulatedSuccess = Math.random() > 0.1; // 90% success rate
    const status: PaymentStatus = simulatedSuccess ? 'completed' : 'failed';

    const payment = this.recordPayment(
      this._paymentSchedule.amount,
      this._paymentSchedule.currency,
      this._preferredMethod,
      status
    );

    if (status === 'completed') {
      // Schedule next payment for recurring plans
      if (this.isRecurring) {
        const nextDate = this._billingPeriod.getNextBillingDate(new Date());
        if (nextDate) {
          this.schedulePayment(nextDate, this._pricing.totalPrice, this._pricing.currency);
        }
      } else {
        this._paymentSchedule = null;
      }
    } else {
      // Handle failed payment
      this._paymentSchedule.attempts++;
      if (this._paymentSchedule.attempts < this._paymentSchedule.maxAttempts) {
        // Schedule retry
        const retryDate = new Date();
        retryDate.setHours(retryDate.getHours() + this._paymentSchedule.retryInterval);
        this._paymentSchedule.nextPaymentDate = retryDate;
      } else {
        // Max attempts reached
        this._status = 'failed';
        this._paymentSchedule = null;
      }
    }

    return payment;
  }

  /**
   * Request refund (structure only)
   */
  requestRefund(paymentId: string, amount?: number): PaymentHistory {
    const originalPayment = this._paymentHistory.find(p => p.id === paymentId);
    if (!originalPayment) {
      throw new Error('Payment not found');
    }

    if (originalPayment.status !== 'completed') {
      throw new Error('Can only refund completed payments');
    }

    const refundAmount = amount || originalPayment.amount;
    if (refundAmount > originalPayment.amount) {
      throw new Error('Refund amount cannot exceed original payment amount');
    }

    const refund: PaymentHistory = {
      id: `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      amount: -refundAmount, // Negative amount for refund
      currency: originalPayment.currency,
      status: 'refunded',
      method: originalPayment.method,
      processedAt: new Date(),
      refundedAt: new Date(),
      refundAmount
    };

    this._paymentHistory.push(refund);
    this._updatedAt = new Date();

    return refund;
  }

  /**
   * Cancel payment plan
   */
  cancel(_reason: string = 'User requested'): void {
    this._isActive = false;
    this._status = 'cancelled';
    this._cancelledAt = new Date();
    this._paymentSchedule = null;
    this._updatedAt = new Date();
  }

  /**
   * Reactivate cancelled plan
   */
  reactivate(): void {
    if (this._status !== 'cancelled') {
      throw new Error('Can only reactivate cancelled plans');
    }

    this._isActive = true;
    this._status = 'pending';
    this._cancelledAt = null;
    this._updatedAt = new Date();

    // Reschedule next payment for recurring plans
    if (this.isRecurring) {
      const nextDate = this._billingPeriod.getNextBillingDate(new Date());
      if (nextDate) {
        this.schedulePayment(nextDate, this._pricing.totalPrice, this._pricing.currency);
      }
    }
  }

  /**
   * Calculate proration for plan changes
   */
  calculateProration(newPricing: PlanPricing, changeDate: Date = new Date()): number {
    if (!this._billingPeriod.allowsProration()) {
      return 0;
    }

    const lastPayment = this.lastSuccessfulPayment;
    if (!lastPayment) {
      return newPricing.totalPrice;
    }

    const billingCycleDays = this._billingPeriod.type === 'monthly' ? 30 : 90;
    const daysSinceLastPayment = Math.floor(
      (changeDate.getTime() - lastPayment.processedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    const remainingDays = Math.max(0, billingCycleDays - daysSinceLastPayment);
    const currentDailyRate = this._pricing.totalPrice / billingCycleDays;
    const newDailyRate = newPricing.totalPrice / billingCycleDays;

    const refundForRemaining = remainingDays * currentDailyRate;
    const chargeForRemaining = remainingDays * newDailyRate;

    return chargeForRemaining - refundForRemaining;
  }

  /**
   * Get payment plan statistics
   */
  getPaymentStatistics(): {
    totalPaid: number;
    totalRefunded: number;
    successfulPayments: number;
    failedPayments: number;
    averagePaymentAmount: number;
    paymentReliability: number;
  } {
    const successfulPayments = this._paymentHistory.filter(p => p.status === 'completed');
    const failedPayments = this._paymentHistory.filter(p => p.status === 'failed');
    const refunds = this._paymentHistory.filter(p => p.status === 'refunded');

    const totalPaid = successfulPayments.reduce((sum, p) => sum + p.amount, 0);
    const totalRefunded = Math.abs(refunds.reduce((sum, p) => sum + p.amount, 0));
    const averagePaymentAmount = successfulPayments.length > 0
      ? totalPaid / successfulPayments.length
      : 0;

    const totalAttempts = successfulPayments.length + failedPayments.length;
    const paymentReliability = totalAttempts > 0
      ? (successfulPayments.length / totalAttempts) * 100
      : 0;

    return {
      totalPaid,
      totalRefunded,
      successfulPayments: successfulPayments.length,
      failedPayments: failedPayments.length,
      averagePaymentAmount,
      paymentReliability
    };
  }

  private validatePaymentPlan(): void {
    if (!this._name || this._name.trim().length === 0) {
      throw new Error('Payment plan name cannot be empty');
    }

    if (this._pricing.basePrice < 0) {
      throw new Error('Base price cannot be negative');
    }

    if (this._pricing.discountPercentage < 0 || this._pricing.discountPercentage > 100) {
      throw new Error('Discount percentage must be between 0 and 100');
    }

    if (this._pricing.taxRate < 0 || this._pricing.taxRate > 100) {
      throw new Error('Tax rate must be between 0 and 100');
    }

    if (this._paymentSchedule && this._paymentSchedule.nextPaymentDate <= new Date()) {
      throw new Error('Scheduled payment date cannot be in the past');
    }
  }

  /**
   * Create payment plan for subscription tier
   */
  static createForTier(
    tier: SubscriptionTier,
    billingPeriod: BillingPeriod,
    basePrice: number,
    currency: Currency = 'USD',
    taxRate: number = 0
  ): PaymentPlan {
    const discountPercentage = billingPeriod.discountPercentage;
    const discountMultiplier = (100 - discountPercentage) / 100;
    const taxMultiplier = (100 + taxRate) / 100;

    const totalPrice = basePrice * discountMultiplier * taxMultiplier;
    const effectiveMonthlyPrice = billingPeriod.getEffectiveMonthlyPrice();

    const pricing: PlanPricing = {
      basePrice,
      currency,
      discountPercentage,
      taxRate,
      totalPrice,
      effectiveMonthlyPrice
    };

    const id = `plan_${tier}_${billingPeriod.type}_${Date.now()}`;
    const name = `${tier.charAt(0).toUpperCase() + tier.slice(1)} ${billingPeriod.type} Plan`;

    return new PaymentPlan(id, name, tier, billingPeriod, pricing);
  }

  /**
   * Create trial payment plan
   */
  static createTrial(tier: SubscriptionTier, trialDays: number = 14): PaymentPlan {
    const billingPeriod = BillingPeriod.create('trial', 0);
    const pricing: PlanPricing = {
      basePrice: 0,
      currency: 'USD',
      discountPercentage: 100,
      taxRate: 0,
      totalPrice: 0,
      effectiveMonthlyPrice: 0
    };

    const id = `trial_${tier}_${Date.now()}`;
    const name = `${tier.charAt(0).toUpperCase() + tier.slice(1)} Trial`;

    const plan = new PaymentPlan(id, name, tier, billingPeriod, pricing);
    plan._preferredMethod = 'trial';
    plan._status = 'completed';
    plan._activatedAt = new Date();

    return plan;
  }

  equals(other: PaymentPlan): boolean {
    return this._id === other._id;
  }

  toString(): string {
    return `PaymentPlan(${this._tier}, ${this._billingPeriod.type}, $${this._pricing.totalPrice}, ${this._status})`;
  }

  toJSON(): {
    id: string;
    name: string;
    tier: SubscriptionTier;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    billingPeriod: any;
    pricing: PlanPricing;
    status: PaymentStatus;
    isActive: boolean;
    isRecurring: boolean;
    isTrial: boolean;
    isLifetime: boolean;
    nextPaymentAmount: number;
    daysUntilNextPayment: number;
    totalAmountPaid: number;
    failedPaymentsCount: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    paymentStatistics: any;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: this._id,
      name: this._name,
      tier: this._tier,
      billingPeriod: this._billingPeriod.toJSON(),
      pricing: this._pricing,
      status: this._status,
      isActive: this._isActive,
      isRecurring: this.isRecurring,
      isTrial: this.isTrial,
      isLifetime: this.isLifetime,
      nextPaymentAmount: this.nextPaymentAmount,
      daysUntilNextPayment: this.daysUntilNextPayment,
      totalAmountPaid: this.totalAmountPaid,
      failedPaymentsCount: this.failedPaymentsCount,
      paymentStatistics: this.getPaymentStatistics(),
      createdAt: this._createdAt,
      updatedAt: this._updatedAt
    };
  }
}