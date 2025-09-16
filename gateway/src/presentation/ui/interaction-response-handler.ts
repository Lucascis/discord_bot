import {
  CommandInteraction,
  ButtonInteraction,
  InteractionResponse,
  InteractionReplyOptions,
  EmbedBuilder
} from 'discord.js';
import { MusicUIBuilder } from './music-ui-builder.js';

/**
 * Interaction Response Handler
 * Handles Discord interaction responses with consistent error handling and formatting
 */
export class InteractionResponseHandler {
  constructor(private readonly musicUIBuilder: MusicUIBuilder) {}

  async sendSuccess(
    interaction: CommandInteraction | ButtonInteraction,
    options: InteractionReplyOptions
  ): Promise<any> {
    try {
      if (interaction.replied || interaction.deferred) {
        // Remove ephemeral flag for editReply as it's not supported
        const editOptions: any = { ...options };
        delete editOptions.ephemeral;
        return await interaction.editReply(editOptions);
      } else {
        return await interaction.reply(options);
      }
    } catch (error) {
      console.error('Failed to send success response:', error);
      // Try to send a fallback message
      await this.sendFallbackError(interaction);
    }
  }

  async sendError(
    interaction: CommandInteraction | ButtonInteraction,
    message: string,
    title: string = 'Error'
  ): Promise<any> {
    try {
      const embed = this.musicUIBuilder.buildErrorEmbed(
        title,
        message,
        interaction.user
      );

      const options: InteractionReplyOptions = {
        embeds: [embed],
        ephemeral: true // Errors are ephemeral by default
      };

      if (interaction.replied || interaction.deferred) {
        // Remove ephemeral flag for editReply as it's not supported
        const editOptions: any = { ...options };
        delete editOptions.ephemeral;
        return await interaction.editReply(editOptions);
      } else {
        return await interaction.reply(options);
      }
    } catch (error) {
      console.error('Failed to send error response:', error);
      await this.sendFallbackError(interaction);
    }
  }

  async sendThinking(
    interaction: CommandInteraction | ButtonInteraction
  ): Promise<void> {
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply();
      }
    } catch (error) {
      console.error('Failed to defer interaction:', error);
    }
  }

  async sendEphemeral(
    interaction: CommandInteraction | ButtonInteraction,
    options: Omit<InteractionReplyOptions, 'ephemeral'>
  ): Promise<any> {
    return this.sendSuccess(interaction, {
      ...options,
      ephemeral: true
    });
  }

  async updateComponents(
    interaction: ButtonInteraction,
    options: InteractionReplyOptions
  ): Promise<any> {
    try {
      // Remove ephemeral flag for update as it's not supported
      const updateOptions: any = { ...options };
      delete updateOptions.ephemeral;
      return await interaction.update(updateOptions);
    } catch (error) {
      console.error('Failed to update components:', error);
      // Fall back to edit reply
      return this.sendSuccess(interaction, options);
    }
  }

  async sendFollowUp(
    interaction: CommandInteraction | ButtonInteraction,
    options: InteractionReplyOptions
  ): Promise<any> {
    try {
      return await interaction.followUp(options);
    } catch (error) {
      console.error('Failed to send follow-up:', error);
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
    } catch (error) {
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
      } catch (error) {
        // Ignore timeout handling errors
      }
    }, timeoutMs);
  }

  async sendCommandInfo(
    interaction: CommandInteraction,
    commandName: string,
    description: string,
    usage: string[]
  ): Promise<InteractionResponse | void> {
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
  ): Promise<InteractionResponse | void> {
    return this.sendError(
      interaction,
      'You do not have permission to use this command.',
      'Permission Denied'
    );
  }

  async sendCooldownError(
    interaction: CommandInteraction | ButtonInteraction,
    remainingTime: number
  ): Promise<InteractionResponse | void> {
    const seconds = Math.ceil(remainingTime / 1000);
    return this.sendError(
      interaction,
      `You are on cooldown. Please wait ${seconds} more second${seconds !== 1 ? 's' : ''}.`,
      'Cooldown Active'
    );
  }

  async sendMaintenanceError(
    interaction: CommandInteraction | ButtonInteraction
  ): Promise<InteractionResponse | void> {
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
      const fallbackMessage = {
        content: '❌ An error occurred while processing your request.',
        ephemeral: true
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(fallbackMessage);
      } else {
        await interaction.reply(fallbackMessage);
      }
    } catch (fallbackError) {
      console.error('Failed to send fallback error:', fallbackError);
      // At this point, we can't communicate with Discord
    }
  }
}