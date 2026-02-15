import { PrismaClient, SubscriptionTier, SubscriptionStatus } from './client.js';
import { logger } from '@discord-bot/logger';

export class SubscriptionService {
    private prisma: PrismaClient;
    private logger = logger.child({ service: 'SubscriptionService' });

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Get the subscription tier for a user.
     * Checks new Customer/Subscription model first, falls back to legacy UserSubscription.
     */
    async getUserTier(userId: string): Promise<string> {
        try {
            // 1. Check new Customer/Subscription model
            const customer = await this.prisma.customer.findUnique({
                where: { discordUserId: userId },
                include: {
                    subscriptions: {
                        where: { status: 'ACTIVE' },
                        include: { plan: true }
                    }
                }
            });

            if (customer && customer.subscriptions.length > 0) {
                // Return the highest tier if multiple exist (logic can be refined)
                const sub = customer.subscriptions[0];
                return sub.plan.name.toUpperCase(); // 'PREMIUM', 'ENTERPRISE'
            }

            // 2. Fallback to legacy UserSubscription
            const sub = await this.prisma.userSubscription.findUnique({
                where: { userId },
            });

            if (!sub) return 'FREE';

            if (sub.expiresAt < new Date()) {
                return 'FREE';
            }

            return sub.tier;
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to get user tier');
            return 'FREE';
        }
    }

    /**
     * Create or retrieve a customer record for a Discord user.
     */
    async ensureCustomer(userId: string, email: string, username?: string): Promise<string> {
        try {
            const customer = await this.prisma.customer.upsert({
                where: { discordUserId: userId },
                update: { email, discordUsername: username },
                create: {
                    discordUserId: userId,
                    email,
                    discordUsername: username
                }
            });
            return customer.id;
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to ensure customer');
            throw error;
        }
    }

    /**
     * Create a subscription for a customer.
     * This is a simplified internal method. In production, this would be handled via PaymentService webhooks.
     */
    async createInternalSubscription(customerId: string, planName: string, durationDays: number) {
        try {
            const plan = await this.prisma.subscriptionPlan.findUnique({ where: { name: planName.toLowerCase() } });
            if (!plan) throw new Error(`Plan ${planName} not found`);

            // Find a price for this plan (mock)
            const price = await this.prisma.subscriptionPrice.findFirst({ where: { planId: plan.id } });
            if (!price) throw new Error(`No price found for plan ${planName}`);

            const now = new Date();
            const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

            return await this.prisma.subscription.create({
                data: {
                    customerId,
                    planId: plan.id,
                    priceId: price.id,
                    provider: 'internal',
                    providerSubscriptionId: `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    status: 'ACTIVE',
                    currentPeriodStart: now,
                    currentPeriodEnd: expiresAt,
                }
            });
        } catch (error) {
            this.logger.error({ error, customerId, planName }, 'Failed to create internal subscription');
            throw error;
        }
    }

    /**
     * Redeem a promo code for a user.
     */
    async redeemCode(userId: string, code: string): Promise<{ success: boolean; message: string; tier?: string }> {
        try {
            const promo = await this.prisma.promoCode.findUnique({
                where: { code },
            });

            if (!promo) {
                return { success: false, message: 'Invalid code.' };
            }

            if (promo.expiresAt && promo.expiresAt < new Date()) {
                return { success: false, message: 'Code expired.' };
            }

            if (promo.usedCount >= promo.maxUses) {
                return { success: false, message: 'Code fully redeemed.' };
            }

            // Update promo usage
            await this.prisma.promoCode.update({
                where: { id: promo.id },
                data: { usedCount: { increment: 1 } },
            });

            // Ensure customer exists (using placeholder email if needed)
            // In a real flow, we'd ask for email. For now, use a dummy one or try to get from Discord.
            const customerId = await this.ensureCustomer(userId, `${userId}@discord.placeholder`, 'Unknown');

            // Create subscription
            await this.createInternalSubscription(customerId, promo.tier, promo.durationDays);

            // Also update legacy table for backward compatibility during migration
            await this.updateLegacySubscription(userId, promo.tier, promo.durationDays);

            return { success: true, message: `Redeemed ${promo.durationDays} days of ${promo.tier}!`, tier: promo.tier };

        } catch (error) {
            this.logger.error({ error, userId, code }, 'Failed to redeem code');
            return { success: false, message: 'Internal error.' };
        }
    }

    private async updateLegacySubscription(userId: string, tier: string, days: number) {
        const now = new Date();
        const durationMs = days * 24 * 60 * 60 * 1000;

        const existing = await this.prisma.userSubscription.findUnique({
            where: { userId },
        });

        let newExpiresAt = new Date(now.getTime() + durationMs);
        if (existing && existing.expiresAt > now) {
            newExpiresAt = new Date(existing.expiresAt.getTime() + durationMs);
        }

        await this.prisma.userSubscription.upsert({
            where: { userId },
            update: {
                tier,
                expiresAt: newExpiresAt,
            },
            create: {
                userId,
                tier,
                expiresAt: newExpiresAt,
            },
        });
    }

    /**
     * Process a referral.
     */
    async processReferral(referrerId: string, newUserId: string): Promise<boolean> {
        if (referrerId === newUserId) return false;

        try {
            const existing = await this.prisma.referral.findUnique({
                where: { referredId: newUserId },
            });

            if (existing) return false;

            await this.prisma.referral.create({
                data: {
                    referrerId,
                    referredId: newUserId,
                    status: 'PENDING',
                },
            });

            return true;
        } catch (error) {
            this.logger.error({ error, referrerId, newUserId }, 'Failed to process referral');
            return false;
        }
    }

    /**
     * Complete a referral.
     */
    async completeReferral(referredId: string): Promise<void> {
        try {
            const referral = await this.prisma.referral.findUnique({
                where: { referredId },
            });

            if (!referral || referral.status === 'COMPLETED') return;

            const rewardDays = 7;
            const rewardTier = 'DIAMOND';

            await this.prisma.referral.update({
                where: { id: referral.id },
                data: { status: 'COMPLETED' },
            });

            // Update legacy subscriptions for rewards (simplest for now)
            await this.updateLegacySubscription(referral.referrerId, rewardTier, rewardDays);
            await this.updateLegacySubscription(referral.referredId, rewardTier, rewardDays);

        } catch (error) {
            this.logger.error({ error, referredId }, 'Failed to complete referral');
        }
    }

    async createPromoCode(code: string, tier: string, durationDays: number, maxUses: number) {
        return this.prisma.promoCode.create({
            data: {
                code,
                tier,
                durationDays,
                maxUses,
            },
        });
    }
}
