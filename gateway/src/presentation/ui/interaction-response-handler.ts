import {
  CommandInteraction,
  ButtonInteraction,
  InteractionResponse,
  InteractionReplyOptions,
  InteractionEditReplyOptions,
  InteractionUpdateOptions,
  EmbedBuilder,
  Message,
  MessageFlags
} from 'discord.js';
import { MusicUIBuilder } from './music-ui-builder.js';
import { DiscordErrorHandler } from '../../utils/discord-error-handler.js';
import { logger } from '@discord-bot/logger';

/**
 * Interaction Response Handler
 * Handles Discord interaction responses with consistent error handling and formatting
 */
export class InteractionResponseHandler {
  constructor(private readonly musicUIBuilder: MusicUIBuilder) {}

  async sendSuccess(
    interaction: CommandInteraction | ButtonInteraction,
    options: InteractionReplyOptions
  ): Promise<InteractionResponse | Message | void> {
    const context = {
      operationName: 'sendSuccess',
      interactionId: interaction.id,
      guildId: interaction.guildId || undefined
    };

    return await DiscordErrorHandler.replyToInteraction(
      interaction,
      options,
      context
    );
  }

  async sendError(
    interaction: CommandInteraction | ButtonInteraction,
    message: string,
    title: string = 'Error'
  ): Promise<InteractionResponse | Message | void> {
    const embed = this.musicUIBuilder.buildErrorEmbed(
      title,
      message,
      interaction.user
    );

    const options: InteractionReplyOptions = {
      embeds: [embed],
      flags: MessageFlags.Ephemeral // Errors are ephemeral by default
    };

    const context = {
      operationName: 'sendError',
      interactionId: interaction.id,
      guildId: interaction.guildId || undefined
    };

    return await DiscordErrorHandler.replyToInteraction(
      interaction,
      options,
      context
    );
  }

  async sendThinking(
    interaction: CommandInteraction | ButtonInteraction
  ): Promise<void> {
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply();
      }
    } catch (error) {
      logger.error({ error, interactionId: interaction.id }, 'Failed to defer interaction');
    }
  }

  async sendEphemeral(
    interaction: CommandInteraction | ButtonInteraction,
    options: Omit<InteractionReplyOptions, 'ephemeral'>
  ): Promise<InteractionResponse | Message | void> {
    return this.sendSuccess(interaction, {
      ...options,
      flags: MessageFlags.Ephemeral
    });
  }

  async updateComponents(
    interaction: ButtonInteraction,
    options: InteractionReplyOptions
  ): Promise<InteractionResponse | Message | void> {
    try {
      // Convert to update options (remove ephemeral and unsupported flags)
      const updateOptions: InteractionUpdateOptions = {
        content: options.content,
        embeds: options.embeds,
        components: options.components,
        files: options.files,
        allowedMentions: options.allowedMentions
      };
      return await interaction.update(updateOptions);
    } catch (error) {
      logger.error({ error, interactionId: interaction.id }, 'Failed to update components');
      // Fall back to edit reply
      return this.sendSuccess(interaction, options);
    }
  }

  async sendFollowUp(
    interaction: CommandInteraction | ButtonInteraction,
    options: InteractionReplyOptions
  ): Promise<Message | void> {
    try {
      return await interaction.followUp(options);
    } catch (error) {
      logger.error({ error, interactionId: interaction.id }, 'Failed to send follow-up');
      throw error;
    }
  }

  async sendTyping(
    interaction: CommandInteraction | ButtonInteraction
  ): Promise<void> {
    try {
      if (interaction.channel && 'sendTyping' in interaction.channel) {
        await interaction.channel.sendTyping();
      }
    } catch {
      // Ignore typing errors
    }
  }

  async handleTimeout(
    interaction: CommandInteraction | ButtonInteraction,
    timeoutMs: number = 15000
  ): Promise<void> {
    setTimeout(async () => {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await this.sendError(
            interaction,
            'The command timed out. Please try again.',
            'Timeout'
          );
        }
      } catch {
        // Ignore timeout handling errors
      }
    }, timeoutMs);
  }

  async sendCommandInfo(
    interaction: CommandInteraction,
    commandName: string,
    description: string,
    usage: string[]
  ): Promise<InteractionResponse | Message | void> {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`📖 ${commandName}`)
      .setDescription(description)
      .addFields({
        name: 'Usage',
        value: usage.map(u => `\`${u}\``).join('\n'),
        inline: false
      })
      .setFooter({
        text: `Requested by ${interaction.user.displayName}`,
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTimestamp();

    return this.sendEphemeral(interaction, {
      embeds: [embed]
    });
  }

  async sendPermissionError(
    interaction: CommandInteraction | ButtonInteraction
  ): Promise<InteractionResponse | Message | void> {
    return this.sendError(
      interaction,
      'You do not have permission to use this command.',
      'Permission Denied'
    );
  }

  async sendCooldownError(
    interaction: CommandInteraction | ButtonInteraction,
    remainingTime: number
  ): Promise<InteractionResponse | Message | void> {
    const seconds = Math.ceil(remainingTime / 1000);
    return this.sendError(
      interaction,
      `You are on cooldown. Please wait ${seconds} more second${seconds !== 1 ? 's' : ''}.`,
      'Cooldown Active'
    );
  }

  async sendMaintenanceError(
    interaction: CommandInteraction | ButtonInteraction
  ): Promise<InteractionResponse | Message | void> {
    return this.sendError(
      interaction,
      'The bot is currently under maintenance. Please try again later.',
      'Maintenance Mode'
    );
  }

  private async sendFallbackError(
    interaction: CommandInteraction | ButtonInteraction
  ): Promise<void> {
    try {
      const fallbackMessage = '❌ An error occurred while processing your request.';

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(fallbackMessage);
      } else {
        await interaction.reply({
          content: fallbackMessage,
          ephemeral: true
        });
      }
    } catch (fallbackError) {
      logger.error({ error: fallbackError, interactionId: interaction.id }, 'Failed to send fallback error');
      // At this point, we can't communicate with Discord
    }
  }
}