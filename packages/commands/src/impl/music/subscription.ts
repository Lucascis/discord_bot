import { type ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { BaseCommand, type CommandExecutionResult } from '../../base/command.js';
import type { MusicRuntime } from '../../runtime.js';

export class SubscriptionCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) {
    super({
      name: 'subscription',
      description: 'View your subscription status and plan details',
      category: 'music',
      permissions: { guildOnly: true, requiresVoiceChannel: false },
    });
  }

  buildSlashCommand() {
    return new SlashCommandBuilder()
      .setName(this.metadata.name)
      .setDescription(this.metadata.description);
  }

  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric } = this.runtime;

    await interaction.deferReply({ ephemeral: true });

    await publish('discord-bot:commands', JSON.stringify({
      type: 'subscription',
      guildId
    }));
    incPublishMetric?.('discord-bot:commands');

    await interaction.editReply('Checking subscription status...');
    return { success: true };
  }
}