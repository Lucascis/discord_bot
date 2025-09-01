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
import { setTimeout as delay } from 'node:timers/promises';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { isBlockReason, pickAutomixTrack, ensurePlayback, seedRelatedQueue } from './autoplay.js';
import { shouldAutomixAfterSkip, shouldSeedOnFirstPlay } from './logic.js';

const redisUrl = env.REDIS_URL;
const redisPub = createClient({ url: redisUrl });
const redisSub = createClient({ url: redisUrl });

await redisPub.connect();
await redisSub.connect();
logger.info({ NOWPLAYING_UPDATE_MS: env.NOWPLAYING_UPDATE_MS }, 'Audio startup config');

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

// Helper: wait until Lavalink REST is ready (plugins loaded)
async function waitForLavalinkRestReady(maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  const url = `http://${env.LAVALINK_HOST}:${env.LAVALINK_PORT}/v4/info`;
  const headers = { Authorization: env.LAVALINK_PASSWORD } as Record<string, string>;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        // Basic sanity: response is JSON and contains version/plugins keys
        const j = (await res.json()) as { version?: unknown; plugins?: unknown };
        if (j && j.version !== undefined && j.plugins !== undefined) return true;
      }
    } catch { /* ignore until deadline */ }
    await delay(1000);
  }
  return false;
}

// Initialize manager, but wait for Lavalink to be ready first to avoid race conditions
await waitForLavalinkRestReady();
await manager.init({ id: env.DISCORD_APPLICATION_ID, username: 'discord-bot' } as BotClientOptions);

// Ensure at least one node connect event (best-effort)
await new Promise<void>((resolve) => {
  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 3000);
  manager.nodeManager.once('connect', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
});


