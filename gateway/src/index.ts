import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
} from 'discord.js';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { createClient } from 'redis';
import { prisma } from '@discord-bot/database';
import { getAutomixEnabled, setAutomixEnabled } from './flags.js';
import { buildControls, resolveTextChannel, type UiState } from './ui.js';
import http from 'node:http';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import crypto from 'node:crypto';
import type { TextChannel } from 'discord.js';

// Avoid privileged GuildMembers intent to prevent DisallowedIntents login failures
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

function hasDjOrAdmin(
  interaction: import('discord.js').ButtonInteraction | import('discord.js').ChatInputCommandInteraction,
): boolean {
  type ApiMember = { roles?: string[]; permissions?: { has?: (p: bigint) => boolean } };
  const gm = interaction.member as import('discord.js').GuildMember | ApiMember | null;
  const djRole = interaction.guild?.roles.cache.find((r) => r.name.toLowerCase() === env.DJ_ROLE_NAME.toLowerCase());
  const isAdmin = !!(gm && 'permissions' in gm && (gm as ApiMember).permissions?.has?.(PermissionsBitField.Flags.Administrator));
  if (!djRole) return isAdmin; // if no role configured/found, admin is enough
  // If roles is an array (Interaction member payload), check by role id
  if (gm && 'roles' in gm && Array.isArray((gm as ApiMember).roles)) {
    return isAdmin || ((gm as ApiMember).roles as string[]).includes(djRole.id);
  }
  // If it's a GuildMember, check the RoleManager cache
  const asGuildMember = gm as import('discord.js').GuildMember | null;
  return isAdmin || !!asGuildMember?.roles.cache.has(djRole.id);
}

client.once('ready', () => {
  logger.info(`Logged in as ${client.user?.tag}`);
});

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Replies with pong!'),
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track or playlist')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('Song name or URL').setRequired(true),
    ),
  new SlashCommandBuilder().setName('skip').setDescription('Skip current track'),
  new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop and clear queue'),
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set loop mode')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices(
          { name: 'off', value: 'off' },
          { name: 'track', value: 'track' },
          { name: 'queue', value: 'queue' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume (0-200)')
    .addIntegerOption((opt) =>
      opt
        .setName('percent')
        .setDescription('Volume percent (0-200)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(200),
    ),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show current track'),
  new SlashCommandBuilder().setName('queue').setDescription('Show queue'),
  new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek current track to position (seconds)')
    .addIntegerOption((opt) => opt.setName('seconds').setDescription('Position in seconds').setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue'),
  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track by position in queue (starting at 1)')
    .addIntegerOption((opt) => opt.setName('index').setDescription('Position (1-based)').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('clear').setDescription('Clear the queue (keeps current track)'),
  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a track from one position to another')
    .addIntegerOption((opt) => opt.setName('from').setDescription('From (1-based)').setRequired(true).setMinValue(1))
    .addIntegerOption((opt) => opt.setName('to').setDescription('To (1-based)').setRequired(true).setMinValue(1)),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
import { withTimeout } from './util.js';

async function main() {
  const appId = env.DISCORD_APPLICATION_ID;
  const guildId = env.DISCORD_GUILD_ID;
  logger.info({ NOWPLAYING_UPDATE_MS: env.NOWPLAYING_UPDATE_MS, COMMANDS_CLEANUP_ON_START: env.COMMANDS_CLEANUP_ON_START, appId, guildId }, 'Gateway startup config');

  // 1) Login primero para que el bot aparezca online y pueda responder
  try {
    const res = await withTimeout(client.login(env.DISCORD_TOKEN), 20000, 'discord-login');
    if (!res) {
      logger.error('Login timed out or failed. Check DISCORD_TOKEN and intents. Will retry in 10s.');
      setTimeout(() => { void withTimeout(client.login(env.DISCORD_TOKEN), 20000, 'discord-login-retry'); }, 10000);
    }
  } catch (e) {
    logger.error({ e }, 'Login failed');
  }

  // 2) Registrar comandos en background (no bloquear inicio)
  void (async () => {
    try {
      let guildRegistered = false;
      if (guildId) {
        logger.info({ appId, guildId }, 'Registering guild commands');
        if (env.COMMANDS_CLEANUP_ON_START) {
          try { await withTimeout(rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] }), 15000, 'guild-cleanup'); logger.info('Cleaned guild commands'); } catch (e) { logger.error({ e }, 'Guild cleanup failed'); }
        }
        const reg = await withTimeout(rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands }), 20000, 'guild-register');
        guildRegistered = !!reg;
        try {
          const g = (await withTimeout(rest.get(Routes.applicationGuildCommands(appId, guildId)) as unknown as Promise<unknown[]>, 15000, 'guild-get')) || [];
          logger.info({ guildCount: (g as unknown[]).length }, 'Guild command registry state');
        } catch { /* ignore */ }
      }

      if (!guildRegistered) {
        // Fallback: register global commands so the bot siempre tiene comandos disponibles
        logger.warn({ appId, guildId }, 'Guild registration failed or not configured; registering global commands as fallback');
        if (!env.COMMANDS_CLEANUP_ON_START) {
          // no-op
        }
        await withTimeout(rest.put(Routes.applicationCommands(appId), { body: commands }), 20000, 'global-register-fallback');
        try { const gl = (await withTimeout(rest.get(Routes.applicationCommands(appId)) as unknown as Promise<unknown[]>, 15000, 'global-get')) || []; logger.info({ globalCount: (gl as unknown[]).length }, 'Global command registry state'); } catch { /* ignore */ }
      } else if (env.COMMANDS_CLEANUP_ON_START) {
        // Opcional: si registramos por guild correctamente, limpiar globales para evitar duplicados
        try { await withTimeout(rest.put(Routes.applicationCommands(appId), { body: [] }), 15000, 'global-clear'); logger.info('Cleared global commands'); } catch { /* ignore */ }
      }
    } catch (e) {
      logger.error({ e }, 'command registration failed');
    }
  })();
}

