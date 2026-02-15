'use server';

import { auth } from '@/app/auth';
import { subscriptionService } from '@discord-bot/database';
import { revalidatePath } from 'next/cache';

export async function getUserTier() {
    const session = await auth();
    if (!session?.user?.id) return 'FREE';
    return await subscriptionService.getUserTier(session.user.id);
}

export async function redeemCode(code: string) {
    const session = await auth();
    if (!session?.user?.id) {
        return { success: false, message: 'Not authenticated' };
    }

    const result = await subscriptionService.redeemCode(session.user.id, code);
    revalidatePath('/dashboard/subscription');
    return result;
}

export async function getReferralLink() {
    const session = await auth();
    if (!session?.user?.id) return null;
    // In a real app, this would be a full URL. For now, we return the code (userId).
    return session.user.id;
}
