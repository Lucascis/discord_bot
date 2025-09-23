// Load environment variables FIRST, before any other imports
import './env-loader.js';

import {
  type VoicePacket,
  type VoiceServer,
  type VoiceState,
  type ChannelDeletePacket,
  type Track,
  type UnresolvedTrack,
} from 'lavalink-client';
// Import config AFTER dotenv has loaded environment variables
import { env } from '@discord-bot/config';
import { logger, HealthChecker, CommonHealthChecks, getAdvancedHealthMonitor, initializeSentry } from '@discord-bot/logger';
import { createClient } from 'redis';
import { prisma } from '@discord-bot/database';
import { RedisCircuitBreaker, type RedisCircuitBreakerConfig } from '@discord-bot/cache';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { isBlockReason, pickAutomixTrack, ensurePlayback, seedRelatedQueue } from './autoplay/index.js';
import { guildMutex } from './guildMutex.js';
import { TTLMap } from '@discord-bot/cache';
import { shouldAutomixAfterSkip, shouldSeedOnFirstPlay } from './logic.js';
import { validateCommandMessage } from './validation.js';
import {
  withErrorHandling
} from './errors.js';
import { automixCache } from './cache.js';
import { audioCacheManager, featureFlagCache } from './services/cache.js';
import { audioMetrics } from './services/metrics.js';
import { predictiveCacheManager } from './services/predictive-cache.js';
import { adaptiveCacheManager } from './services/adaptive-cache.js';
import {
  batchQueueSaver,
  MemoryManager,
  PerformanceTracker,
  SearchThrottler
} from './performance.js';
import {
  initializeWorkerIntegration,
  closeWorkerIntegration,
  checkWorkerIntegrationHealth,
  trackPlaybackAnalytics,
  trackSearchAnalytics,
  trackAutoplayAnalytics,
  trackQueueAnalytics,
  trackUserInteractionAnalytics,
  requestPerformanceAnalysis
} from './services/worker-integration.js';

const redisUrl = env.REDIS_URL;

const redisCircuitConfig: RedisCircuitBreakerConfig = {
  failureThreshold: 0.5,
  timeout: 30000,
  monitoringWindow: 60000,
  volumeThreshold: 10,
  redis: {
    retryDelayOnFailover: 1000,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  },
};

const redisPub = new RedisCircuitBreaker(
  'audio-pub',
  redisCircuitConfig,
  {
    host: redisUrl ? new URL(redisUrl).hostname : 'localhost',
    port: redisUrl ? parseInt(new URL(redisUrl).port) || 6379 : 6379,
    password: redisUrl ? new URL(redisUrl).password || undefined : undefined,
    retryDelayOnFailover: 1000,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  }
);

const redisSub = createClient({ url: redisUrl });

await redisSub.connect();
logger.info({ NOWPLAYING_UPDATE_MS: env.NOWPLAYING_UPDATE_MS }, 'Audio startup config');

// Initialize Sentry error monitoring
await initializeSentry({
  ...(env.SENTRY_DSN && { dsn: env.SENTRY_DSN }),
  environment: env.SENTRY_ENVIRONMENT,
  serviceName: 'audio',
  tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  profilesSampleRate: env.SENTRY_PROFILES_SAMPLE_RATE
});

// Initialize performance monitoring
const memoryManager = MemoryManager.getInstance();
memoryManager.startMonitoring();

// Initialize adaptive cache monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  adaptiveCacheManager.recordMetrics({
    memoryUsage: heapUsagePercent,
    activePlayers: manager.players.size,
    timestamp: Date.now()
  });
}, 60000); // Every minute

// Initialize Worker Service integration for background analytics
try {
  await initializeWorkerIntegration();
  logger.info('Worker Service integration initialized successfully');
} catch (error) {
  logger.error({ error }, 'Failed to initialize Worker Service integration - analytics disabled');
}

import { createLavalinkManager, initManager } from './services/lavalink.js';

const manager = createLavalinkManager(async (guildId, payload) => {
  try {
    await redisPub.publish(
      'discord-bot:to-discord',
      JSON.stringify({ guildId, payload }),
    );
  } catch (e) {
    logger.error({ e }, 'failed to publish to-discord payload');
  }
});

export { manager };

await initManager(manager);

// Ensure at least one node connect event (best-effort)
await new Promise<void>((resolve) => {
  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 3000);
  manager.nodeManager.once('connect', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
});


type CommandMessage =
  | { type: 'play'; guildId: string; voiceChannelId: string; textChannelId: string; userId: string; query: string; requestId?: string }
  | { type: 'playnow'; guildId: string; voiceChannelId: string; textChannelId: string; userId: string; query: string; requestId?: string }
  | { type: 'playnext'; guildId: string; voiceChannelId: string; textChannelId: string; userId: string; query: string; requestId?: string }
  | { type: 'skip'; guildId: string }
  | { type: 'pause'; guildId: string }
  | { type: 'resume'; guildId: string }
  | { type: 'toggle'; guildId: string }
  | { type: 'stop'; guildId: string }
  | { type: 'disconnect'; guildId: string; reason?: string }
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
    const payload = JSON.parse(message);

    // Handle VOICE_CREDENTIALS message from Gateway
    if (payload.type === 'VOICE_CREDENTIALS') {
      await handleVoiceCredentials(payload.guildId, payload.voiceCredentials);
    } else {
      // Handle other Discord events as before
      const discordEvent = payload as VoicePacket | VoiceServer | VoiceState | ChannelDeletePacket;
      await manager.sendRawData(discordEvent);
    }
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

/**
 * CRITICAL FIX: Unified voice credentials handler
 * Processes voice credentials from Discord and connects pending players
 */
