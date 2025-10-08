/**
 * Billing Period Value Object
 * Represents subscription billing cycles and payment periods
 */

export type PeriodType = 'monthly' | 'quarterly' | 'yearly' | 'lifetime' | 'trial';

export interface PeriodCalculation {
  readonly months: number;
  readonly discountPercentage: number;
  readonly effectiveMonthlyPrice: number;
  readonly totalPrice: number;
}

export class BillingPeriod {
  private static readonly PERIOD_CONFIGS: Record<PeriodType, { months: number; discountPercentage: number }> = {
    monthly: { months: 1, discountPercentage: 0 },
    quarterly: { months: 3, discountPercentage: 5 },    // 5% discount
    yearly: { months: 12, discountPercentage: 15 },     // 15% discount
    lifetime: { months: -1, discountPercentage: 0 },    // No discount, special pricing
    trial: { months: 0, discountPercentage: 100 }       // 100% discount (free)
  };

  constructor(
    private readonly _type: PeriodType,
    private readonly _baseMonthlyPrice: number
  ) {
    this.validatePeriod(_type);
    this.validatePrice(_baseMonthlyPrice);
  }

  get type(): PeriodType {
    return this._type;
  }

  get baseMonthlyPrice(): number {
    return this._baseMonthlyPrice;
  }

  get months(): number {
    return BillingPeriod.PERIOD_CONFIGS[this._type].months;
  }

  get discountPercentage(): number {
    return BillingPeriod.PERIOD_CONFIGS[this._type].discountPercentage;
  }

  get isRecurring(): boolean {
    return this._type !== 'lifetime' && this._type !== 'trial';
  }

  get isTrial(): boolean {
    return this._type === 'trial';
  }

  get isLifetime(): boolean {
    return this._type === 'lifetime';
  }

  /**
   * Calculate total price for this billing period
   */
  getTotalPrice(): number {
    if (this._type === 'trial') return 0;
    if (this._type === 'lifetime') {
      // Lifetime pricing: typically 20x monthly price with additional discount
      return this._baseMonthlyPrice * 20 * 0.8; // 20% additional discount
    }

    const discountMultiplier = (100 - this.discountPercentage) / 100;
    return this._baseMonthlyPrice * this.months * discountMultiplier;
  }

  /**
   * Calculate effective monthly price (total divided by months)
   */
  getEffectiveMonthlyPrice(): number {
    if (this._type === 'trial') return 0;
    if (this._type === 'lifetime') {
      // Amortize over 5 years for effective monthly calculation
      return this.getTotalPrice() / 60;
    }

    return this.getTotalPrice() / this.months;
  }

  /**
   * Calculate savings compared to monthly billing
   */
  getSavingsAmount(): number {
    if (this._type === 'monthly' || this._type === 'trial') return 0;

    const monthlyTotal = this._baseMonthlyPrice * this.months;
    const actualTotal = this.getTotalPrice();

    return monthlyTotal - actualTotal;
  }

  /**
   * Calculate savings percentage compared to monthly billing
   */
  getSavingsPercentage(): number {
    if (this._type === 'monthly' || this._type === 'trial') return 0;

    const monthlyTotal = this._baseMonthlyPrice * this.months;
    const savings = this.getSavingsAmount();

    return (savings / monthlyTotal) * 100;
  }

  /**
   * Get next billing date from a start date
   */
  getNextBillingDate(startDate: Date): Date | null {
    if (!this.isRecurring) return null;

    const nextDate = new Date(startDate);

    switch (this._type) {
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case 'yearly':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }

    return nextDate;
  }

