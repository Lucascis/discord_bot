import {
  LavalinkManager,
  type LavalinkNode,
  type GuildShardPayload,
  type VoicePacket,
  type VoiceServer,
  type VoiceState,
  type ChannelDeletePacket,
  type Track,
  type UnresolvedTrack,
  type BotClientOptions,
} from 'lavalink-client';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { createClient } from 'redis';
import { prisma } from '@discord-bot/database';
import http from 'node:http';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const redisUrl = env.REDIS_URL;
const redisPub = createClient({ url: redisUrl });
const redisSub = createClient({ url: redisUrl });

await redisPub.connect();
await redisSub.connect();

const manager = new LavalinkManager({
  nodes: [
    {
      id: 'main',
      host: env.LAVALINK_HOST,
      port: env.LAVALINK_PORT,
      authorization: env.LAVALINK_PASSWORD,
    },
  ],
  sendToShard: async (guildId, payload: GuildShardPayload) => {
    try {
      await redisPub.publish(
        'discord-bot:to-discord',
        JSON.stringify({ guildId, payload }),
      );
    } catch (e) {
      logger.error({ e }, 'failed to publish to-discord payload');
    }
  },
  client: {
    id: env.DISCORD_APPLICATION_ID,
    username: 'discord-bot',
  },
});

manager.nodeManager.on('connect', (node: LavalinkNode) =>
  logger.info(`Node ${node.id} connected`),
);
manager.nodeManager.on('error', (node: LavalinkNode, error: Error) =>
  logger.error({ error }, `Node ${node.id} error`),
);

export { manager };

// Initialize manager
await manager.init({ id: env.DISCORD_APPLICATION_ID, username: 'discord-bot' } as BotClientOptions);

// Handle raw events from Discord via Redis
await redisSub.subscribe('discord-bot:to-audio', async (message) => {
  try {
    const payload = JSON.parse(message) as
      | VoicePacket
      | VoiceServer
      | VoiceState
      | ChannelDeletePacket;
    await manager.sendRawData(payload);
  } catch (e) {
    logger.error({ e }, 'failed to process raw event');
  }
});

// Simple command bus for playback
await redisSub.subscribe('discord-bot:commands', async (message) => {
  try {
    const data = JSON.parse(message) as
      | { type: 'play'; guildId: string; voiceChannelId: string; textChannelId: string; userId: string; query: string }
      | { type: 'skip'; guildId: string }
      | { type: 'pause'; guildId: string }
      | { type: 'resume'; guildId: string }
      | { type: 'stop'; guildId: string }
      | { type: 'volume'; guildId: string; percent: number }
      | { type: 'loop'; guildId: string }
      | { type: 'loopSet'; guildId: string; mode: 'off' | 'track' | 'queue' }
      | { type: 'volumeAdjust'; guildId: string; delta: number }
      | { type: 'nowplaying'; guildId: string; requestId: string }
      | { type: 'queue'; guildId: string; requestId: string };

    if (data.type === 'play') {
      logger.info({ guildId: data.guildId, query: data.query }, 'audio: play command received');
      const player = manager.createPlayer({
        guildId: data.guildId,
        volume: 100,
        voiceChannelId: data.voiceChannelId,
        textChannelId: data.textChannelId,
        selfDeaf: true,
      });
      await player.connect();
      const res = await player.search(
        { query: data.query },
        { id: data.userId } as { id: string },
      );
      logger.info({ tracks: res.tracks.length }, 'audio: search results');
      if (res.tracks.length > 0) {
        if (!player.playing && !player.paused && !player.queue.current) {
          await player.play({ clientTrack: res.tracks[0] as Track | UnresolvedTrack });
        } else {
          await player.queue.add(res.tracks[0] as Track | UnresolvedTrack);
        }
        await saveQueue(data.guildId, player, data.voiceChannelId, data.textChannelId);
      } else {
        logger.warn({ query: data.query }, 'audio: no tracks found');
      }
      return;
    }
    if (data.type === 'skip') {
      const player = manager.getPlayer(data.guildId);
      if (player) await player.skip();
      if (player) await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'pause') {
      const player = manager.getPlayer(data.guildId);
      if (player && !player.paused) await player.pause();
      return;
    }
    if (data.type === 'resume') {
      const player = manager.getPlayer(data.guildId);
      if (player && player.paused) await player.resume();
      if (player) await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'stop') {
      const player = manager.getPlayer(data.guildId);
      if (player) await player.stopPlaying(true, false);
      if (player) await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'volume') {
      const player = manager.getPlayer(data.guildId);
      if (player) await player.setVolume(Math.max(0, Math.min(200, data.percent)));
      if (player) await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'loop') {
      const player = manager.getPlayer(data.guildId);
      if (!player) return;
      const next = player.repeatMode === 'off' ? 'track' : player.repeatMode === 'track' ? 'queue' : 'off';
      await player.setRepeatMode(next);
      await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'loopSet') {
      const player = manager.getPlayer(data.guildId);
      if (!player) return;
      await player.setRepeatMode(data.mode);
      await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'volumeAdjust') {
      const player = manager.getPlayer(data.guildId);
      if (!player) return;
      const newVol = Math.max(0, Math.min(200, (player.volume ?? 100) + data.delta));
      await player.setVolume(newVol);
      await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'nowplaying') {
      const player = manager.getPlayer(data.guildId);
      const current = player?.queue.current;
      type TrackInfoLite = { title?: string; uri?: string; author?: string; duration?: number; isStream?: boolean; artworkUrl?: string };
      const info = current ? ((current as { info?: TrackInfoLite }).info) : undefined;
      const response = info
        ? {
            title: info.title ?? 'Unknown',
            uri: info.uri,
            author: info.author,
            durationMs: (info.duration ?? 0) as number,
            positionMs: player?.position ?? 0,
            isStream: !!info.isStream,
            artworkUrl: info.artworkUrl,
          }
        : null;
      await redisPub.publish(`discord-bot:response:${data.requestId}`, JSON.stringify(response));
      return;
    }
    if (data.type === 'queue') {
      const player = manager.getPlayer(data.guildId);
      const items = (player?.queue.tracks ?? []).slice(0, 10).map((t: { info?: { title?: string; uri?: string } }) => {
        const info = t.info;
        return { title: info?.title ?? 'Unknown', uri: info?.uri };
      });
      await redisPub.publish(`discord-bot:response:${data.requestId}`, JSON.stringify({ items }));
      return;
    }
  } catch (e) {
    const err = e as Error;
    logger.error({ err, message: err?.message, stack: err?.stack }, 'failed to process command');
  }
});

