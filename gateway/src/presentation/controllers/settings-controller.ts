import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { logger } from '@discord-bot/logger';
import { SettingsService } from '../../services/settings-service.js';

export class SettingsController {
  private settingsService: SettingsService;

  constructor(settingsService: SettingsService) {
    this.settingsService = settingsService;
  }

  getCommand() {
    return new SlashCommandBuilder()
      .setName('settings')
      .setDescription('Configure bot settings for this server')
      .addSubcommand(subcommand =>
        subcommand
          .setName('responses')
          .setDescription('Toggle button response messages')
          .addBooleanOption(option =>
            option
              .setName('enabled')
              .setDescription('Enable response messages for button interactions')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('view')
          .setDescription('View current server settings')
      );
  }

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'responses':
          await this.handleResponsesSetting(interaction);
          break;
        case 'view':
          await this.handleViewSettings(interaction);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown subcommand.',
            flags: MessageFlags.Ephemeral
          });
      }
    } catch (error) {
      logger.error({ error, guildId: interaction.guildId, subcommand }, 'Settings command error');
      await interaction.reply({
        content: '❌ An error occurred while updating settings.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  private async handleResponsesSetting(interaction: ChatInputCommandInteraction): Promise<void> {
    const enabled = interaction.options.getBoolean('enabled', true);
    const guildId = interaction.guildId!;

    await this.settingsService.setButtonResponseMessages(guildId, enabled);

    await interaction.reply({
      content: `✅ Button response messages ${enabled ? 'enabled' : 'disabled'}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  private async handleViewSettings(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const settings = await this.settingsService.getGuildSettings(guildId);

    const embed = {
      color: 0x00d4aa,
      title: '⚙️ Server Settings',
      fields: [
        {
          name: '💬 Ephemeral Button Responses',
          value: settings.ephemeralMessages ? '✅ Enabled' : '❌ Disabled',
          inline: true
        }
      ],
      footer: {
        text: 'Use /settings ephemeral to change these settings'
      }
    };

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
}