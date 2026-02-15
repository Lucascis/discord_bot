import { SubscriptionSuccess } from '@/components/SubscriptionSuccess';
import { Suspense } from 'react';

export default function SubscriptionSuccessPage() {
    return (
        <Suspense fallback={<div className="text-white">Loading...</div>}>
            <SubscriptionSuccess />
        </Suspense>
    );
}
