/**
 * Subscription Middleware
 *
 * Validates subscription features and usage limits before command execution.
 * Provides consistent error handling and upgrade prompts.
 *
 * @module gateway/middleware/subscription-middleware
 */

import { CommandInteraction, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Colors } from 'discord.js';
import { SubscriptionService, getNextTier, getPlanByTier, formatPrice } from '@discord-bot/subscription';
import { prisma, SubscriptionTier } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';

export interface SubscriptionCheckOptions {
  /** Feature key to check access for */
  featureKey?: string;
  /** Usage limit type to check */
  limitType?: string;
  /** Amount to increment limit by if check passes */
  incrementAmount?: number;
  /** Whether to show upgrade prompt on failure */
  showUpgradePrompt?: boolean;
}

export interface SubscriptionCheckResult {
  /** Whether the check passed */
  allowed: boolean;
  /** Error message if check failed */
  errorMessage?: string;
  /** Current subscription tier */
  tier?: SubscriptionTier;
  /** Subscription is active */
  isActive?: boolean;
}

/**
 * Subscription Middleware
 * Provides enterprise-grade validation and error handling
 */
export class SubscriptionMiddleware {
  private subscriptionService: SubscriptionService;

  constructor() {
    this.subscriptionService = new SubscriptionService(prisma);
  }

  /**
   * Check if guild has access to a feature
   *
   * @param interaction - Discord interaction
   * @param featureKey - Feature key to check
   * @param options - Additional options
   * @returns Promise<SubscriptionCheckResult>
   */
  async checkFeatureAccess(
    interaction: CommandInteraction,
    featureKey: string,
    options: { showUpgradePrompt?: boolean } = {}
  ): Promise<SubscriptionCheckResult> {
    const guildId = interaction.guildId;

    if (!guildId) {
      return {
        allowed: false,
        errorMessage: 'This command can only be used in a server.',
      };
    }

    try {
      const subscription = await this.subscriptionService.getSubscription(guildId);
      const featureAccess = await this.subscriptionService.checkFeatureAccess(guildId, featureKey);

      if (!subscription.isActive) {
        await this.sendInactiveSubscriptionMessage(interaction);
        return {
          allowed: false,
          errorMessage: 'Subscription is not active',
          tier: subscription.tier,
          isActive: false,
        };
      }

      if (!featureAccess.hasAccess) {
        if (options.showUpgradePrompt !== false) {
          await this.sendFeatureAccessDenied(interaction, featureKey, subscription.tier);
        }

        logger.info(
          { guildId, featureKey, tier: subscription.tier },
          'Feature access denied'
        );

        return {
          allowed: false,
          errorMessage: featureAccess.upgradeMessage || 'Feature not available in your plan',
          tier: subscription.tier,
          isActive: true,
        };
      }

      return {
        allowed: true,
        tier: subscription.tier,
        isActive: true,
      };
    } catch (error) {
      logger.error({ error, guildId, featureKey }, 'Error checking feature access');

      await interaction.reply({
        content: '❌ An error occurred while checking your subscription. Please try again later.',
        ephemeral: true,
      });

      return {
        allowed: false,
        errorMessage: 'Internal error',
      };
    }
  }

  /**
   * Check if guild is within usage limit
   *
   * @param interaction - Discord interaction
   * @param limitType - Limit type to check
   * @param options - Additional options
   * @returns Promise<SubscriptionCheckResult>
   */
  async checkUsageLimit(
    interaction: CommandInteraction,
    limitType: string,
    options: { incrementAmount?: number; showUpgradePrompt?: boolean } = {}
  ): Promise<SubscriptionCheckResult> {
    const guildId = interaction.guildId;

    if (!guildId) {
      return {
        allowed: false,
        errorMessage: 'This command can only be used in a server.',
      };
    }

    try {
      const subscription = await this.subscriptionService.getSubscription(guildId);
      const limitCheck = await this.subscriptionService.checkUsageLimit(guildId, limitType);

      if (!limitCheck.withinLimit) {
        if (options.showUpgradePrompt !== false) {
          await this.sendUsageLimitReached(interaction, limitType, limitCheck, subscription.tier);
        }

        logger.info(
          { guildId, limitType, current: limitCheck.currentValue, max: limitCheck.maxValue },
          'Usage limit reached'
        );

        return {
          allowed: false,
          errorMessage: limitCheck.upgradeMessage || 'Usage limit reached',
          tier: subscription.tier,
          isActive: subscription.isActive,
        };
      }

      // Increment usage if specified
      if (options.incrementAmount && options.incrementAmount > 0) {
        await this.subscriptionService.incrementUsage(guildId, limitType, options.incrementAmount);
      }

      return {
        allowed: true,
        tier: subscription.tier,
        isActive: subscription.isActive,
      };
    } catch (error) {
      logger.error({ error, guildId, limitType }, 'Error checking usage limit');

      await interaction.reply({
        content: '❌ An error occurred while checking your usage limits. Please try again later.',
        ephemeral: true,
      });

      return {
        allowed: false,
        errorMessage: 'Internal error',
      };
    }
  }

