import { vi } from 'vitest';

vi.mock('@discord-bot/database', async () => {
    return {
        PrismaClient: vi.fn(),
        SubscriptionTier: {
            FREE: 'FREE',
            BASIC: 'BASIC',
            PREMIUM: 'PREMIUM',
            ENTERPRISE: 'ENTERPRISE',
        },
        SubscriptionStatus: {
            ACTIVE: 'ACTIVE',
            CANCELED: 'CANCELED',
            PAST_DUE: 'PAST_DUE',
            INCOMPLETE: 'INCOMPLETE',
            INCOMPLETE_EXPIRED: 'INCOMPLETE_EXPIRED',
            TRIALING: 'TRIALING',
            UNPAID: 'UNPAID',
            PAUSED: 'PAUSED',
        },
    };
});
