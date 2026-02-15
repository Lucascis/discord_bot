'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { finalizeSubscription } from '@/app/actions/billing';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

export function SubscriptionSuccess() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState('Verifying payment...');

    useEffect(() => {
        const sessionId = searchParams.get('session_id');
        const plan = searchParams.get('plan');

        if (!sessionId || !plan) {
            setStatus('error');
            setMessage('Invalid session details.');
            return;
        }

        const verify = async () => {
            try {
                await finalizeSubscription(sessionId, plan);
                setStatus('success');
                setMessage(`Successfully subscribed to ${plan}!`);
                router.refresh(); // Refresh server components to update tier
            } catch (error) {
                console.error(error);
                setStatus('error');
                setMessage('Failed to verify subscription. Please contact support.');
            }
        };

        verify();
    }, [searchParams, router]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
            {status === 'loading' && (
                <>
                    <Loader2 className="w-16 h-16 text-brand-500 animate-spin" />
                    <h2 className="text-2xl font-bold text-white">Processing...</h2>
                    <p className="text-white/60">{message}</p>
                </>
            )}

            {status === 'success' && (
                <>
                    <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
                        <CheckCircle className="w-10 h-10" />
                    </div>
                    <h2 className="text-3xl font-bold text-white">Payment Successful!</h2>
                    <p className="text-white/60 text-lg">{message}</p>
                    <Link
                        href="/dashboard/subscription"
                        className="px-8 py-3 bg-white text-black font-bold rounded-xl hover:bg-white/90 transition-colors"
                    >
                        Return to Subscription
                    </Link>
                </>
            )}

            {status === 'error' && (
                <>
                    <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center text-red-500">
                        <XCircle className="w-10 h-10" />
                    </div>
                    <h2 className="text-3xl font-bold text-white">Something went wrong</h2>
                    <p className="text-white/60 text-lg">{message}</p>
                    <Link
                        href="/dashboard/subscription"
                        className="px-8 py-3 bg-white/10 text-white font-bold rounded-xl hover:bg-white/20 transition-colors"
                    >
                        Try Again
                    </Link>
                </>
            )}
        </div>
    );
}