  /**
   * Comprehensive subscription check
   * Validates both feature access and usage limits
   *
   * @param interaction - Discord interaction
   * @param options - Check options
   * @returns Promise<SubscriptionCheckResult>
   */
  async checkSubscription(
    interaction: CommandInteraction,
    options: SubscriptionCheckOptions = {}
  ): Promise<SubscriptionCheckResult> {
    // Check feature access if specified
    if (options.featureKey) {
      const featureResult = await this.checkFeatureAccess(
        interaction,
        options.featureKey,
        { showUpgradePrompt: options.showUpgradePrompt }
      );

      if (!featureResult.allowed) {
        return featureResult;
      }
    }

    // Check usage limit if specified
    if (options.limitType) {
      const limitResult = await this.checkUsageLimit(
        interaction,
        options.limitType,
        {
          incrementAmount: options.incrementAmount,
          showUpgradePrompt: options.showUpgradePrompt,
        }
      );

      if (!limitResult.allowed) {
        return limitResult;
      }
    }

    return { allowed: true };
  }

  /**
   * Send inactive subscription message
   */
  private async sendInactiveSubscriptionMessage(interaction: CommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Subscription Inactive')
      .setDescription(
        'Your subscription is currently inactive.\n\n' +
        'This could be due to:\n' +
        '• Expired trial period\n' +
        '• Failed payment\n' +
        '• Canceled subscription\n\n' +
        'Please renew your subscription to continue using premium features.'
      )
      .setColor(Colors.Orange);

    const renewButton = new ButtonBuilder()
      .setCustomId('premium_renew')
      .setLabel('Renew Subscription')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('💎');

    const supportButton = new ButtonBuilder()
      .setLabel('Contact Support')
      .setStyle(ButtonStyle.Link)
      .setURL('https://discord.gg/support');

    await interaction.reply({
      embeds: [embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(renewButton, supportButton),
      ],
      ephemeral: true,
    });
  }

