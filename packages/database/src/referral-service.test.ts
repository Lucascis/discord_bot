import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReferralService } from './referral-service.js';
import { PrismaClient } from './client.js';
import { SubscriptionService } from './subscription-service.js';

// Mock Logger
vi.mock('@discord-bot/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

// Mock Prisma
const prismaMock = {
    referral: {
        findUnique: vi.fn(),
        create: vi.fn(),
    },
    promoCode: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    userSubscription: {
        upsert: vi.fn(),
    }
} as unknown as PrismaClient;

// Mock SubscriptionService
const subscriptionServiceMock = {
    ensureCustomer: vi.fn(),
    createInternalSubscription: vi.fn(),
} as unknown as SubscriptionService;

describe('ReferralService', () => {
    let referralService: ReferralService;

    beforeEach(() => {
        referralService = new ReferralService(prismaMock, subscriptionServiceMock);
        vi.clearAllMocks();
    });

    describe('getReferralCode', () => {
        it('should generate a code based on userId', () => {
            const userId = '123456789';
            const code = referralService.getReferralCode(userId);
            expect(code).toBe('REF-123456');
        });
    });

    describe('processReferral', () => {
        it('should create a referral if not exists', async () => {
            const newUserId = 'new-user';
            const referralCode = 'REF-REFERRER';

            // Mock findUnique to return null (no existing referral)
            vi.spyOn(prismaMock.referral, 'findUnique').mockResolvedValue(null);

            await referralService.processReferral(newUserId, referralCode);

            expect(prismaMock.referral.create).toHaveBeenCalledWith({
                data: {
                    referrerId: 'REFERRER',
                    referredId: newUserId,
                    status: 'PENDING'
                }
            });
        });

        it('should not create if referral exists', async () => {
            const newUserId = 'new-user';
            const referralCode = 'REF-REFERRER';

            // Mock findUnique to return existing
            vi.spyOn(prismaMock.referral, 'findUnique').mockResolvedValue({ id: '1' } as any);

            await referralService.processReferral(newUserId, referralCode);

            expect(prismaMock.referral.create).not.toHaveBeenCalled();
        });
    });

    describe('redeemPromoCode', () => {
        it('should redeem a valid code', async () => {
            const userId = 'user-1';
            const code = 'PROMO2025';

            vi.spyOn(prismaMock.promoCode, 'findUnique').mockResolvedValue({
                id: 'p1',
                code,
                tier: 'GOLD',
                durationDays: 30,
                maxUses: 100,
                usedCount: 0,
                expiresAt: new Date(Date.now() + 100000),
            } as any);

            vi.spyOn(subscriptionServiceMock, 'ensureCustomer').mockResolvedValue('cust-1');

            const result = await referralService.redeemPromoCode(userId, code);

            expect(result.success).toBe(true);
            expect(subscriptionServiceMock.ensureCustomer).toHaveBeenCalledWith(userId, expect.stringContaining('@example.com'));
            expect(subscriptionServiceMock.createInternalSubscription).toHaveBeenCalledWith('cust-1', 'GOLD', 30);
            expect(prismaMock.promoCode.update).toHaveBeenCalledWith({
                where: { id: 'p1' },
                data: { usedCount: { increment: 1 } }
            });
        });

        it('should fail if code invalid', async () => {
            vi.spyOn(prismaMock.promoCode, 'findUnique').mockResolvedValue(null);
            const result = await referralService.redeemPromoCode('u1', 'INVALID');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid code');
        });

        it('should fail if code expired', async () => {
            vi.spyOn(prismaMock.promoCode, 'findUnique').mockResolvedValue({
                code: 'EXPIRED',
                expiresAt: new Date(Date.now() - 10000),
            } as any);
            const result = await referralService.redeemPromoCode('u1', 'EXPIRED');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Code expired');
        });
    });
});
