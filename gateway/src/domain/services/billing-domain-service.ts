/**
 * Billing Domain Service
 * Contains domain logic for billing calculations, pricing strategies, and financial operations
 * Note: This is structure only - no actual payment processing
 */

import { SubscriptionTier } from '@discord-bot/config';
import { BillingPeriod, PeriodType } from '../value-objects/billing-period.js';
import { PaymentPlan, Currency } from '../entities/payment-plan.js';
import { FeatureSubscription } from '../entities/feature-subscription.js';
import { Customer } from '../entities/customer.js';
import { QuotaType } from '../value-objects/usage-quota.js';

export interface PricingCalculation {
  readonly basePrice: number;
  readonly discount: number;
  readonly taxes: number;
  readonly fees: number;
  readonly totalPrice: number;
  readonly currency: Currency;
  readonly breakdown: PriceBreakdown[];
  readonly prorationAmount?: number;
}

// Alias for compatibility
export interface BillingCalculation extends PricingCalculation {}

export interface PriceAdjustment {
  readonly type: 'discount' | 'surcharge' | 'tax' | 'fee' | 'loyalty_discount';
  readonly amount: number;
  readonly percentage?: number;
  readonly reason?: string;
  readonly description?: string;
  readonly appliedAt?: Date;
}

export interface InvoiceGeneration {
  readonly invoiceId: string;
  readonly totalAmount: number;
  readonly itemizedCharges: PriceBreakdown[];
  readonly taxDetails: PriceAdjustment[];
  readonly generatedAt: Date;
  readonly dueDate: Date;
}

export interface PriceBreakdown {
  readonly item: string;
  readonly amount: number;
  readonly type: 'base' | 'discount' | 'tax' | 'fee' | 'credit';
}

export interface ProrationResult {
  readonly daysUsed: number;
  readonly daysRemaining: number;
  readonly currentPeriodCharge: number;
  readonly refundAmount: number;
  readonly netAmount: number;
  readonly effectiveDate: Date;
}

export interface PricingStrategy {
  readonly strategyName: string;
  readonly basePrice: number;
  readonly tierMultiplier: number;
  readonly volumeDiscounts: VolumeDiscount[];
  readonly promotionalRates: PromotionalRate[];
}

export interface VolumeDiscount {
  readonly minServers: number;
  readonly discountPercentage: number;
  readonly description: string;
}

export interface PromotionalRate {
  readonly code: string;
  readonly discountPercentage: number;
  readonly validUntil: Date;
  readonly restrictions: string[];
}

export interface BillingForecast {
  readonly period: 'month' | 'quarter' | 'year';
  readonly estimatedRevenue: number;
  readonly customerGrowth: number;
  readonly churnImpact: number;
  readonly seasonalAdjustment: number;
  readonly confidence: number;
}

export class BillingDomainService {