type CommandMessage =
  | { type: 'play'; guildId: string; voiceChannelId: string; textChannelId: string; userId: string; query: string; requestId?: string }
  | { type: 'skip'; guildId: string }
  | { type: 'pause'; guildId: string }
  | { type: 'resume'; guildId: string }
  | { type: 'toggle'; guildId: string }
  | { type: 'stop'; guildId: string }
  | { type: 'volume'; guildId: string; percent: number }
  | { type: 'loop'; guildId: string }
  | { type: 'loopSet'; guildId: string; mode: 'off' | 'track' | 'queue' }
  | { type: 'volumeAdjust'; guildId: string; delta: number }
  | { type: 'nowplaying'; guildId: string; requestId: string }
  | { type: 'queue'; guildId: string; requestId: string }
  | { type: 'seek'; guildId: string; positionMs: number }
  | { type: 'seekAdjust'; guildId: string; deltaMs: number }
  | { type: 'shuffle'; guildId: string }
  | { type: 'remove'; guildId: string; index: number }
  | { type: 'clear'; guildId: string }
  | { type: 'move'; guildId: string; from: number; to: number }
  | { type: 'seedRelated'; guildId: string };
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
  let data: CommandMessage | undefined;
  try {
    data = JSON.parse(message) as CommandMessage;

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
        const first = res.tracks[0] as Track | UnresolvedTrack;
        // Evaluar gate de seed ANTES de iniciar la reproducción para capturar el estado "idle"
        let seedOnFirst = false;
        try {
          const autoplayEnabled = await isAutomixEnabled(data.guildId);
          seedOnFirst = shouldSeedOnFirstPlay({
            autoplayEnabled,
            playing: player.playing,
            paused: player.paused,
            hasCurrent: !!player.queue.current,
          });
        } catch { /* ignore and proceed without seeding */ }

        if (!player.playing && !player.paused && !player.queue.current) {
          await player.play({ clientTrack: first });
          // Seed related tracks en segundo plano si corresponde
          if (seedOnFirst) {
            void (async () => {
              try {
                const userId = data.userId;
                const seeded = await seedRelatedQueue(
                  player as unknown as import('./autoplay.js').LLPlayer,
                  first as unknown as import('./autoplay.js').LLTrack,
                  async (q: string) => {
                    const r = await player.search({ query: q }, { id: userId || 'system' } as { id: string });
                    return { tracks: r.tracks as unknown as import('./autoplay.js').LLTrack[] };
                  },
                  10,
                );
                if (seeded > 0) logger.info({ guildId: data.guildId, seeded }, 'audio: seeded related tracks');
                await saveQueue(data.guildId, player, data.voiceChannelId, data.textChannelId);
              } catch (e) {
                logger.error({ e }, 'audio: failed to seed related queue');
              }
            })();
          }
        } else {
          // Priority insertion for subsequent user adds
          await player.queue.add(first, 0);
        }
        await saveQueue(data.guildId, player, data.voiceChannelId, data.textChannelId);
        if (data.requestId) {
          type TrackInfoLite = { title?: string; uri?: string; artworkUrl?: string };
          const info = (res.tracks[0] as { info?: TrackInfoLite }).info;
          await redisPub.publish(
            `discord-bot:response:${data.requestId}`,
            JSON.stringify({ ok: true, title: info?.title ?? 'Unknown', uri: info?.uri, artworkUrl: info?.artworkUrl }),
          );
        }
      } else {
        logger.warn({ query: data.query }, 'audio: no tracks found');
        if (data.requestId) {
          await redisPub.publish(`discord-bot:response:${data.requestId}`, JSON.stringify({ ok: false, reason: 'no_results' }));
        }
      }
      return;
    }
    if (data.type === 'skip') {
      const player = manager.getPlayer(data.guildId);
      if (player) {
        const prev = player.queue.current as { info?: { title?: string; author?: string; uri?: string } } | undefined;
        const qlen = player.queue.tracks.length;
        // Acción rápida con timeout para evitar bloqueo
        const op = qlen > 0 ? player.skip() : player.stopPlaying(true, false);
        await Promise.race([op.catch(() => undefined), delay(2000)]);
        // Manejo post-skip en background para no bloquear el bus de comandos
        void (async () => {
          try {
            await delay(900);
            const enabled = await isAutomixEnabled(player.guildId);
            const state = {
              repeatMode: (player.repeatMode ?? 'off') as 'off'|'track'|'queue',
              playing: !!player.playing,
              hasCurrent: !!player.queue.current,
              queueLen: player.queue.tracks.length,
              autoplayEnabled: enabled,
            };
            if (prev && shouldAutomixAfterSkip(state)) {
              logger.info({ guildId: player.guildId }, 'audio: skip on empty queue with autoplay → enqueue automix');
              await enqueueAutomix(player, prev);
            } else {
              // Sin autoplay y sin cola: empujar estado Idle para refrescar UI
              if (!state.playing && !state.hasCurrent && state.queueLen === 0) {
                await pushIdleState(player);
              }
            }
            await saveQueue(data.guildId, player);
          } catch (e) {
            logger.error({ e }, 'audio: post-skip automix failed');
          }
        })();
      }
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
    if (data.type === 'toggle') {
      const player = manager.getPlayer(data.guildId);
      if (!player) return;
      if (player.paused) await player.resume(); else await player.pause();
      if (player) await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'stop') {
      const player = manager.getPlayer(data.guildId);
      if (player) {
        await player.stopPlaying(true, false);
        await pushIdleState(player);
        await saveQueue(data.guildId, player);
      }
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
    if (data.type === 'seedRelated') {
      const player = manager.getPlayer(data.guildId);
      if (!player) return;
      try {
        const enabled = await isAutomixEnabled(player.guildId);
        if (!enabled) return;
        const current = player.queue.current as { info?: { title?: string; uri?: string } } | undefined;
        if (!current?.info || player.queue.tracks.length > 0) return;
        const seeded = await seedRelatedQueue(
          player as unknown as import('./autoplay.js').LLPlayer,
          current as unknown as import('./autoplay.js').LLTrack,
          async (q: string) => {
            const r = await player.search({ query: q }, { id: 'automix' } as { id: string });
            return { tracks: r.tracks as unknown as import('./autoplay.js').LLTrack[] };
          },
          10,
        );
        if (seeded > 0) {
          logger.info({ guildId: data.guildId, seeded }, 'audio: seedRelated command added tracks');
          await saveQueue(data.guildId, player);
        }
      } catch (e) {
        logger.error({ e }, 'audio: seedRelated failed');
      }
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
            paused: !!player?.paused,
            repeatMode: (player?.repeatMode ?? 'off') as 'off' | 'track' | 'queue',
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
    if (data.type === 'seek') {
      const player = manager.getPlayer(data.guildId);
      if (player) await player.seek(Math.max(0, data.positionMs));
      return;
    }
    if (data.type === 'seekAdjust') {
      const player = manager.getPlayer(data.guildId);
      if (player) await player.seek(Math.max(0, (player.position ?? 0) + data.deltaMs));
      return;
    }
    if (data.type === 'shuffle') {
      const player = manager.getPlayer(data.guildId);
      if (player) await player.queue.shuffle();
      if (player) await saveQueue(data.guildId, player);
      return;
    }
    if (data.type === 'remove') {
      const player = manager.getPlayer(data.guildId);
      if (player) {
        const idx = Math.max(1, data.index) - 1;
        if (player.queue.tracks[idx]) {
          type QueueWithRemove = { remove?: (arg: number | number[] | unknown) => Promise<unknown> };
          const q = player.queue as unknown as QueueWithRemove;
          if (q.remove) await q.remove(idx); else player.queue.splice(idx, 1);
          await saveQueue(data.guildId, player);
        }
      }
      return;
    }
    if (data.type === 'clear') {
      const player = manager.getPlayer(data.guildId);
      if (player) {
        const len = player.queue.tracks.length;
        if (len > 0) player.queue.splice(0, len);
        await saveQueue(data.guildId, player);
      }
      return;
    }
    if (data.type === 'move') {
      const player = manager.getPlayer(data.guildId);
      if (player) {
        const from = Math.max(1, data.from) - 1;
        const to = Math.max(1, data.to) - 1;
        const track = player.queue.tracks[from];
        if (track) {
          player.queue.splice(from, 1);
          await player.queue.add(track, to);
          await saveQueue(data.guildId, player);
        }
      }
      return;
    }
  } catch (e) {
    const err = e as Error;
    logger.error({ err, message: err?.message, stack: err?.stack }, 'failed to process command');
    try {
      if (data && data.type === 'play' && data.requestId) {
        await redisPub.publish(
          `discord-bot:response:${data.requestId}`,
          JSON.stringify({ ok: false, reason: 'error', message: err?.message || 'unknown' }),
        );
      }
    } catch (_ackErr) { /* ignore */ }
  }
});

