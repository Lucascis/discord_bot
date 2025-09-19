import { SubscriptionPlan, PlanType } from './subscription-plan.js';

/**
 * Customer Entity - Commercial Feature
 * Represents a customer who can have multiple Discord guilds under one subscription
 */

export type CustomerStatus = 'active' | 'suspended' | 'cancelled' | 'trial';

export interface CustomerUsage {
  guildsCount: number;
  totalPlaytime: number; // in milliseconds
  apiCallsThisMonth: number;
  lastActivity: Date;
}

export class Customer {
  constructor(
    private readonly _id: string,
    private readonly _email: string,
    private readonly _name: string,
    private _subscriptionPlan: SubscriptionPlan,
    private _status: CustomerStatus = 'active',
    private _guildIds: string[] = [],
    private _usage: CustomerUsage = {
      guildsCount: 0,
      totalPlaytime: 0,
      apiCallsThisMonth: 0,
      lastActivity: new Date()
    },
    private readonly _createdAt: Date = new Date(),
    private _subscriptionExpiresAt: Date | null = null,
    private _trialEndsAt: Date | null = null
  ) {}

  get id(): string {
    return this._id;
  }

  get email(): string {
    return this._email;
  }

  get name(): string {
    return this._name;
  }

  get subscriptionPlan(): SubscriptionPlan {
    return this._subscriptionPlan;
  }

  get status(): CustomerStatus {
    return this._status;
  }

  get guildIds(): string[] {
    return [...this._guildIds];
  }

  get usage(): CustomerUsage {
    return { ...this._usage };
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get subscriptionExpiresAt(): Date | null {
    return this._subscriptionExpiresAt;
  }

  get trialEndsAt(): Date | null {
    return this._trialEndsAt;
  }

  get isSubscriptionActive(): boolean {
    if (this._status !== 'active') return false;
    if (!this._subscriptionExpiresAt) return true; // Lifetime subscription
    return this._subscriptionExpiresAt > new Date();
  }

  get isOnTrial(): boolean {
    if (!this._trialEndsAt) return false;
    return this._trialEndsAt > new Date() && this._status === 'trial';
  }

  get daysUntilExpiration(): number {
    if (!this._subscriptionExpiresAt) return -1; // No expiration
    const diffMs = this._subscriptionExpiresAt.getTime() - new Date().getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  canAddGuild(): boolean {
    if (!this.isSubscriptionActive && !this.isOnTrial) return false;

    const maxGuilds = this._subscriptionPlan.limits.maxGuilds;
    if (maxGuilds === -1) return true; // Unlimited

    return this._guildIds.length < maxGuilds;
  }

  addGuild(guildId: string): void {
    if (!this.canAddGuild()) {
      throw new Error('Cannot add guild: subscription limit reached or inactive');
    }

    if (this._guildIds.includes(guildId)) {
      throw new Error('Guild already associated with this customer');
    }

    this._guildIds.push(guildId);
    this._usage.guildsCount = this._guildIds.length;
    this._usage.lastActivity = new Date();
  }

  removeGuild(guildId: string): void {
    const index = this._guildIds.indexOf(guildId);
    if (index === -1) {
      throw new Error('Guild not found in customer guilds');
    }

    this._guildIds.splice(index, 1);
    this._usage.guildsCount = this._guildIds.length;
    this._usage.lastActivity = new Date();
  }

  upgradePlan(newPlan: SubscriptionPlan): void {
    // Check if this is actually an upgrade
    if (newPlan.price <= this._subscriptionPlan.price) {
      throw new Error('New plan must be an upgrade (higher price)');
    }

    this._subscriptionPlan = newPlan;
    this._usage.lastActivity = new Date();

    // If upgrading during trial, end trial
    if (this._status === 'trial') {
      this._status = 'active';
      this._trialEndsAt = null;
    }
  }

  downgradePlan(newPlan: SubscriptionPlan): void {
    this._subscriptionPlan = newPlan;
    this._usage.lastActivity = new Date();

    // Check if current usage exceeds new plan limits
    const violations = newPlan.exceedsLimit({
      guilds: this._usage.guildsCount
    });

    if (violations.length > 0) {
      throw new Error(`Cannot downgrade: current usage exceeds new plan limits: ${violations.join(', ')}`);
    }
  }

  renewSubscription(months: number = 1): void {
    const now = new Date();
    const currentExpiration = this._subscriptionExpiresAt || now;

    // Extend from current expiration or now, whichever is later
    const baseDate = currentExpiration > now ? currentExpiration : now;

    this._subscriptionExpiresAt = new Date(baseDate.getTime() + (months * 30 * 24 * 60 * 60 * 1000));
    this._status = 'active';
    this._usage.lastActivity = new Date();
  }

  suspendSubscription(reason: string): void {
    this._status = 'suspended';
    this._usage.lastActivity = new Date();
    // Note: In a real system, you'd store the suspension reason
  }

  cancelSubscription(): void {
    this._status = 'cancelled';
    this._usage.lastActivity = new Date();
    // Keep subscription active until expiration date
  }

  startTrial(daysLength: number = 14): void {
    if (this._trialEndsAt && this._trialEndsAt > new Date()) {
      throw new Error('Customer is already on trial');
    }

    this._status = 'trial';
    this._trialEndsAt = new Date(Date.now() + (daysLength * 24 * 60 * 60 * 1000));
    this._usage.lastActivity = new Date();
  }

  recordPlaytime(milliseconds: number): void {
    this._usage.totalPlaytime += milliseconds;
    this._usage.lastActivity = new Date();
  }

  recordApiCall(): void {
    this._usage.apiCallsThisMonth += 1;
    this._usage.lastActivity = new Date();
  }

  resetMonthlyUsage(): void {
    this._usage.apiCallsThisMonth = 0;
  }

  static create(
    id: string,
    email: string,
    name: string,
    planType: PlanType = 'free'
  ): Customer {
    let plan: SubscriptionPlan;

    switch (planType) {
      case 'premium':
        plan = SubscriptionPlan.createPremiumPlan();
        break;
      case 'pro':
        plan = SubscriptionPlan.createProPlan();
        break;
      case 'enterprise':
        plan = SubscriptionPlan.createEnterprisePlan();
        break;
      default:
        plan = SubscriptionPlan.createFreePlan();
    }

    return new Customer(id, email, name, plan);
  }

  toData(): {
    id: string;
    email: string;
    name: string;
    subscriptionPlan: any;
    status: CustomerStatus;
    guildIds: string[];
    usage: CustomerUsage;
    createdAt: Date;
    subscriptionExpiresAt: Date | null;
    trialEndsAt: Date | null;
  } {
    return {
      id: this._id,
      email: this._email,
      name: this._name,
      subscriptionPlan: {
        id: this._subscriptionPlan.id,
        name: this._subscriptionPlan.name,
        type: this._subscriptionPlan.type,
        price: this._subscriptionPlan.price,
        billingPeriod: this._subscriptionPlan.billingPeriod
      },
      status: this._status,
      guildIds: this._guildIds,
      usage: this._usage,
      createdAt: this._createdAt,
      subscriptionExpiresAt: this._subscriptionExpiresAt,
      trialEndsAt: this._trialEndsAt
    };
  }
}