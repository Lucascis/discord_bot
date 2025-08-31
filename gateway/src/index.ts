import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} from 'discord.js';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { createClient } from 'redis';
import http from 'node:http';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import crypto from 'node:crypto';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] });

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

async function main() {
  const appId = env.DISCORD_APPLICATION_ID;
  const guildId = env.DISCORD_GUILD_ID;

  if (guildId) {
    logger.info({ appId, guildId }, 'Registering guild commands');
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  } else {
    logger.info({ appId }, 'Registering global commands');
    await rest.put(Routes.applicationCommands(appId), { body: commands });
  }

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => logger.error(err));

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
      const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:toggle').setLabel('⏯️ Play/Pause').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music:stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music:loop').setLabel('🔁 Loop').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('music:shuffle').setLabel('🔀 Shuffle').setStyle(ButtonStyle.Secondary),
      );
      const controls2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:voldown').setLabel('🔉 Vol -').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:volup').setLabel('🔊 Vol +').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:queue').setLabel('🗒️ Queue').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:now').setLabel('⏱️ Now').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:clear').setLabel('🧹 Clear').setStyle(ButtonStyle.Secondary),
      );
      const ack = (await Promise.race([
        response,
        new Promise<null>((res) => setTimeout(() => res(null), 2500)),
      ])) as PlayAck | null;
      if (!ack) {
        await interaction.editReply({ content: `Queued: ${query}`, components: [controls, controls2] });
      } else if ('ok' in ack && ack.ok) {
        const embed = new EmbedBuilder()
          .setTitle('Queued')
          .setDescription(`[${ack.title}](${ack.uri ?? query})`)
          .setThumbnail(ack.artworkUrl ?? null)
          .setColor(0x5865f2)
          .setFooter({ text: 'Use the controls below to manage playback' });
        await interaction.editReply({ embeds: [embed], components: [controls, controls2] });
      } else {
        await interaction.editReply({ content: `No results for: ${query}`, components: [controls, controls2] });
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
      await redisPub.publish(
        'discord-bot:commands',
        JSON.stringify({ type: 'nowplaying', guildId: interaction.guildId, requestId }),
      );
      redisPubCounter.labels('discord-bot:commands').inc();
      const data: NowPlayingResponse = (await Promise.race([
        response,
        new Promise((res) => setTimeout(() => res(null), 1500)),
      ])) as NowPlayingResponse;
      if (!data) {
        await interaction.editReply('No track playing.');
        return;
      }
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
      const thumb = data.artworkUrl ?? (ytMatch ? `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg` : null);
      const embed = new EmbedBuilder()
        .setTitle('Now Playing')
        .setDescription(`[${data.title}](${data.uri})`)
        .addFields(
          { name: 'Author', value: data.author ?? 'Unknown', inline: true },
          { name: 'Progress', value: data.isStream ? 'live' : `${fmt(pos)} ${bar} ${fmt(total)}`, inline: false },
        )
        .setThumbnail(thumb)
        .setColor(0x57f287);
      await interaction.editReply({ embeds: [embed] });
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
    if (!interaction.replied) await interaction.reply({ content: 'Error', ephemeral: true });
  }
});

// Redis bridge: forward Discord RAW to audio and send payloads from audio to Discord shards
const redisUrl = env.REDIS_URL;
const redisPub = createClient({ url: redisUrl });
const redisSub = createClient({ url: redisUrl });

await redisPub.connect();
await redisSub.connect();

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
    if (!hasDjOrAdmin(interaction)) return await interaction.reply({ content: `Requires ${env.DJ_ROLE_NAME} role.`, ephemeral: true });
    switch (id) {
      case 'music:toggle':
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'toggle', guildId }));
        break;
      case 'music:skip':
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'skip', guildId }));
        break;
      case 'music:stop':
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'stop', guildId }));
        break;
      case 'music:loop':
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'loop', guildId }));
        break;
      case 'music:shuffle':
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'shuffle', guildId }));
        break;
      case 'music:volup':
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'volumeAdjust', guildId, delta: 10 }));
        break;
      case 'music:voldown':
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'volumeAdjust', guildId, delta: -10 }));
        break;
      case 'music:clear':
        await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'clear', guildId }));
        break;
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
          const thumb = data.artworkUrl ?? (ytMatch ? `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg` : null);
          const embed = new EmbedBuilder()
            .setTitle('Now Playing')
            .setDescription(`[${data.title}](${data.uri})`)
            .addFields(
              { name: 'Author', value: data.author ?? 'Unknown', inline: true },
              { name: 'Progress', value: data.isStream ? 'live' : `${fmt(pos)} ${bar} ${fmt(total)}`, inline: false },
            )
            .setThumbnail(thumb)
            .setColor(0x57f287);
          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        return;
      }
    }
    await interaction.reply({ content: 'OK', ephemeral: true });
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
    res.end(JSON.stringify({ ok: true }));
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
