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
import { logger, HealthChecker, CommonHealthChecks } from '@discord-bot/logger';
import { createClient } from 'redis';
import { prisma } from '@discord-bot/database';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { isBlockReason, pickAutomixTrack, ensurePlayback, seedRelatedQueue } from './autoplay.js';
import { guildMutex } from './guildMutex.js';
import { shouldAutomixAfterSkip, shouldSeedOnFirstPlay } from './logic.js';
import { validateCommandMessage } from './validation.js';
import { 
  withErrorHandling
} from './errors.js';
import { searchCache, automixCache, queueCache } from './cache.js';
import { 
  batchQueueSaver, 
  MemoryManager, 
  PerformanceTracker, 
  SearchThrottler 
} from './performance.js';

const redisUrl = env.REDIS_URL;
const redisPub = createClient({ url: redisUrl });
const redisSub = createClient({ url: redisUrl });

await redisPub.connect();
await redisSub.connect();
logger.info({ NOWPLAYING_UPDATE_MS: env.NOWPLAYING_UPDATE_MS }, 'Audio startup config');

// Initialize performance monitoring
const memoryManager = MemoryManager.getInstance();
memoryManager.startMonitoring();

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

/**
 * Command Bus Handler - Processes music playback commands from the gateway service
 * 
 * This is the core command processing system that handles all music-related operations.
 * Commands are received via Redis pub/sub from the gateway service and processed
 * with comprehensive validation, error handling, and performance optimizations.
 * 
 * Command Flow:
 * 1. Parse incoming JSON message from Redis
 * 2. Validate command structure and sanitize inputs
 * 3. Route to appropriate handler based on command type
 * 4. Execute command with error recovery and performance tracking
 * 5. Update persistent state and cache as needed
 */
