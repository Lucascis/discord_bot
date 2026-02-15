import { auth } from '@/app/auth';
import { redirect } from 'next/navigation';
import { getGuilds } from '@/lib/guild-client';
import { getUserSubscription } from '@/app/actions/billing';
import { getReferralCode } from '@/app/actions/referral';
import { SubscriptionContent } from '@/components/SubscriptionContent';

export default async function SubscriptionPage() {
    const session = await auth();
    if (!session?.user) {
        redirect('/');
    }

    const guildResponse = await getGuilds(undefined, session.user.id).catch(() => null);
    const guilds = Array.isArray(guildResponse?.data) ? guildResponse.data : [];

    const subscription = await getUserSubscription();
    const referralCode = await getReferralCode();

    return (
        <SubscriptionContent
            guilds={guilds}
            currentTier={subscription?.tier || 'FREE'}
            referralCode={referralCode || ''}
        />
    );
}