// Metrics + Health
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const lavalinkEvents = new Counter({ name: 'lavalink_events_total', help: 'Lavalink events', labelNames: ['event'], registers: [registry] });
// const audioCommands = new Counter({ name: 'audio_commands_total', help: 'Audio commands', labelNames: ['type'], registers: [registry] });

manager.on('trackStart', (player, track) => {
  lavalinkEvents.labels('trackStart').inc();
  const info = (track as { info?: { title?: string; uri?: string } })?.info;
  logger.info({ guildId: player.guildId, title: info?.title, uri: info?.uri }, 'audio: track start');
  // push immediate now-playing snapshot
  void pushNowPlaying(player);
});
manager.on('trackEnd', () => lavalinkEvents.labels('trackEnd').inc());
manager.on('trackError', () => lavalinkEvents.labels('trackError').inc());
// Try to recover from track errors by skipping or automix
manager.on('trackError', async (player, track) => {
  try {
    if (player.queue.tracks.length > 0) {
      await player.skip();
      await saveQueue(player.guildId, player);
      return;
    }
    if ((player.repeatMode ?? 'off') === 'off' && !(player.playing || player.queue.current)) {
      if (await isAutomixEnabled(player.guildId)) {
        try {
          await enqueueAutomix(player, track as { info?: { title?: string; author?: string; uri?: string } });
        } catch (e) {
          logger.error({ e }, 'automix after trackError failed');
        }
      }
    }
  } catch (e) {
    logger.error({ e }, 'trackError handler failed');
  }
});