main().catch((err) => logger.error(err));

// Controls builder (reused across messages)

// Live Now Playing message (per guild)
type NowLive = { channelId: string; messageId: string; lastEdit?: number; state?: UiState & { trackUri?: string } };
const nowLive = new Map<string, NowLive>();

async function fetchNowPlaying(guildId: string) {
  const requestId = crypto.randomUUID();
  const channel = `discord-bot:response:${requestId}`;
  type NowPlayingResponse = { title: string; uri?: string; author?: string; durationMs: number; positionMs: number; isStream: boolean; artworkUrl?: string; paused?: boolean; repeatMode?: 'off' | 'track' | 'queue' } | null;
  const response: Promise<NowPlayingResponse> = new Promise((resolve) => {
    const handler = async (message: string, chan: string) => {
      if (chan !== channel) return;
      try { resolve(JSON.parse(message)); } finally { await redisSub.unsubscribe(channel); }
    };
    redisSub.subscribe(channel, (msg) => handler(msg, channel)).catch(() => undefined);
  });
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'nowplaying', guildId, requestId }));
  redisPubCounter.labels('discord-bot:commands').inc();
  const data = (await Promise.race([
    response,
    new Promise((res) => setTimeout(() => res(null), 1500)),
  ])) as NowPlayingResponse;
  return data;
}

function buildNowEmbed(data: NonNullable<Awaited<ReturnType<typeof fetchNowPlaying>>>) {
  const total = data.durationMs || 0;
  const pos = data.positionMs || 0;
  const pct = total > 0 ? Math.min(1, pos / total) : 0;
  const barLen = 20;
  const filled = Math.min(barLen - 1, Math.round(pct * barLen));
  const bar = '▬'.repeat(filled) + '🔘' + '▬'.repeat(Math.max(0, barLen - filled - 1));
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };
  const ytMatch = data.uri?.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
  const thumb = data.artworkUrl ?? (ytMatch ? `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg` : undefined);
  const embed = new EmbedBuilder()
    .setTitle('Now Playing')
    .setDescription(`[${data.title}](${data.uri})`)
    .addFields(
      { name: 'Author', value: data.author ?? 'Unknown', inline: true },
      { name: 'Progress', value: data.isStream ? 'live' : `${fmt(pos)} ${bar} ${fmt(total)}`, inline: false },
    )
    .setColor(0x57f287);
  if (thumb) embed.setThumbnail(thumb);
  return embed;
}

