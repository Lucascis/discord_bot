/**
 * Guild Service
 * Manages guild-level subscriptions and auto-provisioning for test guilds
 * Separates guild/server subscriptions from user/customer billing
 *
 * @module subscription/guild-service
 */

import { PrismaClient, SubscriptionTier, SubscriptionStatus } from '@prisma/client';
import { logger } from '@discord-bot/logger';

export interface GuildInfo {
  id: string;
  discordGuildId: string;
  name: string;
  icon: string | null;
  ownerId: string | null;
  isTestGuild: boolean;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  isActive: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * GuildService
 * Manages guild subscriptions with automatic test guild provisioning
 */
export class GuildService {
  private testGuildIds: Set<string>;

  constructor(
    private readonly prisma: PrismaClient,
    testGuildIds: string[] = []
  ) {
    this.testGuildIds = new Set(testGuildIds);
    logger.info({ testGuildCount: this.testGuildIds.size }, 'GuildService initialized');
  }

  /**
   * Get guild subscription tier
   * Automatically provisions test guilds with ENTERPRISE tier
   *
   * @param discordGuildId - Discord guild ID
   * @returns Promise<SubscriptionTier>
   */
  async getGuildTier(discordGuildId: string): Promise<SubscriptionTier> {
    try {
      // Check if this is a test guild
      if (this.testGuildIds.has(discordGuildId)) {
        // Auto-provision test guild if it doesn't exist
        await this.ensureTestGuild(discordGuildId);
        return SubscriptionTier.ENTERPRISE;
      }

      // Get or create guild
      const guild = await this.getOrCreateGuild(discordGuildId);

      // Get guild subscription
      const subscription = await this.prisma.guildSubscription.findUnique({
        where: { guildId: guild.id },
      });

      // Return tier or FREE if no subscription exists
      return subscription?.tier || SubscriptionTier.FREE;
    } catch (error) {
      logger.error({ error, discordGuildId }, 'Error getting guild tier');
      // Default to FREE on error
      return SubscriptionTier.FREE;
    }
  }

  /**
   * Ensure test guild exists with ENTERPRISE tier
   * Creates guild and subscription if they don't exist
   *
   * @param discordGuildId - Discord guild ID
   */
  async ensureTestGuild(discordGuildId: string): Promise<void> {
    try {
      // Get or create guild
      const guild = await this.getOrCreateGuild(discordGuildId, 'Test Guild', true);

      // Check if subscription already exists
      const existingSubscription = await this.prisma.guildSubscription.findUnique({
        where: { guildId: guild.id },
      });

      if (existingSubscription) {
        // Update to ENTERPRISE if not already
        if (existingSubscription.tier !== SubscriptionTier.ENTERPRISE) {
          await this.prisma.guildSubscription.update({
            where: { guildId: guild.id },
            data: {
              tier: SubscriptionTier.ENTERPRISE,
              status: SubscriptionStatus.ACTIVE,
            },
          });
          logger.info({ discordGuildId }, 'Updated test guild to ENTERPRISE tier');
        }
        return;
      }

      // Create ENTERPRISE subscription for test guild
      const now = new Date();
      const farFuture = new Date(now.getFullYear() + 100, now.getMonth(), now.getDate());

      await this.prisma.guildSubscription.create({
        data: {
          guildId: guild.id,
          tier: SubscriptionTier.ENTERPRISE,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: farFuture,
          cancelAtPeriodEnd: false,
        },
      });

      logger.info({ discordGuildId }, 'Created ENTERPRISE subscription for test guild');
    } catch (error) {
      logger.error({ error, discordGuildId }, 'Error ensuring test guild');
      throw error;
    }
  }

  /**
   * Get or create guild record
   *
   * @param discordGuildId - Discord guild ID
   * @param name - Guild name (optional)
   * @param isTestGuild - Whether this is a test guild
   * @returns Promise<Guild>
   */
  async getOrCreateGuild(
    discordGuildId: string,
    name?: string,
    isTestGuild = false
  ) {
    try {
      // Try to find existing guild
      let guild = await this.prisma.guild.findUnique({
        where: { discordGuildId },
      });

      if (guild) {
        return guild;
      }

      // Create new guild
      guild = await this.prisma.guild.create({
        data: {
          discordGuildId,
          name: name || `Guild ${discordGuildId}`,
          isTestGuild,
        },
      });

      logger.info({ discordGuildId, isTestGuild }, 'Created new guild record');
      return guild;
    } catch (error) {
      logger.error({ error, discordGuildId }, 'Error getting or creating guild');
      throw error;
    }
  }