  /**
   * Calculates comprehensive pricing for a subscription
   */
  calculatePricing(
    tier: SubscriptionTier,
    billingPeriod: BillingPeriod,
    serverCount: number = 1,
    region: string = 'US',
    promotionalCode?: string
  ): PricingCalculation {
    const basePrice = this.getBasePriceForTier(tier, billingPeriod.type);
    const breakdown: PriceBreakdown[] = [];

    // Base price
    breakdown.push({
      item: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Subscription`,
      amount: basePrice,
      type: 'base'
    });

    let totalPrice = basePrice;

    // Volume discounts for multiple servers
    const volumeDiscount = this.calculateVolumeDiscount(tier, serverCount);
    if (volumeDiscount > 0) {
      const discountAmount = (basePrice * volumeDiscount) / 100;
      breakdown.push({
        item: `Volume Discount (${serverCount} servers)`,
        amount: -discountAmount,
        type: 'discount'
      });
      totalPrice -= discountAmount;
    }

    // Billing period discount
    const periodDiscount = billingPeriod.discountPercentage;
    if (periodDiscount > 0) {
      const discountAmount = (totalPrice * periodDiscount) / 100;
      breakdown.push({
        item: `${billingPeriod.type} billing discount`,
        amount: -discountAmount,
        type: 'discount'
      });
      totalPrice -= discountAmount;
    }

    // Promotional code discount
    let promoDiscount = 0;
    if (promotionalCode) {
      promoDiscount = this.validateAndCalculatePromoDiscount(promotionalCode, tier, totalPrice);
      if (promoDiscount > 0) {
        breakdown.push({
          item: `Promotional Code: ${promotionalCode}`,
          amount: -promoDiscount,
          type: 'discount'
        });
        totalPrice -= promoDiscount;
      }
    }

    // Tax calculation
    const taxRate = this.getTaxRate(region);
    const taxAmount = (totalPrice * taxRate) / 100;
    if (taxAmount > 0) {
      breakdown.push({
        item: `Tax (${region})`,
        amount: taxAmount,
        type: 'tax'
      });
      totalPrice += taxAmount;
    }

    // Processing fees for small amounts
    const processingFee = this.calculateProcessingFee(totalPrice);
    if (processingFee > 0) {
      breakdown.push({
        item: 'Processing Fee',
        amount: processingFee,
        type: 'fee'
      });
      totalPrice += processingFee;
    }

    return {
      basePrice,
      discount: volumeDiscount + periodDiscount + (promoDiscount > 0 ? (promoDiscount / basePrice) * 100 : 0),
      taxes: taxAmount,
      fees: processingFee,
      totalPrice: Math.round(totalPrice * 100) / 100, // Round to 2 decimal places
      currency: 'USD',
      breakdown
    };
  }

  /**
   * Calculates proration for subscription changes
   */
  calculateProration(
    currentPlan: PaymentPlan,
    newTier: SubscriptionTier,
    newBillingPeriod: BillingPeriod,
    changeDate: Date = new Date()
  ): ProrationResult {
    const currentBilling = currentPlan.billingPeriod;
    const lastBillingDate = currentPlan.lastBillingAt || currentPlan.createdAt;

    // Calculate period information
    const periodLengthMs = this.getPeriodLengthMs(currentBilling.type);
    const periodStartDate = lastBillingDate;
    const periodEndDate = new Date(periodStartDate.getTime() + periodLengthMs);

    const totalDays = Math.ceil(periodLengthMs / (1000 * 60 * 60 * 24));
    const usedMs = changeDate.getTime() - periodStartDate.getTime();
    const daysUsed = Math.max(0, Math.ceil(usedMs / (1000 * 60 * 60 * 24)));
    const daysRemaining = Math.max(0, totalDays - daysUsed);

    // Calculate prorated amounts
    const currentDailyRate = currentPlan.pricing.totalPrice / totalDays;
    const currentPeriodCharge = currentDailyRate * daysUsed;

    const newPricing = this.calculatePricing(newTier, newBillingPeriod);
    const newDailyRate = newPricing.totalPrice / totalDays;
    const newPeriodCharge = newDailyRate * daysRemaining;

    const refundAmount = Math.max(0, currentDailyRate * daysRemaining);
    const netAmount = newPeriodCharge - refundAmount;

    return {
      daysUsed,
      daysRemaining,
      currentPeriodCharge,
      refundAmount,
      netAmount: Math.round(netAmount * 100) / 100,
      effectiveDate: changeDate
    };
  }

  /**
   * Calculates overage charges for quota usage
   */
  calculateOverageCharges(
    subscription: FeatureSubscription,
    quotaOverages: Map<QuotaType, number>
  ): { totalCharges: number; itemizedCharges: Map<QuotaType, number>; description: string } {
    const itemizedCharges = new Map<QuotaType, number>();
    let totalCharges = 0;

    const overageRates = this.getOverageRates(subscription.tier);

    for (const [quotaType, overageAmount] of quotaOverages.entries()) {
      const rate = overageRates.get(quotaType) || 0;
      const charge = overageAmount * rate;

      if (charge > 0) {
        itemizedCharges.set(quotaType, charge);
        totalCharges += charge;
      }
    }

    const description = totalCharges > 0
      ? `Overage charges for ${Array.from(quotaOverages.keys()).join(', ')}`
      : 'No overage charges';

    return {
      totalCharges: Math.round(totalCharges * 100) / 100,
      itemizedCharges,
      description
    };
  }

  /**
   * Validates and calculates pricing strategy effectiveness
   */
  evaluatePricingStrategy(
    strategy: PricingStrategy,
    marketData: {
      competitorPrices: number[];
      demandElasticity: number;
      customerAcquisitionCost: number;
      lifetimeValue: number;
    }
  ): {
    competitiveness: number;
    profitability: number;
    marketPosition: 'low' | 'medium' | 'high' | 'premium';
    recommendations: string[];
  } {
    const avgCompetitorPrice = marketData.competitorPrices.reduce((sum, price) => sum + price, 0) / marketData.competitorPrices.length;

    // Calculate competitiveness (0-100)
    const priceDifference = (strategy.basePrice - avgCompetitorPrice) / avgCompetitorPrice;
    const competitiveness = Math.max(0, Math.min(100, 100 - (priceDifference * 50)));

    // Calculate profitability
    const estimatedMargin = (strategy.basePrice - marketData.customerAcquisitionCost) / strategy.basePrice;
    const profitability = Math.max(0, Math.min(100, estimatedMargin * 100));

    // Determine market position
    let marketPosition: 'low' | 'medium' | 'high' | 'premium' = 'medium';
    if (strategy.basePrice < avgCompetitorPrice * 0.8) {
      marketPosition = 'low';
    } else if (strategy.basePrice > avgCompetitorPrice * 1.5) {
      marketPosition = 'premium';
    } else if (strategy.basePrice > avgCompetitorPrice * 1.2) {
      marketPosition = 'high';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (competitiveness < 50) {
      recommendations.push('Consider reducing prices to improve competitiveness');
    }
    if (profitability < 30) {
      recommendations.push('Increase prices or reduce acquisition costs to improve profitability');
    }
    if (marketPosition === 'premium' && competitiveness > 80) {
      recommendations.push('Strong premium positioning - consider value-added services');
    }

    return {
      competitiveness,
      profitability,
      marketPosition,
      recommendations
    };
  }

  /**
   * Generates billing forecast based on subscription trends
   */
  generateBillingForecast(
    historicalData: {
      monthlyRevenue: number[];
      customerCount: number[];
      churnRate: number[];
    },
    period: 'month' | 'quarter' | 'year'
  ): BillingForecast {
    const recentRevenue = historicalData.monthlyRevenue.slice(-6);
    const recentCustomers = historicalData.customerCount.slice(-6);
    const recentChurn = historicalData.churnRate.slice(-6);

    // Calculate growth trends
    const revenueGrowth = this.calculateGrowthTrend(recentRevenue);
    const customerGrowth = this.calculateGrowthTrend(recentCustomers);
    const avgChurnRate = recentChurn.reduce((sum, rate) => sum + rate, 0) / recentChurn.length;

    // Project forward
    const monthsToProject = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;
    const lastRevenue = recentRevenue[recentRevenue.length - 1];

    let estimatedRevenue = lastRevenue;
    for (let i = 0; i < monthsToProject; i++) {
      estimatedRevenue *= (1 + revenueGrowth / 100);
    }

    // Apply churn impact
    const churnImpact = estimatedRevenue * (avgChurnRate / 100);
    estimatedRevenue -= churnImpact;

    // Apply seasonal adjustment
    const seasonalAdjustment = this.getSeasonalAdjustment(period);
    estimatedRevenue *= (1 + seasonalAdjustment / 100);

    // Calculate confidence based on data consistency
    const revenueVariability = this.calculateVariability(recentRevenue);
    const confidence = Math.max(50, 100 - (revenueVariability * 2));

    return {
      period,
      estimatedRevenue: Math.round(estimatedRevenue * 100) / 100,
      customerGrowth,
      churnImpact,
      seasonalAdjustment,
      confidence
    };
  }

  /**
   * Optimizes billing cycles based on customer behavior
   */
  optimizeBillingCycle(
    customer: Customer,
    paymentHistory: {
      onTimePayments: number;
      latePayments: number;
      failedPayments: number;
      preferredPaymentDay: number;
    },
    cashFlowRequirements: {
      monthlyTargets: boolean;
      quarterlyReporting: boolean;
      annualBudgeting: boolean;
    }
  ): {
    recommendedCycle: PeriodType;
    incentives: string[];
    riskFactors: string[];
    confidence: number;
  } {
    const paymentReliability = paymentHistory.onTimePayments /
      (paymentHistory.onTimePayments + paymentHistory.latePayments + paymentHistory.failedPayments);

    let recommendedCycle: PeriodType = 'monthly';
    const incentives: string[] = [];
    const riskFactors: string[] = [];
    let confidence = 70;

    // High reliability customers can benefit from annual billing
    if (paymentReliability > 0.95 && customer.subscriptionPlan.type !== 'free') {
      recommendedCycle = 'yearly';
      incentives.push('15% annual discount');
      incentives.push('Simplified billing');
      confidence = 90;
    }
    // Medium reliability suggests quarterly
    else if (paymentReliability > 0.85) {
      recommendedCycle = 'quarterly';
      incentives.push('5% quarterly discount');
      confidence = 80;
    }
    // Low reliability stays monthly
    else {
      if (paymentHistory.failedPayments > 2) {
        riskFactors.push('History of failed payments');
      }
      if (paymentHistory.latePayments > 3) {
        riskFactors.push('Frequent late payments');
      }
      confidence = 60;
    }

    // Consider cash flow requirements
    if (cashFlowRequirements.monthlyTargets && recommendedCycle !== 'monthly') {
      riskFactors.push('Monthly cash flow targets may be impacted');
    }

    return {
      recommendedCycle,
      incentives,
      riskFactors,
      confidence
    };
  }

  private getBasePriceForTier(tier: SubscriptionTier, period: PeriodType): number {
    const monthlyPrices = {
      free: 0,
      basic: 9.99,
      premium: 19.99,
      enterprise: 99.99
    };

    const basePrice = monthlyPrices[tier];

    // Adjust for billing period
    switch (period) {
      case 'quarterly':
        return basePrice * 3;
      case 'yearly':
        return basePrice * 12;
      case 'lifetime':
        return basePrice * 24; // 2 years worth
      case 'trial':
        return 0;
      default:
        return basePrice;
    }
  }

  private calculateVolumeDiscount(tier: SubscriptionTier, serverCount: number): number {
    if (tier === 'free' || serverCount < 2) return 0;

    const discountTiers = [
      { min: 5, discount: 10 },   // 10% for 5+ servers
      { min: 10, discount: 15 },  // 15% for 10+ servers
      { min: 25, discount: 20 },  // 20% for 25+ servers
      { min: 50, discount: 25 },  // 25% for 50+ servers
    ];

    for (let i = discountTiers.length - 1; i >= 0; i--) {
      if (serverCount >= discountTiers[i].min) {
        return discountTiers[i].discount;
      }
    }

    return 0;
  }

  private validateAndCalculatePromoDiscount(code: string, tier: SubscriptionTier, totalPrice: number): number {
    // Simulated promotional codes
    const promoCodes = {
      'WELCOME20': { discount: 20, minTier: 'basic', maxDiscount: 50 },
      'STUDENT50': { discount: 50, minTier: 'basic', maxDiscount: 100 },
      'ENTERPRISE10': { discount: 10, minTier: 'enterprise', maxDiscount: 200 }
    };

    const promo = promoCodes[code as keyof typeof promoCodes];
    if (!promo) return 0;

    const tierOrder: SubscriptionTier[] = ['free', 'basic', 'premium', 'enterprise'];
    const tierIndex = tierOrder.indexOf(tier);
    const requiredTierIndex = tierOrder.indexOf(promo.minTier as SubscriptionTier);

    if (tierIndex < requiredTierIndex) return 0;

    const discountAmount = (totalPrice * promo.discount) / 100;
    return Math.min(discountAmount, promo.maxDiscount);
  }

  private getTaxRate(region: string): number {
    const taxRates = {
      'US': 8.5,
      'EU': 20,
      'CA': 13,
      'AU': 10,
      'JP': 10,
      'GB': 20
    };

    return taxRates[region as keyof typeof taxRates] || 0;
  }

  private calculateProcessingFee(amount: number): number {
    // Small processing fee for amounts under $10
    if (amount < 10) {
      return 0.30; // Fixed fee
    }
    return 0; // No fee for larger amounts
  }

  private getPeriodLengthMs(period: PeriodType): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    switch (period) {
      case 'monthly':
        return 30 * msPerDay;
      case 'quarterly':
        return 90 * msPerDay;
      case 'yearly':
        return 365 * msPerDay;
      default:
        return 30 * msPerDay;
    }
  }

  private getOverageRates(tier: SubscriptionTier): Map<QuotaType, number> {
    const rates = new Map<QuotaType, number>();

    // Base overage rates (per unit)
    const baseRates = {
      api_requests: 0.001,        // $0.001 per request
      storage_mb: 0.01,           // $0.01 per MB
      ai_recommendations: 0.05,   // $0.05 per recommendation
      voice_commands: 0.02,       // $0.02 per command
    };

    // Tier multipliers (premium users pay less for overages)
    const tierMultipliers = {
      free: 2.0,
      basic: 1.5,
      premium: 1.0,
      enterprise: 0.5
    };

    const multiplier = tierMultipliers[tier];

    for (const [quotaType, baseRate] of Object.entries(baseRates)) {
      rates.set(quotaType as QuotaType, baseRate * multiplier);
    }

    return rates;
  }

  private calculateGrowthTrend(values: number[]): number {
    if (values.length < 2) return 0;

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;

    return firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
  }

  private getSeasonalAdjustment(period: 'month' | 'quarter' | 'year'): number {
    const currentMonth = new Date().getMonth();

    // Simple seasonal adjustments (could be more sophisticated)
    const monthlyAdjustments = [
      -5,  // January (post-holiday decline)
      -3,  // February
      2,   // March
      1,   // April
      3,   // May
      5,   // June (summer uptick)
      3,   // July
      2,   // August
      4,   // September (back-to-school)
      6,   // October
      8,   // November (pre-holiday)
      -2   // December (holidays)
    ];

    if (period === 'month') {
      return monthlyAdjustments[currentMonth];
    }

    // For longer periods, average the seasonal effects
    return 2; // Minimal seasonal impact for longer periods
  }

  private calculateVariability(values: number[]): number {
    if (values.length < 2) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const standardDeviation = Math.sqrt(variance);

    return mean > 0 ? (standardDeviation / mean) * 100 : 0;
  }

  /**
   * Calculate upgrade cost for subscription change
   */
  calculateUpgradeCost(
    currentPlan: PaymentPlan,
    targetPlan: PaymentPlan,
    remainingDays: number
  ): PricingCalculation {
    const currentDailyCost = currentPlan.finalPrice / 30; // Assuming monthly basis
    const targetDailyCost = targetPlan.finalPrice / 30;
    const proratedCurrent = currentDailyCost * remainingDays;
    const proratedTarget = targetDailyCost * remainingDays;
    const upgradeCost = Math.max(0, proratedTarget - proratedCurrent);

    return {
      basePrice: upgradeCost,
      discount: 0,
      taxes: upgradeCost * 0.1, // 10% tax estimation
      fees: 0,
      totalPrice: upgradeCost * 1.1,
      currency: currentPlan.pricing.currency,
      breakdown: [
        { item: 'Upgrade cost', amount: upgradeCost, type: 'base' },
        { item: 'Tax', amount: upgradeCost * 0.1, type: 'tax' }
      ]
    };
  }

  /**
   * Calculate period discount
   */
  calculatePeriodDiscount(period: PeriodType, basePrice: number): PriceAdjustment {
    const discounts = {
      monthly: 0,
      quarterly: 0.05,
      yearly: 0.15,
      biannual: 0.10
    };

    const discountPercentage = discounts[period] || 0;
    const amount = basePrice * discountPercentage;

    return {
      type: 'discount',
      amount,
      percentage: discountPercentage * 100,
      description: `${period} billing discount`,
      appliedAt: new Date()
    };
  }

  /**
   * Validate and apply promo code
   */
  validateAndApplyPromoCode(
    promoCode: string,
    finalPrice: number,
    tier: SubscriptionTier
  ): { isValid: boolean; adjustment: PriceAdjustment; discount?: number; reason?: string } {
    // Simple validation logic
    const promoCodes: Record<string, { discount: number; validUntil: Date; usageLimit?: number }> = {
      'WELCOME20': { discount: 0.20, validUntil: new Date('2024-12-31') },
      'SAVE15': { discount: 0.15, validUntil: new Date('2024-12-31') },
      'STUDENT': { discount: 0.50, validUntil: new Date('2024-12-31') }
    };

    const promo = promoCodes[promoCode.toUpperCase()];

    if (!promo) {
      return {
        isValid: false,
        adjustment: { type: 'discount', amount: 0, description: 'Invalid promo code' },
        reason: 'Invalid promo code'
      };
    }

    if (new Date() > promo.validUntil) {
      return {
        isValid: false,
        adjustment: { type: 'discount', amount: 0, description: 'Expired promo code' },
        reason: 'Promo code has expired'
      };
    }

    const discountAmount = finalPrice * promo.discount;

    return {
      isValid: true,
      adjustment: {
        type: 'discount',
        amount: discountAmount,
        percentage: promo.discount * 100,
        description: `Promo code: ${promoCode}`,
        appliedAt: new Date()
      },
      discount: discountAmount
    };
  }
}