async function ensureLiveNow(guildId: string, channelId: string, forceRelocate = false) {
  const data = await fetchNowPlaying(guildId);
  const channel = await resolveTextChannel(client, channelId);
  if (!channel) return;
  const autoplayOn = await getAutomixEnabled(guildId);
  // Quick approximation for initial controls
  const loopMode = (data?.repeatMode as 'off' | 'track' | 'queue') || 'off';
  const hasTrack = !!data;
  const canSeek = !!data && !data.isStream;
  const queueLen = 0;
  const controls = buildControls({ autoplayOn, loopMode, paused: false, hasTrack, queueLen, canSeek });
  if (!data) { return; }
  const embed = buildNowEmbed(data);
  const existing = nowLive.get(guildId);
  if (existing) {
    const msg = await channel.messages.fetch(existing.messageId).catch(() => null);
    if (msg && !forceRelocate) await msg.edit({ embeds: [embed], components: controls });
    else {
      const sent = await channel.send({ embeds: [embed], components: controls });
      if (msg) await msg.delete().catch(() => undefined);
      nowLive.set(guildId, { channelId, messageId: sent.id });
      return;
    }
  } else {
    const sent = await channel.send({ embeds: [embed], components: controls });
    nowLive.set(guildId, { channelId, messageId: sent.id });
  }
  // No interval here; updates are driven by push events from audio (playerUpdate)
  nowLive.set(guildId, { channelId, messageId: (nowLive.get(guildId)?.messageId as string) || '' });
}

// push update subscription is set after Redis connection (see later)

