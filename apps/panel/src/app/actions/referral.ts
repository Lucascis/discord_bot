'use server';

import { auth } from '@/app/auth';
import { referralService } from '@discord-bot/database';
import { revalidatePath } from 'next/cache';

export async function getReferralCode() {
    const session = await auth();
    if (!session?.user?.id) {
        return null;
    }
    return referralService.getReferralCode(session.user.id);
}

export async function redeemPromoCode(code: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    try {
        const result = await referralService.redeemPromoCode(session.user.id, code);
        if (result.success) {
            revalidatePath('/dashboard/subscription');
        }
        return result;
    } catch (error) {
        console.error('Failed to redeem code:', error);
        return { success: false, message: 'Failed to redeem code' };
    }
}
