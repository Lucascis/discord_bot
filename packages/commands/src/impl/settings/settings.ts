import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { BaseCommand, type CommandExecutionResult } from '../../base/command';
import type { MusicRuntime } from '../../runtime';
import { randomUUID } from 'node:crypto';

export class VolumeCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) { super({ name: 'volume', description: 'Set playback volume (0-200)', category: 'settings', permissions: { guildOnly: true } }); }
  buildSlashCommand(): import('discord.js').SlashCommandBuilder | import('discord.js').SlashCommandOptionsOnlyBuilder { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description).addIntegerOption((opt)=>opt.setName('percent').setDescription('Volume percent (0-200)').setRequired(true).setMinValue(0).setMaxValue(200)); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric, hasDjOrAdmin, validators } = this.runtime;
    if (!hasDjOrAdmin(interaction)) { await interaction.reply({ content: 'Requires DJ role.', ephemeral: true }); return { success: false, error: 'no_perm' }; }
    const raw = interaction.options.getInteger('percent', true);
    const v = validators.validateInteger(raw, 0, 200, 'volume percent');
    if (!v.success) { await interaction.reply({ content: `Invalid volume: ${v.error}`, ephemeral: true }); return { success: false, error: 'bad_vol' }; }
    await interaction.deferReply({ ephemeral: true });
    await publish('discord-bot:commands', JSON.stringify({ type: 'volume', guildId, percent: v.data }));
    incPublishMetric?.('discord-bot:commands');
    await interaction.editReply(`Volume set to ${v.data}%`);
    return { success: true };
  }
}

export class LoopCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) { super({ name: 'loop', description: 'Set loop mode', category: 'settings', permissions: { guildOnly: true } }); }
  buildSlashCommand(): import('discord.js').SlashCommandBuilder | import('discord.js').SlashCommandOptionsOnlyBuilder { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description).addStringOption((opt)=>opt.setName('mode').setDescription('Loop mode').setRequired(true).addChoices({name:'off', value:'off'},{name:'track', value:'track'},{name:'queue', value:'queue'})); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric, hasDjOrAdmin, validators } = this.runtime;
    if (!hasDjOrAdmin(interaction)) { await interaction.reply({ content: 'Requires DJ role.', ephemeral: true }); return { success: false, error: 'no_perm' }; }
    const modeRaw = interaction.options.getString('mode', true);
    const v = validators.validateLoopMode(modeRaw);
    if (!v.success) { await interaction.reply({ content: `Invalid loop mode: ${v.error}`, ephemeral: true }); return { success: false, error: 'bad_mode' }; }
    await interaction.deferReply({ ephemeral: true });
    await publish('discord-bot:commands', JSON.stringify({ type: 'loopSet', guildId, mode: v.data }));
    incPublishMetric?.('discord-bot:commands');
    await interaction.editReply(`Loop set to ${v.data}`);
    return { success: true };
  }
}

export class SeekCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) { super({ name: 'seek', description: 'Seek current track to position (seconds)', category: 'settings', permissions: { guildOnly: true } }); }
  buildSlashCommand(): import('discord.js').SlashCommandBuilder | import('discord.js').SlashCommandOptionsOnlyBuilder { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description).addIntegerOption((opt)=>opt.setName('seconds').setDescription('Position in seconds').setRequired(true).setMinValue(0)); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric, hasDjOrAdmin, validators } = this.runtime;
    if (!hasDjOrAdmin(interaction)) { await interaction.reply({ content: 'Requires DJ role.', ephemeral: true }); return { success: false, error: 'no_perm' }; }
    const raw = interaction.options.getInteger('seconds', true);
    const v = validators.validateInteger(raw, 0, 86400, 'seconds');
    if (!v.success) { await interaction.reply({ content: `Invalid seek position: ${v.error}`, ephemeral: true }); return { success: false, error: 'bad_seek' }; }
    await interaction.deferReply({ ephemeral: true });
    await publish('discord-bot:commands', JSON.stringify({ type: 'seek', guildId, positionMs: Math.max(0, v.data!) * 1000 }));
    incPublishMetric?.('discord-bot:commands');
    await interaction.editReply(`Seeking to ${v.data}s`);
    return { success: true };
  }
}

export class NowPlayingCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) { super({ name: 'nowplaying', description: 'Show current track', category: 'settings', permissions: { guildOnly: true } }); }
  buildSlashCommand(): import('discord.js').SlashCommandBuilder | import('discord.js').SlashCommandOptionsOnlyBuilder { return new SlashCommandBuilder().setName(this.metadata.name).setDescription(this.metadata.description); }
  async execute({ interaction, guildId }: { interaction: ChatInputCommandInteraction; guildId: string }): Promise<CommandExecutionResult> {
    const { publish, incPublishMetric } = this.runtime;
    await interaction.deferReply({ ephemeral: true });
    const requestId = randomUUID();
    const channel = `discord-bot:response:${requestId}`;
    type NowPlaying = { title: string; uri?: string; author?: string; durationMs: number; positionMs: number; isStream: boolean; artworkUrl?: string; paused?: boolean; repeatMode?: 'off'|'track'|'queue' } | null;
    const response: Promise<NowPlaying> = this.runtime.subscribeOnce(channel).then((msg) => (msg ? JSON.parse(msg) as NowPlaying : null));
    await publish('discord-bot:commands', JSON.stringify({ type: 'nowplaying', guildId, requestId }));
    incPublishMetric?.('discord-bot:commands');
    const data: NowPlaying = (await Promise.race([response, new Promise<null>((res)=>setTimeout(()=>res(null), 1500))])) as NowPlaying;
    if (!data) { await interaction.editReply('No track playing.'); return { success: true }; }
    const total = data.durationMs || 0; const pos = data.positionMs || 0; const pct = total>0? Math.min(1, pos/total):0; const barLen=20; const filled = Math.min(barLen-1, Math.round(pct*barLen)); const bar = '▬'.repeat(filled)+'🔘'+'▬'.repeat(Math.max(0, barLen-filled-1));
    const fmt = (ms:number)=>{ const s = Math.floor(ms/1000); const m = Math.floor(s/60); const ss = s%60; return `${m}:${ss.toString().padStart(2,'0')}`; };
    const ytMatch = data.uri?.match(/(?:v=|youtu\.be\/)([\w-]{11})/); const thumb = data.artworkUrl ?? (ytMatch ? `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg` : undefined); const description = data.uri ? `[${data.title}](${data.uri})` : `${data.title}`;
    const embed = new EmbedBuilder().setTitle('Now Playing').setDescription(description).addFields({ name: 'Author', value: data.author ?? 'Unknown', inline: true }, { name: 'Progress', value: data.isStream ? 'live' : `${fmt(pos)} ${bar} ${fmt(total)}`, inline: false }).setColor(0x57f287);
    if (thumb) embed.setThumbnail(thumb);
    await interaction.editReply({ embeds: [embed] });
    return { success: true };
  }
}
