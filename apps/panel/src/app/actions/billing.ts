'use server';

import { auth } from '@/app/auth';
import { paymentService, subscriptionService } from '@discord-bot/database';

export async function createCheckoutSession(planName: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const userId = session.user.id;
    const successUrl = `${process.env.NEXT_PUBLIC_PANEL_URL || 'http://localhost:3000'}/dashboard/subscription/success`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_PANEL_URL || 'http://localhost:3000'}/dashboard/subscription`;

    try {
        const checkout = await paymentService.createCheckoutSession(userId, planName, successUrl, cancelUrl);
        return { url: checkout.url };
    } catch (error) {
        console.error('Failed to create checkout session:', error);
        throw new Error('Failed to initiate checkout');
    }
}

export async function getUserSubscription() {
    const session = await auth();
    if (!session?.user?.id) {
        return null;
    }

    try {
        const tier = await subscriptionService.getUserTier(session.user.id);
        return { tier };
    } catch (error) {
        console.error('Failed to get user subscription:', error);
        return { tier: 'FREE' };
    }
}

export async function finalizeSubscription(sessionId: string, planName: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    try {
        await paymentService.handleCheckoutSuccess(sessionId, session.user.id, planName);
        return { success: true };
    } catch (error) {
        console.error('Failed to finalize subscription:', error);
        throw new Error('Failed to finalize subscription');
    }
}