await redisSub.subscribe('discord-bot:commands', withErrorHandling(async (message) => {
  let data: CommandMessage | undefined;
  try {
    const rawData = JSON.parse(message);
    
    // Validate command message structure and content for security
    // This prevents malformed commands and injection attacks
    const validation = validateCommandMessage(rawData);
    if (!validation.success) {
      logger.error({ error: validation.error, rawData }, 'Invalid command message received');
      return;
    }
    
    data = validation.data as CommandMessage;

    // PLAY COMMAND HANDLER - Most complex command with multiple stages
    if (data.type === 'play') {
      await guildMutex.run(data.guildId, async () => {
      const playData = data as Extract<CommandMessage, { type: 'play' }>;
      logger.info({ guildId: playData.guildId, query: playData.query }, 'audio: play command received');
      
      /**
       * STAGE 1: Player Creation and Connection
       * 
       * Create or get existing player for this guild. The player manages
       * the voice connection and audio playback for a specific Discord server.
       * Configuration sets optimal defaults for music playback.
       */
      const player = manager.createPlayer({
        guildId: playData.guildId,
        volume: 100,                    // Default volume level
        voiceChannelId: playData.voiceChannelId,
        textChannelId: playData.textChannelId,
        selfDeaf: true,                 // Bot doesn't need to hear other users
      });
      await player.connect();
      
      /**
       * STAGE 2: Intelligent Search with Performance Optimizations
       * 
       * Multi-layered approach to track searching:
       * 1. Check memory cache first (5-minute TTL)
       * 2. Use search throttling to prevent API abuse
       * 3. Track search performance metrics
       * 4. Cache successful results for future use
       */
      const cacheKey = `search:${playData.query}:${playData.userId}`;
      const isUrl = /^https?:\/\//i.test(playData.query);
      // Avoid caching direct URLs to prevent any mismatch from stale entries
      let res = isUrl ? undefined : searchCache.get(cacheKey);
      
      if (!res) {
        // Throttle concurrent searches to prevent API rate limits and server overload
        res = await SearchThrottler.throttle(() =>
          PerformanceTracker.measure('search', () =>
            player.search(
              { query: playData.query },
              { id: playData.userId } as { id: string },
            )
          )
        );
        
        // Cache successful search results to reduce future API calls
        // Only cache results with tracks to avoid caching errors
        if (res.tracks.length > 0) {
          searchCache.set(cacheKey, res, 300000); // 5 minutes cache
        }
      }
      logger.info({ tracks: res.tracks.length }, 'audio: search results');
      
      /**
       * STAGE 3: Track Processing and Intelligent Playback Logic
       * 
       * When tracks are found, determine the optimal playback behavior:
       * - Immediate playback if nothing is playing
       * - Queue addition if something is already playing
       * - Intelligent autoplay seeding for enhanced user experience
       */
      if (res.tracks.length > 0) {
        let chosen = res.tracks[0] as Track | UnresolvedTrack;
        // If a YouTube URL was provided, try to pick the exact video-id match
        if (isUrl) {
          try {
            const u = new URL(playData.query);
            let vid = '';
            if (u.hostname.includes('youtube.com')) {
              vid = u.searchParams.get('v') || '';
            } else if (u.hostname.includes('youtu.be')) {
              vid = u.pathname.replace(/^\//, '');
            }
            if (vid) {
              const exact = (res.tracks as Array<{ info?: { uri?: string } }>).find(t => t.info?.uri?.includes(vid));
              if (exact) chosen = exact as unknown as Track | UnresolvedTrack;
            }
          } catch { /* ignore */ }
        }
        const first = chosen;
        
        /**
         * STAGE 3A: Autoplay Seeding Logic
         * 
         * Evaluate whether to seed related tracks BEFORE starting playback
         * to capture the "idle" state. This provides seamless music discovery
         * when the user isn't actively managing their queue.
         */
        let seedOnFirst = false;
        try {
          const autoplayEnabled = await PerformanceTracker.measure('automix_check', () =>
            isAutomixEnabledCached(playData.guildId)
          );
          seedOnFirst = shouldSeedOnFirstPlay({
            autoplayEnabled,
            playing: player.playing,
            paused: player.paused,
            hasCurrent: !!player.queue.current,
          });
        } catch { /* ignore autoplay errors and proceed without seeding */ }

        /**
         * STAGE 3B: Playback Initiation
         * 
         * Start immediate playback if the player is idle, otherwise add to queue.
         * This ensures a seamless user experience without interrupting ongoing music.
         */
        if (!player.playing && !player.paused && !player.queue.current) {
          await player.play({ clientTrack: first });
          
          /**
           * STAGE 3C: Background Autoplay Seeding
           * 
           * Asynchronously populate the queue with related tracks for continuous playback.
           * This runs in the background to avoid blocking the initial playback response.
           * 
           * Process:
           * 1. Generate related track queries based on the current song
           * 2. Search for similar tracks using multiple algorithms
           * 3. Add diverse, high-quality recommendations to queue
           * 4. Update persistent state for queue recovery
           */
          if (seedOnFirst) {
            void (async () => {
              try {
                const userId = playData.userId;
                const seeded = await seedRelatedQueue(
                  player as unknown as import('./autoplay.js').LLPlayer,
                  first as unknown as import('./autoplay.js').LLTrack,
                  async (q: string) => {
                    const r = await player.search({ query: q }, { id: userId || 'system' } as { id: string });
                    return { tracks: r.tracks as unknown as import('./autoplay.js').LLTrack[] };
                  },
                  10, // Seed up to 10 related tracks for variety
                );
                if (seeded > 0) logger.info({ guildId: playData.guildId, seeded }, 'audio: seeded related tracks');
                // Update database with new queue state
                batchQueueSaver.scheduleUpdate(playData.guildId, player, playData.voiceChannelId, playData.textChannelId);
              } catch (e) {
                logger.error({ e }, 'audio: failed to seed related queue');
              }
            })();
          }
        } else {
          // Priority insertion for subsequent user adds
          await player.queue.add(first, 0);
        }
        batchQueueSaver.scheduleUpdate(playData.guildId, player, playData.voiceChannelId, playData.textChannelId);
        if (playData.requestId) {
          type TrackInfoLite = { title?: string; uri?: string; artworkUrl?: string };
          const info = (chosen as { info?: TrackInfoLite }).info;
          await redisPub.publish(
            `discord-bot:response:${playData.requestId}`,
            JSON.stringify({ ok: true, title: info?.title ?? 'Unknown', uri: info?.uri, artworkUrl: info?.artworkUrl }),
          );
        }
      } else {
        logger.warn({ query: playData.query }, 'audio: no tracks found');
        if (playData.requestId) {
          await redisPub.publish(`discord-bot:response:${playData.requestId}`, JSON.stringify({ ok: false, reason: 'no_results' }));
        }
      }
      });
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
            const enabled = await isAutomixEnabledCached(player.guildId);
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
            batchQueueSaver.scheduleUpdate(data.guildId, player);
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
      if (player) batchQueueSaver.scheduleUpdate(data.guildId, player);
      return;
    }
    if (data.type === 'toggle') {
      const player = manager.getPlayer(data.guildId);
      if (!player) return;
      if (player.paused) await player.resume(); else await player.pause();
      if (player) batchQueueSaver.scheduleUpdate(data.guildId, player);
      return;
    }
    if (data.type === 'stop') {
      const player = manager.getPlayer(data.guildId);
      if (player) {
        await player.stopPlaying(true, false);
        await pushIdleState(player);
        batchQueueSaver.scheduleUpdate(data.guildId, player);
      }
      return;
    }
    if (data.type === 'volume') {
      const player = manager.getPlayer(data.guildId);
      if (player) await player.setVolume(Math.max(0, Math.min(200, data.percent)));
      if (player) batchQueueSaver.scheduleUpdate(data.guildId, player);
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
        const enabled = await isAutomixEnabledCached(player.guildId);
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
          batchQueueSaver.scheduleUpdate(data.guildId, player);
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
      if (player) batchQueueSaver.scheduleUpdate(data.guildId, player);
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
          batchQueueSaver.scheduleUpdate(data.guildId, player);
        }
      }
      return;
    }
    if (data.type === 'clear') {
      const player = manager.getPlayer(data.guildId);
      if (player) {
        const len = player.queue.tracks.length;
        if (len > 0) player.queue.splice(0, len);
        batchQueueSaver.scheduleUpdate(data.guildId, player);
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
          batchQueueSaver.scheduleUpdate(data.guildId, player);
        }
      }
      return;
    }
  } catch (e) {
    const err = e as Error;
    logger.error({ err, message: err?.message, stack: err?.stack }, 'failed to process command');
    try {
      if (data && data.type === 'play') {
        const playData = data as Extract<CommandMessage, { type: 'play' }>;
        if (playData.requestId) {
          await redisPub.publish(
            `discord-bot:response:${playData.requestId}`,
            JSON.stringify({ ok: false, reason: 'error', message: err?.message || 'unknown' }),
          );
        }
      }
    } catch (_ackErr) { /* ignore */ }
  }
}, 'redis_command_handler'));