// Metrics + Health
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const lavalinkEvents = new Counter({ name: 'lavalink_events_total', help: 'Lavalink events', labelNames: ['event'], registers: [registry] });
const audioCommands = new Counter({ name: 'audio_commands_total', help: 'Audio commands', labelNames: ['type'], registers: [registry] });

manager.on('trackStart', (player, track) => {
  lavalinkEvents.labels('trackStart').inc();
  const info = (track as { info?: { title?: string; uri?: string } })?.info;
  logger.info({ guildId: player.guildId, title: info?.title, uri: info?.uri }, 'audio: track start');
});
manager.on('trackEnd', () => lavalinkEvents.labels('trackEnd').inc());
manager.on('trackError', () => lavalinkEvents.labels('trackError').inc());

await redisSub.subscribe('discord-bot:commands', async (message) => {
  try {
    const { type } = JSON.parse(message) as { type: string };
    audioCommands.labels(type).inc();
  } catch (_err) {
    // ignore metrics parse errors
  }
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
  res.writeHead(404); res.end();
});
healthServer.listen(env.AUDIO_HTTP_PORT, () => logger.info(`Audio health on :${env.AUDIO_HTTP_PORT}`));

// Tracing
if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  void sdk.start();
}

// Persistence helpers
async function saveQueue(guildId: string, player: import('lavalink-client').Player, voiceChannelId?: string, textChannelId?: string) {
  try {
    let queue = await prisma.queue.findFirst({ where: { guildId }, select: { id: true } });
    if (!queue) {
      queue = await prisma.queue.create({ data: { guildId, voiceChannelId, textChannelId }, select: { id: true } });
    } else {
      await prisma.queue.update({ where: { id: queue.id }, data: { voiceChannelId, textChannelId } });
    }
    // Clear existing items and insert new snapshot (current + upcoming)
    await prisma.queueItem.deleteMany({ where: { queueId: queue.id } });
    const items: Array<{ title: string; url: string; requestedBy: string; duration: number }> = [];
    const current = player.queue.current as { info?: { title?: string; uri?: string; duration?: number }; requester?: { id?: string } } | undefined;
    if (current?.info?.uri) {
      items.push({
        title: current.info.title ?? 'Unknown',
        url: current.info.uri,
        requestedBy: current.requester?.id ?? 'unknown',
        duration: Math.floor((current.info.duration ?? 0) / 1000),
      });
    }
    for (const t of player.queue.tracks as Array<{ info?: { title?: string; uri?: string; duration?: number }; requester?: { id?: string } }>) {
      if (!t.info?.uri) continue;
      items.push({
        title: t.info.title ?? 'Unknown',
        url: t.info.uri,
        requestedBy: t.requester?.id ?? 'unknown',
        duration: Math.floor((t.info.duration ?? 0) / 1000),
      });
    }
    if (items.length > 0) {
      await prisma.queueItem.createMany({
        data: items.map((it) => ({ ...it, queueId: queue.id })),
      });
    }
  } catch (e) {
    logger.error({ e }, 'failed to save queue');
  }
}

async function resumeQueues() {
  try {
    const queues = await prisma.queue.findMany({ include: { items: { orderBy: { createdAt: 'asc' } } } });
    for (const q of queues) {
      if (q.items.length === 0) continue;
      if (!q.voiceChannelId) continue; // cannot resume without voice channel
      const player = manager.createPlayer({ guildId: q.guildId, voiceChannelId: q.voiceChannelId, textChannelId: q.textChannelId ?? undefined, selfDeaf: true, volume: 100 });
      await player.connect();
      for (const it of q.items) {
        const res = await player.search({ query: it.url || it.title }, { id: 'system' } as { id: string });
        if (res.tracks.length > 0) {
          if (!player.playing && !player.paused && !player.queue.current) {
            await player.play({ clientTrack: res.tracks[0] as Track | UnresolvedTrack });
          } else {
            await player.queue.add(res.tracks[0] as Track | UnresolvedTrack);
          }
        }
      }
    }
  } catch (e) {
    logger.error({ e }, 'failed to resume queues');
  }
}

void resumeQueues();
