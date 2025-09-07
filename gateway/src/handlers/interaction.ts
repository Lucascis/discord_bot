import { type ButtonInteraction, EmbedBuilder, type Client } from 'discord.js';
import { type RedisClientType } from 'redis';
import { validateSnowflake } from '../validation.js';
import { getAutomixEnabled, setAutomixEnabled } from '../flags.js';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { randomUUID } from 'node:crypto';

interface RedisPubCounter {
  count: number;
  lastReset: number;
}

interface NowLiveData {
  channelId: string;
  messageId: string;
  lastUpdate: number;
}

export interface InteractionHandlerContext {
  client: Client;
  redisPub: RedisClientType;
  redisSub: RedisClientType;
  redisPubCounter: RedisPubCounter;
  nowLive: Map<string, NowLiveData>;
  hasDjOrAdmin: (interaction: ButtonInteraction) => boolean;
  ensureLiveNow: (guildId: string, channelId: string, forceRelocate?: boolean) => Promise<void>;
}

export async function handleMusicToggle(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter, ensureLiveNow } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'toggle' }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'toggle', guildId }));
  redisPubCounter.labels('discord-bot:commands').inc();
  
  if (interaction.channelId) {
    setTimeout(() => { void ensureLiveNow(guildId, interaction.channelId!); }, 700);
  }
}

export async function handleMusicSkip(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'skip' }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'skip', guildId }));
  redisPubCounter.labels('discord-bot:commands').inc();
}

export async function handleMusicStop(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'stop' }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'stop', guildId }));
  redisPubCounter.labels('discord-bot:commands').inc();
}

export async function handleMusicLoop(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter, nowLive, ensureLiveNow } = context;
  const guildId = interaction.guildId!;
  
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
  
  if (interaction.channelId) {
    void ensureLiveNow(guildId, interaction.channelId);
  }
}

export async function handleMusicShuffle(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'shuffle' }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'shuffle', guildId }));
  redisPubCounter.labels('discord-bot:commands').inc();
}

export async function handleSeekBack(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'seek', deltaMs: -10000 }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'seekAdjust', guildId, deltaMs: -10000 }));
  redisPubCounter.labels('discord-bot:commands').inc();
}

export async function handleSeekForward(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'seek', deltaMs: 10000 }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'seekAdjust', guildId, deltaMs: 10000 }));
  redisPubCounter.labels('discord-bot:commands').inc();
}

export async function handleVolumeUp(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'volume', delta: 10 }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'volumeAdjust', guildId, delta: 10 }));
  redisPubCounter.labels('discord-bot:commands').inc();
}

export async function handleVolumeDown(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'volume', delta: -10 }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'volumeAdjust', guildId, delta: -10 }));
  redisPubCounter.labels('discord-bot:commands').inc();
}

export async function handleMusicClear(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  await interaction.deferUpdate();
  logger.info({ guildId, userId: interaction.user.id, action: 'clear' }, 'button');
  
  await redisPub.publish('discord-bot:commands', JSON.stringify({ type: 'clear', guildId }));
  redisPubCounter.labels('discord-bot:commands').inc();
}

export async function handleAutoplay(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisPubCounter, nowLive, ensureLiveNow } = context;
  const guildId = interaction.guildId!;
  
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
  
  if (interaction.channelId) {
    void ensureLiveNow(guildId, interaction.channelId);
  }
}

export async function handleQueueButton(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisSub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  const requestId = randomUUID();
  const channel = `discord-bot:response:${requestId}`;
  
  type QueuePayload = { items: Array<{ title: string; uri?: string }> } | null;
  
  const response: Promise<QueuePayload> = new Promise((resolve) => {
    const handler = async (message: string, chan: string) => {
      if (chan !== channel) return;
      try { 
        resolve(JSON.parse(message)); 
      } finally { 
        await redisSub.unsubscribe(channel); 
      }
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
    const desc = data.items.slice(0, 10).map((t: { title: string; uri?: string }, i: number) => 
      `${i + 1}. [${t.title}](${t.uri})`
    ).join('\n');
    const embed = new EmbedBuilder().setTitle('Queue').setDescription(desc).setColor(0xfee75c);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

export async function handleNowPlayingButton(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const { redisPub, redisSub, redisPubCounter } = context;
  const guildId = interaction.guildId!;
  
  const requestId = randomUUID();
  const channel = `discord-bot:response:${requestId}`;
  
  type NowPlayingResponse = { 
    title: string; 
    uri?: string; 
    author?: string; 
    durationMs: number; 
    positionMs: number; 
    isStream: boolean; 
    artworkUrl?: string 
  } | null;

  const response: Promise<NowPlayingResponse> = new Promise((resolve) => {
    const handler = async (message: string, chan: string) => {
      if (chan !== channel) return;
      try { 
        resolve(JSON.parse(message)); 
      } finally { 
        await redisSub.unsubscribe(channel); 
      }
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
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
  context: InteractionHandlerContext
): Promise<void> {
  const guildId = interaction.guildId;
  const id = interaction.customId;
  
  try {
    if (!guildId) { 
      await interaction.reply({ content: 'Guild-only control.', ephemeral: true }); 
      return; 
    }
    
    // Validate guild ID for security
    const guildValidation = validateSnowflake(guildId, 'Guild ID');
    if (!guildValidation.success) {
      await interaction.reply({ content: 'Invalid guild context.', ephemeral: true });
      return;
    }
    
    if (!context.hasDjOrAdmin(interaction)) {
      await interaction.reply({ content: `Requires ${env.DJ_ROLE_NAME} role.`, ephemeral: true });
      return;
    }
    
    switch (id) {
      case 'music:toggle':
        await handleMusicToggle(interaction, context);
        break;
      case 'music:skip':
        await handleMusicSkip(interaction, context);
        break;
      case 'music:stop':
        await handleMusicStop(interaction, context);
        break;
      case 'music:loop':
        await handleMusicLoop(interaction, context);
        break;
      case 'music:shuffle':
        await handleMusicShuffle(interaction, context);
        break;
      case 'music:seekback':
        await handleSeekBack(interaction, context);
        break;
      case 'music:seekfwd':
        await handleSeekForward(interaction, context);
        break;
      case 'music:volup':
        await handleVolumeUp(interaction, context);
        break;
      case 'music:voldown':
        await handleVolumeDown(interaction, context);
        break;
      case 'music:clear':
        await handleMusicClear(interaction, context);
        break;
      case 'music:autoplay':
      case 'music:automix': // legacy id support
        await handleAutoplay(interaction, context);
        break;
      case 'music:queue':
        await handleQueueButton(interaction, context);
        break;
      case 'music:now':
        await handleNowPlayingButton(interaction, context);
        break;
      default:
        logger.warn({ customId: id }, 'Unknown button interaction');
        await interaction.reply({ content: 'Unknown button action.', ephemeral: true });
    }
  } catch (error) {
    logger.error({ error, customId: id, guildId }, 'Button interaction error');
    
    const errorMessage = 'An error occurred while processing your interaction.';
    if (interaction.deferred) {
      await interaction.editReply({ content: errorMessage });
    } else if (!interaction.replied) {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}