/**
 * Billing Analytics Service
 *
 * Enterprise-grade analytics for revenue, customer metrics, and business intelligence.
 * Provides comprehensive reporting for subscription business management.
 *
 * @module BillingAnalyticsService
 * @category Domain
 */

// PrismaClient type replaced with any to avoid Docker build issues with type-only imports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaClient = any;

/**
 * Revenue metrics for a time period
 */
export interface RevenueMetrics {
  // Revenue breakdown
  totalRevenue: number;
  recurringRevenue: number; // MRR contribution
  oneTimeRevenue: number;
  currency: string;

  // Growth metrics
  revenueGrowth: number; // Percentage vs previous period
  mrrGrowth: number; // MRR growth percentage

  // Revenue by provider
  stripeRevenue: number;
  mercadopagoRevenue: number;
  paypalRevenue: number;
}

/**
 * Customer metrics for a time period
 */
export interface CustomerMetrics {
  // Customer counts
  newCustomers: number;
  churnedCustomers: number;
  totalActiveCustomers: number;

  // Growth metrics
  customerGrowth: number; // Percentage vs previous period
  churnRate: number; // Percentage of churned customers

  // Customer lifetime value
  averageLtv: number;
  medianLtv: number;
}

/**
 * Subscription metrics for a time period
 */
export interface SubscriptionMetrics {
  // Subscription counts
  newSubscriptions: number;
  canceledSubscriptions: number;
  totalActiveSubscriptions: number;

  // Subscription changes
  upgrades: number;
  downgrades: number;

  // Subscription health
  trialingSubscriptions: number;
  pastDueSubscriptions: number;

  // Growth metrics
  subscriptionGrowth: number; // Percentage vs previous period
  cancellationRate: number;
}

/**
 * Payment metrics for a time period
 */
export interface PaymentMetrics {
  // Payment counts
  successfulPayments: number;
  failedPayments: number;
  totalPayments: number;

  // Payment amounts
  successfulAmount: number;
  failedAmount: number;

  // Success rate
  successRate: number; // Percentage

  // Refunds
  refunds: number;
  refundedAmount: number;
  refundRate: number; // Percentage of total revenue
}

/**
 * Comprehensive analytics for a time period
 */
export interface AnalyticsSummary {
  period: {
    start: Date;
    end: Date;
  };

  revenue: RevenueMetrics;
  customers: CustomerMetrics;
  subscriptions: SubscriptionMetrics;
  payments: PaymentMetrics;
}

/**
 * Plan performance metrics
 */
export interface PlanPerformance {
  planId: string;
  planName: string;

  // Subscription counts
  activeSubscriptions: number;
  newSubscriptions: number;
  canceledSubscriptions: number;

  // Revenue
  totalRevenue: number;
  averageRevenuePerUser: number;

  // Customer metrics
  customerCount: number;
  averageLtv: number;
  churnRate: number;
}

/**
 * Cohort analysis data
 */
export interface CohortAnalysis {
  cohort: string; // e.g., "2025-01" for January 2025
  customersJoined: number;

  // Retention by month
  retention: {
    month: number; // 0 = signup month, 1 = first month, etc.
    activeCustomers: number;
    retentionRate: number; // Percentage
    revenue: number;
  }[];
}

/**
 * Billing Analytics Service
 *
 * Provides comprehensive analytics and business intelligence:
 * - Revenue tracking and forecasting
 * - Customer acquisition and retention metrics
 * - Subscription health monitoring
 * - Payment success rates
 * - Plan performance analysis
 * - Cohort analysis
 * - Churn prediction
 */
export class BillingAnalyticsService {
  constructor(
    private readonly database: PrismaClient
  ) {}

  // ============================================================================
  // REVENUE ANALYTICS
  // ============================================================================

