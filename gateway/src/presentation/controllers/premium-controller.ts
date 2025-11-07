/**
 * Premium Controller
 * Handles premium subscription commands, demo tooling, and plan switching.
 */

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Colors,
  ButtonInteraction,
  PermissionsBitField,
  GuildMember,
} from 'discord.js';
import { SubscriptionService,
  getPlanByTier,
  formatPrice,
  getAllPlans,
  needsUpgrade } from '@discord-bot/subscription';
import { prisma, SubscriptionTier, BillingInterval } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';

type PremiumControllerOptions = {
  testGuildIds?: string[];
};

type _PlanButtonMeta = {
  tier: SubscriptionTier;
  label: string;
  description: string;
};

const PLAN_ORDER: SubscriptionTier[] = [
  SubscriptionTier.FREE,
  SubscriptionTier.BASIC,
  SubscriptionTier.PREMIUM,
  SubscriptionTier.ENTERPRISE,
];

const TIER_EMOJIS: Record<SubscriptionTier, string> = {
  [SubscriptionTier.FREE]: '🪙',
  [SubscriptionTier.BASIC]: '💠',
  [SubscriptionTier.PREMIUM]: '💎',
  [SubscriptionTier.ENTERPRISE]: '🏢',
};

export class PremiumController {
  private readonly subscriptionService: SubscriptionService;
  private readonly testGuildIds: Set<string>;

