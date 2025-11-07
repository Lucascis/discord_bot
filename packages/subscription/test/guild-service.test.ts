/**
 * GuildService Tests
 * Comprehensive test suite for guild-level subscription management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient, SubscriptionTier, SubscriptionStatus } from '@prisma/client';
import { GuildService } from '../src/guild-service.js';

// Mock Prisma Client
const mockPrisma = {
  guild: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  guildSubscription: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
} as unknown as PrismaClient;

describe('GuildService', () => {
  let guildService: GuildService;
  const testGuildId1 = '123456789012345678';
  const testGuildId2 = '987654321098765432';
  const regularGuildId = '111111111111111111';

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create GuildService with test guild IDs
    guildService = new GuildService(mockPrisma, [testGuildId1, testGuildId2]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getGuildTier', () => {
    it('should return ENTERPRISE for test guilds', async () => {
      // Mock guild creation
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockPrisma.guild.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'guild-1',
        discordGuildId: testGuildId1,
        name: 'Test Guild',
        icon: null,
        ownerId: null,
        isTestGuild: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock subscription not found (will be created)
      (mockPrisma.guildSubscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockPrisma.guildSubscription.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sub-1',
        guildId: 'guild-1',
        tier: SubscriptionTier.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: null,
        mercadopagoSubscriptionId: null,
        paypalSubscriptionId: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        trialStart: null,
        trialEnd: null,
      });

      const tier = await guildService.getGuildTier(testGuildId1);

      expect(tier).toBe(SubscriptionTier.ENTERPRISE);
      expect(mockPrisma.guildSubscription.create).toHaveBeenCalled();
    });

    it('should return FREE for non-existent guilds', async () => {
      // Mock guild creation with FREE tier
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockPrisma.guild.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'guild-2',
        discordGuildId: regularGuildId,
        name: `Guild ${regularGuildId}`,
        icon: null,
        ownerId: null,
        isTestGuild: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock subscription not found
      (mockPrisma.guildSubscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const tier = await guildService.getGuildTier(regularGuildId);

      expect(tier).toBe(SubscriptionTier.FREE);
      expect(mockPrisma.guild.create).toHaveBeenCalled();
    });

    it('should return existing guild tier', async () => {
      // Mock existing guild with PREMIUM tier
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'guild-3',
        discordGuildId: regularGuildId,
        name: 'Premium Guild',
        icon: null,
        ownerId: null,
        isTestGuild: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      (mockPrisma.guildSubscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sub-3',
        guildId: 'guild-3',
        tier: SubscriptionTier.PREMIUM,
        status: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: 'sub_123',
        mercadopagoSubscriptionId: null,
        paypalSubscriptionId: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        trialStart: null,
        trialEnd: null,
      });

      const tier = await guildService.getGuildTier(regularGuildId);

      expect(tier).toBe(SubscriptionTier.PREMIUM);
    });

    it('should handle errors gracefully and return FREE', async () => {
      // Mock error
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Database error')
      );

      const tier = await guildService.getGuildTier(regularGuildId);

      expect(tier).toBe(SubscriptionTier.FREE);
    });
  });

  describe('ensureTestGuild', () => {
    it('should create guild with isTestGuild=true', async () => {
      // Mock guild not found
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      // Mock guild creation
      const mockGuild = {
        id: 'guild-test-1',
        discordGuildId: testGuildId1,
        name: 'Test Guild',
        icon: null,
        ownerId: null,
        isTestGuild: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockPrisma.guild.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockGuild);

      // Mock subscription not found
      (mockPrisma.guildSubscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      // Mock subscription creation
      (mockPrisma.guildSubscription.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sub-test-1',
        guildId: 'guild-test-1',
        tier: SubscriptionTier.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: null,
        mercadopagoSubscriptionId: null,
        paypalSubscriptionId: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        trialStart: null,
        trialEnd: null,
      });

      await guildService.ensureTestGuild(testGuildId1);

      expect(mockPrisma.guild.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discordGuildId: testGuildId1,
          isTestGuild: true,
        }),
      });

      expect(mockPrisma.guildSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          guildId: 'guild-test-1',
          tier: SubscriptionTier.ENTERPRISE,
          status: SubscriptionStatus.ACTIVE,
        }),
      });
    });

    it('should create GuildSubscription with ENTERPRISE tier', async () => {
      // Mock existing guild
      const mockGuild = {
        id: 'guild-test-2',
        discordGuildId: testGuildId2,
        name: 'Test Guild 2',
        icon: null,
        ownerId: null,
        isTestGuild: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockGuild);

      // Mock subscription not found
      (mockPrisma.guildSubscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      // Mock subscription creation
      (mockPrisma.guildSubscription.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sub-test-2',
        guildId: 'guild-test-2',
        tier: SubscriptionTier.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: null,
        mercadopagoSubscriptionId: null,
        paypalSubscriptionId: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        trialStart: null,
        trialEnd: null,
      });

      await guildService.ensureTestGuild(testGuildId2);

      expect(mockPrisma.guildSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tier: SubscriptionTier.ENTERPRISE,
          status: SubscriptionStatus.ACTIVE,
        }),
      });
    });

    it('should update existing subscription to ENTERPRISE if not already', async () => {
      // Mock existing guild
      const mockGuild = {
        id: 'guild-test-3',
        discordGuildId: testGuildId1,
        name: 'Test Guild 3',
        icon: null,
        ownerId: null,
        isTestGuild: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockGuild);

      // Mock existing subscription with BASIC tier
      (mockPrisma.guildSubscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sub-test-3',
        guildId: 'guild-test-3',
        tier: SubscriptionTier.BASIC,
        status: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: null,
        mercadopagoSubscriptionId: null,
        paypalSubscriptionId: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        trialStart: null,
        trialEnd: null,
      });

      // Mock subscription update
      (mockPrisma.guildSubscription.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sub-test-3',
        guildId: 'guild-test-3',
        tier: SubscriptionTier.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: null,
        mercadopagoSubscriptionId: null,
        paypalSubscriptionId: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        trialStart: null,
        trialEnd: null,
      });

      await guildService.ensureTestGuild(testGuildId1);

      expect(mockPrisma.guildSubscription.update).toHaveBeenCalledWith({
        where: { guildId: 'guild-test-3' },
        data: expect.objectContaining({
          tier: SubscriptionTier.ENTERPRISE,
          status: SubscriptionStatus.ACTIVE,
        }),
      });
    });
  });

  describe('getOrCreateGuild', () => {
    it('should return existing guild if found', async () => {
      const mockGuild = {
        id: 'guild-existing',
        discordGuildId: regularGuildId,
        name: 'Existing Guild',
        icon: 'icon-url',
        ownerId: 'owner-123',
        isTestGuild: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockGuild);

      const guild = await guildService.getOrCreateGuild(regularGuildId);

      expect(guild).toEqual(mockGuild);
      expect(mockPrisma.guild.create).not.toHaveBeenCalled();
    });

    it('should create new guild if not found', async () => {
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const mockNewGuild = {
        id: 'guild-new',
        discordGuildId: regularGuildId,
        name: `Guild ${regularGuildId}`,
        icon: null,
        ownerId: null,
        isTestGuild: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.guild.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewGuild);

      const guild = await guildService.getOrCreateGuild(regularGuildId);

      expect(guild).toEqual(mockNewGuild);
      expect(mockPrisma.guild.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discordGuildId: regularGuildId,
          name: `Guild ${regularGuildId}`,
          isTestGuild: false,
        }),
      });
    });

    it('should create guild with custom name and test flag', async () => {
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const mockNewGuild = {
        id: 'guild-custom',
        discordGuildId: testGuildId1,
        name: 'Custom Test Guild',
        icon: null,
        ownerId: null,
        isTestGuild: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.guild.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewGuild);

      const guild = await guildService.getOrCreateGuild(testGuildId1, 'Custom Test Guild', true);

      expect(guild).toEqual(mockNewGuild);
      expect(mockPrisma.guild.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discordGuildId: testGuildId1,
          name: 'Custom Test Guild',
          isTestGuild: true,
        }),
      });
    });
  });

  describe('Multiple test guild IDs', () => {
    it('should handle multiple test guild IDs correctly', async () => {
      // Mock for first test guild
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (mockPrisma.guild.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'guild-1',
        discordGuildId: testGuildId1,
        name: 'Test Guild',
        icon: null,
        ownerId: null,
        isTestGuild: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (mockPrisma.guildSubscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (mockPrisma.guildSubscription.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'sub-1',
        guildId: 'guild-1',
        tier: SubscriptionTier.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: null,
        mercadopagoSubscriptionId: null,
        paypalSubscriptionId: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        trialStart: null,
        trialEnd: null,
      });

      const tier1 = await guildService.getGuildTier(testGuildId1);
      expect(tier1).toBe(SubscriptionTier.ENTERPRISE);

      // Mock for second test guild
      (mockPrisma.guild.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (mockPrisma.guild.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'guild-2',
        discordGuildId: testGuildId2,
        name: 'Test Guild',
        icon: null,
        ownerId: null,
        isTestGuild: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (mockPrisma.guildSubscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (mockPrisma.guildSubscription.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'sub-2',
        guildId: 'guild-2',
        tier: SubscriptionTier.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        stripeSubscriptionId: null,
        mercadopagoSubscriptionId: null,
        paypalSubscriptionId: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        trialStart: null,
        trialEnd: null,
      });

      const tier2 = await guildService.getGuildTier(testGuildId2);
      expect(tier2).toBe(SubscriptionTier.ENTERPRISE);
    });
  });

  describe('isTestGuild', () => {
    it('should return true for test guild IDs', () => {
      expect(guildService.isTestGuild(testGuildId1)).toBe(true);
      expect(guildService.isTestGuild(testGuildId2)).toBe(true);
    });

    it('should return false for non-test guild IDs', () => {
      expect(guildService.isTestGuild(regularGuildId)).toBe(false);
      expect(guildService.isTestGuild('999999999999999999')).toBe(false);
    });
  });

  describe('addTestGuild and removeTestGuild', () => {
    it('should add guild to test guild list', () => {
      const newTestGuildId = '222222222222222222';
      expect(guildService.isTestGuild(newTestGuildId)).toBe(false);

      guildService.addTestGuild(newTestGuildId);
      expect(guildService.isTestGuild(newTestGuildId)).toBe(true);
    });

    it('should remove guild from test guild list', () => {
      expect(guildService.isTestGuild(testGuildId1)).toBe(true);

      guildService.removeTestGuild(testGuildId1);
      expect(guildService.isTestGuild(testGuildId1)).toBe(false);
    });
  });
});
