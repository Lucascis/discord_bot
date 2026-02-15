'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import type { GuildOverview } from '@/lib/guild-client';
import { Check, Loader2 } from 'lucide-react';
import { createCheckoutSession } from '@/app/actions/billing';
import { useRouter } from 'next/navigation';

interface Props {
    guilds: GuildOverview[];
    currentTier: string;
    referralCode: string;
}

const PLANS = [
    {
        name: 'Free',
        price: '$0',
        features: ['Standard Quality', 'Basic Commands', '10 Listeners Limit'],
        tier: 'FREE'
    },
    {
        name: 'Gold',
        price: '$4.99',
        features: ['High Quality', 'Volume Control', '50 Listeners Limit', 'No Vote Skip'],
        tier: 'GOLD'
    },
    {
        name: 'Diamond',
        price: '$9.99',
        features: ['Lossless Quality', 'AI DJ & Recommendations', 'Unlimited Listeners', 'Priority Support'],
        tier: 'DIAMOND',
        popular: true
    }
];

import { redeemPromoCode } from '@/app/actions/referral';
import { Copy, Gift } from 'lucide-react';

export function SubscriptionContent({ guilds, currentTier, referralCode }: Props) {
    const router = useRouter();
    const [loading, setLoading] = useState<string | null>(null);
    const [promoCode, setPromoCode] = useState('');
    const [promoStatus, setPromoStatus] = useState<{ success: boolean; message: string } | null>(null);

    const handleSubscribe = async (planName: string) => {
        if (planName === 'Free') return; // Cannot subscribe to free
        setLoading(planName);
        try {
            const { url } = await createCheckoutSession(planName.toLowerCase());
            window.location.href = url;
        } catch (error) {
            console.error('Checkout failed', error);
            setLoading(null);
        }
    };

    const handleRedeem = async () => {
        if (!promoCode) return;
        setLoading('promo');
        const result = await redeemPromoCode(promoCode);
        setPromoStatus(result);
        setLoading(null);
        if (result.success) {
            setPromoCode('');
            router.refresh();
        }
    };

    const copyReferral = () => {
        navigator.clipboard.writeText(`https://nebudj.com/invite?ref=${referralCode}`);
        // Could add toast here
    };

    return (
        <div className="flex flex-col lg:flex-row gap-8 min-h-[calc(100vh-140px)]">
            <Sidebar
                guilds={guilds}
                onSelect={(guild) => router.push(`/dashboard?guild=${guild.id}`)}
            />

            <main className="flex-1 min-w-0 space-y-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold font-display text-white">Subscription</h1>
                        <p className="text-white/50 text-sm mt-1">Manage your plan and billing</p>
                    </div>
                </div>

                {/* Referral & Promo Section */}
                <div className="grid md:grid-cols-2 gap-6">
                    <div className="glass-card rounded-2xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-brand-500/20 text-brand-400">
                                <Gift size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-white">Referral Program</h3>
                                <p className="text-xs text-white/50">Invite friends, earn rewards</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <code className="flex-1 bg-black/30 rounded-lg px-3 py-2 text-sm text-white/70 font-mono flex items-center">
                                {referralCode || 'Generating...'}
                            </code>
                            <button
                                onClick={copyReferral}
                                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/70"
                            >
                                <Copy size={18} />
                            </button>
                        </div>
                    </div>

                    <div className="glass-card rounded-2xl p-6">
                        <h3 className="font-bold text-white mb-1">Redeem Code</h3>
                        <p className="text-xs text-white/50 mb-4">Have a promo code?</p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={promoCode}
                                onChange={(e) => setPromoCode(e.target.value)}
                                placeholder="ENTER-CODE"
                                className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-brand-500"
                            />
                            <button
                                onClick={handleRedeem}
                                disabled={!promoCode || loading === 'promo'}
                                className="px-4 py-2 bg-white text-black font-bold rounded-lg text-sm hover:bg-white/90 disabled:opacity-50"
                            >
                                {loading === 'promo' ? <Loader2 className="animate-spin" size={16} /> : 'Apply'}
                            </button>
                        </div>
                        {promoStatus && (
                            <p className={`text-xs mt-2 ${promoStatus.success ? 'text-green-400' : 'text-red-400'}`}>
                                {promoStatus.message}
                            </p>
                        )}
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-6">
                    {PLANS.map((plan) => {
                        const isCurrent = currentTier === plan.tier;
                        const isProcessing = loading === plan.name;

                        return (
                            <div
                                key={plan.name}
                                className={`relative rounded-2xl p-6 border ${plan.popular ? 'border-brand-500 bg-brand-500/10' : 'border-white/10 bg-white/5'} flex flex-col`}
                            >
                                {plan.popular && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-brand-500 text-white text-xs font-bold rounded-full uppercase tracking-wider">
                                        Most Popular
                                    </div>
                                )}

                                <div className="mb-4">
                                    <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                                    <div className="flex items-baseline gap-1 mt-2">
                                        <span className="text-3xl font-bold text-white">{plan.price}</span>
                                        <span className="text-white/50 text-sm">/month</span>
                                    </div>
                                </div>

                                <ul className="space-y-3 mb-8 flex-1">
                                    {plan.features.map((feature) => (
                                        <li key={feature} className="flex items-start gap-3 text-sm text-white/70">
                                            <Check className="w-4 h-4 text-brand-400 mt-0.5 shrink-0" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    onClick={() => handleSubscribe(plan.name)}
                                    disabled={isCurrent || !!loading || plan.name === 'Free'}
                                    className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2
                                        ${isCurrent
                                            ? 'bg-white/10 text-white/50 cursor-default'
                                            : plan.popular
                                                ? 'bg-brand-500 hover:bg-brand-400 text-white shadow-lg shadow-brand-500/20'
                                                : 'bg-white text-black hover:bg-white/90'
                                        }
                                        ${loading && !isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                >
                                    {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {isCurrent ? 'Current Plan' : plan.name === 'Free' ? 'Included' : 'Upgrade'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </main>
        </div>
    );
}