  /**
   * Get trial end date (for trial periods)
   */
  getTrialEndDate(startDate: Date, trialDays: number = 14): Date | null {
    if (!this.isTrial) return null;

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + trialDays);
    return endDate;
  }

  /**
   * Check if billing period allows prorated billing
   */
  allowsProration(): boolean {
    return this._type === 'monthly' || this._type === 'quarterly';
  }

  /**
   * Calculate prorated amount for partial period
   */
  getProrationAmount(daysUsed: number): number {
    if (!this.allowsProration()) {
      throw new Error(`Proration not supported for ${this._type} billing`);
    }

    const totalDays = this._type === 'monthly' ? 30 : 90;
    const dailyRate = this.getTotalPrice() / totalDays;

    return dailyRate * daysUsed;
  }

  /**
   * Get billing period calculation details
   */
  getCalculation(): PeriodCalculation {
    return {
      months: this.months,
      discountPercentage: this.discountPercentage,
      effectiveMonthlyPrice: this.getEffectiveMonthlyPrice(),
      totalPrice: this.getTotalPrice()
    };
  }

  /**
   * Create billing period from type and base price
   */
  static create(type: PeriodType, baseMonthlyPrice: number): BillingPeriod {
    return new BillingPeriod(type, baseMonthlyPrice);
  }

  /**
   * Get all available billing periods
   */
  static getAllTypes(): PeriodType[] {
    return ['monthly', 'quarterly', 'yearly', 'lifetime', 'trial'];
  }

  /**
   * Get billing periods for subscription offerings (excludes trial)
   */
  static getSubscriptionTypes(): PeriodType[] {
    return ['monthly', 'quarterly', 'yearly', 'lifetime'];
  }

  /**
   * Get most cost-effective period (highest discount)
   */
  static getMostCostEffective(baseMonthlyPrice: number): BillingPeriod {
    // Compare yearly vs lifetime effective monthly price
    const yearly = new BillingPeriod('yearly', baseMonthlyPrice);
    const lifetime = new BillingPeriod('lifetime', baseMonthlyPrice);

    if (lifetime.getEffectiveMonthlyPrice() < yearly.getEffectiveMonthlyPrice()) {
      return lifetime;
    }

    return yearly;
  }

  /**
   * Compare two billing periods by value
   */
  static compareValue(period1: BillingPeriod, period2: BillingPeriod): number {
    const value1 = period1.getEffectiveMonthlyPrice();
    const value2 = period2.getEffectiveMonthlyPrice();

    return value1 - value2; // Lower effective monthly price = better value
  }

  /**
   * Check if period type is valid
   */
  static isValidType(type: string): type is PeriodType {
    return ['monthly', 'quarterly', 'yearly', 'lifetime', 'trial'].includes(type);
  }

  private validatePeriod(type: PeriodType): void {
    if (!BillingPeriod.isValidType(type)) {
      throw new Error(`Invalid billing period type: ${type}`);
    }
  }

  private validatePrice(price: number): void {
    if (price < 0) {
      throw new Error(`Base monthly price cannot be negative: ${price}`);
    }
  }

  equals(other: BillingPeriod): boolean {
    return this._type === other._type &&
           this._baseMonthlyPrice === other._baseMonthlyPrice;
  }

  toString(): string {
    const totalPrice = this.getTotalPrice();
    const savings = this.getSavingsAmount();

    if (this.isTrial) {
      return `BillingPeriod(trial, free)`;
    }

    if (this.isLifetime) {
      return `BillingPeriod(lifetime, $${totalPrice.toFixed(2)}, ~$${this.getEffectiveMonthlyPrice().toFixed(2)}/mo)`;
    }

    return `BillingPeriod(${this._type}, $${totalPrice.toFixed(2)}${savings > 0 ? `, saves $${savings.toFixed(2)}` : ''})`;
  }

  toJSON(): {
    type: PeriodType;
    baseMonthlyPrice: number;
    calculation: PeriodCalculation;
    savings: { amount: number; percentage: number };
    isRecurring: boolean;
    nextBillingSupported: boolean;
  } {
    return {
      type: this._type,
      baseMonthlyPrice: this._baseMonthlyPrice,
      calculation: this.getCalculation(),
      savings: {
        amount: this.getSavingsAmount(),
        percentage: this.getSavingsPercentage()
      },
      isRecurring: this.isRecurring,
      nextBillingSupported: this.isRecurring
    };
  }
}