// Handle track stuck (e.g., problematic streams) similar to trackError
manager.on('trackStuck', async (player, track) => {
  try {
    if (player.queue.tracks.length > 0) {
      await player.skip();
      await saveQueue(player.guildId, player);
      return;
    }
    if ((player.repeatMode ?? 'off') === 'off' && !(player.playing || player.queue.current)) {
      if (await isAutomixEnabled(player.guildId)) {
        try { await enqueueAutomix(player, track as { info?: { title?: string; author?: string; uri?: string } }); } catch (e) { logger.error({ e }, 'automix after trackStuck failed'); }
      }
    }
  } catch (e) {
    logger.error({ e }, 'trackStuck handler failed');
  }
});

// Metrics logic for 'discord-bot:commands' is now handled in the main command handler (see line 82).

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
      // Limitar reanudación para evitar sobrecarga en arranque
      const maxResume = 25;
      for (const it of q.items.slice(0, maxResume)) {
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

// --- Automix (simple heuristic): when queue is empty after a track ends, enqueue a similar track if enabled ---
async function isAutomixEnabled(guildId: string): Promise<boolean> {
  try {
    const flag = await prisma.featureFlag.findFirst({ where: { guildId, OR: [{ name: 'autoplay' }, { name: 'automix' }] } });
    return !!flag?.enabled;
  } catch { return false; }
}

async function enqueueAutomix(player: import('lavalink-client').Player, last: { info?: { title?: string; author?: string; uri?: string } }) {
  const title = (last?.info?.title ?? '').trim();
  const author = (last?.info?.author ?? '').trim();
  const uri = last?.info?.uri ?? '';

  const pick = await pickAutomixTrack(
    async (q: string) => {
      const res = await player.search({ query: q }, { id: 'automix' } as { id: string });
      return { tracks: res.tracks as unknown as import('./autoplay.js').LLTrack[] };
    },
    title,
    author,
    uri,
  );
  if (!pick) { logger.warn({ guildId: player.guildId, title, author }, 'automix: no candidate found'); return; }
  try {
    const info = (pick as { info?: { title?: string; uri?: string } }).info;
    logger.info({ guildId: player.guildId, nextTitle: info?.title, nextUri: info?.uri }, 'automix: picked candidate');
  } catch (_e) { /* ignore */ }
  await ensurePlayback(player as unknown as import('./autoplay.js').LLPlayer, pick as unknown as import('./autoplay.js').LLTrack);
  // Si la cola queda corta, volver a sembrar relacionados para mantener reproducción continua
  try {
    const qlen = player.queue.tracks.length;
    if (qlen < 3) {
      const seeded = await seedRelatedQueue(
        player as unknown as import('./autoplay.js').LLPlayer,
        pick as unknown as import('./autoplay.js').LLTrack,
        async (q: string) => {
          const r = await player.search({ query: q }, { id: 'automix' } as { id: string });
          return { tracks: r.tracks as unknown as import('./autoplay.js').LLTrack[] };
        },
        10,
      );
      if (seeded > 0) logger.info({ guildId: player.guildId, seeded }, 'automix: refilled related tracks');
    }
  } catch (e) {
    logger.error({ e }, 'automix: failed to refill related tracks');
  }
  await saveQueue(player.guildId, player);
}

const autoplayCooldown = new Map<string, number>();

manager.on('trackEnd', async (player, track, payload?: unknown) => {
  try {
    // Reason may be undefined depending on library version. Only block on explicit non-finished reasons.
    const reason = (payload as { reason?: string } | undefined)?.reason;
    logger.info({ guildId: player.guildId, reason: reason ?? 'none' }, 'audio: track end');
    if (isBlockReason(reason)) { logger.info({ guildId: player.guildId, reason }, 'audio: track end blocked for autoplay'); return; }
    // Pequeña espera para que el estado del player/cola se estabilice
    await delay(900);
    // Cooldown por guild para evitar dobles triggers
    const now = Date.now();
    const last = autoplayCooldown.get(player.guildId) ?? 0;
    if (now - last < 1500) return;
    autoplayCooldown.set(player.guildId, now);
    // No ejecutar autoplay si loop está activo
    if ((player.repeatMode ?? 'off') !== 'off') return;
    // Si hay reproducción en curso o cola con elementos, no hacemos autoplay
    if (player.playing || player.queue.current || player.queue.tracks.length > 0) return;
    // Autoplay habilitado?
    const enabled = await isAutomixEnabled(player.guildId);
    if (!enabled) {
      logger.info({ guildId: player.guildId }, 'audio: autoplay disabled');
      // Nada en cola y autoplay off → publicar estado Idle para actualizar UI
      if (!(player.playing || player.queue.current) && player.queue.tracks.length === 0) {
        await pushIdleState(player);
      }
      return;
    }
    await enqueueAutomix(player, track as { info?: { title?: string; author?: string; uri?: string } });
  } catch (e) {
    logger.error({ e }, 'automix failed');
  }
});

// --- Real-time push updates to Gateway ---
const lastUiPush = new Map<string, number>();
const minUiInterval = Math.max(1000, env.NOWPLAYING_UPDATE_MS ?? 5000);

manager.on('playerUpdate', (playerJson) => {
  const p = manager.getPlayer((playerJson as { guildId?: string }).guildId as string);
  if (p) void pushNowPlaying(p);
});

async function pushNowPlaying(player: import('lavalink-client').Player) {
  try {
    const guildId = player.guildId;
    if (player.paused) return;
    const now = Date.now();
    const last = lastUiPush.get(guildId) ?? 0;
    if (now - last < minUiInterval) return;
    const current = player.queue.current as { info?: { title?: string; uri?: string; author?: string; duration?: number; isStream?: boolean; artworkUrl?: string } } | undefined;
    if (!current?.info) return;
    lastUiPush.set(guildId, now);
    const payload: { guildId: string; title: string; uri?: string; author?: string; durationMs: number; positionMs: number; isStream: boolean; artworkUrl?: string; paused: boolean; repeatMode?: 'off' | 'track' | 'queue'; queueLen: number; hasTrack: boolean; canSeek: boolean } = {
      guildId,
      title: current.info.title ?? 'Unknown',
      uri: current.info.uri,
      author: (current as { info?: { author?: string } })?.info?.author,
      durationMs: Math.floor((current.info.duration ?? 0) as number),
      positionMs: player.position ?? 0,
      isStream: !!current.info.isStream,
      artworkUrl: (current as { info?: { artworkUrl?: string } })?.info?.artworkUrl,
      paused: !!player.paused,
      repeatMode: (player.repeatMode ?? 'off') as 'off' | 'track' | 'queue',
      queueLen: player.queue.tracks.length,
      hasTrack: !!player.queue.current,
      canSeek: !current.info.isStream,
    };
    await redisPub.publish('discord-bot:ui:now', JSON.stringify(payload));
  } catch { /* ignore */ }
}

// Push an explicit idle UI state (no current track) so Gateway can
// render controls enabled for autoplay while disabling playback actions.
async function pushIdleState(player: import('lavalink-client').Player) {
  try {
    const payload = {
      guildId: player.guildId,
      title: 'Nothing playing',
      uri: undefined as string | undefined,
      author: undefined as string | undefined,
      durationMs: 0,
      positionMs: 0,
      isStream: false,
      artworkUrl: undefined as string | undefined,
      paused: false,
      repeatMode: (player.repeatMode ?? 'off') as 'off' | 'track' | 'queue',
      queueLen: player.queue.tracks.length,
      hasTrack: false,
      canSeek: false,
    };
    await redisPub.publish('discord-bot:ui:now', JSON.stringify(payload));
  } catch { /* ignore */ }
}