async function handleVoiceCredentials(guildId: string, voiceCredentials: any): Promise<void> {
  try {
    logger.info({
      guildId,
      hasSessionId: !!voiceCredentials?.sessionId,
      hasToken: !!voiceCredentials?.token,
      hasEndpoint: !!voiceCredentials?.endpoint
    }, 'VOICE_CONNECT: Received Discord credentials from Gateway');

    // Send voice credentials to Lavalink
    if (voiceCredentials) {
      const voiceStateUpdate = {
        op: 'voiceUpdate',
        guildId,
        sessionId: voiceCredentials.sessionId,
        event: {
          token: voiceCredentials.token,
          guild_id: guildId,
          endpoint: voiceCredentials.endpoint
        }
      };

      await manager.sendRawData(voiceStateUpdate as any);
      logger.info({ guildId }, 'VOICE_CONNECT: Voice credentials sent to Lavalink');

      // CRITICAL FIX: Connect pending player now that we have credentials
      const pendingEntry = pendingPlayerConnections.get(guildId);
      if (pendingEntry) {
        try {
          logger.info({ guildId }, 'VOICE_CONNECT: Connecting pending player...');
          await pendingEntry.player.connect();
          logger.info({ guildId }, 'VOICE_CONNECT: Player connected successfully');

          // Resolve the promise and clean up
          pendingEntry.resolve();
          pendingPlayerConnections.delete(guildId);
        } catch (connectError) {
          logger.error({
            guildId,
            error: connectError instanceof Error ? connectError.message : String(connectError)
          }, 'VOICE_CONNECT: Failed to connect player');

          // Reject the promise and clean up
          pendingEntry.reject(connectError instanceof Error ? connectError : new Error(String(connectError)));
          pendingPlayerConnections.delete(guildId);
        }
      } else {
        logger.debug({ guildId }, 'VOICE_CONNECT: No pending player found for this guild');
      }
    }
  } catch (error) {
    logger.error({
      guildId,
      error: error instanceof Error ? error.message : String(error)
    }, 'VOICE_CONNECT: Failed to handle voice credentials');

    // Also reject any pending connection for this guild
    const pendingEntry = pendingPlayerConnections.get(guildId);
    if (pendingEntry) {
      pendingEntry.reject(error instanceof Error ? error : new Error(String(error)));
      pendingPlayerConnections.delete(guildId);
    }
  }
}

// CRITICAL: Listen for voice credentials from Gateway service (legacy channel support)
await redisSub.subscribe('discord-bot:voice-credentials', withErrorHandling(async (...args: unknown[]) => {
  const message = args[0] as string;
  try {
    const voiceCredentials = JSON.parse(message);
    await handleVoiceCredentials(voiceCredentials.guildId, voiceCredentials);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to process voice credentials message');
  }
}));

