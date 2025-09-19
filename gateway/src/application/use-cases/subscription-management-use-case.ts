import { Customer, CustomerStatus } from '../../domain/entities/customer.js';
import { SubscriptionPlan, PlanType } from '../../domain/entities/subscription-plan.js';
import { GuildId } from '../../domain/value-objects/guild-id.js';

/**
 * Subscription Management Use Case - Commercial Feature
 * Handles all subscription-related business logic
 */

export interface CustomerRepository {
  findById(customerId: string): Promise<Customer | null>;
  findByGuildId(guildId: string): Promise<Customer | null>;
  findByEmail(email: string): Promise<Customer | null>;
  save(customer: Customer): Promise<void>;
  delete(customerId: string): Promise<void>;
  findExpiringSoon(days: number): Promise<Customer[]>;
  findTrialsEndingSoon(days: number): Promise<Customer[]>;
}

export interface PaymentService {
  createSubscription(customerId: string, planId: string): Promise<{ subscriptionId: string; paymentUrl: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  upgradeSubscription(subscriptionId: string, newPlanId: string): Promise<void>;
  processPayment(customerId: string, amount: number): Promise<{ success: boolean; transactionId?: string }>;
}

export interface NotificationService {
  sendSubscriptionExpiring(customer: Customer): Promise<void>;
  sendTrialEnding(customer: Customer): Promise<void>;
  sendSubscriptionUpgraded(customer: Customer): Promise<void>;
  sendSubscriptionCancelled(customer: Customer): Promise<void>;
}

export class SubscriptionManagementUseCase {
  constructor(
    private readonly customerRepository: CustomerRepository,
    private readonly paymentService: PaymentService,
    private readonly notificationService: NotificationService
  ) {}

  /**
   * Create a new customer with free plan
   */
  async createCustomer(email: string, name: string, guildId?: string): Promise<Customer> {
    // Check if customer already exists
    const existingCustomer = await this.customerRepository.findByEmail(email);
    if (existingCustomer) {
      throw new Error('Customer with this email already exists');
    }

    // Generate customer ID (in real app, use UUID)
    const customerId = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const customer = Customer.create(customerId, email, name, 'free');

    // Start with 14-day trial
    customer.startTrial(14);

    // Add guild if provided
    if (guildId) {
      customer.addGuild(guildId);
    }

    await this.customerRepository.save(customer);

    return customer;
  }

  /**
   * Upgrade customer to a higher plan
   */
  async upgradeSubscription(customerId: string, newPlanType: PlanType): Promise<Customer> {
    const customer = await this.customerRepository.findById(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }

    let newPlan: SubscriptionPlan;
    switch (newPlanType) {
      case 'premium':
        newPlan = SubscriptionPlan.createPremiumPlan();
        break;
      case 'pro':
        newPlan = SubscriptionPlan.createProPlan();
        break;
      case 'enterprise':
        newPlan = SubscriptionPlan.createEnterprisePlan();
        break;
      default:
        throw new Error('Invalid plan type for upgrade');
    }

    // Process payment
    const paymentResult = await this.paymentService.processPayment(customerId, newPlan.price);
    if (!paymentResult.success) {
      throw new Error('Payment failed for subscription upgrade');
    }

    customer.upgradePlan(newPlan);
    customer.renewSubscription(1); // Renew for 1 month

    await this.customerRepository.save(customer);
    await this.notificationService.sendSubscriptionUpgraded(customer);

    return customer;
  }