// Cleanup live message state when guild or channel is removed
client.on('guildDelete', (g) => {
  nowLive.delete(g.id);
});
client.on('channelDelete', (ch) => {
  const id = (ch as unknown as { id?: string } | null)?.id;
  for (const [gid, live] of nowLive) {
    if (id && live.channelId === id) nowLive.delete(gid);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const hasControl = hasDjOrAdmin(interaction);
    const requireDJ = async () => {
      if (!hasControl) {
        await interaction.reply({ content: `Requires ${env.DJ_ROLE_NAME} role.`, ephemeral: true });
        return false;
      }
      return true;
    };
    const allow = async (cmd: string, limit = 10, windowSec = 60) => {
      const key = `rl:${cmd}:${interaction.user.id}`;
      const n = await redisPub.incr(key);
      if (n === 1) await redisPub.expire(key, windowSec);
      return n <= limit;
    };
    if (interaction.commandName === 'ping') {
      await interaction.reply('Pong!');
      return;
    }
    if (interaction.commandName === 'play') {
      if (!(await allow('play', 5))) return await interaction.reply({ content: 'Too many requests. Try later.', ephemeral: true });
      const query = interaction.options.getString('query', true);
      const voice = interaction.guild?.members.cache.get(interaction.user.id)?.voice
        .channelId;
      if (!voice) {
        await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
        return;
      }
      await interaction.deferReply();
      const requestId = crypto.randomUUID();
      const channel = `discord-bot:response:${requestId}`;
      type PlayAck = { ok: true; title: string; uri?: string; artworkUrl?: string } | { ok: false; reason: string };
      const response: Promise<PlayAck | null> = new Promise((resolve) => {
        const handler = async (message: string, chan: string) => {
          if (chan !== channel) return;
          try { resolve(JSON.parse(message)); } finally { await redisSub.unsubscribe(channel); }
        };
        redisSub.subscribe(channel, (msg) => handler(msg, channel)).catch(() => undefined);
      });
      await redisPub.publish(
        'discord-bot:commands',
        JSON.stringify({
          type: 'play',
          guildId: interaction.guildId,
          voiceChannelId: voice,
          textChannelId: interaction.channelId,
          userId: interaction.user.id,
          query,
          requestId,
        }),
      );
      redisPubCounter.labels('discord-bot:commands').inc();
      // For queued ack, we keep the message minimal; controls live on Now Playing
      const ack = (await Promise.race([
        response,
        new Promise<null>((res) => setTimeout(() => res(null), 2500)),
      ])) as PlayAck | null;
      if (!ack) {
        await interaction.editReply({ content: `▶️ Queued: ${query}` });
      } else if ('ok' in ack && ack.ok) {
        await interaction.editReply({ content: `▶️ Queued: [${ack.title}](${ack.uri ?? query})` });
        // Crear/actualizar reproductor y relocalizarlo al pie del canal
        if (interaction.guildId && interaction.channelId) {
          void ensureLiveNow(interaction.guildId, interaction.channelId, true);
          setTimeout(() => { void ensureLiveNow(interaction.guildId!, interaction.channelId!); }, 1200);
        }
      } else {
        await interaction.editReply({ content: `No results for: ${query}` });
      }
      return;
    }
    if (interaction.commandName === 'skip') {
      if (!(await requireDJ())) return;
      if (!(await allow('skip'))) return await interaction.reply({ content: 'Slow down.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish(
        'discord-bot:commands',
        JSON.stringify({ type: 'skip', guildId: interaction.guildId }),
      );
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply('Skipped');
      return;
    }
    if (interaction.commandName === 'pause') {
      if (!(await requireDJ())) return;
      if (!(await allow('pause'))) return await interaction.reply({ content: 'Slow down.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'pause', guildId: interaction.guildId }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply('Paused');
      return;
    }
    if (interaction.commandName === 'resume') {
      if (!(await requireDJ())) return;
      if (!(await allow('resume'))) return await interaction.reply({ content: 'Slow down.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'resume', guildId: interaction.guildId }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply('Resumed');
      return;
    }
    if (interaction.commandName === 'stop') {
      if (!(await requireDJ())) return;
      if (!(await allow('stop'))) return await interaction.reply({ content: 'Slow down.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'stop', guildId: interaction.guildId }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply('Stopped');
      return;
    }
    if (interaction.commandName === 'loop') {
      if (!(await requireDJ())) return;
      if (!(await allow('loop'))) return await interaction.reply({ content: 'Slow down.', ephemeral: true });
      const mode = interaction.options.getString('mode', true) as 'off' | 'track' | 'queue';
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'loopSet', guildId: interaction.guildId, mode }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply(`Loop set to ${mode}`);
      return;
    }
    if (interaction.commandName === 'seek') {
      if (!(await requireDJ())) return;
      const seconds = interaction.options.getInteger('seconds', true);
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'seek', guildId: interaction.guildId, positionMs: Math.max(0, seconds) * 1000 }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply(`Seeking to ${seconds}s`);
      return;
    }
    if (interaction.commandName === 'shuffle') {
      if (!(await requireDJ())) return;
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'shuffle', guildId: interaction.guildId }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply('Queue shuffled');
      return;
    }
    if (interaction.commandName === 'remove') {
      if (!(await requireDJ())) return;
      const index = interaction.options.getInteger('index', true);
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'remove', guildId: interaction.guildId, index }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply(`Removed track #${index}`);
      return;
    }
    if (interaction.commandName === 'clear') {
      if (!(await requireDJ())) return;
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'clear', guildId: interaction.guildId }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply('Cleared queue');
      return;
    }
    if (interaction.commandName === 'move') {
      if (!(await requireDJ())) return;
      const from = interaction.options.getInteger('from', true);
      const to = interaction.options.getInteger('to', true);
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'move', guildId: interaction.guildId, from, to }));
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply(`Moved #${from} → #${to}`);
      return;
    }
    if (interaction.commandName === 'volume') {
      if (!(await requireDJ())) return;
      if (!(await allow('volume'))) return await interaction.reply({ content: 'Slow down.', ephemeral: true });
      const percent = interaction.options.getInteger('percent', true);
      await interaction.deferReply({ ephemeral: true });
      await redisPub.publish(
        'discord-bot:commands',
        JSON.stringify({ type: 'volume', guildId: interaction.guildId, percent }),
      );
      redisPubCounter.labels('discord-bot:commands').inc();
      await interaction.editReply(`Volume set to ${percent}%`);
      return;
    }
    if (interaction.commandName === 'nowplaying') {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.guildId) { await interaction.editReply('This command is guild-only.'); return; }
      const data = await fetchNowPlaying(interaction.guildId);
      if (!data) { await interaction.editReply('No track playing.'); return; }
      const embed = buildNowEmbed(data);
      const autoplayOn = await getAutomixEnabled(interaction.guildId);
      const state: UiState = {
        autoplayOn,
        loopMode: (data.repeatMode as 'off'|'track'|'queue') || 'off',
        paused: !!data.paused,
        hasTrack: true,
        queueLen: 0,
        canSeek: !data.isStream,
      };
      const controls = buildControls(state);
      await interaction.editReply({ embeds: [embed], components: controls });
      return;
    }
    if (interaction.commandName === 'queue') {
      await interaction.deferReply({ ephemeral: true });
      const requestId = crypto.randomUUID();
      const channel = `discord-bot:response:${requestId}`;
      type QueueResponse = { items: Array<{ title: string; uri?: string }> } | null;
      const response: Promise<QueueResponse> = new Promise((resolve) => {
        const handler = async (message: string, chan: string) => {
          if (chan !== channel) return;
          try { resolve(JSON.parse(message)); } finally { await redisSub.unsubscribe(channel); }
        };
        redisSub.subscribe(channel, (msg) => handler(msg, channel)).catch(() => undefined);
      });
      await redisPub.publish(
        'discord-bot:commands',
        JSON.stringify({ type: 'queue', guildId: interaction.guildId, requestId }),
      );
      redisPubCounter.labels('discord-bot:commands').inc();
      const data = (await Promise.race([
        response,
        new Promise((res) => setTimeout(() => res(null), 1500)),
      ])) as QueueResponse;
      if (!data || !data.items || data.items.length === 0) {
        await interaction.editReply('Queue is empty.');
        return;
      }
      const description = data.items
        .slice(0, 10)
        .map((t, i: number) => `${i + 1}. [${t.title}](${t.uri})`)
        .join('\n');
      const embed = new EmbedBuilder().setTitle('Queue').setDescription(description).setColor(0xfee75c);
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  } catch (err) {
    logger.error({ err }, 'interaction error');
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: 'Error', ephemeral: true });
      else await interaction.reply({ content: 'Error', ephemeral: true });
    } catch (_) { /* ignore double replies */ }
  }
});

