import { type ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import { BaseCommand, type CommandExecutionResult } from '../../base/command.js';
import type { MusicRuntime } from '../../runtime.js';
import { randomUUID } from 'node:crypto';

type PlayAck = { ok: true; title: string; uri?: string; artworkUrl?: string } | { ok: false; reason: string };

export class PlayCommand extends BaseCommand {
  constructor(private runtime: MusicRuntime) {
    super({
      name: 'play',
      description: 'Play a track or playlist',
      category: 'music',
      permissions: { requiresVoiceChannel: true, guildOnly: true },
      rateLimit: { limit: 5, windowSeconds: 60 },
    });
  }

  buildSlashCommand() {
    return new SlashCommandBuilder()
      .setName(this.metadata.name)
      .setDescription(this.metadata.description)
      .addStringOption((opt) => opt.setName('query').setDescription('Song name or URL').setRequired(true));
  }

  async execute({ interaction, guildId, userId, channelId }: { interaction: ChatInputCommandInteraction; guildId: string; userId: string; channelId: string | null; }): Promise<CommandExecutionResult> {
    const { allow, validators, publish, incPublishMetric, ensureLiveNow } = this.runtime;

    if (!(await allow(interaction, 'play', this.metadata.rateLimit?.limit, this.metadata.rateLimit?.windowSeconds))) {
      await interaction.reply({ content: 'Too many requests. Try later.', ephemeral: true });
      return { success: false, error: 'rate_limited' };
    }

    const rawQuery = interaction.options.getString('query', true);
    const queryValidation = validators.validateSearchQuery(rawQuery);
    if (!queryValidation.success) {
      await interaction.reply({ content: `Invalid query: ${queryValidation.error}`, ephemeral: true });
      return { success: false, error: 'invalid_query' };
    }
    const query = queryValidation.data!;

    // Robust voice channel resolve without requiring privileged GuildMembers intent
    let voice: string | null | undefined = interaction.guild?.voiceStates?.cache.get(userId)?.channelId;
    if (!voice) {
      // Fallback to interaction.member when available
      const asMember = (interaction.member as { voice?: { channelId?: string | null } } | null);
      voice = asMember?.voice?.channelId ?? null;
    }
    if (!voice && interaction.guild) {
      // Best-effort fetch of member; allowed without privileged intent for a single user
      try {
        const fetched = await interaction.guild.members.fetch(userId);
        voice = fetched?.voice?.channelId ?? null;
      } catch {
        // ignore fetch errors; will handle as not-in-voice below
      }
    }
    if (!voice) {
      await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
      return { success: false, error: 'no_voice' };
    }

    await interaction.deferReply();

    const requestId = randomUUID();
    const channel = `discord-bot:response:${requestId}`;

    const response = this.runtime.subscribeOnce(channel).then((msg) => (msg ? (JSON.parse(msg) as PlayAck) : null));

    await publish('discord-bot:commands', JSON.stringify({
      type: 'play',
      guildId,
      voiceChannelId: voice,
      textChannelId: channelId,
      userId,
      query,
      requestId,
    }));
    incPublishMetric?.('discord-bot:commands');

    const ack = (await Promise.race<PlayAck | null>([
      response as Promise<PlayAck | null>,
      new Promise<null>((res) => setTimeout(() => res(null), 2500)),
    ]));

    if (!ack) {
      await interaction.editReply({ content: `▶️ Queued: ${query}` });
      if (guildId && channelId && ensureLiveNow) {
        setTimeout(() => { void ensureLiveNow(guildId, channelId, true); }, 600);
        setTimeout(() => { void ensureLiveNow(guildId, channelId); }, 1500);
      }
    } else if ('ok' in ack && ack.ok) {
      const title = ack.title;
      const uri = ack.uri ?? query;
      await interaction.editReply({ content: `▶️ Queued: [${title}](${uri})` });
      if (guildId && channelId && ensureLiveNow) {
        void ensureLiveNow(guildId, channelId, true);
        setTimeout(() => { void ensureLiveNow(guildId!, channelId!); }, 1200);
      }
    } else {
      await interaction.editReply({ content: `No results for: ${query}` });
    }

    // CRITICAL FIX: Always try to ensure UI exists regardless of ack state
    if (guildId && channelId && ensureLiveNow) {
      setTimeout(() => { void ensureLiveNow(guildId, channelId, true); }, 2000);
    }

    return { success: true };
  }
}
