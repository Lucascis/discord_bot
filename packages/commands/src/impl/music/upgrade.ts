import { type ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder, SlashCommandStringOption } from '@discordjs/builders';
import { BaseCommand, type CommandExecutionResult } from '../../base/command.js';
import type { MusicRuntime } from '../../runtime.js';

export class UpgradeCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) {
    super({
      name: 'upgrade',
      description: 'Upgrade your subscription plan',
      category: 'music',
      permissions: { guildOnly: true, requiresVoiceChannel: false },
    });
  }

  buildSlashCommand() {
    return new SlashCommandBuilder()
      .setName(this.metadata.name)
      .setDescription(this.metadata.description)
      .addStringOption((opt: SlashCommandStringOption) =>
        opt.setName('plan')
          .setDescription('Choose your subscription plan')
          .setRequired(true)
          .addChoices(
            { name: 'Premium ($9.99/month)', value: 'premium' },
            { name: 'Pro ($19.99/month)', value: 'pro' },
            { name: 'Enterprise ($99.99/month)', value: 'enterprise' }
          )
      );
  }

  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric } = this.runtime;

    const plan = interaction.options.getString('plan', true);

    await interaction.deferReply({ ephemeral: true });

    await publish('discord-bot:commands', JSON.stringify({
      type: 'upgrade',
      guildId,
      plan
    }));
    incPublishMetric?.('discord-bot:commands');

    await interaction.editReply(`Processing upgrade to ${plan} plan...`);
    return { success: true };
  }
}