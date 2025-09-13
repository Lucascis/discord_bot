import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { BaseCommand, type CommandExecutionResult } from '../../base/command';
import type { MusicRuntime } from '../../runtime';

export class SimplePublishCommand extends BaseCommand {
  constructor(
    private runtime: MusicRuntime,
    meta: { name: string; description: string; requiresDj?: boolean }
  ) {
    super({
      name: meta.name,
      description: meta.description,
      category: 'music',
      permissions: { guildOnly: true, requiresVoiceChannel: false },
    });
    this.requiresDj = !!meta.requiresDj;
  }

  private requiresDj: boolean;

  buildSlashCommand(): SlashCommandBuilder | import('discord.js').SlashCommandOptionsOnlyBuilder {
    return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description);
  }

  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric, hasDjOrAdmin } = this.runtime;
    if (this.requiresDj && !hasDjOrAdmin(interaction)) {
      await interaction.reply({ content: 'Insufficient permissions.', ephemeral: true });
      return { success: false, error: 'no_perm' };
    }
    await interaction.deferReply({ ephemeral: true });
    const typeMap: Record<string, string> = {
      skip: 'skip', pause: 'pause', resume: 'resume', stop: 'stop'
    };
    const type = typeMap[this.metadata.name];
    if (!type) return { success: false, error: 'unknown' };
    await publish('discord-bot:commands', JSON.stringify({ type, guildId }));
    incPublishMetric?.('discord-bot:commands');
    await interaction.editReply(this.metadata.description);
    return { success: true };
  }
}