  constructor(options: PremiumControllerOptions = {}) {
    const testGuildIds = (options.testGuildIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
    this.subscriptionService = new SubscriptionService(prisma, { testGuildIds });
    this.testGuildIds = new Set(testGuildIds);
  }

  /**
   * Register premium slash commands.
   */
  public getCommands() {
    const builder = new SlashCommandBuilder()
      .setName('premium')
      .setDescription('Manage your premium subscription')
      .addSubcommand((sub) =>
        sub.setName('status').setDescription('Check your current subscription status'),
      )
      .addSubcommand((sub) =>
        sub.setName('plans').setDescription('View available subscription plans'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('upgrade')
          .setDescription('Upgrade your subscription')
          .addStringOption((opt) =>
            opt
              .setName('tier')
              .setDescription('Subscription tier to upgrade to')
              .setRequired(true)
              .addChoices(
                { name: 'Basic - $4.99/month', value: 'BASIC' },
                { name: 'Premium - $9.99/month', value: 'PREMIUM' },
                { name: 'Enterprise - Contact Sales', value: 'ENTERPRISE' },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('features').setDescription('View premium features for your plan'),
      )
      .addSubcommand((sub) =>
        sub.setName('usage').setDescription('Check your usage statistics'),
      )
      .addSubcommand((sub) =>
        sub.setName('cancel').setDescription('Cancel your subscription'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('demo')
          .setDescription('Open the premium demo panel (test guilds only)'),
      );

    return [builder.toJSON()];
  }

  /**
   * Entry point for premium slash commands.
   */
  public async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'status':
          await this.handleStatus(interaction);
          break;
        case 'plans':
          await this.handlePlans(interaction);
          break;
        case 'upgrade':
          await this.handleUpgrade(interaction);
          break;
        case 'features':
          await this.handleFeatures(interaction);
          break;
        case 'usage':
          await this.handleUsage(interaction);
          break;
        case 'cancel':
          await this.handleCancel(interaction);
          break;
        case 'demo':
          await this.handleDemo(interaction);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown premium subcommand',
            ephemeral: true,
          });
      }
    } catch (error) {
      logger.error({ error, guildId: interaction.guildId }, 'Error handling premium command');
      const alreadyReplied = interaction.deferred || interaction.replied;
      const payload = {
        content:
          '❌ An error occurred while processing your request. Please try again later.',
        ephemeral: true,
      };
      if (alreadyReplied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }
  }

  /**
   * Initializes demo guilds with ENTERPRISE tier on startup.
   */
  public async initializeTestGuilds(): Promise<void> {
    if (this.testGuildIds.size === 0) return;

    for (const guildId of this.testGuildIds) {
      try {
        await this.ensureGuildTier(guildId, SubscriptionTier.ENTERPRISE);
      } catch (error) {
        logger.warn({ error, guildId }, 'Failed to bootstrap premium test guild');
      }
    }
  }

  /**
   * Handles plan selection buttons triggered from the demo panel.
   */
  public async handlePlanButton(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: 'This action is server-only.', ephemeral: true });
      return;
    }

    if (!this.isTestGuild(guildId)) {
      await interaction.reply({
        content: '🚫 Plan switching is restricted to the QA test guilds.',
        ephemeral: true,
      });
      return;
    }

    const hasPermission = await this.ensureManageGuildPermissions(interaction);
    if (!hasPermission) {
      return;
    }

    const [, tierValue] = interaction.customId.split(':');
    if (!tierValue || !(tierValue in SubscriptionTier)) {
      await interaction.reply({
        content: '❌ Invalid plan selection.',
        ephemeral: true,
      });
      return;
    }

    const targetTier = SubscriptionTier[tierValue as keyof typeof SubscriptionTier];
    await this.setGuildTier(guildId, targetTier);

    const view = await this.buildPlansView(guildId);
    view.embed.setFooter({
      text: `${getPlanByTier(targetTier).displayName} plan activated for testing ✅`,
    });

    await interaction.update({
      embeds: [view.embed],
      components: view.components,
    });
  }

  /**
   * Handle /premium status
   */
  private async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subscription = await this.subscriptionService.getSubscription(guildId);
    const plan = getPlanByTier(subscription.tier);

    const embed = new EmbedBuilder()
      .setTitle('📊 Subscription Status')
      .setColor(this.getTierColor(subscription.tier))
      .addFields(
        { name: '🎫 Current Plan', value: `${plan.displayName}`, inline: true },
        {
          name: '📈 Status',
          value: subscription.isActive ? '✅ Active' : '❌ Inactive',
          inline: true,
        },
        {
          name: '💰 Price',
          value:
            subscription.tier === SubscriptionTier.FREE
              ? 'Free Forever'
              : formatPrice(plan.price.monthly, 'monthly'),
          inline: true,
        },
      );

    if (subscription.currentPeriodEnd) {
      embed.addFields({
        name: '📅 Renews On',
        value: `<t:${Math.floor(subscription.currentPeriodEnd.getTime() / 1000)}:F>`,
        inline: true,
      });
    }

    if (subscription.isTrialing && subscription.currentPeriodEnd) {
      embed.addFields({
        name: '🎁 Trial Ends',
        value: `<t:${Math.floor(subscription.currentPeriodEnd.getTime() / 1000)}:R>`,
        inline: true,
      });
    }

    if (subscription.cancelAtPeriodEnd) {
      embed.setFooter({
        text: '⚠️ Your subscription will not renew at the end of this period',
      });
    }

    const components = this.isTestGuild(guildId)
      ? this.buildPlanButtons(subscription.tier)
      : [];

    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  }

  /**
   * Handle /premium plans
   */
  private async handlePlans(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const view = await this.buildPlansView(guildId);

    await interaction.reply({
      embeds: [view.embed],
      components: view.components,
      ephemeral: true,
    });
  }

  /**
   * Handle /premium demo (test guilds only)
   */
  private async handleDemo(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;

    if (!this.isTestGuild(guildId)) {
      await interaction.reply({
        content:
          '🚫 The premium demo panel is restricted to QA guilds configured in `PREMIUM_TEST_GUILD_IDS`.',
        ephemeral: true,
      });
      return;
    }

    const hasPermission = await this.ensureManageGuildPermissions(interaction);
    if (!hasPermission) {
      return;
    }

    const view = await this.buildPlansView(guildId);
    view.embed.setDescription(
      'Use the buttons below to switch between tiers instantly. This only affects the current guild and is intended for QA.',
    );

    await interaction.reply({
      embeds: [view.embed],
      components: view.components,
      ephemeral: true,
    });
  }

  /**
   * Handle /premium upgrade
   */
  private async handleUpgrade(interaction: ChatInputCommandInteraction): Promise<void> {
    const tierValue = interaction.options.getString('tier', true);

    // Convert string to proper SubscriptionTier enum
    const targetTier = SubscriptionTier[tierValue as keyof typeof SubscriptionTier];

    if (!targetTier) {
      await interaction.reply({
        content: '❌ Invalid subscription tier selected.',
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guildId!;

    if (this.isTestGuild(guildId)) {
      const hasPermission = await this.ensureManageGuildPermissions(interaction);
      if (!hasPermission) return;

      await this.setGuildTier(guildId, targetTier);
      await interaction.reply({
        content: `✅ Test guild upgraded to **${getPlanByTier(targetTier).displayName}**.`,
        ephemeral: true,
      });
      return;
    }

    const currentSubscription = await this.subscriptionService.getSubscription(guildId);
    if (!needsUpgrade(currentSubscription.tier, targetTier)) {
      await interaction.reply({
        content: '❌ You are already on this tier or a higher one.',
        ephemeral: true,
      });
      return;
    }

    const targetPlan = getPlanByTier(targetTier);
    const embed = new EmbedBuilder()
      .setTitle(`⬆️ Upgrade to ${targetPlan.displayName}`)
      .setDescription(targetPlan.description)
      .setColor(this.getTierColor(targetTier))
      .addFields(
        {
          name: '💰 Price',
          value: formatPrice(targetPlan.price.monthly, 'monthly'),
          inline: true,
        },
        {
          name: '📊 Current Plan',
          value: getPlanByTier(currentSubscription.tier).displayName,
          inline: true,
        },
      );

    if (targetTier === SubscriptionTier.ENTERPRISE) {
      embed.setDescription(
        'Enterprise plan requires custom pricing. Please contact our sales team.',
      );
      const button = new ButtonBuilder()
        .setLabel('Contact Sales')
        .setStyle(ButtonStyle.Link)
        .setURL('https://discordmusicbot.com/contact');

      await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
        ephemeral: true,
      });
      return;
    }

    const paymentButton = new ButtonBuilder()
      .setCustomId(`premium_checkout_${targetTier}`)
      .setLabel('Continue to Payment')
      .setStyle(ButtonStyle.Success)
      .setEmoji('💳');

    const cancelButton = new ButtonBuilder()
      .setCustomId('premium_upgrade_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(paymentButton, cancelButton)],
      ephemeral: true,
    });
  }

  /**
   * Handle /premium features
   */
  private async handleFeatures(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subscription = await this.subscriptionService.getSubscription(guildId);
    const plan = getPlanByTier(subscription.tier);

    const embed = new EmbedBuilder()
      .setTitle(`🎵 ${plan.displayName} Features`)
      .setColor(this.getTierColor(subscription.tier))
      .setDescription('Here are all the features available in your current plan:');

    // Playback Features
    const playbackFeatures = [
      `🎵 ${plan.features.concurrentPlaybacks === -1 ? 'Unlimited' : plan.features.concurrentPlaybacks} concurrent playbacks`,
      `🎧 ${plan.features.audioQuality.toUpperCase()} audio quality`,
      plan.features.autoplayEnabled
        ? '✅ Autoplay with smart recommendations'
        : '❌ Autoplay not available',
    ];

    embed.addFields({
      name: '🎵 Playback',
      value: playbackFeatures.join('\n'),
      inline: false,
    });

    // Commands
    const commandFeatures = [
      plan.features.basicCommands ? '✅ Basic commands' : '❌ Basic commands',
      plan.features.advancedCommands ? '✅ Advanced commands' : '❌ Advanced commands',
      plan.features.premiumCommands ? '✅ Premium commands' : '❌ Premium commands',
    ];

    embed.addFields({
      name: '🛠️ Commands',
      value: commandFeatures.join('\n'),
      inline: false,
    });

    // Analytics
    const analyticsFeatures = [
      plan.features.analyticsEnabled ? '✅ Usage analytics' : '❌ Usage analytics',
      plan.features.advancedAnalytics ? '✅ Advanced analytics' : '❌ Advanced analytics',
    ];

    embed.addFields({
      name: '📊 Analytics',
      value: analyticsFeatures.join('\n'),
      inline: false,
    });

    // Support
    embed.addFields({
      name: '🆘 Support',
      value: `Support Level: **${plan.features.supportLevel}**`,
      inline: false,
    });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  }

  /**
   * Handle /premium usage
   */
  private async handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const stats = await this.subscriptionService.getUsageStats(guildId);

    if (!stats) {
      await interaction.reply({
        content: '❌ Unable to retrieve usage statistics',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 Usage Statistics')
      .setColor(Colors.Blue)
      .addFields(
        {
          name: '📈 Current Period',
          value:
            `**Tracks Played:** ${stats.current.tracksPlayed.toLocaleString()}\n` +
            `**Playback Time:** ${Math.floor(stats.current.playbackMinutes / 60)}h ${
              stats.current.playbackMinutes % 60
            }m\n` +
            `**API Requests:** ${stats.current.apiRequests.toLocaleString()}`,
          inline: true,
        },
        {
          name: '🏆 Lifetime',
          value:
            `**Total Tracks:** ${stats.lifetime.totalTracksPlayed.toLocaleString()}\n` +
            `**Total Time:** ${Math.floor(stats.lifetime.totalPlaybackMinutes / 60)}h\n` +
            `**Total Requests:** ${stats.lifetime.totalApiRequests.toLocaleString()}`,
          inline: true,
        },
      )
      .setFooter({
        text: `Period: ${stats.current.periodStart.toLocaleDateString()} - ${stats.current.periodEnd.toLocaleDateString()}`,
      });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  }

  /**
   * Handle /premium cancel
   */
  private async handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subscription = await this.subscriptionService.getSubscription(guildId);

    if (subscription.tier === SubscriptionTier.FREE) {
      await interaction.reply({
        content: '❌ You are already on the free plan.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Cancel Subscription')
      .setDescription(
        'Are you sure you want to cancel your subscription?\n\n' +
          '• You will keep access until the end of your current billing period\n' +
          '• Your subscription will then downgrade to the Free plan\n' +
          '• You can upgrade again at any time',
      )
      .setColor(Colors.Orange);

    if (subscription.currentPeriodEnd) {
      embed.addFields({
        name: '📅 Access Until',
        value: `<t:${Math.floor(subscription.currentPeriodEnd.getTime() / 1000)}:F>`,
      });
    }

    const confirmButton = new ButtonBuilder()
      .setCustomId('premium_cancel_confirm')
      .setLabel('Confirm Cancellation')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⚠️');

    const cancelButton = new ButtonBuilder()
      .setCustomId('premium_cancel_abort')
      .setLabel('Keep Subscription')
      .setStyle(ButtonStyle.Secondary);

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton)],
      ephemeral: true,
    });
  }

  /**
   * Builds the plans embed + components for the current guild.
   */
  private async buildPlansView(guildId: string): Promise<{
    embed: EmbedBuilder;
    components: ActionRowBuilder<ButtonBuilder>[];
  }> {
    const subscription = await this.subscriptionService.getSubscription(guildId);
    const plans = getAllPlans().sort(
      (a, b) => PLAN_ORDER.indexOf(a.tier) - PLAN_ORDER.indexOf(b.tier),
    );

    const embed = new EmbedBuilder()
      .setTitle('🎯 Subscription Plans')
      .setColor(Colors.Gold)
      .setDescription(
        'Compare plans and select the tier that matches your community. QA guilds can switch instantly for testing.',
      );

    for (const plan of plans) {
      const isCurrent = plan.tier === subscription.tier;
      const price =
        plan.tier === SubscriptionTier.FREE
          ? 'Free Forever'
          : `${formatPrice(plan.price.monthly, 'monthly')} • ${formatPrice(plan.price.yearly, 'yearly')} yearly`;

      const bulletPoints = [
        `🎵 ${plan.features.concurrentPlaybacks === -1 ? 'Unlimited' : plan.features.concurrentPlaybacks} concurrent playbacks`,
        `📊 Queue size: ${plan.limits.maxQueueSize === -1 ? 'Unlimited' : plan.limits.maxQueueSize}`,
        `🗂️ Max song duration: ${
          plan.limits.maxSongDuration === -1
            ? 'Unlimited'
            : `${Math.round(plan.limits.maxSongDuration / 60)} minutes`
        }`,
        `🎧 Audio quality: **${plan.features.audioQuality.toUpperCase()}**`,
        plan.features.autoplayEnabled ? '✅ Smart autoplay modes' : '❌ Autoplay disabled',
        plan.features.advancedCommands ? '✅ Advanced commands' : '❌ Basic commands only',
      ];

      embed.addFields({
        name: `${isCurrent ? '⭐ ' : ''}${TIER_EMOJIS[plan.tier]} ${plan.displayName} — ${price}`,
        value: bulletPoints.join('\n'),
        inline: false,
      });
    }

    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (this.isTestGuild(guildId)) {
      components.push(...this.buildPlanButtons(subscription.tier));
    }

    // Always add pricing docs link
    const docsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View full comparison')
        .setStyle(ButtonStyle.Link)
        .setURL('https://discordmusicbot.com/pricing')
        .setEmoji('📚'),
    );
    components.push(docsRow);

    return { embed, components };
  }

  /**
   * Builds a row of selector buttons for plan switching (test guilds only).
   */
  private buildPlanButtons(currentTier: SubscriptionTier): ActionRowBuilder<ButtonBuilder>[] {
    const buttons: ButtonBuilder[] = PLAN_ORDER.map((tier) => {
      const plan = getPlanByTier(tier);
      const isCurrent = tier === currentTier;

      return new ButtonBuilder()
        .setCustomId(`premium_plan:${tier}`)
        .setLabel(`${plan.displayName}`)
        .setStyle(isCurrent ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setEmoji(TIER_EMOJIS[tier])
        .setDisabled(isCurrent);
    });

    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
    ];
  }

  /**
   * Ensures a guild has at least the provided tier.
   */
  private async ensureGuildTier(guildId: string, tier: SubscriptionTier): Promise<void> {
    const subscription = await this.subscriptionService.getSubscription(guildId);
    if (subscription.tier === tier) return;

    await this.setGuildTier(guildId, tier);
  }

  /**
   * Updates the guild subscription tier.
   */
  private async setGuildTier(guildId: string, tier: SubscriptionTier): Promise<void> {
      const params = tier === SubscriptionTier.FREE
        ? { tier, cancelAtPeriodEnd: false }
        : { tier, billingCycle: BillingInterval.MONTH, cancelAtPeriodEnd: false };

      await this.subscriptionService.updateSubscription(guildId, params);
  }

  /**
   * Validates that the user can manage the guild.
   */
  private async ensureManageGuildPermissions(
    interaction: ButtonInteraction | ChatInputCommandInteraction,
  ): Promise<boolean> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This action can only be performed inside a guild.',
        ephemeral: true,
      });
      return false;
    }

    let member: GuildMember | null = null;
    if (interaction.member instanceof GuildMember) {
      member = interaction.member;
    } else if (interaction.user) {
      try {
        member = await guild.members.fetch(interaction.user.id);
      } catch {
        member = null;
      }
    }

    if (!member || !member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      await interaction.reply({
        content: '🚫 You need the **Manage Server** permission to change plans.',
        ephemeral: true,
      });
      return false;
    }

    return true;
  }

  /**
   * Determines whether the guild is registered as a premium test guild.
   */
  private isTestGuild(guildId?: string | null): boolean {
    if (!guildId) return false;
    return this.testGuildIds.has(guildId);
  }

  /**
   * Get color based on tier.
   */
  private getTierColor(tier: SubscriptionTier): number {
    switch (tier) {
      case SubscriptionTier.FREE:
        return Colors.Grey;
      case SubscriptionTier.BASIC:
        return Colors.Blue;
      case SubscriptionTier.PREMIUM:
        return Colors.Gold;
      case SubscriptionTier.ENTERPRISE:
        return Colors.Purple;
      default:
        return Colors.Grey;
    }
  }
}