// Health Check Setup
const healthChecker = new HealthChecker('audio', '1.0.0');

// Register health checks
healthChecker.register('redis', () => CommonHealthChecks.redis(redisPub));
healthChecker.register('database', () => CommonHealthChecks.database(prisma));
healthChecker.register('lavalink', () => CommonHealthChecks.lavalink(manager));
healthChecker.register('memory', () => CommonHealthChecks.memory(2048)); // Audio service typically uses more memory

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
      if (await isAutomixEnabledCached(player.guildId)) {
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
      if (await isAutomixEnabledCached(player.guildId)) {
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
  
  // Enhanced health endpoint
  if (req.url.startsWith('/health')) {
    try {
      const health = await healthChecker.check();
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
      
      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } catch (error) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        service: 'audio',
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
    }
    return;
  }
  
  // Player status endpoint
  if (req.url.startsWith('/players')) {
    const players = manager.players;
    const playerStats = Array.from(players.values()).map(player => ({
      guildId: player.guildId,
      connected: player.connected,
      playing: player.playing,
      paused: player.paused,
      queueSize: player.queue.tracks.length,
      current: player.queue.current?.info?.title || null,
    }));
    
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ players: playerStats, count: playerStats.length }));
    return;
  }
  if (req.url.startsWith('/metrics')) {
    res.writeHead(200, { 'content-type': registry.contentType });
    res.end(await registry.metrics());
    return;
  }
  
  // Performance metrics endpoint
  if (req.url.startsWith('/performance')) {
    const metrics = PerformanceTracker.getMetrics();
    const searchStats = SearchThrottler.getStats();
    const memoryStats = memoryManager.getMemoryStats();
    
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      performance: metrics,
      search: searchStats,
      memory: memoryStats,
      timestamp: new Date().toISOString()
    }, null, 2));
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