  /**
   * Get revenue metrics for a time period
   */
  async getRevenueMetrics(startDate: Date, endDate: Date): Promise<RevenueMetrics> {
    // Aggregate revenue from BillingMetrics table
    const aggregated = await this.database.billingMetrics.aggregate({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        }
      },
      _sum: {
        totalRevenue: true,
        recurringRevenue: true,
        oneTimeRevenue: true,
        stripeRevenue: true,
        mercadopagoRevenue: true,
        paypalRevenue: true,
      }
    });

    // Calculate growth vs previous period
    const periodDuration = endDate.getTime() - startDate.getTime();
    const previousPeriodStart = new Date(startDate.getTime() - periodDuration);
    const previousPeriodEnd = new Date(endDate.getTime() - periodDuration);

    const previousAggregated = await this.database.billingMetrics.aggregate({
      where: {
        date: {
          gte: previousPeriodStart,
          lte: previousPeriodEnd,
        }
      },
      _sum: {
        totalRevenue: true,
        recurringRevenue: true,
      }
    });

    const currentRevenue = aggregated._sum.totalRevenue || 0;
    const previousRevenue = previousAggregated._sum.totalRevenue || 0;
    const currentMrr = aggregated._sum.recurringRevenue || 0;
    const previousMrr = previousAggregated._sum.recurringRevenue || 0;

    const revenueGrowth = previousRevenue > 0
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
      : 0;
    const mrrGrowth = previousMrr > 0
      ? ((currentMrr - previousMrr) / previousMrr) * 100
      : 0;

    const metrics: RevenueMetrics = {
      totalRevenue: currentRevenue,
      recurringRevenue: currentMrr,
      oneTimeRevenue: aggregated._sum.oneTimeRevenue || 0,
      currency: 'USD',
      revenueGrowth,
      mrrGrowth,
      stripeRevenue: aggregated._sum.stripeRevenue || 0,
      mercadopagoRevenue: aggregated._sum.mercadopagoRevenue || 0,
      paypalRevenue: aggregated._sum.paypalRevenue || 0,
    };

    console.log(`[BillingAnalytics] Revenue metrics: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    return metrics;
  }

  /**
   * Calculate Monthly Recurring Revenue (MRR)
   */
  async calculateMRR(): Promise<number> {
    // Get all active subscriptions with their prices
    const activeSubscriptions = await this.database.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIALING'] }
      },
      include: {
        price: true
      }
    });

    // Calculate MRR by normalizing all intervals to monthly
    let mrr = 0;
    for (const subscription of activeSubscriptions) {
      const amount = subscription.price.amount;
      const interval = subscription.price.interval;
      const intervalCount = subscription.price.intervalCount;

      // Normalize to monthly amount
      switch (interval) {
        case 'MONTH':
          mrr += amount / intervalCount;
          break;
        case 'YEAR':
          mrr += amount / (12 * intervalCount);
          break;
        case 'WEEK':
          mrr += (amount * 4.33) / intervalCount; // Average weeks per month
          break;
        case 'DAY':
          mrr += (amount * 30) / intervalCount; // Average days per month
          break;
      }
    }

    console.log('[BillingAnalytics] Calculating MRR');

    return Math.round(mrr);
  }

  /**
   * Calculate Annual Recurring Revenue (ARR)
   */
  async calculateARR(): Promise<number> {
    const mrr = await this.calculateMRR();
    return mrr * 12;
  }

  /**
   * Forecast revenue for next N months
   */
  async forecastRevenue(months: number): Promise<{
    month: string;
    predictedRevenue: number;
    confidenceInterval: { low: number; high: number };
  }[]> {
    // TODO: [ANALYTICS-ENHANCEMENT] Implement time series forecasting

    // Simple forecast based on growth rate
    const lastMonthMetrics = await this.getRevenueMetrics(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      new Date()
    );

    const forecast = [];
    for (let i = 1; i <= months; i++) {
      const month = new Date();
      month.setMonth(month.getMonth() + i);

      forecast.push({
        month: month.toISOString().slice(0, 7),
        predictedRevenue: lastMonthMetrics.totalRevenue * (1 + lastMonthMetrics.revenueGrowth / 100) ** i,
        confidenceInterval: {
          low: 0,
          high: 0,
        },
      });
    }

    console.log(`[BillingAnalytics] Forecasted revenue for ${months} months`);

    return forecast;
  }

  // ============================================================================
  // CUSTOMER ANALYTICS
  // ============================================================================

  /**
   * Get customer metrics for a time period
   */
  async getCustomerMetrics(startDate: Date, endDate: Date): Promise<CustomerMetrics> {
    // Count new customers in period
    const newCustomers = await this.database.customer.count({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      }
    });

    // Count churned customers (canceled subscriptions in period)
    const churnedCustomers = await this.database.subscription.groupBy({
      by: ['customerId'],
      where: {
        status: 'CANCELED',
        canceledAt: { gte: startDate, lte: endDate }
      },
      _count: true
    });

    // Count total active customers (customers with at least one active subscription)
    const totalActiveCustomers = await this.database.customer.count({
      where: {
        status: 'ACTIVE',
        subscriptions: {
          some: {
            status: { in: ['ACTIVE', 'TRIALING'] }
          }
        }
      }
    });

    // Calculate growth vs previous period
    const periodDuration = endDate.getTime() - startDate.getTime();
    const previousPeriodStart = new Date(startDate.getTime() - periodDuration);
    const previousPeriodEnd = new Date(endDate.getTime() - periodDuration);

    const previousNewCustomers = await this.database.customer.count({
      where: {
        createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd }
      }
    });

    const customerGrowth = previousNewCustomers > 0
      ? ((newCustomers - previousNewCustomers) / previousNewCustomers) * 100
      : 0;

    // Calculate churn rate: (churned customers / starting customers) * 100
    const startingCustomers = await this.database.customer.count({
      where: {
        createdAt: { lt: startDate },
        status: 'ACTIVE'
      }
    });

    const churnRate = startingCustomers > 0
      ? (churnedCustomers.length / startingCustomers) * 100
      : 0;

    // Calculate LTV metrics from CustomerLifetimeValue table
    const ltvData = await this.database.customerLifetimeValue.aggregate({
      _avg: {
        netRevenue: true
      }
    });

    // For median, we need to fetch all LTV values and calculate manually
    const allLtvs = await this.database.customerLifetimeValue.findMany({
      select: { netRevenue: true },
      orderBy: { netRevenue: 'asc' }
    });

    const medianLtv = allLtvs.length > 0
      ? allLtvs[Math.floor(allLtvs.length / 2)]?.netRevenue || 0
      : 0;

    const metrics: CustomerMetrics = {
      newCustomers,
      churnedCustomers: churnedCustomers.length,
      totalActiveCustomers,
      customerGrowth,
      churnRate,
      averageLtv: ltvData._avg.netRevenue || 0,
      medianLtv,
    };

    console.log(`[BillingAnalytics] Customer metrics: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    return metrics;
  }

  /**
   * Calculate customer churn rate
   */
  async calculateChurnRate(startDate: Date, endDate: Date): Promise<number> {
    // Count customers at start of period
    const startingCustomers = await this.database.customer.count({
      where: {
        createdAt: { lt: startDate },
        status: 'ACTIVE'
      }
    });

    // Count customers who churned during the period
    const churnedCustomers = await this.database.subscription.groupBy({
      by: ['customerId'],
      where: {
        status: 'CANCELED',
        canceledAt: { gte: startDate, lte: endDate }
      },
      _count: true
    });

    // Churn Rate = (Customers Lost / Starting Customers) * 100
    const churnRate = startingCustomers > 0
      ? (churnedCustomers.length / startingCustomers) * 100
      : 0;

    console.log('[BillingAnalytics] Calculating churn rate');

    return churnRate;
  }

  /**
   * Get top customers by lifetime value
   */
  async getTopCustomers(limit: number = 10): Promise<{
    customerId: string;
    email: string;
    ltv: number;
    totalPayments: number;
    monthsSubscribed: number;
  }[]> {
    const topLtvRecords = await this.database.customerLifetimeValue.findMany({
      take: limit,
      orderBy: { netRevenue: 'desc' },
      select: {
        customerId: true,
        netRevenue: true,
        totalPayments: true,
        monthsSubscribed: true
      }
    });

    // Get customer details for each LTV record
    const customerIds = topLtvRecords.map((ltv: unknown) => (ltv as { customerId: string }).customerId);
    const customers = await this.database.customer.findMany({
      where: {
        id: { in: customerIds }
      },
      select: {
        id: true,
        email: true
      }
    });

    // Create a map for quick lookup
    const customerMap = new Map(customers.map((c: unknown) => [(c as { id: string }).id, (c as { email: string }).email]));

    // Combine the data
    const result = topLtvRecords.map((ltv: unknown) => {
      const ltvRecord = ltv as { customerId: string; netRevenue: number; totalPayments: number; monthsSubscribed: number };
      return {
        customerId: ltvRecord.customerId,
        email: customerMap.get(ltvRecord.customerId) || 'unknown',
        ltv: ltvRecord.netRevenue,
        totalPayments: ltvRecord.totalPayments,
        monthsSubscribed: ltvRecord.monthsSubscribed
      };
    });

    console.log(`[BillingAnalytics] Fetching top ${limit} customers`);

    return result;
  }

  // ============================================================================
  // SUBSCRIPTION ANALYTICS
  // ============================================================================

  /**
   * Get subscription metrics for a time period
   */
  async getSubscriptionMetrics(startDate: Date, endDate: Date): Promise<SubscriptionMetrics> {
    // Count new subscriptions created in period
    const newSubscriptions = await this.database.subscription.count({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      }
    });

    // Count canceled subscriptions in period
    const canceledSubscriptions = await this.database.subscription.count({
      where: {
        status: 'CANCELED',
        canceledAt: { gte: startDate, lte: endDate }
      }
    });

    // Count total active subscriptions
    const totalActiveSubscriptions = await this.database.subscription.count({
      where: {
        status: { in: ['ACTIVE', 'TRIALING'] }
      }
    });

    // Count trialing subscriptions
    const trialingSubscriptions = await this.database.subscription.count({
      where: {
        status: 'TRIALING'
      }
    });

    // Count past due subscriptions
    const pastDueSubscriptions = await this.database.subscription.count({
      where: {
        status: 'PAST_DUE'
      }
    });

    // Count upgrades and downgrades from billing history
    const upgrades = await this.database.billingHistory.count({
      where: {
        eventType: 'SUBSCRIPTION_UPGRADED',
        createdAt: { gte: startDate, lte: endDate }
      }
    });

    const downgrades = await this.database.billingHistory.count({
      where: {
        eventType: 'SUBSCRIPTION_DOWNGRADED',
        createdAt: { gte: startDate, lte: endDate }
      }
    });

    // Calculate growth vs previous period
    const periodDuration = endDate.getTime() - startDate.getTime();
    const previousPeriodStart = new Date(startDate.getTime() - periodDuration);
    const previousPeriodEnd = new Date(endDate.getTime() - periodDuration);

    const previousNewSubscriptions = await this.database.subscription.count({
      where: {
        createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd }
      }
    });

    const subscriptionGrowth = previousNewSubscriptions > 0
      ? ((newSubscriptions - previousNewSubscriptions) / previousNewSubscriptions) * 100
      : 0;

    // Calculate cancellation rate
    const startingSubscriptions = await this.database.subscription.count({
      where: {
        createdAt: { lt: startDate },
        status: { in: ['ACTIVE', 'TRIALING'] }
      }
    });

    const cancellationRate = startingSubscriptions > 0
      ? (canceledSubscriptions / startingSubscriptions) * 100
      : 0;

    const metrics: SubscriptionMetrics = {
      newSubscriptions,
      canceledSubscriptions,
      totalActiveSubscriptions,
      upgrades,
      downgrades,
      trialingSubscriptions,
      pastDueSubscriptions,
      subscriptionGrowth,
      cancellationRate,
    };

    console.log(`[BillingAnalytics] Subscription metrics: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    return metrics;
  }

  /**
   * Analyze plan performance
   */
  async analyzePlanPerformance(): Promise<PlanPerformance[]> {
    const plans = await this.database.subscriptionPlan.findMany({
      where: { active: true },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING', 'CANCELED'] } },
          include: {
            price: true,
            customer: true
          }
        }
      }
    });

    const performance: PlanPerformance[] = [];

    for (const plan of plans) {
      const activeSubscriptions = plan.subscriptions.filter((s: unknown) =>
        (s as { status: string }).status === 'ACTIVE' || (s as { status: string }).status === 'TRIALING'
      );
      const canceledSubscriptions = plan.subscriptions.filter((s: unknown) =>
        (s as { status: string }).status === 'CANCELED'
      );

      // Count new subscriptions (created in last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const newSubscriptions = plan.subscriptions.filter((s: unknown) =>
        (s as { createdAt: Date }).createdAt >= thirtyDaysAgo
      );

      // Calculate total revenue for this plan
      let totalRevenue = 0;
      for (const sub of activeSubscriptions) {
        const monthsPassed = Math.max(1, Math.floor(
          (Date.now() - sub.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000)
        ));

        // Normalize price to monthly
        let monthlyPrice = sub.price.amount;
        if (sub.price.interval === 'YEAR') {
          monthlyPrice = sub.price.amount / 12;
        } else if (sub.price.interval === 'WEEK') {
          monthlyPrice = sub.price.amount * 4.33;
        } else if (sub.price.interval === 'DAY') {
          monthlyPrice = sub.price.amount * 30;
        }

        totalRevenue += monthlyPrice * monthsPassed;
      }

      // Get unique customers for this plan
      const customerIds = new Set(activeSubscriptions.map((s: unknown) => (s as { customerId: string }).customerId));
      const customerCount = customerIds.size;

      // Calculate average revenue per user (ARPU)
      const averageRevenuePerUser = customerCount > 0
        ? totalRevenue / customerCount
        : 0;

      // Get LTV for customers on this plan
      const ltvData = await this.database.customerLifetimeValue.aggregate({
        where: {
          customerId: { in: Array.from(customerIds) }
        },
        _avg: {
          netRevenue: true
        }
      });

      // Calculate churn rate for this plan
      const totalSubscriptions = activeSubscriptions.length + canceledSubscriptions.length;
      const churnRate = totalSubscriptions > 0
        ? (canceledSubscriptions.length / totalSubscriptions) * 100
        : 0;

      performance.push({
        planId: plan.id,
        planName: plan.displayName,
        activeSubscriptions: activeSubscriptions.length,
        newSubscriptions: newSubscriptions.length,
        canceledSubscriptions: canceledSubscriptions.length,
        totalRevenue: Math.round(totalRevenue),
        averageRevenuePerUser: Math.round(averageRevenuePerUser),
        customerCount,
        averageLtv: Math.round(ltvData._avg.netRevenue || 0),
        churnRate: Math.round(churnRate * 100) / 100,
      });
    }

    console.log('[BillingAnalytics] Analyzing plan performance');

    return performance;
  }

  // ============================================================================
  // PAYMENT ANALYTICS
  // ============================================================================

  /**
   * Get payment metrics for a time period
   */
  async getPaymentMetrics(startDate: Date, endDate: Date): Promise<PaymentMetrics> {
    // Count payments by status with amounts
    const payments = await this.database.payment.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: startDate, lte: endDate }
      },
      _count: true,
      _sum: { amount: true }
    });

    // Calculate metrics from grouped data
    let successfulPayments = 0;
    let failedPayments = 0;
    let successfulAmount = 0;
    let failedAmount = 0;

    for (const payment of payments) {
      const count = payment._count;
      const amount = payment._sum.amount || 0;

      if (payment.status === 'SUCCEEDED') {
        successfulPayments = count;
        successfulAmount = amount;
      } else if (payment.status === 'FAILED') {
        failedPayments = count;
        failedAmount = amount;
      }
    }

    const totalPayments = payments.reduce((sum: number, p: unknown) => sum + (p as { _count: number })._count, 0);

    // Calculate success rate
    const successRate = totalPayments > 0
      ? (successfulPayments / totalPayments) * 100
      : 0;

    // Count refunds
    const refundData = await this.database.refund.aggregate({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: 'SUCCEEDED'
      },
      _count: true,
      _sum: {
        amount: true
      }
    });

    const refunds = refundData._count || 0;
    const refundedAmount = refundData._sum.amount || 0;

    // Calculate refund rate (refunded amount / successful amount)
    const refundRate = successfulAmount > 0
      ? (refundedAmount / successfulAmount) * 100
      : 0;

    const metrics: PaymentMetrics = {
      successfulPayments,
      failedPayments,
      totalPayments,
      successfulAmount,
      failedAmount,
      successRate,
      refunds,
      refundedAmount,
      refundRate,
    };

    console.log(`[BillingAnalytics] Payment metrics: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    return metrics;
  }

  /**
   * Analyze payment failure reasons
   */
  async analyzePaymentFailures(startDate: Date, endDate: Date): Promise<{
    failureCode: string;
    count: number;
    totalAmount: number;
  }[]> {
    const failureAnalysis = await this.database.payment.groupBy({
      by: ['failureCode'],
      where: {
        status: 'FAILED',
        createdAt: { gte: startDate, lte: endDate },
        failureCode: { not: null }
      },
      _count: true,
      _sum: { amount: true }
    });

    const result = failureAnalysis.map((failure: unknown) => {
      const f = failure as { failureCode?: string; _count: number; _sum: { amount: number | null } };
      return {
        failureCode: f.failureCode || 'UNKNOWN',
        count: f._count,
        totalAmount: f._sum.amount || 0
      };
    });

    console.log('[BillingAnalytics] Analyzing payment failures');

    return result;
  }

  // ============================================================================
  // COHORT ANALYSIS
  // ============================================================================

  /**
   * Perform cohort analysis
   */
  async performCohortAnalysis(cohortMonth: string): Promise<CohortAnalysis> {
    // Parse cohortMonth (format: "YYYY-MM")
    const [year, month] = cohortMonth.split('-').map(Number);
    const cohortStart = new Date(year, month - 1, 1);
    const cohortEnd = new Date(year, month, 0, 23, 59, 59, 999);

    // Get all customers who joined in this cohort month
    const cohortCustomers = await this.database.customer.findMany({
      where: {
        createdAt: {
          gte: cohortStart,
          lte: cohortEnd
        }
      },
      select: {
        id: true,
        createdAt: true
      }
    });

    const customersJoined = cohortCustomers.length;
    const customerIds = cohortCustomers.map((c: unknown) => (c as { id: string }).id);

    // Track retention for up to 12 months
    const retention = [];
    const now = new Date();

    for (let monthOffset = 0; monthOffset < 12; monthOffset++) {
      const periodStart = new Date(year, month - 1 + monthOffset, 1);
      const periodEnd = new Date(year, month + monthOffset, 0, 23, 59, 59, 999);

      // Stop if we've reached the future
      if (periodStart > now) break;

      // Count active customers in this month (have active subscription)
      const activeInMonth = await this.database.subscription.groupBy({
        by: ['customerId'],
        where: {
          customerId: { in: customerIds },
          status: { in: ['ACTIVE', 'TRIALING'] },
          currentPeriodStart: { lte: periodEnd },
          currentPeriodEnd: { gte: periodStart }
        },
        _count: true
      });

      const activeCustomers = activeInMonth.length;

      // Calculate revenue for this cohort in this month
      const cohortRevenue = await this.database.payment.aggregate({
        where: {
          customerId: { in: customerIds },
          status: 'SUCCEEDED',
          createdAt: {
            gte: periodStart,
            lte: periodEnd
          }
        },
        _sum: {
          amount: true
        }
      });

      // Calculate retention rate
      const retentionRate = customersJoined > 0
        ? (activeCustomers / customersJoined) * 100
        : 0;

      retention.push({
        month: monthOffset,
        activeCustomers,
        retentionRate,
        revenue: cohortRevenue._sum.amount || 0
      });
    }

    const analysis: CohortAnalysis = {
      cohort: cohortMonth,
      customersJoined,
      retention,
    };

    console.log(`[BillingAnalytics] Cohort analysis for ${cohortMonth}`);

    return analysis;
  }

  // ============================================================================
  // COMPREHENSIVE REPORTS
  // ============================================================================

  /**
   * Generate comprehensive analytics summary
   */
  async generateAnalyticsSummary(startDate: Date, endDate: Date): Promise<AnalyticsSummary> {
    const [revenue, customers, subscriptions, payments] = await Promise.all([
      this.getRevenueMetrics(startDate, endDate),
      this.getCustomerMetrics(startDate, endDate),
      this.getSubscriptionMetrics(startDate, endDate),
      this.getPaymentMetrics(startDate, endDate),
    ]);

    return {
      period: { start: startDate, end: endDate },
      revenue,
      customers,
      subscriptions,
      payments,
    };
  }

  /**
   * Generate daily metrics snapshot
   *
   * This should be run daily to populate the BillingMetrics table
   */
  async generateDailyMetricsSnapshot(date: Date): Promise<void> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Calculate metrics
    const revenue = await this.getRevenueMetrics(startOfDay, endOfDay);
    const customers = await this.getCustomerMetrics(startOfDay, endOfDay);
    const subscriptions = await this.getSubscriptionMetrics(startOfDay, endOfDay);
    const payments = await this.getPaymentMetrics(startOfDay, endOfDay);

    // Prepare date for storage (normalize to midnight UTC)
    const metricsDate = new Date(date);
    metricsDate.setHours(0, 0, 0, 0);

    // Upsert into BillingMetrics table
    await this.database.billingMetrics.upsert({
      where: { date: metricsDate },
      create: {
        date: metricsDate,
        totalRevenue: revenue.totalRevenue,
        recurringRevenue: revenue.recurringRevenue,
        oneTimeRevenue: revenue.oneTimeRevenue,
        currency: revenue.currency,
        newCustomers: customers.newCustomers,
        churnedCustomers: customers.churnedCustomers,
        totalActiveCustomers: customers.totalActiveCustomers,
        newSubscriptions: subscriptions.newSubscriptions,
        canceledSubscriptions: subscriptions.canceledSubscriptions,
        upgrades: subscriptions.upgrades,
        downgrades: subscriptions.downgrades,
        totalActiveSubscriptions: subscriptions.totalActiveSubscriptions,
        successfulPayments: payments.successfulPayments,
        failedPayments: payments.failedPayments,
        refunds: payments.refunds,
        refundedAmount: payments.refundedAmount,
        stripeRevenue: revenue.stripeRevenue,
        mercadopagoRevenue: revenue.mercadopagoRevenue,
        paypalRevenue: revenue.paypalRevenue,
      },
      update: {
        totalRevenue: revenue.totalRevenue,
        recurringRevenue: revenue.recurringRevenue,
        oneTimeRevenue: revenue.oneTimeRevenue,
        currency: revenue.currency,
        newCustomers: customers.newCustomers,
        churnedCustomers: customers.churnedCustomers,
        totalActiveCustomers: customers.totalActiveCustomers,
        newSubscriptions: subscriptions.newSubscriptions,
        canceledSubscriptions: subscriptions.canceledSubscriptions,
        upgrades: subscriptions.upgrades,
        downgrades: subscriptions.downgrades,
        totalActiveSubscriptions: subscriptions.totalActiveSubscriptions,
        successfulPayments: payments.successfulPayments,
        failedPayments: payments.failedPayments,
        refunds: payments.refunds,
        refundedAmount: payments.refundedAmount,
        stripeRevenue: revenue.stripeRevenue,
        mercadopagoRevenue: revenue.mercadopagoRevenue,
        paypalRevenue: revenue.paypalRevenue,
      }
    });

    console.log(`[BillingAnalytics] Generated daily snapshot for ${date.toISOString()}`);
  }

  /**
   * Export analytics data to CSV
   */
  async exportToCSV(startDate: Date, endDate: Date): Promise<string> {
    const summary = await this.generateAnalyticsSummary(startDate, endDate);

    // TODO: [ENHANCEMENT] Generate CSV from summary data

    const csv = `
Period,${summary.period.start.toISOString()},${summary.period.end.toISOString()}

REVENUE
Total Revenue,${summary.revenue.totalRevenue}
Recurring Revenue,${summary.revenue.recurringRevenue}
One-Time Revenue,${summary.revenue.oneTimeRevenue}

CUSTOMERS
New Customers,${summary.customers.newCustomers}
Churned Customers,${summary.customers.churnedCustomers}
Total Active,${summary.customers.totalActiveCustomers}

SUBSCRIPTIONS
New Subscriptions,${summary.subscriptions.newSubscriptions}
Canceled Subscriptions,${summary.subscriptions.canceledSubscriptions}
Active Subscriptions,${summary.subscriptions.totalActiveSubscriptions}

PAYMENTS
Successful Payments,${summary.payments.successfulPayments}
Failed Payments,${summary.payments.failedPayments}
Success Rate,${summary.payments.successRate}%
    `.trim();

    console.log('[BillingAnalytics] Exported analytics to CSV');

    return csv;
  }
}