// Redis bridge: forward Discord RAW to audio and send payloads from audio to Discord shards
const redisUrl = env.REDIS_URL;
const redisPub = createClient({ url: redisUrl });
const redisSub = createClient({ url: redisUrl });

await redisPub.connect();
await redisSub.connect();

// Subscribe to UI push updates from audio and update the live message efficiently
const rawMs = env.NOWPLAYING_UPDATE_MS ?? 5000;
const uiIntervalMs = Math.max(1000, Math.min(60000, Number.isFinite(rawMs as number) ? (rawMs as number) : 5000));

await redisSub.subscribe('discord-bot:ui:now', async (message) => {
  try {
    const data = JSON.parse(message) as { guildId: string; title: string; uri?: string; author?: string; durationMs: number; positionMs: number; isStream: boolean; artworkUrl?: string; paused?: boolean; repeatMode?: 'off'|'track'|'queue'; queueLen?: number; hasTrack?: boolean; canSeek?: boolean };
    if (!data || !data.guildId) return;
    if (data.paused) return; // don't update while paused
    let live = nowLive.get(data.guildId);
    if (!live) {
      // Try to create the live message automatically using stored textChannelId
      try {
        const q = await prisma.queue.findFirst({ where: { guildId: data.guildId }, select: { textChannelId: true } });
        const chId = q?.textChannelId;
        if (chId) {
          const ch = client.channels.cache.get(chId) as TextChannel | null;
          const channel = ch ?? (await client.channels.fetch(chId).catch(() => null) as TextChannel | null);
          if (channel) {
            const embed = buildNowEmbed({ title: data.title, uri: data.uri, author: data.author, durationMs: data.durationMs, positionMs: data.positionMs, isStream: data.isStream, artworkUrl: data.artworkUrl } as { title: string; uri?: string; author?: string; durationMs: number; positionMs: number; isStream: boolean; artworkUrl?: string });
            const state: UiState = {
              autoplayOn: await getAutomixEnabled(data.guildId),
              loopMode: data.repeatMode ?? 'off',
              paused: !!data.paused,
              hasTrack: data.hasTrack ?? true,
              queueLen: data.queueLen ?? 0,
              canSeek: data.canSeek ?? !data.isStream,
            };
            const controls = buildControls(state);
            const sent = await channel.send({ embeds: [embed], components: controls });
            nowLive.set(data.guildId, { channelId: channel.id, messageId: sent.id, lastEdit: Date.now(), state: { ...state, trackUri: data.uri } });
            live = nowLive.get(data.guildId);
          }
        }
      } catch (e) {
        logger.error({ e }, 'ui:now auto-create failed');
        return;
      }
      if (!live) return; // couldn't create automatically
    }
    const now = Date.now();
    if (live.lastEdit && now - live.lastEdit < uiIntervalMs) return; // debounce edits
    const ch = client.channels.cache.get(live.channelId) as TextChannel | null;
    if (!ch) return;
    const msg = await ch.messages.fetch(live.messageId).catch(() => null);
    const embed = buildNowEmbed({ title: data.title, uri: data.uri, author: data.author, durationMs: data.durationMs, positionMs: data.positionMs, isStream: data.isStream, artworkUrl: data.artworkUrl } as { title: string; uri?: string; author?: string; durationMs: number; positionMs: number; isStream: boolean; artworkUrl?: string });
    const state: UiState = {
      autoplayOn: await getAutomixEnabled(data.guildId),
      loopMode: data.repeatMode ?? 'off',
      paused: !!data.paused,
      hasTrack: data.hasTrack ?? true,
      queueLen: data.queueLen ?? 0,
      canSeek: data.canSeek ?? !data.isStream,
    };
    const controls = buildControls(state);
    // Always edit the same message; do not recreate per track
    if (!msg) {
      const newMsg = await ch.send({ embeds: [embed], components: controls });
      nowLive.set(data.guildId, { channelId: live.channelId, messageId: newMsg.id, lastEdit: now, state: { ...state, trackUri: data.uri } });
    } else {
      await msg.edit({ embeds: [embed], components: controls });
      nowLive.set(data.guildId, { ...live, lastEdit: now, state: { ...state, trackUri: data.uri } });
    }
  } catch (e) {
    logger.error({ e }, 'ui:now update failed');
  }
});

