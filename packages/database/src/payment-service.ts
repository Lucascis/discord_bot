import { PrismaClient } from './client.js';
import { logger } from '@discord-bot/logger';
import { SubscriptionService } from './subscription-service.js';

export interface CheckoutSessionOptions {
    customerId: string;
    planName: string; // 'premium', 'enterprise'
    successUrl: string;
    cancelUrl: string;
}

export interface PaymentProvider {
    createCheckoutSession(options: CheckoutSessionOptions): Promise<{ url: string; sessionId: string }>;
    cancelSubscription(subscriptionId: string): Promise<void>;
}

export class MockPaymentProvider implements PaymentProvider {
    async createCheckoutSession(options: CheckoutSessionOptions): Promise<{ url: string; sessionId: string }> {
        // In a real app, this would call Stripe API
        // For mock, we return a URL that hits our own API to simulate success
        const sessionId = `sess_${Math.random().toString(36).substring(7)}`;
        // We append sessionId and plan to successUrl to simulate Stripe's behavior and pass context
        const url = `${options.successUrl}?session_id=${sessionId}&plan=${options.planName}`;
        return { url, sessionId };
    }

    async cancelSubscription(subscriptionId: string): Promise<void> {
        logger.info({ subscriptionId }, 'Mock provider cancelled subscription');
    }
}

export class PaymentService {
    private prisma: PrismaClient;
    private subscriptionService: SubscriptionService;
    private provider: PaymentProvider;
    private logger = logger.child({ service: 'PaymentService' });

    constructor(prisma: PrismaClient, subscriptionService: SubscriptionService) {
        this.prisma = prisma;
        this.subscriptionService = subscriptionService;
        this.provider = new MockPaymentProvider(); // Default to mock
    }

    /**
     * Initiate a checkout session for a user.
     */
    async createCheckoutSession(userId: string, planName: string, successUrl: string, cancelUrl: string) {
        try {
            // Ensure customer exists
            // We need email for real payments, but for mock we can fake it if missing
            const customerId = await this.subscriptionService.ensureCustomer(userId, `${userId}@example.com`, 'User');

            const session = await this.provider.createCheckoutSession({
                customerId,
                planName,
                successUrl,
                cancelUrl
            });

            this.logger.info({ userId, planName, sessionId: session.sessionId }, 'Created checkout session');
            return session;
        } catch (error) {
            this.logger.error({ error, userId, planName }, 'Failed to create checkout session');
            throw error;
        }
    }

    /**
     * Handle a successful payment (e.g. via webhook or return URL).
     * In a real app, this would verify the session with the provider.
     */
    async handleCheckoutSuccess(sessionId: string, userId: string, planName: string) {
        try {
            this.logger.info({ sessionId, userId, planName }, 'Handling checkout success');

            const customerId = await this.subscriptionService.ensureCustomer(userId, `${userId}@example.com`);

            // Create the subscription in our DB
            // Default to 30 days for now
            await this.subscriptionService.createInternalSubscription(customerId, planName, 30);

            // Also update legacy for backward compatibility
            // This is a bit hacky, accessing private method logic via public interface if possible
            // But we can just use the public redeemCode logic or similar, or just direct DB update
            // Let's use direct DB update for legacy
            const durationMs = 30 * 24 * 60 * 60 * 1000;
            const now = new Date();
            const expiresAt = new Date(now.getTime() + durationMs);

            await this.prisma.userSubscription.upsert({
                where: { userId },
                update: { tier: planName.toUpperCase(), expiresAt },
                create: { userId, tier: planName.toUpperCase(), expiresAt }
            });

            return { success: true };
        } catch (error) {
            this.logger.error({ error, sessionId }, 'Failed to handle checkout success');
            throw error;
        }
    }
}