  /**
   * Add a guild to customer's subscription
   */
  async addGuildToCustomer(guildId: string, customerId: string): Promise<void> {
    const customer = await this.customerRepository.findById(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Check if guild is already associated with another customer
    const existingCustomer = await this.customerRepository.findByGuildId(guildId);
    if (existingCustomer && existingCustomer.id !== customerId) {
      throw new Error('Guild is already associated with another customer');
    }

    customer.addGuild(guildId);
    await this.customerRepository.save(customer);
  }

  /**
   * Remove a guild from customer's subscription
   */
  async removeGuildFromCustomer(guildId: string): Promise<void> {
    const customer = await this.customerRepository.findByGuildId(guildId);
    if (!customer) {
      throw new Error('No customer found for this guild');
    }

    customer.removeGuild(guildId);
    await this.customerRepository.save(customer);
  }

  /**
   * Check if a guild can use a specific feature
   */
  async canUseFeature(guildId: string, featureName: string): Promise<boolean> {
    const customer = await this.customerRepository.findByGuildId(guildId);
    if (!customer) {
      // No customer = free tier with basic features only
      return ['basic_playback', 'queue_management', 'basic_controls'].includes(featureName);
    }

    if (!customer.isSubscriptionActive && !customer.isOnTrial) {
      return false;
    }

    return customer.subscriptionPlan.canUseFeature(featureName);
  }

  /**
   * Validate if a guild can perform an action based on plan limits
   */
  async validateUsage(guildId: string, usage: { queueSize?: number; trackDuration?: number }): Promise<void> {
    const customer = await this.customerRepository.findByGuildId(guildId);
    if (!customer) {
      // Apply free tier limits
      const freePlan = SubscriptionPlan.createFreePlan();
      const violations = freePlan.exceedsLimit(usage);
      if (violations.length > 0) {
        throw new Error(`Free tier limits exceeded: ${violations.join(', ')}`);
      }
      return;
    }

    if (!customer.isSubscriptionActive && !customer.isOnTrial) {
      throw new Error('Subscription is not active');
    }

    const violations = customer.subscriptionPlan.exceedsLimit(usage);
    if (violations.length > 0) {
      throw new Error(`Plan limits exceeded: ${violations.join(', ')}`);
    }
  }

  /**
   * Cancel customer subscription
   */
  async cancelSubscription(customerId: string): Promise<void> {
    const customer = await this.customerRepository.findById(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }

    customer.cancelSubscription();
    await this.customerRepository.save(customer);
    await this.notificationService.sendSubscriptionCancelled(customer);
  }

  /**
   * Record music playback for billing/analytics
   */
  async recordPlaytime(guildId: string, milliseconds: number): Promise<void> {
    const customer = await this.customerRepository.findByGuildId(guildId);
    if (customer) {
      customer.recordPlaytime(milliseconds);
      await this.customerRepository.save(customer);
    }
  }

  /**
   * Record API call for rate limiting
   */
  async recordApiCall(guildId: string): Promise<void> {
    const customer = await this.customerRepository.findByGuildId(guildId);
    if (customer) {
      customer.recordApiCall();
      await this.customerRepository.save(customer);
    }
  }

  /**
   * Get customer by guild ID
   */
  async getCustomerByGuild(guildId: string): Promise<Customer | null> {
    return await this.customerRepository.findByGuildId(guildId);
  }

  /**
   * Process subscription renewals and expirations
   */
  async processSubscriptionExpirations(): Promise<void> {
    // Find subscriptions expiring in 7 days
    const expiringSoon = await this.customerRepository.findExpiringSoon(7);
    for (const customer of expiringSoon) {
      await this.notificationService.sendSubscriptionExpiring(customer);
    }

    // Find trials ending in 3 days
    const trialsEndingSoon = await this.customerRepository.findTrialsEndingSoon(3);
    for (const customer of trialsEndingSoon) {
      await this.notificationService.sendTrialEnding(customer);
    }
  }

  /**
   * Get subscription status for a guild
   */
  async getSubscriptionStatus(guildId: string): Promise<{
    hasSubscription: boolean;
    planType: PlanType;
    isActive: boolean;
    isOnTrial: boolean;
    daysUntilExpiration: number;
    limits: any;
  }> {
    const customer = await this.customerRepository.findByGuildId(guildId);

    if (!customer) {
      const freePlan = SubscriptionPlan.createFreePlan();
      return {
        hasSubscription: false,
        planType: 'free',
        isActive: true,
        isOnTrial: false,
        daysUntilExpiration: -1,
        limits: freePlan.limits
      };
    }

    return {
      hasSubscription: true,
      planType: customer.subscriptionPlan.type,
      isActive: customer.isSubscriptionActive,
      isOnTrial: customer.isOnTrial,
      daysUntilExpiration: customer.daysUntilExpiration,
      limits: customer.subscriptionPlan.limits
    };
  }
}