// Graceful shutdown handling
process.on('SIGINT', async () => {
  logger.info('Graceful shutdown initiated...');
  
  try {
    // Flush any pending queue updates
    await batchQueueSaver.flush();
    
    // Stop memory monitoring
    memoryManager.stopMonitoring();
    
    // Close Redis connections
    await Promise.all([
      redisPub.quit().catch(() => {}),
      redisSub.quit().catch(() => {}),
    ]);
    
    // Close health server
    healthServer.close();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  process.kill(process.pid, 'SIGINT');
});

// Persistence helpers
async function saveQueue(guildId: string, player: import('lavalink-client').Player, voiceChannelId?: string, textChannelId?: string) {
  try {
    let queue = await prisma.queue.findFirst({ where: { guildId }, select: { id: true } });
    if (!queue) {
      queue = await prisma.queue.create({ data: { guildId, voiceChannelId: voiceChannelId ?? null, textChannelId: textChannelId ?? null }, select: { id: true } });
    } else {
      await prisma.queue.update({ where: { id: queue.id }, data: { voiceChannelId: voiceChannelId ?? null, textChannelId: textChannelId ?? null } });
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
    
    // Invalidate cache after queue update
    invalidateQueueCache(guildId);
  } catch (e) {
    logger.error({ e }, 'failed to save queue');
  }
}

async function resumeQueues() {
  try {
    // Only fetch queues that have items and voice channels, with limited fields
    const queues = await prisma.queue.findMany({ 
      where: {
        voiceChannelId: { not: null },
        items: { some: {} } // Only queues that have at least one item
      },
      select: {
        guildId: true,
        voiceChannelId: true,
        textChannelId: true,
        items: {
          select: {
            title: true,
            url: true
          },
          orderBy: { createdAt: 'asc' },
          take: 25 // Limit to first 25 items for performance
        }
      }
    });
    for (const q of queues) {
      if (q.items.length === 0) continue;
      if (!q.voiceChannelId) continue; // cannot resume without voice channel
      const playerOptions: { guildId: string; voiceChannelId: string; textChannelId?: string; selfDeaf: true; volume: number } = {
        guildId: q.guildId, 
        voiceChannelId: q.voiceChannelId, 
        selfDeaf: true, 
        volume: 100
      };
      
      if (q.textChannelId) {
        playerOptions.textChannelId = q.textChannelId;
      }
      
      const player = manager.createPlayer(playerOptions);
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

// Cached queue loading for better performance (exported for future use)
export async function getQueueCached(guildId: string): Promise<any | null> {
  const cacheKey = `queue:${guildId}`;
  let queueData = queueCache.get(cacheKey);
  
  if (queueData === undefined) {
    try {
      queueData = await prisma.queue.findFirst({
        where: { guildId },
        select: {
          id: true,
          guildId: true,
          voiceChannelId: true,
          textChannelId: true,
          items: {
            select: {
              id: true,
              title: true,
              url: true,
              requestedBy: true,
              duration: true
            },
            orderBy: { createdAt: 'asc' },
            take: 50 // Reasonable limit for cache
          }
        }
      });
      
      // Cache for 30 seconds - queues change frequently
      queueCache.set(cacheKey, queueData || null, 30000);
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to fetch queue from database');
      return null;
    }
  }
  
  return queueData;
}

// Invalidate queue cache when queue is updated
function invalidateQueueCache(guildId: string): void {
  queueCache.delete(`queue:${guildId}`);
}

// --- Automix (simple heuristic): when queue is empty after a track ends, enqueue a similar track if enabled ---
async function isAutomixEnabled(guildId: string): Promise<boolean> {
  try {
    const flag = await prisma.featureFlag.findFirst({ 
      where: { guildId, OR: [{ name: 'autoplay' }, { name: 'automix' }] },
      select: { enabled: true }
    });
    return !!flag?.enabled;
  } catch { return false; }
}

// Cached version of automix check for better performance
async function isAutomixEnabledCached(guildId: string): Promise<boolean> {
  const cacheKey = `automix:${guildId}`;
  let enabled = automixCache.get(cacheKey);
  
  if (enabled === undefined) {
    enabled = await isAutomixEnabled(guildId);
    automixCache.set(cacheKey, enabled, 180000); // 3 minutes cache
  }
  
  return enabled;
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
    const enabled = await isAutomixEnabledCached(player.guildId);
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
      durationMs: Math.floor((current.info.duration ?? 0) as number),
      positionMs: player.position ?? 0,
      isStream: !!current.info.isStream,
      paused: !!player.paused,
      repeatMode: (player.repeatMode ?? 'off') as 'off' | 'track' | 'queue',
      queueLen: player.queue.tracks.length,
      hasTrack: !!player.queue.current,
      canSeek: !current.info.isStream,
    };
    
    if (current.info.uri !== undefined) {
      payload.uri = current.info.uri;
    }
    
    const author = (current as { info?: { author?: string } })?.info?.author;
    if (author !== undefined) {
      payload.author = author;
    }
    
    const artworkUrl = (current as { info?: { artworkUrl?: string } })?.info?.artworkUrl;
    if (artworkUrl !== undefined) {
      payload.artworkUrl = artworkUrl;
    }
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
