import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder, SlashCommandIntegerOption } from 'discord.js';
import { BaseCommand, type CommandExecutionResult } from '../../base/command.js';
import type { MusicRuntime } from '../../runtime.js';
import { randomUUID } from 'node:crypto';

export class QueueCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) {
    super({ name: 'queue', description: 'Show queue', category: 'queue', permissions: { guildOnly: true } });
  }
  buildSlashCommand(): SlashCommandBuilder { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric } = this.runtime;
    await interaction.deferReply({ ephemeral: true });
    const requestId = randomUUID();
    const channel = `discord-bot:response:${requestId}`;
    const response = this.runtime.subscribeOnce(channel).then((msg) => (msg ? JSON.parse(msg) : null)) as Promise<{ items: Array<{ title: string; uri?: string }> } | null>;
    await publish('discord-bot:commands', JSON.stringify({ type: 'queue', guildId, requestId }));
    incPublishMetric?.('discord-bot:commands');
    const data = (await Promise.race([response, new Promise((res) => setTimeout(() => res(null), 1500))])) as { items: Array<{ title: string; uri?: string }> } | null;
    if (!data || !data.items || data.items.length === 0) { await interaction.editReply('Queue is empty.'); return { success: true }; }
    const description = data.items.slice(0, 10).map((t, i) => `${i + 1}. [${t.title}](${t.uri})`).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('Queue')
      .setDescription(description)
      .setColor(0xfee75c);
    await interaction.editReply({ embeds: [embed] });
    return { success: true };
  }
}

export class ShuffleCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) { super({ name: 'shuffle', description: 'Shuffle the queue', category: 'queue', permissions: { guildOnly: true } }); }
  buildSlashCommand(): SlashCommandBuilder { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric, hasDjOrAdmin } = this.runtime;
    if (!hasDjOrAdmin(interaction)) { await interaction.reply({ content: 'Requires DJ role.', ephemeral: true }); return { success: false, error: 'no_perm' }; }
    await interaction.deferReply({ ephemeral: true });
    await publish('discord-bot:commands', JSON.stringify({ type: 'shuffle', guildId }));
    incPublishMetric?.('discord-bot:commands');
    await interaction.editReply('Queue shuffled');
    return { success: true };
  }
}

export class RemoveCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) { super({ name: 'remove', description: 'Remove a track by position (1-based)', category: 'queue', permissions: { guildOnly: true } }); }
  buildSlashCommand() { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description).addIntegerOption((opt: SlashCommandIntegerOption)=>opt.setName('index').setDescription('Position (1-based)').setRequired(true).setMinValue(1)); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric, hasDjOrAdmin, validators } = this.runtime;
    if (!hasDjOrAdmin(interaction)) { await interaction.reply({ content: 'Requires DJ role.', ephemeral: true }); return { success: false, error: 'no_perm' }; }
    const raw = interaction.options.getInteger('index', true);
    const v = validators.validateInteger(raw, 1, 1000, 'track index');
    if (!v.success) { await interaction.reply({ content: `Invalid track index: ${v.error}`, ephemeral: true }); return { success: false, error: 'bad_index' }; }
    await interaction.deferReply({ ephemeral: true });
    await publish('discord-bot:commands', JSON.stringify({ type: 'remove', guildId, index: v.data }));
    incPublishMetric?.('discord-bot:commands');
    await interaction.editReply(`Removed track #${v.data}`);
    return { success: true };
  }
}

export class ClearCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) { super({ name: 'clear', description: 'Clear the queue (keeps current)', category: 'queue', permissions: { guildOnly: true } }); }
  buildSlashCommand(): SlashCommandBuilder { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric, hasDjOrAdmin } = this.runtime;
    if (!hasDjOrAdmin(interaction)) { await interaction.reply({ content: 'Requires DJ role.', ephemeral: true }); return { success: false, error: 'no_perm' }; }
    await interaction.deferReply({ ephemeral: true });
    await publish('discord-bot:commands', JSON.stringify({ type: 'clear', guildId }));
    incPublishMetric?.('discord-bot:commands');
    await interaction.editReply('Cleared queue');
    return { success: true };
  }
}

export class MoveCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) { super({ name: 'move', description: 'Move a track between positions', category: 'queue', permissions: { guildOnly: true } }); }
  buildSlashCommand() { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description).addIntegerOption((o: SlashCommandIntegerOption)=>o.setName('from').setDescription('From (1-based)').setRequired(true).setMinValue(1)).addIntegerOption((o: SlashCommandIntegerOption)=>o.setName('to').setDescription('To (1-based)').setRequired(true).setMinValue(1)); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric, hasDjOrAdmin, validators } = this.runtime;
    if (!hasDjOrAdmin(interaction)) { await interaction.reply({ content: 'Requires DJ role.', ephemeral: true }); return { success: false, error: 'no_perm' }; }
    const fromRaw = interaction.options.getInteger('from', true);
    const toRaw = interaction.options.getInteger('to', true);
    const vf = validators.validateInteger(fromRaw, 1, 1000, 'from position');
    const vt = validators.validateInteger(toRaw, 1, 1000, 'to position');
    if (!vf.success) { await interaction.reply({ content: `Invalid from position: ${vf.error}`, ephemeral: true }); return { success: false, error: 'bad_from' }; }
    if (!vt.success) { await interaction.reply({ content: `Invalid to position: ${vt.error}`, ephemeral: true }); return { success: false, error: 'bad_to' }; }
    await interaction.deferReply({ ephemeral: true });
    await publish('discord-bot:commands', JSON.stringify({ type: 'move', guildId, from: vf.data, to: vt.data }));
    incPublishMetric?.('discord-bot:commands');
    await interaction.editReply(`Moved #${vf.data} → #${vt.data}`);
    return { success: true };
  }
}