await redisSub.subscribe('discord-bot:commands', withErrorHandling(async (message) => {
  let data: CommandMessage | undefined;
  try {
    const rawData = JSON.parse(String(message));
    
    // Validate command message structure and content for security
    // This prevents malformed commands and injection attacks
    const validation = validateCommandMessage(rawData);
    if (!validation.success) {
      logger.error({ error: validation.error, rawData }, 'Invalid command message received');
      return;
    }
    
    data = validation.data as CommandMessage;

    // PLAY COMMAND HANDLER - Most complex command with multiple stages
    // Handle all play-related commands ('play', 'playnow', 'playnext') with the same logic
    if (data && (data.type === 'play' || data.type === 'playnow' || data.type === 'playnext')) {
      const commandType = data.type; // Store type before async block to avoid closure issues
      await guildMutex.run(data.guildId, async () => {
      const playData = data as Extract<CommandMessage, { type: 'play' }>;
      const startTime = Date.now();
      logger.info({ guildId: playData.guildId, query: playData.query, commandType }, `audio: ${commandType} command received`);

      // Track user session and command start
      audioMetrics.trackUserSessionStart(playData.userId, playData.guildId);
      
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

      // Store user ID for predictive tracking
      (player as any)._lastUserId = playData.userId;

      // CRITICAL FIX: Store textChannelId for UI updates
      guildTextChannels.set(playData.guildId, playData.textChannelId);

      // CRITICAL FIX: Wait for voice credentials instead of connecting immediately
      try {
        logger.info({ guildId: playData.guildId }, 'VOICE_CONNECT: Waiting for Discord voice credentials...');
        await waitForVoiceCredentials(player);
        logger.info({ guildId: playData.guildId }, 'VOICE_CONNECT: Player connection established');
      } catch (connectionError) {
        logger.error({
          guildId: playData.guildId,
          error: connectionError instanceof Error ? connectionError.message : String(connectionError)
        }, 'VOICE_CONNECT: Failed to establish voice connection');

        // Send error response if requestId is provided
        if (playData.requestId) {
          await redisPub.publish(
            `discord-bot:response:${playData.requestId}`,
            JSON.stringify({
              ok: false,
              reason: 'voice_connection_failed',
              message: 'Failed to connect to voice channel'
            })
          );
        }

        // Track failed connection
        const commandLatency = Date.now() - startTime;
        audioMetrics.trackCommandExecution(
          'play',
          playData.guildId,
          commandLatency,
          false,
          'voice_connection_failed',
          playData.userId
        );

        return; // Exit early on connection failure
      }
      
      // STAGE 2: Intelligent Search with Performance Optimizations (extracted)
      const searchStartTime = Date.now();
      const { smartSearch } = await import('./playback/search.js');
      const res = await smartSearch(player, playData.query, playData.userId, playData.guildId);
      const searchResponseTime = Date.now() - searchStartTime;

      logger.info({ tracks: res.tracks.length, responseTime: searchResponseTime }, 'audio: search results');

      // Track search analytics for predictive caching
      void predictiveCacheManager.trackUserSearch(
        playData.userId,
        playData.guildId,
        playData.query,
        res.tracks.length,
        searchResponseTime
      ).catch(e => logger.debug({ e }, 'Predictive search tracking failed'));
      
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
        const isUrl = /^https?:\/\//i.test(playData.query);
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
        
        // Validate track duration - reject tracks longer than 5 hours
        const MAX_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours in milliseconds
        const trackInfo = first as { info?: { duration?: number; title?: string } };
        if (trackInfo.info?.duration && trackInfo.info.duration > MAX_DURATION_MS) {
          logger.warn({ guildId: playData.guildId, duration: trackInfo.info.duration, title: trackInfo.info.title }, 'Track rejected: exceeds 5-hour limit');
          if (playData.requestId) {
            await redisPub.publish(`discord-bot:response:${playData.requestId}`, JSON.stringify({
              error: 'Track duration exceeds 5-hour limit'
            }));
          }
          return;
        }
        
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
         * Handle different command types:
         * - 'playnow': Always play immediately, replacing current track
         * - 'play'/'playnext': Start immediate playback if idle, otherwise add to queue
         */
        logger.info({
          guildId: playData.guildId,
          playerPlaying: player.playing,
          playerPaused: player.paused,
          hasCurrent: !!player.queue.current,
          currentTrack: player.queue.current?.info?.title,
          commandType: data?.type
        }, 'audio: player state before play decision');

        // PLAYNOW: Always play immediately, replacing current track
        if (data?.type === 'playnow') {
          logger.info({ guildId: playData.guildId }, 'audio: playnow - replacing current track immediately');

          // Clear the queue and set the new track as current
          player.queue.tracks.splice(0, player.queue.tracks.length); // Clear queue
          await player.queue.add(first);

          // Force stop current track and play new one
          if (player.playing || player.paused) {
            await player.skip();
          }

          try {
            await player.play();
            logger.info({ guildId: playData.guildId }, 'audio: playnow completed successfully');
          } catch (error) {
            logger.error({ guildId: playData.guildId, error }, 'audio: playnow failed');
            throw error;
          }

          // Track song playback metrics for playnow
          const trackInfo = first as { info?: { title?: string; author?: string; duration?: number; uri?: string } };
          if (trackInfo.info) {
            audioMetrics.trackSongPlayback(
              playData.guildId,
              {
                title: trackInfo.info.title || 'Unknown',
                author: trackInfo.info.author,
                duration: trackInfo.info.duration || 0,
                source: 'youtube',
                uri: trackInfo.info.uri,
              },
              false, // Not autoplay
              playData.userId
            );

            void trackPlaybackAnalytics(
              playData.guildId,
              playData.userId,
              first as Track,
              'user_request'
            ).catch(e => logger.debug({ e }, 'Worker analytics tracking failed'));
          }

          // Force UI update after playnow
          void (async () => {
            try {
              await delay(500); // Wait for player state to stabilize
              await pushNowPlaying(player);
            } catch (e) {
              logger.error({ e }, 'Failed to push playnow UI state');
            }
          })();

        } else if (!player.playing && !player.paused) {
          // PLAY/PLAYNEXT: Standard behavior when nothing is playing
          logger.info({ guildId: playData.guildId }, 'audio: adding track to queue and initiating playback');
          await player.queue.add(first);

          // Log player state before play
          logger.info({
            guildId: playData.guildId,
            connected: player.connected,
            voiceChannelId: player.voiceChannelId,
            queueLength: player.queue.tracks.length,
            playing: player.playing,
            paused: player.paused
          }, 'audio: player state before play()');

          try {
            await player.play();
            logger.info({ guildId: playData.guildId }, 'audio: player.play() completed successfully');
          } catch (error) {
            logger.error({ guildId: playData.guildId, error }, 'audio: player.play() failed');
            throw error;
          }

          // Track song playback metrics
          const trackInfo = first as { info?: { title?: string; author?: string; duration?: number; uri?: string } };
          if (trackInfo.info) {
            audioMetrics.trackSongPlayback(
              playData.guildId,
              {
                title: trackInfo.info.title || 'Unknown',
                author: trackInfo.info.author,
                duration: trackInfo.info.duration || 0,
                source: 'youtube', // Default source, could be enhanced
                uri: trackInfo.info.uri,
              },
              false, // Not autoplay
              playData.userId
            );

            // Track playback analytics in Worker Service
            void trackPlaybackAnalytics(
              playData.guildId,
              playData.userId,
              first as Track,
              'user_request'
            ).catch(e => logger.debug({ e }, 'Worker analytics tracking failed'));
          }

          // Note: Do NOT send track_queued for first track - UI is handled by pushNowPlaying()

          // CRITICAL FIX: Force UI creation after immediate playback
          void (async () => {
            try {
              await delay(800); // Wait for player state to stabilize
              await pushNowPlaying(player);
            } catch (e) {
              logger.error({ e }, 'Failed to push initial UI state');
            }
          })();
          
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
                  player as unknown as import('./autoplay').LLPlayer,
                  first as unknown as import('./autoplay').LLTrack,
                  async (q: string) => {
                    const r = await player.search({ query: q }, { id: userId || 'system' } as { id: string });
                    return { tracks: r.tracks as unknown as import('./autoplay').LLTrack[] };
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
          // PLAY/PLAYNEXT: Add to queue when music is already playing
          const isPlayNext = data?.type === 'playnext';
          const position = isPlayNext ? 0 : undefined; // playnext goes to front, play goes to end

          logger.info({
            guildId: playData.guildId,
            commandType: data?.type,
            position: position === 0 ? 'front' : 'end'
          }, 'audio: adding track to queue');

          await player.queue.add(first, position);

          // Track queue operation
          audioMetrics.trackQueueOperation(
            playData.guildId,
            'add',
            player.queue.tracks.length,
            playData.userId
          );

          // Track queue analytics in Worker Service
          void trackQueueAnalytics(
            playData.guildId,
            playData.userId,
            'add',
            player.queue.tracks.length
          ).catch(e => logger.debug({ e }, 'Worker queue analytics failed'));

          // Send queued notification to Discord gateway
          const trackInfo = first as { info?: { title?: string; author?: string; artworkUrl?: string; duration?: number; uri?: string } };
          if (trackInfo.info) {
            try {
              await redisPub.publish(
                'discord-bot:to-discord',
                JSON.stringify({
                  guildId: playData.guildId,
                  payload: {
                    op: 'track_queued',
                    track: {
                      title: trackInfo.info.title || 'Unknown Track',
                      artist: trackInfo.info.author || 'Unknown Artist',
                      thumbnail: trackInfo.info.artworkUrl,
                      duration: trackInfo.info.duration,
                      uri: trackInfo.info.uri
                    },
                    queuePosition: player.queue.tracks.length,
                    requestedBy: playData.userId,
                    textChannelId: playData.textChannelId,
                    command: data?.type, // Command type (play/playnext)
                    isFirstTrack: false // This is always in the 'else' branch (subsequent tracks)
                  }
                })
              );
              logger.info({ guildId: playData.guildId, trackTitle: trackInfo.info.title }, 'Sent queued notification to Discord');
            } catch (e) {
              logger.error({ e }, 'Failed to send queued notification');
            }
          }

          // Send response to Gateway for request-response pattern
          logger.info({ requestId: playData.requestId, hasRequestId: !!playData.requestId }, 'Checking requestId for response');
          if (playData.requestId) {
            await redisPub.publish(
              `discord-bot:response:${playData.requestId}`,
              JSON.stringify({
                ok: true,
                title: trackInfo.info?.title ?? 'Unknown Track',
                uri: trackInfo.info?.uri,
                artworkUrl: trackInfo.info?.artworkUrl
              })
            );
            logger.info({ requestId: playData.requestId }, 'Sent response to Gateway');
          } else {
            logger.warn('No requestId found in playData - cannot send response to Gateway');
          }
        }
        batchQueueSaver.scheduleUpdate(playData.guildId, player, playData.voiceChannelId, playData.textChannelId);

        // Track successful command execution
        const commandLatency = Date.now() - startTime;
        audioMetrics.trackCommandExecution(
          'play',
          playData.guildId,
          commandLatency,
          true,
          undefined,
          playData.userId
        );

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

        // Track failed command execution
        const commandLatency = Date.now() - startTime;
        audioMetrics.trackCommandExecution(
          'play',
          playData.guildId,
          commandLatency,
          false,
          'no_results',
          playData.userId
        );

        if (playData.requestId) {
          await redisPub.publish(`discord-bot:response:${playData.requestId}`, JSON.stringify({ ok: false, reason: 'no_results' }));
        }
      }
      });
      return;
    }
    if (data.type === 'skip') {
      const startTime = Date.now();
      const player = manager.getPlayer(data.guildId);
      if (player) {
        const prev = player.queue.current as { info?: { title?: string; author?: string; uri?: string; duration?: number } } | undefined;
        const qlen = player.queue.tracks.length;

        // Track song skip if there was a current track
        if (prev?.info) {
          audioMetrics.trackSongSkip(
            data.guildId,
            {
              title: prev.info.title || 'Unknown',
              duration: prev.info.duration || 0,
            },
            player.position || 0,
            'user_skip'
          );
        }
        
        try {
          // Perform skip operation with better error handling
          if (qlen > 0) {
            await player.skip();
          } else {
            await player.stopPlaying(true, false);
          }
          
          // Wait for player state to stabilize
          await delay(1200); // Increased from 900ms for better stability
          
          // Check autoplay conditions more robustly
          const enabled = await isAutomixEnabledCached(player.guildId);
          const currentState = {
            repeatMode: (player.repeatMode ?? 'off') as 'off'|'track'|'queue',
            playing: !!player.playing,
            hasCurrent: !!player.queue.current,
            queueLen: player.queue.tracks.length,
            autoplayEnabled: enabled,
          };
          
          const shouldAutoplay = shouldAutomixAfterSkip(currentState);
          logger.info({ 
            guildId: player.guildId, 
            shouldAutoplay, 
            state: currentState 
          }, 'skip: autoplay evaluation');
          
          if (prev && shouldAutoplay) {
            logger.info({ guildId: player.guildId }, 'skip: triggering autoplay for empty queue');

            // Track autoplay trigger
            audioMetrics.trackAutoplayTrigger(data.guildId, 'queue_empty');

            await enqueueAutomix(player, prev);
          } else if (!shouldAutoplay && currentState.queueLen === 0 && !currentState.playing) {
            // Ensure UI updates for idle state
            await pushIdleState(player);
          }

          batchQueueSaver.scheduleUpdate(data.guildId, player);

          // Track successful skip command
          const commandLatency = Date.now() - startTime;
          audioMetrics.trackCommandExecution(
            'skip',
            data.guildId,
            commandLatency,
            true
          );

        } catch (e) {
          logger.error({ e, guildId: player.guildId }, 'skip operation failed');

          // Track failed skip command
          const commandLatency = Date.now() - startTime;
          audioMetrics.trackCommandExecution(
            'skip',
            data.guildId,
            commandLatency,
            false,
            'skip_error'
          );

          // Ensure UI state consistency even on errors
          if (!player.playing && !player.queue.current) {
            await pushIdleState(player);
          }
        }
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
    if (data.type === 'disconnect') {
      const player = manager.getPlayer(data.guildId);
      if (player) {
        logger.info({
          guildId: data.guildId,
          reason: data.reason || 'unknown'
        }, 'Disconnecting bot from voice channel');

        await player.stopPlaying(true, false);
        await player.destroy();
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
        if (!enabled) {
          logger.info({ guildId: data.guildId }, 'seedRelated: autoplay disabled, skipping');
          return;
        }
        
        const current = player.queue.current as { info?: { title?: string; uri?: string } } | undefined;
        if (!current?.info) {
          logger.warn({ guildId: data.guildId }, 'seedRelated: no current track to base recommendations on');
          return;
        }
        
        // Allow seeding even with existing queue, but limit to prevent over-population
        const currentQueueLen = player.queue.tracks.length;
        const maxSeedTarget = 10;
        const seedAmount = Math.max(0, maxSeedTarget - currentQueueLen);
        
        if (seedAmount <= 0) {
          logger.info({ guildId: data.guildId, currentQueueLen }, 'seedRelated: queue already sufficiently populated');
          return;
        }
        
        logger.info({ 
          guildId: data.guildId, 
          currentQueueLen, 
          seedAmount,
          trackTitle: current.info.title 
        }, 'seedRelated: seeding tracks');
        
        const seeded = await seedRelatedQueue(
          player as unknown as import('./autoplay').LLPlayer,
          current as unknown as import('./autoplay').LLTrack,
          async (q: string) => {
            const r = await player.search({ query: q }, { id: 'seed-related' } as { id: string });
            return { tracks: r.tracks as unknown as import('./autoplay').LLTrack[] };
          },
          seedAmount,
        );
        
        if (seeded > 0) {
          logger.info({ guildId: data.guildId, seeded }, 'seedRelated: successfully added tracks');
          batchQueueSaver.scheduleUpdate(data.guildId, player);
        } else {
          logger.warn({ guildId: data.guildId }, 'seedRelated: no suitable tracks found');
        }
      } catch (e) {
        logger.error({ e, guildId: data.guildId }, 'seedRelated command failed');
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
    } catch { /* ignore */ }
  }
}, 'redis_command_handler'));

// Health Check Setup with Advanced Monitoring
const healthChecker = new HealthChecker('audio', '1.0.0');
const advancedHealth = getAdvancedHealthMonitor({
  timeout: 8000,
  retryAttempts: 2,
  warningThresholds: {
    responseTime: 2000,
    memoryUsage: 80,
    cpuUsage: 75,
  },
  criticalThresholds: {
    responseTime: 8000,
    memoryUsage: 95,
    cpuUsage: 90,
  },
});

// Register standard health checks
healthChecker.register('redis', () => CommonHealthChecks.redis(redisPub));
healthChecker.register('database', () => CommonHealthChecks.database(prisma));
healthChecker.register('lavalink', () => CommonHealthChecks.lavalink(manager));
healthChecker.register('memory', () => CommonHealthChecks.memory(2048));

// Register advanced health components
advancedHealth.registerComponent('redis-circuit-breaker', async () => {
  const metrics = redisPub.getMetrics();
  return {
    status: metrics.redisStatus === 'ready' ? 'healthy' : 'unhealthy',
    message: `Redis circuit breaker status: ${metrics.redisStatus}`,
    details: {
      circuitState: metrics.state,
      fallbackCacheSize: metrics.fallbackCache.size,
      failures: metrics.failures,
      successes: metrics.successes,
    },
  };
});

advancedHealth.registerComponent('lavalink-nodes', async () => {
  const nodes = Array.from(manager.nodeManager?.nodes.values() || []);
  const connectedNodes = nodes.filter(node => node.connected);
  const totalNodes = nodes.length;

  if (totalNodes === 0) {
    return {
      status: 'unhealthy',
      message: 'No Lavalink nodes configured',
      details: { totalNodes: 0, connectedNodes: 0 },
    };
  }

  const connectionRate = connectedNodes.length / totalNodes;

  if (connectionRate === 1) {
    return {
      status: 'healthy',
      message: 'All Lavalink nodes connected',
      details: {
        totalNodes,
        connectedNodes: connectedNodes.length,
        connectionRate,
        nodeDetails: nodes.map(node => ({
          id: node.id,
          connected: node.connected,
          stats: node.stats,
        })),
      },
    };
  } else if (connectionRate >= 0.5) {
    return {
      status: 'degraded',
      message: `${connectedNodes.length}/${totalNodes} Lavalink nodes connected`,
      details: {
        totalNodes,
        connectedNodes: connectedNodes.length,
        connectionRate,
        nodeDetails: nodes.map(node => ({
          id: node.id,
          connected: node.connected,
          stats: node.stats,
        })),
      },
    };
  } else {
    return {
      status: 'unhealthy',
      message: `Critical: Only ${connectedNodes.length}/${totalNodes} Lavalink nodes connected`,
      details: {
        totalNodes,
        connectedNodes: connectedNodes.length,
        connectionRate,
        nodeDetails: nodes.map(node => ({
          id: node.id,
          connected: node.connected,
          stats: node.stats,
        })),
      },
    };
  }
});

advancedHealth.registerComponent('audio-performance', async () => {
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
  const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

  const activePlayers = manager.players.size;
  const totalTracks = Array.from(manager.players.values()).reduce(
    (sum, player) => sum + player.queue.tracks.length + (player.queue.current ? 1 : 0),
    0
  );

  const performanceScore = Math.max(0, 100 - heapUsagePercent - (activePlayers * 2));

  return {
    status: performanceScore > 70 ? 'healthy' : performanceScore > 40 ? 'degraded' : 'unhealthy',
    message: `Audio service performance score: ${performanceScore.toFixed(1)}%`,
    details: {
      memory: {
        heapUsedMB: heapUsedMB.toFixed(1),
        heapTotalMB: heapTotalMB.toFixed(1),
        heapUsagePercent: heapUsagePercent.toFixed(1),
        external: (memoryUsage.external / 1024 / 1024).toFixed(1),
      },
      audio: {
        activePlayers,
        totalTracks,
        performanceScore: performanceScore.toFixed(1),
      },
      uptime: process.uptime(),
    },
  };
});

advancedHealth.registerComponent('cache-performance', async () => {
  const cacheStats = {
    automixCacheSize: (automixCache as { size?: number }).size || 0,
    autoplayCooldownSize: autoplayCooldown.size,
    lastUiPushSize: lastUiPush.size,
  };

  const totalCacheEntries = Object.values(cacheStats).reduce((sum, size) => sum + size, 0);
  const cacheEfficiency = totalCacheEntries > 0 ? Math.min(100, (1000 / totalCacheEntries) * 100) : 100;

  return {
    status: cacheEfficiency > 70 ? 'healthy' : cacheEfficiency > 40 ? 'degraded' : 'unhealthy',
    message: `Cache efficiency: ${cacheEfficiency.toFixed(1)}%`,
    details: {
      ...cacheStats,
      totalEntries: totalCacheEntries,
      efficiency: cacheEfficiency.toFixed(1),
    },
  };
});

advancedHealth.registerComponent('worker-integration', async () => {
  try {
    const workerHealth = await checkWorkerIntegrationHealth();
    return {
      status: workerHealth.healthy ? 'healthy' : 'unhealthy',
      message: workerHealth.healthy ? 'Worker Service integration operational' : 'Worker Service integration unavailable',
      details: workerHealth.details,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'Worker Service integration check failed',
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
});

// Metrics + Health
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const lavalinkEvents = new Counter({ name: 'lavalink_events_total', help: 'Lavalink events', labelNames: ['event'], registers: [registry] });
// const audioCommands = new Counter({ name: 'audio_commands_total', help: 'Audio commands', labelNames: ['type'], registers: [registry] });

manager.on('trackStart', (player, track) => {
  lavalinkEvents.labels('trackStart').inc();
  const info = (track as { info?: { title?: string; uri?: string; duration?: number } })?.info;
  logger.info({ guildId: player.guildId, title: info?.title, uri: info?.uri }, 'audio: track start');

  // Track listening analytics for predictive caching
  if (info?.title) {
    // Store track start time for later duration calculation
    (player as any)._trackStartTime = Date.now();
  }

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
      if (req.url === '/health/advanced') {
        // Advanced health monitoring
        const healthChecks = new Map([
          ['redis-circuit-breaker', () => advancedHealth.checkComponent('redis-circuit-breaker', async () => {
            const metrics = redisPub.getMetrics();
            return {
              status: metrics.redisStatus === 'ready' ? 'healthy' : 'unhealthy',
              message: `Redis circuit breaker status: ${metrics.redisStatus}`,
              details: {
                circuitState: metrics.state,
                fallbackCacheSize: metrics.fallbackCache.size,
                failures: metrics.failures,
                successes: metrics.successes,
              },
            };
          })],
          ['lavalink-nodes', () => advancedHealth.checkComponent('lavalink-nodes', async () => {
            const nodes = Array.from(manager.nodeManager?.nodes.values() || []);
            const connectedNodes = nodes.filter(node => node.connected);
            const totalNodes = nodes.length;
            const connectionRate = totalNodes > 0 ? connectedNodes.length / totalNodes : 0;

            return {
              status: connectionRate === 1 ? 'healthy' : connectionRate >= 0.5 ? 'degraded' : 'unhealthy',
              message: `${connectedNodes.length}/${totalNodes} Lavalink nodes connected`,
              details: { totalNodes, connectedNodes: connectedNodes.length, connectionRate },
            };
          })],
          ['audio-performance', () => advancedHealth.checkComponent('audio-performance', async () => {
            const memoryUsage = process.memoryUsage();
            const heapUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
            const activePlayers = manager.players.size;
            const performanceScore = Math.max(0, 100 - heapUsagePercent - (activePlayers * 2));

            return {
              status: performanceScore > 70 ? 'healthy' : performanceScore > 40 ? 'degraded' : 'unhealthy',
              message: `Performance score: ${performanceScore.toFixed(1)}%`,
              details: { heapUsagePercent, activePlayers, performanceScore },
            };
          })],
          ['worker-integration', () => advancedHealth.checkComponent('worker-integration', async () => {
            const workerHealth = await checkWorkerIntegrationHealth();
            return {
              status: workerHealth.healthy ? 'healthy' : 'unhealthy',
              message: workerHealth.healthy ? 'Worker Service integration operational' : 'Worker Service unavailable',
              details: workerHealth.details,
            };
          })],
        ]);

        const componentResults = await advancedHealth.checkAllComponents(healthChecks);
        const healthSummary = advancedHealth.getHealthSummary();

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ...healthSummary,
          components: Array.from(componentResults.values()),
          timestamp: new Date().toISOString(),
        }, null, 2));
      } else if (req.url === '/health/trends') {
        // Health trends endpoint
        const trends = {
          'redis-circuit-breaker': advancedHealth.getComponentTrends('redis-circuit-breaker', 30),
          'lavalink-nodes': advancedHealth.getComponentTrends('lavalink-nodes', 30),
          'audio-performance': advancedHealth.getComponentTrends('audio-performance', 30),
          'worker-integration': advancedHealth.getComponentTrends('worker-integration', 30),
        };

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(trends, null, 2));
      } else {
        // Standard health check
        const health = await healthChecker.check();
        const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

        res.writeHead(statusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify(health, null, 2));
      }
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
    const cacheStats = audioCacheManager.getCacheStats();
    const businessInsights = audioMetrics.getBusinessInsights();
    const adaptiveAnalytics = adaptiveCacheManager.getPerformanceAnalytics();
    const predictiveAnalytics = predictiveCacheManager.getAnalytics();

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      performance: metrics,
      search: searchStats,
      memory: memoryStats,
      cache: cacheStats,
      business: businessInsights,
      adaptive: adaptiveAnalytics,
      predictive: predictiveAnalytics,
      timestamp: new Date().toISOString()
    }, null, 2));
    return;
  }

  // Business metrics endpoint
  if (req.url.startsWith('/metrics/business')) {
    const insights = audioMetrics.getBusinessInsights();

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(insights, null, 2));
    return;
  }

  // Cache statistics endpoint
  if (req.url.startsWith('/cache/stats')) {
    const cacheStats = audioCacheManager.getCacheStats();
    const cacheSizes = audioCacheManager.getCacheSizes();

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      stats: cacheStats,
      sizes: cacheSizes,
      timestamp: new Date().toISOString()
    }, null, 2));
    return;
  }

  // Adaptive cache endpoint
  if (req.url.startsWith('/cache/adaptive')) {
    if (req.method === 'POST') {
      // Trigger cache optimization
      const optimization = await adaptiveCacheManager.optimizeCache();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(optimization, null, 2));
    } else {
      // Get adaptive cache analytics
      const analytics = adaptiveCacheManager.getPerformanceAnalytics();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(analytics, null, 2));
    }
    return;
  }

  // Predictive cache endpoint
  if (req.url.startsWith('/cache/predictive')) {
    const guildId = new URL(req.url, 'http://localhost').searchParams.get('guildId');
    if (guildId) {
      const suggestions = await predictiveCacheManager.getPredictiveSearches('system', guildId);
      const recommendations = await adaptiveCacheManager.getGuildCacheRecommendations(guildId);

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        guildId,
        predictiveSearches: suggestions,
        cacheRecommendations: recommendations,
        analytics: predictiveCacheManager.getAnalytics(),
        timestamp: new Date().toISOString()
      }, null, 2));
    } else {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'guildId parameter required' }));
    }
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

    // Cleanup TTL maps
    autoplayCooldown.destroy();
    lastUiPush.destroy();
    guildTextChannels.destroy();

    // CRITICAL FIX: Reject any pending voice connections during shutdown
    for (const [guildId, entry] of pendingPlayerConnections.entries()) {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error('Service shutting down'));
    }
    pendingPlayerConnections.clear();

    // Cleanup cache system
    await audioCacheManager.flushAllCaches().catch(() => {});

    // Close Worker Service integration
    await closeWorkerIntegration().catch(() => {});

    // Close Redis connections
    await Promise.all([
      redisPub.disconnect().catch(() => {}),
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
import { saveQueue, resumeQueues, getQueueCached as _getQueueCached } from './services/database.js';

// Queue resuming should be explicit, not automatic on service start
// Only resume queues when explicitly requested via command or specific condition
// void resumeQueues(manager);

// Cached queue loading for better performance (exported for future use)
export async function getQueueCached(guildId: string) { return _getQueueCached(guildId); }

// Invalidate queue cache when queue is updated
// invalidateQueueCache moved to services/database

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

// Cached version of automix check for better performance using multi-layer cache
async function isAutomixEnabledCached(guildId: string): Promise<boolean> {
  return await featureFlagCache.getOrSet(
    featureFlagCache.generateFlagKey(guildId, 'autoplay'),
    async () => {
      const enabled = await isAutomixEnabled(guildId);
      // Track feature flag usage for metrics
      audioMetrics.businessMetrics.trackFeatureUsage('autoplay_check', guildId);
      return enabled;
    },
    180000 // 3 minutes cache
  );
}

async function enqueueAutomix(player: import('lavalink-client').Player, last: { info?: { title?: string; author?: string; uri?: string; duration?: number } }) {
  const title = (last?.info?.title ?? '').trim();
  const author = (last?.info?.author ?? '').trim();
  const uri = last?.info?.uri ?? '';

  const pick = await pickAutomixTrack(
    async (q: string) => {
      const res = await player.search({ query: q }, { id: 'automix' } as { id: string });
      return { tracks: res.tracks as unknown as import('./autoplay').LLTrack[] };
    },
    title,
    author,
    uri,
  );

  if (!pick) {
    logger.warn({ guildId: player.guildId, title, author }, 'automix: no candidate found');

    // Track failed autoplay recommendation
    audioMetrics.trackAutoplayRecommendation(
      player.guildId,
      'similar', // Default type
      false // Failed
    );

    return;
  }

  try {
    const info = (pick as { info?: { title?: string; uri?: string; duration?: number } }).info;
    logger.info({ guildId: player.guildId, nextTitle: info?.title, nextUri: info?.uri }, 'automix: picked candidate');

    // Track successful autoplay recommendation
    audioMetrics.trackAutoplayRecommendation(
      player.guildId,
      'similar', // Default recommendation type
      true,      // Success
      info?.title
    );

    // Track the autoplay song
    if (info) {
      audioMetrics.trackSongPlayback(
        player.guildId,
        {
          title: info.title || 'Unknown',
          duration: info.duration || 0,
          source: 'youtube', // Default source
          uri: info.uri,
        },
        true // Is autoplay
      );
    }

  } catch { /* ignore */ }

  await ensurePlayback(player as unknown as import('./autoplay').LLPlayer, pick as unknown as import('./autoplay').LLTrack);
  // Si la cola queda corta, volver a sembrar relacionados para mantener reproducción continua
  try {
    const qlen = player.queue.tracks.length;
    if (qlen < 3) {
      const seeded = await seedRelatedQueue(
        player as unknown as import('./autoplay').LLPlayer,
        pick as unknown as import('./autoplay').LLTrack,
        async (q: string) => {
          const r = await player.search({ query: q }, { id: 'automix' } as { id: string });
          return { tracks: r.tracks as unknown as import('./autoplay').LLTrack[] };
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

const autoplayCooldown = new TTLMap<string, number>({
  maxSize: 200,           // Max 200 guilds
  defaultTTL: 180000,     // 3 minutes TTL (cooldown duration)
  cleanupInterval: 60000  // Cleanup every minute
});

manager.on('trackEnd', async (player, track, payload?: unknown) => {
  try {
    // Reason may be undefined depending on library version. Only block on explicit non-finished reasons.
    const reason = (payload as { reason?: string } | undefined)?.reason;
    logger.info({ guildId: player.guildId, reason: reason ?? 'none' }, 'audio: track end');

    // Track listening behavior for predictive caching
    const trackInfo = (track as { info?: { title?: string; duration?: number } })?.info;
    const startTime = (player as any)._trackStartTime;
    if (trackInfo?.title && startTime) {
      const listenTime = Date.now() - startTime;
      const skipped = reason === 'REPLACED' || reason === 'STOPPED';
      const duration = trackInfo.duration || 0;

      // Track user listening analytics (use most recent user from player context)
      const lastUserId = (player as any)._lastUserId || 'unknown';
      void predictiveCacheManager.trackUserListening(
        lastUserId,
        player.guildId,
        trackInfo.title,
        duration,
        skipped,
        listenTime
      ).catch(e => logger.debug({ e }, 'Predictive listening tracking failed'));

      // Clear track start time
      delete (player as any)._trackStartTime;
    }

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
const lastUiPush = new TTLMap<string, number>({
  maxSize: 300,           // Max 300 guilds
  defaultTTL: 900000,     // 15 minutes TTL
  cleanupInterval: 300000 // Cleanup every 5 minutes
});
const minUiInterval = Math.max(1000, env.NOWPLAYING_UPDATE_MS ?? 5000);

// CRITICAL FIX: Store textChannelId for each guild to send UI updates to correct channel
const guildTextChannels = new TTLMap<string, string>({
  maxSize: 300,           // Max 300 guilds
  defaultTTL: 1800000,    // 30 minutes TTL
  cleanupInterval: 300000 // Cleanup every 5 minutes
});

// CRITICAL FIX: Track pending players waiting for voice credentials
const pendingPlayerConnections = new Map<string, {
  player: import('lavalink-client').Player;
  createdAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}>();

/**
 * CRITICAL FIX: Wait for voice credentials before connecting player
 * This prevents the race condition where player.connect() is called before
 * Discord voice credentials (sessionId, token, endpoint) are available.
 */
async function waitForVoiceCredentials(player: import('lavalink-client').Player): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const guildId = player.guildId;

    // Check if player is already connected
    if (player.connected) {
      logger.info({ guildId }, 'VOICE_CONNECT: Player already connected, skipping wait');
      resolve();
      return;
    }

    // Set up timeout for 30 seconds
    const timeoutId = setTimeout(() => {
      pendingPlayerConnections.delete(guildId);
      logger.warn({ guildId }, 'VOICE_CONNECT: Player connection timed out waiting for credentials');
      reject(new Error('Voice connection timeout - credentials not received'));
    }, 30000);

    // Set up pending connection entry
    const entry = {
      player,
      createdAt: Date.now(),
      resolve: () => {
        clearTimeout(timeoutId);
        resolve();
      },
      reject: (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
      timeoutId,
    };

    pendingPlayerConnections.set(guildId, entry);
    logger.info({ guildId }, 'VOICE_CONNECT: Player registered for pending voice connection');
  });
}

manager.on('playerUpdate', (playerJson) => {
  const p = manager.getPlayer((playerJson as { guildId?: string }).guildId as string);
  if (p) void pushNowPlaying(p);
});

async function pushNowPlaying(player: import('lavalink-client').Player) {
  try {
    const guildId = player.guildId;
    // CRITICAL FIX: Remove paused state blocking - UI should update regardless of pause state
    const now = Date.now();
    const last = lastUiPush.get(guildId) ?? 0;
    if (now - last < minUiInterval) return;
    const current = player.queue.current as { info?: { title?: string; uri?: string; author?: string; duration?: number; isStream?: boolean; artworkUrl?: string } } | undefined;
    if (!current?.info) return;
    lastUiPush.set(guildId, now);
    // CRITICAL FIX: Get stored textChannelId for this guild
    const textChannelId = guildTextChannels.get(guildId);

    const payload: { guildId: string; title: string; uri?: string; author?: string; durationMs: number; positionMs: number; isStream: boolean; artworkUrl?: string; paused: boolean; repeatMode?: 'off' | 'track' | 'queue'; queueLen: number; hasTrack: boolean; canSeek: boolean; textChannelId?: string } = {
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
      ...(textChannelId ? { textChannelId } : {}),
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
    // CRITICAL FIX: Get stored textChannelId for this guild
    const textChannelId = guildTextChannels.get(player.guildId);

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
      ...(textChannelId ? { textChannelId } : {}),
    };
    await redisPub.publish('discord-bot:ui:now', JSON.stringify(payload));
  } catch { /* ignore */ }
}