client.on('raw', async (d) => {
  try {
    await redisPub.publish('discord-bot:to-audio', JSON.stringify(d));
  } catch (e) {
    logger.error({ e }, 'failed to publish raw to audio');
  }
});

await redisSub.subscribe('discord-bot:to-discord', async (message) => {
  try {
    const { guildId, payload } = JSON.parse(message) as {
      guildId: string;
      payload: unknown;
    };
    redisSubCounter.labels('discord-bot:to-discord').inc();
    const shardId =
      client.guilds.cache.get(guildId)?.shardId ??
      (Number((BigInt(guildId) >> 22n) % BigInt(client.ws.shards.size)) || 0);
    const shard = client.ws.shards.get(shardId);
    if (!shard) return;
    await shard.send(payload as Record<string, unknown>);
  } catch (e) {
    logger.error({ e }, 'failed to dispatch payload to shard');
  }
});

// Button Interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const guildId = interaction.guildId;
  const id = interaction.customId;
  try {
    if (!guildId) { await interaction.reply({ content: 'Guild-only control.', ephemeral: true }); return; }
    if (!hasDjOrAdmin(interaction)) return await interaction.reply({ content: `Requires ${env.DJ_ROLE_NAME} role.`, ephemeral: true });
    switch (id) {
      case 'music:toggle':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'toggle' }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'toggle', guildId }));
        redisPubCounter.labels('discord-bot:commands').inc();
        // restart live updater shortly after toggling (resume or pause)
        if (interaction.channelId) setTimeout(() => { void ensureLiveNow(guildId, interaction.channelId!); }, 700);
        return;
      case 'music:skip':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'skip' }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'skip', guildId }));
        redisPubCounter.labels('discord-bot:commands').inc();
        return;
      case 'music:stop':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'stop' }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'stop', guildId }));
        redisPubCounter.labels('discord-bot:commands').inc();
        return;
      case 'music:loop': {
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'loop-toggle' }, 'button');
        const live = nowLive.get(guildId);
        const cur = live?.state?.loopMode ?? 'off';
        const next = cur === 'off' ? 'track' : cur === 'track' ? 'queue' : 'off';
        const autoplay = live?.state?.autoplayOn ?? (await getAutomixEnabled(guildId));
        if (next !== 'off' && autoplay) {
          await setAutomixEnabled(guildId, false);
        }
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'loop', guildId }));
        redisPubCounter.labels('discord-bot:commands').inc();
        if (interaction.channelId) void ensureLiveNow(guildId, interaction.channelId);
        return;
      }
      case 'music:shuffle':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'shuffle' }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'shuffle', guildId }));
        redisPubCounter.labels('discord-bot:commands').inc();
        return;
      case 'music:seekback':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'seek', deltaMs: -10000 }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'seekAdjust', guildId, deltaMs: -10000 }));
        redisPubCounter.labels('discord-bot:commands').inc();
        return;
      case 'music:seekfwd':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'seek', deltaMs: 10000 }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'seekAdjust', guildId, deltaMs: 10000 }));
        redisPubCounter.labels('discord-bot:commands').inc();
        return;
      case 'music:volup':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'volume', delta: 10 }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'volumeAdjust', guildId, delta: 10 }));
        redisPubCounter.labels('discord-bot:commands').inc();
        return;
      case 'music:voldown':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'volume', delta: -10 }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'volumeAdjust', guildId, delta: -10 }));
        redisPubCounter.labels('discord-bot:commands').inc();
        return;
      case 'music:clear':
        await interaction.deferUpdate();
        logger.info({ guildId, userId: interaction.user.id, action: 'clear' }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'clear', guildId }));
        redisPubCounter.labels('discord-bot:commands').inc();
        return;
      case 'music:autoplay':
      case 'music:automix': { // legacy id support
        await interaction.deferUpdate();
        const current = await getAutomixEnabled(guildId);
        const next = !current;
        logger.info({ guildId, userId: interaction.user.id, action: 'autoplay', enabled: next }, 'button');
        await setAutomixEnabled(guildId, next);
        if (next) {
          await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'loopSet', guildId, mode: 'off' }));
          redisPubCounter.labels('discord-bot:commands').inc();
          const live = nowLive.get(guildId);
          const queueLen = live?.state?.queueLen ?? 0;
          const hasTrack = live?.state?.hasTrack ?? false;
          if (hasTrack && queueLen === 0) {
            await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'seedRelated', guildId }));
            redisPubCounter.labels('discord-bot:commands').inc();
          }
        }
        if (interaction.channelId) void ensureLiveNow(guildId, interaction.channelId);
        return;
      }
      case 'music:queue': {
        const requestId = crypto.randomUUID();
        const channel = `discord-bot:response:${requestId}`;
        type QueuePayload = { items: Array<{ title: string; uri?: string }> } | null;
        const response: Promise<QueuePayload> = new Promise((resolve) => {
          const handler = async (message: string, chan: string) => {
            if (chan !== channel) return;
            try { resolve(JSON.parse(message)); } finally { await redisSub.unsubscribe(channel); }
          };
          redisSub.subscribe(channel, (msg) => handler(msg, channel)).catch(() => undefined);
        });
        logger.info({ guildId, userId: interaction.user.id, action: 'queue' }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'queue', guildId, requestId }));
        redisPubCounter.labels('discord-bot:commands').inc();
        const data = (await Promise.race([
          response,
          new Promise((res) => setTimeout(() => res(null), 1500)),
        ])) as QueuePayload;
        if (!data || !data?.items || data.items.length === 0) {
          await interaction.reply({ content: 'Queue is empty.', ephemeral: true });
        } else {
          const desc = data.items.slice(0, 10).map((t: { title: string; uri?: string }, i: number) => `${i + 1}. [${t.title}](${t.uri})`).join('\n');
          const embed = new EmbedBuilder().setTitle('Queue').setDescription(desc).setColor(0xfee75c);
          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        return;
      }
      case 'music:now': {
        const requestId = crypto.randomUUID();
        const channel = `discord-bot:response:${requestId}`;
        type NowPlayingResponse = { title: string; uri?: string; author?: string; durationMs: number; positionMs: number; isStream: boolean; artworkUrl?: string } | null;
        const response: Promise<NowPlayingResponse> = new Promise((resolve) => {
          const handler = async (message: string, chan: string) => {
            if (chan !== channel) return;
            try { resolve(JSON.parse(message)); } finally { await redisSub.unsubscribe(channel); }
          };
          redisSub.subscribe(channel, (msg) => handler(msg, channel)).catch(() => undefined);
        });
        logger.info({ guildId, userId: interaction.user.id, action: 'now' }, 'button');
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'nowplaying', guildId, requestId }));
        redisPubCounter.labels('discord-bot:commands').inc();
        const data = (await Promise.race([
          response,
          new Promise((res) => setTimeout(() => res(null), 1500)),
        ])) as NowPlayingResponse;
        if (!data) {
          await interaction.reply({ content: 'No track playing.', ephemeral: true });
        } else {
          const total = data.durationMs || 0;
          const pos = data.positionMs || 0;
          const pct = total > 0 ? Math.min(1, pos / total) : 0;
          const barLen = 20;
          const filled = Math.min(barLen - 1, Math.round(pct * barLen));
          const bar = '─'.repeat(filled) + '●' + '─'.repeat(Math.max(0, barLen - filled - 1));
          const fmt = (ms: number) => {
            const s = Math.floor(ms / 1000);
            const m = Math.floor(s / 60);
            const ss = s % 60;
            return `${m}:${ss.toString().padStart(2, '0')}`;
          };
          const ytMatch = data.uri?.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
          const thumb = data.artworkUrl ?? (ytMatch ? `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg` : undefined);
          const embed = new EmbedBuilder()
            .setTitle('Now Playing')
            .setDescription(`[${data.title}](${data.uri})`)
            .addFields(
              { name: 'Author', value: data.author ?? 'Unknown', inline: true },
              { name: 'Progress', value: data.isStream ? 'live' : `${fmt(pos)} ${bar} ${fmt(total)}`, inline: false },
            )
            .setColor(0x57f287);
          if (thumb) embed.setThumbnail(thumb);
          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        return;
      }
    }
    // Most handlers use deferUpdate() and do not send an extra message.
  } catch (e) {
    logger.error({ e }, 'button error');
    if (!interaction.replied) await interaction.reply({ content: 'Error', ephemeral: true });
  }
});

