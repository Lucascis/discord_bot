'use client';

import { useState, useEffect } from 'react';
import { getUserTier, redeemCode, getReferralLink } from '@/actions/subscription-actions';
import { motion } from 'framer-motion';

export default function SubscriptionManager() {
    const [tier, setTier] = useState<string>('LOADING');
    const [code, setCode] = useState('');
    const [referralCode, setReferralCode] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        getUserTier().then(setTier);
        getReferralLink().then(setReferralCode);
    }, []);

    const handleRedeem = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code) return;

        setLoading(true);
        setMessage(null);

        try {
            const result = await redeemCode(code);
            setMessage({
                text: result.message,
                type: result.success ? 'success' : 'error'
            });
            if (result.success) {
                setCode('');
                getUserTier().then(setTier); // Refresh tier
            }
        } catch {
            setMessage({ text: 'Failed to redeem code', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const copyReferral = () => {
        if (referralCode) {
            navigator.clipboard.writeText(`https://bot.example.com/invite?ref=${referralCode}`);
            setMessage({ text: 'Referral link copied!', type: 'success' });
        }
    };

    return (
        <div className="space-y-6">
            {/* Current Plan Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl"
            >
                <h2 className="text-2xl font-bold text-white mb-2">Your Plan</h2>
                <div className="flex items-baseline gap-4">
                    <span className={`text-4xl font-black ${tier === 'DIAMOND' ? 'text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]' :
                            tier === 'GOLD' ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' :
                                'text-gray-400'
                        }`}>
                        {tier}
                    </span>
                    {tier === 'FREE' && (
                        <span className="text-gray-400 text-sm">Upgrade to unlock AI DJ & Lossless Audio</span>
                    )}
                </div>
            </motion.div>

            {/* Redeem Code */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl"
            >
                <h3 className="text-xl font-bold text-white mb-4">Redeem Promo Code</h3>
                <form onSubmit={handleRedeem} className="flex gap-4">
                    <input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="ENTER-CODE-HERE"
                        className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors"
                    />
                    <button
                        type="submit"
                        disabled={loading || !code}
                        className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl text-white font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        {loading ? '...' : 'Redeem'}
                    </button>
                </form>
                {message && (
                    <p className={`mt-4 text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                        {message.text}
                    </p>
                )}
            </motion.div>

            {/* Referral System */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl"
            >
                <h3 className="text-xl font-bold text-white mb-2">Refer a Friend</h3>
                <p className="text-gray-400 mb-4">Get 7 days of DIAMOND for every friend who subscribes.</p>

                <div className="flex items-center gap-4 bg-black/20 p-4 rounded-xl border border-white/10">
                    <code className="flex-1 text-purple-300 font-mono">
                        {referralCode ? `https://bot.example.com/invite?ref=${referralCode}` : 'Loading...'}
                    </code>
                    <button
                        onClick={copyReferral}
                        className="text-sm text-white/70 hover:text-white transition-colors"
                    >
                        Copy
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
