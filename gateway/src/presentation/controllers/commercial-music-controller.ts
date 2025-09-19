import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { PlayMusicUseCase } from '../../application/use-cases/play-music-use-case.js';
import { ControlMusicUseCase } from '../../application/use-cases/control-music-use-case.js';
import { SubscriptionManagementUseCase } from '../../application/use-cases/subscription-management-use-case.js';
import { PlayMusicCommand, PauseMusicCommand, ResumeMusicCommand, StopMusicCommand, SetVolumeCommand } from '../../application/commands/play-music-command.js';
import { MusicUIBuilder } from '../ui/music-ui-builder.js';
import { InteractionResponseHandler } from '../ui/interaction-response-handler.js';

/**
 * Commercial Music Controller
 * Integrates subscription management with music functionality
 */
export class CommercialMusicController {
  constructor(
    private readonly playMusicUseCase: PlayMusicUseCase,
    private readonly controlMusicUseCase: ControlMusicUseCase,
    private readonly subscriptionUseCase: SubscriptionManagementUseCase,
    private readonly uiBuilder: MusicUIBuilder,
    private readonly responseHandler: InteractionResponseHandler
  ) {}

  async handlePlayCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const query = interaction.options.getString('query', true);

    try {
      // Check subscription and feature access
      const canUseFeature = await this.subscriptionUseCase.canUseFeature(interaction.guildId, 'basic_playback');
      if (!canUseFeature) {
        await this.sendSubscriptionUpgradeMessage(interaction);
        return;
      }

      // Validate track duration for plan limits
      // Note: In real implementation, you'd check track duration after search
      await this.subscriptionUseCase.validateUsage(interaction.guildId, {
        trackDuration: 300000 // Example: 5 minutes, would be actual track duration
      });

      // Record the playback for analytics/billing
      await this.subscriptionUseCase.recordPlaytime(interaction.guildId, 0); // Start tracking

      // Execute the play command
      const playCommand = PlayMusicCommand.create({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        query,
        textChannelId: interaction.channelId || '',
        voiceChannelId: (interaction.member as any)?.voice?.channelId || ''
      });

      // Defer reply to avoid "thinking" state, then execute
      await interaction.deferReply();

      const result = await this.playMusicUseCase.execute(playCommand);

      // Only send minimal feedback if needed
      if (result.success) {
        await interaction.deleteReply(); // Remove the deferred reply completely
      } else {
        await interaction.editReply('❌ Failed to play track.');
      }

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('limits exceeded') || error.message.includes('Subscription')) {
          await this.sendSubscriptionUpgradeMessage(interaction, error.message);
        } else {
          await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
        }
      } else {
        await interaction.reply({ content: '❌ An unexpected error occurred.', ephemeral: true });
      }
    }
  }

  async handleQueueCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    try {
      // Check if user can view extended queue
      const subscriptionStatus = await this.subscriptionUseCase.getSubscriptionStatus(interaction.guildId);
      const maxDisplayItems = subscriptionStatus.planType === 'free' ? 5 : 25;

      // Get queue from music use case
      // Note: This would integrate with your existing queue logic
      const queueData = { items: [], currentTrack: null }; // Placeholder

      const embed = new EmbedBuilder()
        .setTitle('🎵 Music Queue')
        .setDescription(queueData.items.length === 0 ? 'Queue is empty' : 'Current queue items')
        .setColor(0x57f287);

      if (subscriptionStatus.planType === 'free' && queueData.items.length > maxDisplayItems) {
        embed.setFooter({ text: `Showing ${maxDisplayItems} of ${queueData.items.length} items. Upgrade to see full queue!` });
      }

      // Add subscription status to embed
      if (!subscriptionStatus.isActive && subscriptionStatus.isOnTrial) {
        embed.addFields({
          name: '⏰ Trial Status',
          value: `${subscriptionStatus.daysUntilExpiration} days remaining`,
          inline: true
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (error) {
      await interaction.reply({ content: '❌ Failed to get queue information.', ephemeral: true });
    }
  }

  async handleSubscriptionCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    try {
      const subscriptionStatus = await this.subscriptionUseCase.getSubscriptionStatus(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('💳 Subscription Status')
        .setColor(subscriptionStatus.isActive ? 0x57f287 : 0xed4245);

      embed.addFields(
        { name: 'Plan', value: subscriptionStatus.planType.toUpperCase(), inline: true },
        { name: 'Status', value: subscriptionStatus.isActive ? '✅ Active' : '❌ Inactive', inline: true }
      );

      if (subscriptionStatus.isOnTrial) {
        embed.addFields({
          name: '⏰ Trial',
          value: `${subscriptionStatus.daysUntilExpiration} days remaining`,
          inline: true
        });
      } else if (subscriptionStatus.daysUntilExpiration > 0) {
        embed.addFields({
          name: '📅 Expires',
          value: `In ${subscriptionStatus.daysUntilExpiration} days`,
          inline: true
        });
      }

      // Show plan limits
      const limits = subscriptionStatus.limits;
      const limitsText = [
        `Max Guilds: ${limits.maxGuilds === -1 ? 'Unlimited' : limits.maxGuilds}`,
        `Queue Size: ${limits.maxQueueSize === -1 ? 'Unlimited' : limits.maxQueueSize}`,
        `Track Length: ${limits.maxTrackDuration === -1 ? 'Unlimited' : `${Math.floor(limits.maxTrackDuration / 60000)} min`}`,
        `High Quality: ${limits.highQualityAudio ? '✅' : '❌'}`,
        `Custom Branding: ${limits.customBranding ? '✅' : '❌'}`
      ].join('\n');

      embed.addFields({ name: '📊 Plan Limits', value: limitsText });

      // Add upgrade information for free users
      if (subscriptionStatus.planType === 'free') {
        embed.addFields({
          name: '🚀 Upgrade Benefits',
          value: '• Longer songs\n• Bigger queues\n• High quality audio\n• Priority support\n• Analytics access'
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (error) {
      await interaction.reply({ content: '❌ Failed to get subscription information.', ephemeral: true });
    }
  }

  private async sendSubscriptionUpgradeMessage(interaction: ChatInputCommandInteraction, reason?: string): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🚀 Upgrade Required')
      .setDescription(reason || 'This feature requires a subscription upgrade.')
      .setColor(0xfee75c);

    embed.addFields(
      { name: '💎 Premium Plan ($9.99/month)', value: '• Up to 5 servers\n• 30-minute songs\n• High quality audio\n• Analytics', inline: true },
      { name: '🏆 Pro Plan ($19.99/month)', value: '• Up to 25 servers\n• 1-hour songs\n• Custom branding\n• API access\n• Priority support', inline: true },
      { name: '🏢 Enterprise Plan ($99.99/month)', value: '• Unlimited servers\n• Unlimited features\n• White labeling\n• Dedicated support\n• SLA guarantee', inline: true }
    );

    embed.setFooter({ text: 'Use /upgrade to choose your plan!' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async handleUpgradeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const planType = interaction.options.getString('plan') as 'premium' | 'pro' | 'enterprise';

    if (!planType || !['premium', 'pro', 'enterprise'].includes(planType)) {
      await interaction.reply({ content: 'Please specify a valid plan: premium, pro, or enterprise', ephemeral: true });
      return;
    }

    try {
      // Check if customer exists, create if not
      let customer = await this.subscriptionUseCase.getCustomerByGuild(interaction.guildId);

      if (!customer) {
        // Create new customer
        customer = await this.subscriptionUseCase.createCustomer(
          interaction.user.id + '@discord.local', // Temporary email
          interaction.user.displayName,
          interaction.guildId
        );
      }

      // Upgrade subscription
      await this.subscriptionUseCase.upgradeSubscription(customer.id, planType);

      const embed = new EmbedBuilder()
        .setTitle('🎉 Subscription Upgraded!')
        .setDescription(`Successfully upgraded to ${planType.toUpperCase()} plan`)
        .setColor(0x57f287);

      await interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (error) {
      const embed = new EmbedBuilder()
        .setTitle('❌ Upgrade Failed')
        .setDescription(error instanceof Error ? error.message : 'An unexpected error occurred')
        .setColor(0xed4245);

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  async handlePauseCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    try {
      // Basic commands are available to all users
      const pauseCommand = PauseMusicCommand.create({
        guildId: interaction.guildId,
        userId: interaction.user.id
      });

      const result = await this.controlMusicUseCase.pauseMusic(pauseCommand);

      // Only respond on errors
      if (!result.success) {
        await interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
      } else {
        // Success: no response needed, keep it clean
        await interaction.deferReply();
        await interaction.deleteReply();
      }
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to pause music', ephemeral: true });
    }
  }

  async handleResumeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    try {
      const resumeCommand = ResumeMusicCommand.create({
        guildId: interaction.guildId,
        userId: interaction.user.id
      });

      const result = await this.controlMusicUseCase.resumeMusic(resumeCommand);

      // Only respond on errors
      if (!result.success) {
        await interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
      } else {
        // Success: no response needed, keep it clean
        await interaction.deferReply();
        await interaction.deleteReply();
      }
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to resume music', ephemeral: true });
    }
  }

  async handleStopCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    try {
      const stopCommand = StopMusicCommand.create({
        guildId: interaction.guildId,
        userId: interaction.user.id
      });

      const result = await this.controlMusicUseCase.stopMusic(stopCommand);

      // Only respond on errors
      if (!result.success) {
        await interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
      } else {
        // Success: no response needed, keep it clean
        await interaction.deferReply();
        await interaction.deleteReply();
      }
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to stop music', ephemeral: true });
    }
  }

  async handleVolumeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const volume = interaction.options.getInteger('level', true);

    try {
      // Check if user can control volume (premium feature)
      const canUseFeature = await this.subscriptionUseCase.canUseFeature(interaction.guildId, 'high_quality_audio');
      if (!canUseFeature && volume > 100) {
        await this.sendSubscriptionUpgradeMessage(interaction, 'Volume above 100% requires Premium plan');
        return;
      }

      const setVolumeCommand = SetVolumeCommand.create({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        volume
      });

      const result = await this.controlMusicUseCase.setVolume(setVolumeCommand);

      // Only respond on errors
      if (!result.success) {
        await interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
      } else {
        // Success: no response needed, keep it clean
        await interaction.deferReply();
        await interaction.deleteReply();
      }
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to set volume', ephemeral: true });
    }
  }

  async handleLoopCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    try {
      // Loop is a basic feature available to all
      // Implementation would cycle through off -> track -> queue -> off

      // Success: no response needed, keep it clean
      await interaction.deferReply();
      await interaction.deleteReply();
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to toggle loop', ephemeral: true });
    }
  }
}