// Metrics and Health server
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const cmdCounter = new Counter({ name: 'discord_commands_total', help: 'Total slash commands', labelNames: ['command'], registers: [registry] });
const btnCounter = new Counter({ name: 'discord_buttons_total', help: 'Total button clicks', labelNames: ['action'], registers: [registry] });
const redisPubCounter = new Counter({ name: 'redis_published_total', help: 'Published messages', labelNames: ['channel'], registers: [registry] });
const redisSubCounter = new Counter({ name: 'redis_consumed_total', help: 'Consumed messages', labelNames: ['channel'], registers: [registry] });

client.on('interactionCreate', (i) => {
  if (i.isChatInputCommand()) cmdCounter.labels(i.commandName).inc();
  if (i.isButton()) btnCounter.labels(i.customId).inc();
});

const healthServer = http.createServer(async (req, res) => {
  if (!req.url) return;
  if (req.url.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ready: client.isReady }));
    return;
  }
  if (req.url.startsWith('/metrics')) {
    res.writeHead(200, { 'content-type': registry.contentType });
    res.end(await registry.metrics());
    return;
  }
  res.writeHead(404);
  res.end();
});
healthServer.listen(env.GATEWAY_HTTP_PORT, () => logger.info(`Gateway health on :${env.GATEWAY_HTTP_PORT}`));

// Simple redis metrics instrumentation at call sites

// Tracing
if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  void sdk.start();
}