  /**
   * Send feature access denied message with upgrade prompt
   */
  private async sendFeatureAccessDenied(
    interaction: CommandInteraction,
    featureKey: string,
    currentTier: SubscriptionTier
  ): Promise<void> {
    const nextTier = getNextTier(currentTier);
    const currentPlan = getPlanByTier(currentTier);

    if (!nextTier) {
      await interaction.reply({
        content: '❌ This feature is not available in any plan.',
        ephemeral: true,
      });
      return;
    }

    const nextPlan = getPlanByTier(nextTier);

    const embed = new EmbedBuilder()
      .setTitle('🔒 Premium Feature')
      .setDescription(
        `This feature requires **${nextPlan.displayName}** tier or higher.\n\n` +
        `You are currently on the **${currentPlan.displayName}** plan.`
      )
      .setColor(Colors.Gold)
      .addFields(
        {
          name: '✨ Upgrade Benefits',
          value: `• Access to ${featureKey.replace(/_/g, ' ')}\n` +
            `• ${nextPlan.features.concurrentPlaybacks === -1 ? 'Unlimited' : nextPlan.features.concurrentPlaybacks} concurrent playbacks\n` +
            `• ${nextPlan.features.audioQuality} audio quality\n` +
            `• And many more features!`,
        },
        {
          name: '💰 Pricing',
          value: formatPrice(nextPlan.price.monthly, 'monthly'),
          inline: true,
        }
      );

    const upgradeButton = new ButtonBuilder()
      .setCustomId(`premium_upgrade_${nextTier}`)
      .setLabel(`Upgrade to ${nextPlan.displayName}`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('⬆️');

    const viewPlansButton = new ButtonBuilder()
      .setCustomId('premium_view_plans')
      .setLabel('View All Plans')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📋');

    await interaction.reply({
      embeds: [embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(upgradeButton, viewPlansButton),
      ],
      ephemeral: true,
    });
  }

  /**
   * Send usage limit reached message with upgrade prompt
   */
  private async sendUsageLimitReached(
    interaction: CommandInteraction,
    limitType: string,
    limitCheck: any,
    currentTier: SubscriptionTier
  ): Promise<void> {
    const nextTier = getNextTier(currentTier);
    const currentPlan = getPlanByTier(currentTier);

    if (!nextTier) {
      await interaction.reply({
        content: `❌ You've reached the maximum ${limitType} limit.`,
        ephemeral: true,
      });
      return;
    }

    const nextPlan = getPlanByTier(nextTier);
    const nextTierLimit = nextPlan.limits.maxQueueSize; // Adjust based on limitType

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Usage Limit Reached')
      .setDescription(
        `You've reached your **${limitType.replace(/_/g, ' ')}** limit.\n\n` +
        `**Current Usage:** ${limitCheck.currentValue}/${limitCheck.maxValue}\n` +
        `**Plan:** ${currentPlan.displayName}`
      )
      .setColor(Colors.Orange)
      .addFields({
        name: '⬆️ Upgrade for More',
        value: `**${nextPlan.displayName}** offers:\n` +
          `• ${nextTierLimit === -1 ? 'Unlimited' : nextTierLimit} ${limitType.replace(/_/g, ' ')}\n` +
          `• Priority support\n` +
          `• Advanced features`,
      });

    if (limitCheck.resetDate) {
      embed.addFields({
        name: '🔄 Reset Date',
        value: `<t:${Math.floor(limitCheck.resetDate.getTime() / 1000)}:R>`,
        inline: true,
      });
    }

    const upgradeButton = new ButtonBuilder()
      .setCustomId(`premium_upgrade_${nextTier}`)
      .setLabel(`Upgrade to ${nextPlan.displayName}`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('💎');

    await interaction.reply({
      embeds: [embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(upgradeButton),
      ],
      ephemeral: true,
    });
  }

  /**
   * Get usage percentage as emoji indicator
   */
  private getUsageIndicator(percentage: number): string {
    if (percentage >= 90) return '🔴';
    if (percentage >= 75) return '🟡';
    return '🟢';
  }
}

/**
 * Global subscription middleware instance
 */
export const subscriptionMiddleware = new SubscriptionMiddleware();

/**
 * Helper decorator for command handlers
 * Automatically validates subscription before executing command
 *
 * @example
 * ```typescript
 * @RequireFeature('advanced_commands')
 * async handleCommand(interaction: CommandInteraction) {
 *   // Command logic here
 * }
 * ```
 */
export function RequireFeature(featureKey: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (interaction: CommandInteraction, ...args: any[]) {
      const result = await subscriptionMiddleware.checkFeatureAccess(interaction, featureKey);

      if (!result.allowed) {
        return; // Error message already sent by middleware
      }

      return originalMethod.apply(this, [interaction, ...args]);
    };

    return descriptor;
  };
}

/**
 * Helper decorator for usage limit checking
 *
 * @example
 * ```typescript
 * @RequireLimit('queue_size', 1)
 * async handleAddToQueue(interaction: CommandInteraction) {
 *   // Command logic here
 * }
 * ```
 */
export function RequireLimit(limitType: string, incrementAmount: number = 1) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (interaction: CommandInteraction, ...args: any[]) {
      const result = await subscriptionMiddleware.checkUsageLimit(
        interaction,
        limitType,
        { incrementAmount }
      );

      if (!result.allowed) {
        return; // Error message already sent by middleware
      }

      return originalMethod.apply(this, [interaction, ...args]);
    };

    return descriptor;
  };
}

/**
 * Helper decorator for comprehensive subscription check
 *
 * @example
 * ```typescript
 * @RequireSubscription({ featureKey: 'premium_commands', limitType: 'monthly_tracks' })
 * async handlePremiumCommand(interaction: CommandInteraction) {
 *   // Command logic here
 * }
 * ```
 */
export function RequireSubscription(options: SubscriptionCheckOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (interaction: CommandInteraction, ...args: any[]) {
      const result = await subscriptionMiddleware.checkSubscription(interaction, options);

      if (!result.allowed) {
        return; // Error message already sent by middleware
      }

      return originalMethod.apply(this, [interaction, ...args]);
    };

    return descriptor;
  };
}