  /**
   * Get complete guild information including subscription
   *
   * @param discordGuildId - Discord guild ID
   * @returns Promise<GuildInfo | null>
   */
  async getGuildInfo(discordGuildId: string): Promise<GuildInfo | null> {
    try {
      const guild = await this.prisma.guild.findUnique({
        where: { discordGuildId },
        include: {
          subscription: true,
        },
      });

      if (!guild) {
        return null;
      }

      const subscription = guild.subscription;
      const tier = subscription?.tier || SubscriptionTier.FREE;
      const status = subscription?.status || SubscriptionStatus.ACTIVE;

      // Check if subscription is active
      const isActive = this.isSubscriptionActive(subscription);

      return {
        id: guild.id,
        discordGuildId: guild.discordGuildId,
        name: guild.name,
        icon: guild.icon,
        ownerId: guild.ownerId,
        isTestGuild: guild.isTestGuild,
        tier,
        status,
        isActive,
        currentPeriodStart: subscription?.currentPeriodStart || null,
        currentPeriodEnd: subscription?.currentPeriodEnd || null,
      };
    } catch (error) {
      logger.error({ error, discordGuildId }, 'Error getting guild info');
      return null;
    }
  }

  /**
   * Update guild subscription tier
   *
   * @param discordGuildId - Discord guild ID
   * @param tier - New subscription tier
   */
  async updateGuildTier(discordGuildId: string, tier: SubscriptionTier): Promise<void> {
    try {
      const guild = await this.getOrCreateGuild(discordGuildId);

      const existingSubscription = await this.prisma.guildSubscription.findUnique({
        where: { guildId: guild.id },
      });

      if (existingSubscription) {
        // Update existing subscription
        await this.prisma.guildSubscription.update({
          where: { guildId: guild.id },
          data: { tier },
        });
        logger.info({ discordGuildId, tier }, 'Updated guild subscription tier');
      } else {
        // Create new subscription
        const now = new Date();
        const periodEnd = tier === SubscriptionTier.FREE
          ? new Date(now.getFullYear() + 100, now.getMonth(), now.getDate())
          : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

        await this.prisma.guildSubscription.create({
          data: {
            guildId: guild.id,
            tier,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        });
        logger.info({ discordGuildId, tier }, 'Created guild subscription');
      }
    } catch (error) {
      logger.error({ error, discordGuildId, tier }, 'Error updating guild tier');
      throw error;
    }
  }

  /**
   * Cancel guild subscription
   *
   * @param discordGuildId - Discord guild ID
   * @param immediately - Cancel immediately or at period end
   * @param reason - Cancellation reason
   */
  async cancelGuildSubscription(
    discordGuildId: string,
    immediately = false,
    reason?: string
  ): Promise<void> {
    try {
      const guild = await this.prisma.guild.findUnique({
        where: { discordGuildId },
      });

      if (!guild) {
        throw new Error(`Guild ${discordGuildId} not found`);
      }

      const subscription = await this.prisma.guildSubscription.findUnique({
        where: { guildId: guild.id },
      });

      if (!subscription) {
        throw new Error(`No subscription found for guild ${discordGuildId}`);
      }

      if (immediately) {
        // Cancel immediately and downgrade to FREE
        await this.prisma.guildSubscription.update({
          where: { guildId: guild.id },
          data: {
            tier: SubscriptionTier.FREE,
            status: SubscriptionStatus.CANCELED,
            canceledAt: new Date(),
            cancelReason: reason,
            cancelAtPeriodEnd: false,
          },
        });
        logger.info({ discordGuildId }, 'Immediately canceled guild subscription');
      } else {
        // Cancel at period end
        await this.prisma.guildSubscription.update({
          where: { guildId: guild.id },
          data: {
            cancelAtPeriodEnd: true,
            cancelReason: reason,
          },
        });
        logger.info({ discordGuildId }, 'Scheduled guild subscription cancellation');
      }
    } catch (error) {
      logger.error({ error, discordGuildId }, 'Error canceling guild subscription');
      throw error;
    }
  }

  /**
   * Check if guild subscription is active
   *
   * @param subscription - Guild subscription object
   * @returns boolean
   */
  private isSubscriptionActive(
    subscription: { tier: SubscriptionTier; status: SubscriptionStatus; currentPeriodEnd: Date | null } | null
  ): boolean {
    if (!subscription) return false;

    // FREE tier is always active
    if (subscription.tier === SubscriptionTier.FREE) return true;

    // Check status
    if (subscription.status === SubscriptionStatus.CANCELED) return false;
    if (subscription.status === SubscriptionStatus.UNPAID) return false;
    if (subscription.status === SubscriptionStatus.INCOMPLETE_EXPIRED) return false;

    // Check if period has ended
    if (subscription.currentPeriodEnd && new Date() > subscription.currentPeriodEnd) {
      return false;
    }

    return true;
  }

  /**
   * Add guild ID to test guild list (for runtime updates)
   *
   * @param discordGuildId - Discord guild ID to add
   */
  addTestGuild(discordGuildId: string): void {
    this.testGuildIds.add(discordGuildId);
    logger.info({ discordGuildId }, 'Added guild to test guild list');
  }

  /**
   * Remove guild ID from test guild list
   *
   * @param discordGuildId - Discord guild ID to remove
   */
  removeTestGuild(discordGuildId: string): void {
    this.testGuildIds.delete(discordGuildId);
    logger.info({ discordGuildId }, 'Removed guild from test guild list');
  }

  /**
   * Check if guild is a test guild
   *
   * @param discordGuildId - Discord guild ID
   * @returns boolean
   */
  isTestGuild(discordGuildId: string): boolean {
    return this.testGuildIds.has(discordGuildId);
  }
}
