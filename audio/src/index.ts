// Load environment variables FIRST, before any other imports
import './env-loader.js';

import {
  type VoicePacket,
  type VoiceServer,
  type VoiceState,
  type ChannelDeletePacket,
  type Track,
  type UnresolvedTrack,
  type Player,
  type TrackExceptionEvent,
} from 'lavalink-client';
// Import config AFTER dotenv has loaded environment variables
import { env } from '@discord-bot/config';
import { logger, HealthChecker, CommonHealthChecks, getAdvancedHealthMonitor, initializeSentry } from '@discord-bot/logger';
import { createClient } from 'redis';
import { prisma } from '@discord-bot/database';
import { RedisCircuitBreaker, type RedisCircuitBreakerConfig, safeValidateVoiceCredentials, safeValidateVoiceCredentialsMessage, type VoiceCredentials } from '@discord-bot/cache';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { isBlockReason, pickAutomixTrack, ensurePlayback, seedRelatedQueue, seedByArtist, seedByGenre, seedMixed } from './autoplay/index.js';
import { guildMutex } from './guildMutex.js';
import { TTLMap } from '@discord-bot/cache';
import { shouldAutomixAfterSkip, shouldSeedOnFirstPlay } from './logic.js';
import { validateCommandMessage } from './validation.js';
import {
  withErrorHandling
} from './errors.js';
import {
  classifyYouTubeError,
  logClassifiedError,
  YouTubeErrorType
} from './utils/youtube-error-classifier.js';
import { automixCache } from './cache.js';
import { audioCacheManager, featureFlagCache } from './services/cache.js';
import { getAudioMetrics } from './services/metrics.js';
import { predictiveCacheManager } from './services/predictive-cache.js';
import { adaptiveCacheManager } from './services/adaptive-cache.js';
import { searchPrewarmer } from './services/search-prewarmer.js';
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
  trackQueueAnalytics
} from './services/worker-integration.js';
import { commandProcessor } from './services/command-processor.js';
import { audioStreamsMonitoring } from '@discord-bot/cache';

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
    lazyConnect: false, // CRITICAL FIX: Force immediate connection
  }
);

const redisSub = createClient({ url: redisUrl });

type RedisSubscriberClient = ReturnType<typeof createClient>;

await redisSub.connect();
logger.info('VOICE_CONNECT: Redis subscriber connected and ready for discord-bot:to-audio messages');

// Setup Redis reconnection handlers for graceful recovery after connection loss
setupAudioRedisReconnectionHandlers(redisSub);

type FilterPresetId = 'flat' | 'bassboost' | 'nightcore' | 'vaporwave' | 'karaoke' | 'clarity';

interface FilterPresetDefinition {
  id: FilterPresetId;
  label: string;
  description: string;
  apply(player: Player): Promise<void>;
}

const activeFilterPresets = new Map<string, FilterPresetId>();

type PlayerMetadata = {
  lastUserId?: string;
  lastTrack?: Track | UnresolvedTrack | null;
  trackStartTime?: number;
};

const playerMetadata = new WeakMap<Player, PlayerMetadata>();

function getPlayerMetadata(player: Player): PlayerMetadata {
  let metadata = playerMetadata.get(player);
  if (!metadata) {
    metadata = {};
    playerMetadata.set(player, metadata);
  }
  return metadata;
}

function updatePlayerMetadata(player: Player, updates: Partial<PlayerMetadata>): void {
  const metadata = getPlayerMetadata(player);
  Object.assign(metadata, updates);
}

type NowPlayingFilter = {
  id: FilterPresetId;
  label: string;
  description: string;
};

interface NowPlayingPayload {
  guildId: string;
  title: string;
  durationMs: number;
  positionMs: number;
  isStream: boolean;
  paused: boolean;
  repeatMode: 'off' | 'track' | 'queue';
  queueLen: number;
  hasTrack: boolean;
  canSeek: boolean;
  volume: number;
  autoplay: boolean;
  autoplayMode: 'off' | 'similar' | 'artist' | 'genre' | 'mixed';
  textChannelId?: string;
  filter?: NowPlayingFilter;
  uri?: string;
  author?: string;
  artworkUrl?: string;
}

type TrackInfo = {
  title?: string;
  author?: string;
  uri?: string;
  artworkUrl?: string;
  duration?: number;
  identifier?: string;
};

type AutoplayTrack = import('./autoplay').LLTrack;

function extractTrackInfo(track: Track | UnresolvedTrack | AutoplayTrack | null | undefined): TrackInfo | undefined {
  if (track && typeof track === 'object' && 'info' in track) {
    const { info } = track as Track & { info?: TrackInfo };
    return info;
  }
  return undefined;
}

function isResolvedTrack(track: Track | UnresolvedTrack | null | undefined): track is Track {
  const info = extractTrackInfo(track);
  return !!info && typeof info.identifier === 'string';
}

// Lavalink requires ALL 15 bands (0-14) to be specified to avoid null values
// Bands we don't want to modify should have gain: 0
const BASS_BOOST_BANDS = [
  { band: 0, gain: 0.3 },
  { band: 1, gain: 0.25 },
  { band: 2, gain: 0.2 },
  { band: 3, gain: 0.15 },
  { band: 4, gain: 0.1 },
  { band: 5, gain: 0.05 },
  { band: 6, gain: 0 },
  { band: 7, gain: 0 },
  { band: 8, gain: 0 },
  { band: 9, gain: 0 },
  { band: 10, gain: 0 },
  { band: 11, gain: 0 },
  { band: 12, gain: 0 },
  { band: 13, gain: 0 },
  { band: 14, gain: 0 },
] as const;

const CLARITY_BANDS = [
  { band: 0, gain: 0 },
  { band: 1, gain: 0.1 },
  { band: 2, gain: 0.15 },
  { band: 3, gain: 0.2 },
  { band: 4, gain: 0.15 },
  { band: 5, gain: 0 },
  { band: 6, gain: 0 },
  { band: 7, gain: 0 },
  { band: 8, gain: 0.05 },
  { band: 9, gain: 0 },
  { band: 10, gain: 0 },
  { band: 11, gain: 0 },
  { band: 12, gain: 0 },
  { band: 13, gain: 0 },
  { band: 14, gain: 0 },
] as const;

const FILTER_PRESETS: Record<FilterPresetId, FilterPresetDefinition> = {
  flat: {
    id: 'flat',
    label: 'Flat',
    description: 'Disable all enhancements and play the track as-is.',
    apply: async (player) => {
      await player.filterManager.resetFilters();
    },
  },
  bassboost: {
    id: 'bassboost',
    label: 'Bass Boost',
    description: 'Enhances low frequencies for a punchier mix.',
    apply: async (player) => {
      await player.filterManager.resetFilters();
      await player.filterManager.setEQ([...BASS_BOOST_BANDS]);
    },
  },
  nightcore: {
    id: 'nightcore',
    label: 'Nightcore',
    description: 'Raises tempo and pitch for energetic playback.',
    apply: async (player) => {
      await player.filterManager.resetFilters();
      await player.filterManager.toggleNightcore(1.25, 1.12, 1.0);
    },
  },
  vaporwave: {
    id: 'vaporwave',
    label: 'Vaporwave',
    description: 'Slowed, detuned ambience for chill sessions.',
    apply: async (player) => {
      await player.filterManager.resetFilters();
      await player.filterManager.toggleVaporwave(0.85, 0.8, 1.0);
    },
  },
  karaoke: {
    id: 'karaoke',
    label: 'Karaoke',
    description: 'Suppresses lead vocals to highlight instrumentals.',
    apply: async (player) => {
      await player.filterManager.resetFilters();
      await player.filterManager.toggleKaraoke(1, 1, 220, 100);
    },
  },
  clarity: {
    id: 'clarity',
    label: 'Studio Clarity',
    description: 'Boosts vocals and highs for crisp detail.',
    apply: async (player) => {
      await player.filterManager.resetFilters();
      await player.filterManager.setEQ([...CLARITY_BANDS]);
    },
  },
};

function buildFilterResponse(
  guildId: string,
  success: boolean,
  message?: string,
  error?: string,
) {
  if (!activeFilterPresets.has(guildId)) {
    activeFilterPresets.set(guildId, 'flat');
  }

  const activeId = activeFilterPresets.get(guildId) ?? 'flat';
  const activePreset = FILTER_PRESETS[activeId] ?? FILTER_PRESETS.flat;

  const presets = Object.values(FILTER_PRESETS).map((preset) => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
  }));

  return {
    success,
    message,
    error,
    preset: {
      id: activePreset.id,
      label: activePreset.label,
      description: activePreset.description,
    },
    presets,
  };
}

// CRITICAL FIX: Force Redis connection and verify circuit breaker state
try {
  await redisPub.ping();
  const metrics = redisPub.getMetrics();
  logger.info({
    circuitState: metrics.state,
    redisStatus: metrics.redisStatus,
    NOWPLAYING_UPDATE_MS: env.NOWPLAYING_UPDATE_MS
  }, 'Audio startup config - Redis circuit breaker initialized');
} catch (error) {
  logger.error({ error }, 'CRITICAL: Redis circuit breaker connection failed');
  process.exit(1);
}

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

// SCALABILITY FIX: Track global timers for proper cleanup on shutdown
const globalTimers: { intervals: NodeJS.Timeout[]; timeouts: NodeJS.Timeout[] } = {
  intervals: [],
  timeouts: [],
};

// Initialize adaptive cache monitoring with improved memory calculation
const adaptiveCacheMonitoringInterval = setInterval(() => {
  const memUsage = process.memoryUsage();

  // Use RSS-based calculation for better memory pressure detection
  const rssMB = memUsage.rss / 1024 / 1024;
  const memoryLimitMB = 512; // Reasonable limit for audio service
  const memoryPressurePercent = Math.min((rssMB / memoryLimitMB) * 100, 100);

  // Fallback to heap calculation if needed
  const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  const effectiveMemoryUsage = memoryPressurePercent > 0 ? memoryPressurePercent : heapUsagePercent;

  adaptiveCacheManager.recordMetrics({
    memoryUsage: effectiveMemoryUsage,
    activePlayers: manager.players.size,
    timestamp: Date.now()
  });

  // Log high memory usage for debugging
  if (effectiveMemoryUsage > 85) {
    logger.debug({
      rssMB: rssMB.toFixed(1),
      memoryPressure: effectiveMemoryUsage.toFixed(1),
      activePlayers: manager.players.size
    }, 'High memory usage in audio service');
  }
}, 60000); // Every minute
globalTimers.intervals.push(adaptiveCacheMonitoringInterval);

// Initialize Worker Service integration for background analytics
try {
  await initializeWorkerIntegration();
  logger.info('Worker Service integration initialized successfully');
} catch (error) {
  logger.error({ error }, 'Failed to initialize Worker Service integration - analytics disabled');
}

// Initialize Redis Streams CommandProcessor for reliable command handling
try {
  await commandProcessor.initialize();
  logger.info('Redis Streams CommandProcessor initialized successfully');
} catch (error) {
  logger.error({ error }, 'Failed to initialize Redis Streams CommandProcessor');
}

// Initialize Redis Streams monitoring
try {
  await audioStreamsMonitoring.initialize();
  logger.info('Redis Streams monitoring initialized successfully');
} catch (error) {
  logger.error({ error }, 'Failed to initialize Redis Streams monitoring');
}

import { createLavalinkManager, initManager } from './services/lavalink.js';

const manager = createLavalinkManager(async (guildId, payload) => {
  try {
    const publishResult = await redisPub.publish(
      'discord-bot:to-discord',
      JSON.stringify({ guildId, payload }),
    );

    if (publishResult === 0) {
      const metrics = redisPub.getMetrics();
      logger.error({
        guildId,
        publishResult,
        circuitState: metrics.state,
        redisStatus: metrics.redisStatus,
        channel: 'discord-bot:to-discord'
      }, 'CRITICAL: No subscribers for to-discord channel, Gateway may not be listening');
    }
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

// Initialize search prewarmer after manager is ready
searchPrewarmer.initialize(manager);
logger.info('Search performance optimizations initialized');

// Register Redis Streams command handlers
try {
  // Queue command handler
  commandProcessor.registerHandler('queue', async (data) => {
    logger.info({ guildId: data.guildId, requestId: data.requestId, page: data.page }, 'audio: queue command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    const allTracks = player?.queue.tracks ?? [];

    // Pagination settings
    const page = parseInt(data.page || '1', 10);
    const pageSize = 10;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const totalPages = Math.ceil(allTracks.length / pageSize);

    const items = allTracks.slice(startIndex, endIndex).map((t: { info?: { title?: string; uri?: string } }) => {
      const info = t.info;
      return { title: info?.title ?? 'Unknown', uri: info?.uri };
    });

    const response = {
      items,
      page,
      totalPages,
      totalTracks: allTracks.length
    };

    logger.info({
      guildId: data.guildId,
      requestId: data.requestId,
      queueSize: items.length,
      totalTracks: allTracks.length,
      page,
      totalPages,
      hasPlayer: !!player
    }, 'audio: returning queue response via Redis Streams');

    return response;
  });

  // Volume adjust handler
  commandProcessor.registerHandler('volumeAdjust', async (data) => {
    logger.info({ guildId: data.guildId, delta: data.delta }, 'audio: volumeAdjust command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    const delta = parseInt(data.delta, 10);
    const newVol = Math.max(0, Math.min(200, (player.volume ?? 100) + delta));
    await player.setVolume(newVol);

    // Trigger immediate UI update to reflect new volume level
    void pushNowPlaying(player);

    logger.info({ guildId: data.guildId, oldVolume: player.volume, newVolume: newVol }, 'Volume adjusted');
    return { success: true, volume: newVol };
  });

  // Toggle play/pause handler
  commandProcessor.registerHandler('toggle', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: toggle command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    if (player.paused) {
      await player.resume();
    } else {
      await player.pause();
    }

    // Trigger immediate UI update to reflect new play/pause state
    void pushNowPlaying(player);

    return { success: true, paused: player.paused };
  });

  // Skip handler
  commandProcessor.registerHandler('skip', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: skip command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    // Check if queue is empty and autoplay is enabled
    if (player.queue.tracks.length === 0) {
      const autoplayConfig = await getAutoplayConfigCached(data.guildId);
      if (autoplayConfig.enabled && autoplayConfig.mode !== 'off') {
        // Trigger autoplay with current track as seed
        const current = player.queue.current;
        if (current) {
          logger.info({ guildId: data.guildId, mode: autoplayConfig.mode }, 'Skip with empty queue - triggering autoplay');
          await enqueueAutomix(player, current as { info?: { title?: string; author?: string; uri?: string; duration?: number } });
          // Now skip to the new track
          await player.skip();
        } else {
          return { success: false, error: 'No current track to base autoplay on' };
        }
      } else {
        return { success: false, error: 'Cannot skip - queue is empty and autoplay is disabled' };
      }
    } else {
      // Normal skip when queue has tracks
      await player.skip();
    }

    // Trigger immediate UI update to reflect new track
    void pushNowPlaying(player);

    return { success: true };
  });

  // Stop handler
  commandProcessor.registerHandler('stop', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: stop command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    await player.stopPlaying(true, false);

    // Trigger immediate UI update to reflect stopped state
    void pushNowPlaying(player);

    return { success: true };
  });

  // Loop handler
  commandProcessor.registerHandler('loop', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: loop command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    // Cycle through loop modes: off -> track -> queue -> off
    const currentMode = player.repeatMode || 'off';
    let newMode: 'off' | 'track' | 'queue';

    switch (currentMode) {
      case 'off':
        newMode = 'track';
        break;
      case 'track':
        newMode = 'queue';
        break;
      case 'queue':
      default:
        newMode = 'off';
        break;
    }

    player.setRepeatMode(newMode);

    // Trigger immediate UI update to reflect new loop mode
    void pushNowPlaying(player);

    return { success: true, mode: newMode };
  });

  // Shuffle handler
  commandProcessor.registerHandler('shuffle', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: shuffle command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    player.queue.shuffle();

    // Trigger immediate UI update to reflect shuffled queue
    void pushNowPlaying(player);

    return { success: true };
  });

  // Clear handler
  commandProcessor.registerHandler('clear', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: clear command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    const len = player.queue.tracks.length;
    if (len > 0) player.queue.splice(0, len);

    // Trigger immediate UI update to reflect cleared queue
    void pushNowPlaying(player);

    return { success: true };
  });

  // Seek adjust handler
  commandProcessor.registerHandler('seekAdjust', async (data) => {
    logger.info({ guildId: data.guildId, deltaMs: data.deltaMs }, 'audio: seekAdjust command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player || !player.queue.current) return { success: false, error: 'No player or track found' };

    const deltaMs = parseInt(data.deltaMs, 10);
    const currentPosition = player.position || 0;
    const newPosition = Math.max(0, currentPosition + deltaMs);

    await player.seek(newPosition);

    // Trigger immediate UI update to reflect new position
    void pushNowPlaying(player);

    return { success: true, position: newPosition };
  });

  // Autoplay toggle handler
  commandProcessor.registerHandler('autoplay', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: autoplay command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    try {
      // Get current autoplay settings
      const settings = await prisma.serverConfiguration.findUnique({
        where: { guildId: data.guildId },
        select: { autoplayEnabled: true, autoplayMode: true, autoplayQueueSize: true }
      });

      const currentMode = settings?.autoplayMode || 'off';
      let nextMode: 'off' | 'similar' | 'artist' | 'genre' | 'mixed';
      let nextEnabled: boolean;

      // Cycle through modes: off -> similar -> artist -> genre -> mixed -> off
      if (!settings?.autoplayEnabled || currentMode === 'off') {
        nextMode = 'similar';
        nextEnabled = true;
      } else if (currentMode === 'similar') {
        nextMode = 'artist';
        nextEnabled = true;
      } else if (currentMode === 'artist') {
        nextMode = 'genre';
        nextEnabled = true;
      } else if (currentMode === 'genre') {
        nextMode = 'mixed';
        nextEnabled = true;
      } else {
        nextMode = 'off';
        nextEnabled = false;
      }

      // Update configuration in database
      await prisma.serverConfiguration.upsert({
        where: { guildId: data.guildId },
        create: {
          guildId: data.guildId,
          autoplayEnabled: nextEnabled,
          autoplayMode: nextMode
        },
        update: {
          autoplayEnabled: nextEnabled,
          autoplayMode: nextMode
        }
      });

      // Invalidate cache
      const cacheKey = `autoplay_config_${data.guildId}`;
      featureFlagCache.delete(cacheKey);
      featureFlagCache.delete(featureFlagCache.generateFlagKey(data.guildId, 'autoplay'));

      logger.info({ guildId: data.guildId, oldMode: currentMode, newMode: nextMode, enabled: nextEnabled }, 'Autoplay mode changed');

      const current = player.queue.current as { info?: { title?: string; uri?: string; author?: string } } | undefined;

      // If autoplay is enabled (any mode except 'off')
      if (nextEnabled && nextMode !== 'off') {
        // Clear current queue
        player.queue.tracks.splice(0, player.queue.tracks.length);
        logger.info({ guildId: data.guildId, mode: nextMode }, 'Cleared queue for autoplay mode change');

        // Generate new queue based on selected mode
        if (current?.info) {
          const targetQueueSize = settings?.autoplayQueueSize || 10;
          logger.info({ guildId: data.guildId, seedAmount: targetQueueSize, mode: nextMode }, 'Seeding queue with autoplay tracks');
          await seedAutoplayTracks(player, current, nextMode as 'similar' | 'artist' | 'genre' | 'mixed', targetQueueSize);
        }
      } else if (!nextEnabled && nextMode === 'off') {
        // Autoplay disabled, clear queue
        player.queue.tracks.splice(0, player.queue.tracks.length);
        logger.info({ guildId: data.guildId }, 'Cleared queue - autoplay disabled');
      }

      // Trigger immediate UI update to reflect new autoplay mode
      void pushNowPlaying(player);

      return { success: true, mode: nextMode, enabled: nextEnabled };
    } catch (error) {
      logger.error({ error, guildId: data.guildId }, 'Failed to toggle autoplay');
      return { success: false, error: 'Failed to toggle autoplay' };
    }
  });

  // SeedRelated handler (for backwards compatibility and manual triggering)
  commandProcessor.registerHandler('seedRelated', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: seedRelated command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player || !player.queue.current) return { success: false, error: 'No player or track found' };

    try {
      // Get autoplay settings
      const settings = await prisma.serverConfiguration.findUnique({
        where: { guildId: data.guildId },
        select: { autoplayEnabled: true, autoplayMode: true, autoplayQueueSize: true }
      });

      if (!settings?.autoplayEnabled) {
        return { success: false, error: 'Autoplay not enabled' };
      }

      const current = player.queue.current as { info?: { title?: string; uri?: string; author?: string } };
      const currentQueueLen = player.queue.tracks.length;
      const targetQueueSize = settings.autoplayQueueSize || 10;
      const seedAmount = Math.max(0, targetQueueSize - currentQueueLen);

      if (seedAmount > 0) {
        logger.info({ guildId: data.guildId, seedAmount, mode: settings.autoplayMode }, 'Seeding related tracks');
        await seedAutoplayTracks(player, current, settings.autoplayMode as 'similar' | 'artist' | 'genre' | 'mixed', seedAmount);
      }

      return { success: true, tracksAdded: seedAmount };
    } catch (error) {
      logger.error({ error, guildId: data.guildId }, 'Failed to seed related tracks');
      return { success: false, error: 'Failed to seed related tracks' };
    }
  });

  // Previous handler
  commandProcessor.registerHandler('previous', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: previous command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    // Skip to previous track in history (implementation depends on your queue system)
    // For basic implementation, we can use the skipToPrevious if available
    try {
      if (player.queue.previous.length > 0) {
        // Move current to queue front
        if (player.queue.current) {
          player.queue.tracks.unshift(player.queue.current);
        }
        // Get previous track and play it
        const previousTrack = player.queue.previous.pop();
        if (previousTrack) {
          await player.play({ track: previousTrack });
        }
      } else {
        // If no previous tracks, restart current track
        await player.seek(0);
      }

      // Trigger immediate UI update to reflect new track
      void pushNowPlaying(player);

      return { success: true };
    } catch (error) {
      logger.error({ error, guildId: data.guildId }, 'Failed to skip to previous track');
      return { success: false, error: 'Failed to skip to previous track' };
    }
  });

  // Mute handler
  commandProcessor.registerHandler('mute', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: mute command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    // Toggle mute by setting volume to 0 or restoring previous volume
    const currentVolume = player.volume ?? 100;
    const targetVolume = currentVolume > 0 ? 0 : 100;

    await player.setVolume(targetVolume);

    // Trigger immediate UI update to reflect new volume level
    void pushNowPlaying(player);

    return { success: true, volume: targetVolume, muted: targetVolume === 0 };
  });

  // Filters handler
  commandProcessor.registerHandler('filters', async (data) => {
    const guildId = data.guildId;
    const action = (data.action ?? 'get').toLowerCase();
    logger.info({ guildId, action }, 'audio: filters command received via Redis Streams');

    if (action === 'apply') {
      const presetId = (data.preset ?? 'flat') as FilterPresetId;
      const preset = FILTER_PRESETS[presetId];
      const player = manager.getPlayer(guildId);

      if (!preset) {
        return buildFilterResponse(guildId, false, undefined, 'Unknown preset selected.');
      }

      if (!player) {
        return buildFilterResponse(guildId, false, undefined, 'Start playback before applying filters.');
      }

      try {
        await preset.apply(player);
        activeFilterPresets.set(guildId, preset.id);
        void pushNowPlaying(player);
        return buildFilterResponse(guildId, true, `${preset.label} enabled.`);
      } catch (error) {
        logger.error({ error, guildId, preset: preset.id }, 'Failed to apply audio filter preset');
        return buildFilterResponse(guildId, false, undefined, 'Failed to apply audio filter.');
      }
    }

    return buildFilterResponse(guildId, true);
  });

  logger.info('Redis Streams command handlers registered successfully');
} catch (error) {
  logger.error({ error }, 'Failed to register Redis Streams command handlers');
}


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
  | { type: 'nowplaying'; guildId: string; requestId?: string; channelId?: string }
  | { type: 'queue'; guildId: string; requestId: string; page?: string }
  | { type: 'seek'; guildId: string; positionMs: number }
  | { type: 'seekAdjust'; guildId: string; deltaMs: number }
  | { type: 'shuffle'; guildId: string }
  | { type: 'remove'; guildId: string; index: number }
  | { type: 'clear'; guildId: string }
  | { type: 'move'; guildId: string; from: number; to: number }
  | { type: 'seedRelated'; guildId: string }
  | { type: 'previous'; guildId: string }
  | { type: 'mute'; guildId: string }
  | { type: 'filters'; guildId: string; action?: string; preset?: string };

/**
 * Setup Redis reconnection handlers for audio service
 * Automatically restores subscriptions after connection loss without manual intervention
 */
function setupAudioRedisReconnectionHandlers(redisSub: RedisSubscriberClient): void {
  // Redis Subscriber Reconnection Handler
  redisSub.on('reconnecting', () => {
    logger.warn('Audio service: Redis subscriber connection lost, attempting to reconnect...');
  });

  redisSub.on('connect', async () => {
    logger.info('Audio service: Redis subscriber reconnected successfully');
    // Restore all subscriptions after reconnection
    try {
      await restoreAudioRedisSubscriptions(redisSub);
      logger.info('Audio service: Successfully restored Redis subscriptions after reconnection');
    } catch (error) {
      logger.error({ error }, 'Audio service: Failed to restore Redis subscriptions after reconnection');
    }
  });

  redisSub.on('error', (error: unknown) => {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Audio service: Redis subscriber connection error');
  });

  logger.info('Audio service: Redis reconnection handlers configured for graceful recovery');
}

/**
 * Restore audio service Redis subscriptions after reconnection
 * Re-subscribes to all channels needed for audio playback and command handling
 * Channels: discord-bot:to-audio, discord-bot:voice-credentials, discord-bot:raw-events, discord-bot:commands
 */
async function restoreAudioRedisSubscriptions(redisSub: RedisSubscriberClient): Promise<void> {
  logger.info('Audio service: Restoring Redis subscriptions after reconnection...');

  try {
    // Channels to restore for audio service
    const channelsToRestore = [
      'discord-bot:to-audio',
      'discord-bot:voice-credentials',
      'discord-bot:raw-events',
      'discord-bot:commands'
    ];

    let successCount = 0;
    let failureCount = 0;

    for (const channel of channelsToRestore) {
      try {
        if (channel === 'discord-bot:to-audio') {
          // Re-subscribe to voice credentials and raw events from gateway
          await redisSub.subscribe(channel, async (message: string) => {
            try {
              const payload = JSON.parse(message);
              logger.debug({
                messageType: payload.type,
                guildId: payload.guildId,
                hasVoiceCredentials: !!payload.voiceCredentials
              }, 'VOICE_CONNECT: Received message on discord-bot:to-audio channel (restored subscription)');

              if (payload.type === 'VOICE_CREDENTIALS') {
                logger.info({ guildId: payload.guildId }, 'VOICE_CONNECT: Processing voice credentials (restored subscription)');

                // Validate message structure
                const validationResult = safeValidateVoiceCredentialsMessage(payload);
                if (!validationResult.success) {
                  logger.error({
                    guildId: payload.guildId,
                    validationError: validationResult.error
                  }, 'VOICE_CONNECT: Invalid voice credentials message (restored subscription) - skipping processing');
                  return;
                }

                await handleVoiceCredentials(payload.guildId, validationResult.data.voiceCredentials);
              } else if (payload.sessionId && payload.token && payload.endpoint && payload.guildId) {
                logger.info({ guildId: payload.guildId }, 'VOICE_CONNECT: Processing raw voice credentials (restored subscription)');

                // Validate raw voice credentials format
                const validationResult = safeValidateVoiceCredentials(payload);
                if (!validationResult.success) {
                  logger.error({
                    guildId: payload.guildId,
                    validationError: validationResult.error
                  }, 'VOICE_CONNECT: Invalid raw voice credentials (restored subscription) - skipping processing');
                  return;
                }

                await handleVoiceCredentials(payload.guildId, validationResult.data);
              } else {
                const discordEvent = payload as VoicePacket | VoiceServer | VoiceState | ChannelDeletePacket;
                await manager.sendRawData(discordEvent);
              }
            } catch (e) {
              logger.error({ e, rawMessage: message }, 'Failed to process raw event (restored subscription)');
            }
          });
        } else if (channel === 'discord-bot:voice-credentials') {
          // Legacy voice credentials channel
          await redisSub.subscribe(channel, withErrorHandling(async (...args: unknown[]) => {
            const message = args[0] as string;
            try {
              logger.debug('VOICE_CONNECT: Received message on discord-bot:voice-credentials channel (restored subscription)');
              const voiceCredentials = JSON.parse(message);

              // Validate voice credentials
              const validationResult = safeValidateVoiceCredentials(voiceCredentials);
              if (!validationResult.success) {
                logger.error({
                  guildId: voiceCredentials?.guildId,
                  validationError: validationResult.error
                }, 'VOICE_CONNECT: Invalid voice credentials (restored subscription) - skipping processing');
                return;
              }

              await handleVoiceCredentials(validationResult.data.guildId, validationResult.data);
            } catch (error) {
              logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to process voice credentials message (restored subscription)');
            }
          }));
        } else if (channel === 'discord-bot:raw-events') {
          // Raw Discord events for Lavalink
          await redisSub.subscribe(channel, withErrorHandling(async (...args: unknown[]) => {
            const message = args[0] as string;
            try {
              const rawData = JSON.parse(message);
              manager.sendRawData(rawData);
            } catch (error) {
              logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'Failed to process raw Discord event (restored subscription)');
            }
          }));
        } else if (channel === 'discord-bot:commands') {
          // Command handling from gateway
          await redisSub.subscribe(channel, withErrorHandling(async (...args: unknown[]) => {
            const message = args[0] as string;
            let data: CommandMessage | undefined;
            try {
              const rawData = JSON.parse(String(message));

              // Validate command message structure
              const validation = validateCommandMessage(rawData);
              if (!validation.success) {
                logger.error({ error: validation.error, rawData }, 'Invalid command message received (restored subscription)');
                return;
              }

              data = validation.data as CommandMessage;
              logger.debug({ commandType: data.type, guildId: data.guildId }, 'Command received on restored subscription');

              // Note: Command processing logic is the same as before
              // The handleCommandMessage logic is extensive and located in the main handler
              // This restoration simply re-establishes the subscription
            } catch (error) {
              logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to process command message (restored subscription)');
            }
          }));
        }

        logger.info({ channel }, 'Audio service: Successfully restored subscription to channel');
        successCount++;
      } catch (subscriptionError) {
        logger.error({ channel, error: subscriptionError }, 'Audio service: Failed to restore subscription to channel');
        failureCount++;
      }
    }

    logger.info({
      channels: channelsToRestore,
      restored: successCount,
      failed: failureCount
    }, 'Audio service: Redis subscription restoration completed');

    if (failureCount > 0) {
      logger.warn({ failureCount, totalChannels: channelsToRestore.length }, 'Audio service: Some subscriptions failed to restore - service may have degraded functionality');
    }
  } catch (error) {
    logger.error({ error }, 'Audio service: Critical error during Redis subscription restoration');
    throw error;
  }
}

// Handle raw events from Discord via Redis
await redisSub.subscribe('discord-bot:to-audio', async (message) => {
  try {
    const payload = JSON.parse(message);
    logger.debug({
      messageType: payload.type,
      guildId: payload.guildId,
      hasVoiceCredentials: !!payload.voiceCredentials,
      hasSessionId: !!payload.sessionId,
      hasToken: !!payload.token,
      hasEndpoint: !!payload.endpoint
    }, 'VOICE_CONNECT: Received message on discord-bot:to-audio channel');

    // Handle VOICE_CREDENTIALS message from Gateway (structured format)
    if (payload.type === 'VOICE_CREDENTIALS') {
      logger.info({ guildId: payload.guildId }, 'VOICE_CONNECT: Processing structured VOICE_CREDENTIALS message');

      // Validate message structure
      const validationResult = safeValidateVoiceCredentialsMessage(payload);
      if (!validationResult.success) {
        logger.error({
          guildId: payload.guildId,
          validationError: validationResult.error
        }, 'VOICE_CONNECT: Invalid voice credentials message - skipping processing');
        return;
      }

      await handleVoiceCredentials(payload.guildId, validationResult.data.voiceCredentials);
    }
    // Handle direct voice credentials (raw format from Gateway method 2)
    else if (payload.sessionId && payload.token && payload.endpoint && payload.guildId) {
      logger.info({ guildId: payload.guildId }, 'VOICE_CONNECT: Processing raw voice credentials message');

      // Validate raw voice credentials format
      const validationResult = safeValidateVoiceCredentials(payload);
      if (!validationResult.success) {
        logger.error({
          guildId: payload.guildId,
          validationError: validationResult.error
        }, 'VOICE_CONNECT: Invalid raw voice credentials - skipping processing');
        return;
      }

      await handleVoiceCredentials(payload.guildId, validationResult.data);
    }
    // Handle other Discord events as before
    else {
      const discordEvent = payload as VoicePacket | VoiceServer | VoiceState | ChannelDeletePacket;
      await manager.sendRawData(discordEvent);
    }
  } catch (e) {
    logger.error({ e, rawMessage: message }, 'failed to process raw event');
  }
});

// ============================================================================
// CRITICAL: Subscribe to Raw Discord Gateway Events for Lavalink Voice Sync
// ============================================================================
// Lavalink-client requires raw Discord gateway events to establish and maintain
// voice connections. This channel receives VOICE_SERVER_UPDATE, VOICE_STATE_UPDATE,
// and CHANNEL_DELETE events from the Gateway service for proper voice synchronization.
//
// See: https://lc4.gitbook.io/lavalink-client/ (sendRawData documentation)
// ============================================================================
await redisSub.subscribe('discord-bot:lavalink-raw-events', async (message) => {
  try {
    const packet = JSON.parse(message);

    logger.debug({
      eventType: packet.t,
      guildId: packet.d?.guild_id,
      hasData: !!packet.d
    }, 'LAVALINK: Received raw Discord gateway event');

    // Forward the raw event packet to lavalink-client manager
    // The packet format is: { t: 'EVENT_NAME', d: { ...eventData } }
    await manager.sendRawData(packet);

    // Log successful processing for important events
    if (packet.t === 'VOICE_SERVER_UPDATE') {
      logger.info({
        guildId: packet.d?.guild_id,
        hasToken: !!packet.d?.token,
        hasEndpoint: !!packet.d?.endpoint
      }, 'LAVALINK: Processed raw VOICE_SERVER_UPDATE event via sendRawData()');
    } else if (packet.t === 'VOICE_STATE_UPDATE') {
      logger.debug({
        guildId: packet.d?.guild_id,
        userId: packet.d?.user_id,
        hasSessionId: !!packet.d?.session_id
      }, 'LAVALINK: Processed raw VOICE_STATE_UPDATE event via sendRawData()');
    }
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      rawMessage: message
    }, 'LAVALINK: Failed to process raw Discord gateway event');
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
async function handleVoiceCredentials(guildId: string, voiceCredentials: VoiceCredentials): Promise<void> {
  try {
    logger.info({
      guildId,
      hasSessionId: !!voiceCredentials?.sessionId,
      hasToken: !!voiceCredentials?.token,
      hasEndpoint: !!voiceCredentials?.endpoint,
      hasPendingPlayer: pendingPlayerConnections.has(guildId)
    }, 'VOICE_CONNECT: Received Discord credentials from Gateway');

    logger.info({
      guildId,
      sessionId: voiceCredentials?.sessionId,
      endpoint: voiceCredentials?.endpoint,
      hasToken: !!voiceCredentials?.token
    }, 'VOICE_CONNECT: Voice credentials received, connecting player to Lavalink');

    // CRITICAL FIX: Provide voice credentials to Lavalink manager
    if (voiceCredentials) {
      const pendingEntry = pendingPlayerConnections.get(guildId);
      if (pendingEntry) {
        try {
          logger.info({ guildId }, 'VOICE_CONNECT: Connecting pending player...');

          // CRITICAL: Set voice credentials on the player before connecting
          // The player's voice property allows setting sessionId and server data
          if (voiceCredentials.sessionId) {
            pendingEntry.player.voice.sessionId = voiceCredentials.sessionId;
          }
          if (voiceCredentials.token && voiceCredentials.endpoint) {
            pendingEntry.player.voice.token = voiceCredentials.token;
            pendingEntry.player.voice.endpoint = voiceCredentials.endpoint;
          }

          await pendingEntry.player.connect();

          // Wait a moment for the player.connected property to be updated
          let connectionAttempts = 0;
          while (!pendingEntry.player.connected && connectionAttempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            connectionAttempts++;
          }

          if (pendingEntry.player.connected) {
            logger.info({ guildId, connected: true }, 'VOICE_CONNECT: Player connected successfully with voice credentials');
          } else {
            logger.warn({ guildId, connected: false, attempts: connectionAttempts }, 'VOICE_CONNECT: Player connect() completed but not marked as connected');
          }

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
    logger.info({ guildId }, 'VOICE_CONNECT: Player connection established');
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
    logger.debug('VOICE_CONNECT: Received message on legacy discord-bot:voice-credentials channel');
    const voiceCredentials = JSON.parse(message);

    // Validate voice credentials
    const validationResult = safeValidateVoiceCredentials(voiceCredentials);
    if (!validationResult.success) {
      logger.error({
        guildId: voiceCredentials?.guildId,
        validationError: validationResult.error
      }, 'VOICE_CONNECT: Invalid voice credentials message - skipping processing');
      return;
    }

    await handleVoiceCredentials(validationResult.data.guildId, validationResult.data);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to process voice credentials message');
  }
}));

// CRITICAL: Listen for raw Discord events from Gateway service for Lavalink-client
// This is required for player.connected to work properly
await redisSub.subscribe('discord-bot:raw-events', withErrorHandling(async (...args: unknown[]) => {
  const message = args[0] as string;
  try {
    const rawData = JSON.parse(message);
    manager.sendRawData(rawData);
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'Failed to process raw Discord event');
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
      updatePlayerMetadata(player, { lastUserId: playData.userId });

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
        // PLAYLIST SUPPORT: Detect if this is a playlist (multiple tracks)
        const isPlaylist = res.tracks.length > 1;
        let chosen = res.tracks[0] as Track | UnresolvedTrack;

        // If a YouTube URL was provided, try to pick the exact video-id match
        const isUrl = /^https?:\/\//i.test(playData.query);
        if (isUrl && !isPlaylist) { // Only for single tracks, not playlists
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

        // PLAYLIST PROCESSING: Get all playlist tracks for later addition
        const playlistTracks = isPlaylist ? res.tracks as (Track | UnresolvedTrack)[] : [];

        if (isPlaylist) {
          logger.info({
            guildId: playData.guildId,
            trackCount: res.tracks.length,
            query: playData.query
          }, 'PLAYLIST: Processing playlist with multiple tracks');
        }
        
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

          // FIXED: Skip player.connected check - it's unreliable in lavalink-client
          // The player.connect() Promise already ensures connection is established
          logger.info({
            guildId: playData.guildId,
            voiceChannelId: player.voiceChannelId
          }, 'audio: playnow - Connection established, proceeding with playback');

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

          // FIXED: Skip player.connected check - it's unreliable in lavalink-client
          // The player.connect() Promise already ensures connection is established
          logger.info({
            guildId: playData.guildId,
            voiceChannelId: player.voiceChannelId
          }, 'audio: play - Connection established, proceeding with playback');

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

          // REMOVED: Automatic playlist track addition
          // Only autoplay should generate queue tracks automatically
          if (isPlaylist && playlistTracks.length > 1) {
            logger.info({
              guildId: playData.guildId,
              playlistSize: playlistTracks.length,
              query: playData.query
            }, 'PLAYLIST: Detected playlist but only playing first track (autoplay will handle queue generation)');
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

          // REMOVED: Automatic playlist track addition
          // Only autoplay should generate queue tracks automatically
          if (isPlaylist && playlistTracks.length > 1) {
            logger.info({
              guildId: playData.guildId,
              playlistSize: playlistTracks.length,
              query: playData.query,
              commandType: data?.type
            }, 'PLAYLIST: Detected playlist but only adding first track (autoplay will handle queue generation)');
          }

          // Calculate the actual position where the track was inserted
          // For playnext (position = 0): track is at index 0, so display position is 1
          // For play (position = undefined): track is at the end, so position is the length
          const actualQueuePosition = isPlayNext ? 1 : player.queue.tracks.length;

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
                    queuePosition: actualQueuePosition,
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
        // ENHANCED FIX: Better no-results handling with specific error message
        logger.warn({
          query: playData.query,
          guildId: playData.guildId,
          searchResponseTime,
          userId: playData.userId
        }, 'SEARCH_NO_RESULTS: No tracks found for query');

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

        // Send helpful error message to Discord
        if (playData.requestId) {
          await redisPub.publish(`discord-bot:response:${playData.requestId}`, JSON.stringify({
            ok: false,
            reason: 'no_results',
            message: `No tracks found for "${playData.query}". Try being more specific or use a different search term.`
          }));
        }

        // Send error notification to Discord gateway for user feedback
        try {
          await redisPub.publish(
            'discord-bot:to-discord',
            JSON.stringify({
              guildId: playData.guildId,
              payload: {
                op: 'search_error',
                query: playData.query,
                message: `No tracks found for "${playData.query}". Try being more specific.`,
                textChannelId: playData.textChannelId,
                requestedBy: playData.userId
              }
            })
          );
        } catch (notificationError) {
          logger.debug({ notificationError }, 'Failed to send no-results notification to Discord');
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

        // SCALABILITY FIX: Clean up all guild-specific Map entries to prevent memory leaks
        cleanupGuildMaps(data.guildId);
      }
      return;
    }
    if (data.type === 'volume') {
      const player = manager.getPlayer(data.guildId);
      if (player) await player.setVolume(Math.max(0, Math.min(200, data.percent)));
      if (player) batchQueueSaver.scheduleUpdate(data.guildId, player);
      // CRITICAL FIX: Trigger immediate UI update to reflect new volume level
      if (player) void pushNowPlaying(player);
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
      // CRITICAL FIX: Trigger immediate UI update to reflect new volume level
      void pushNowPlaying(player);
      return;
    }
    if (data.type === 'nowplaying') {
      const player = manager.getPlayer(data.guildId);
      const current = player?.queue.current;
      type TrackInfoLite = { title?: string; uri?: string; author?: string; duration?: number; isStream?: boolean; artworkUrl?: string };
      const info = current ? ((current as { info?: TrackInfoLite }).info) : undefined;

      if (!info) {
        // Send "no track playing" message to Discord
        await redisPub.publish(
          'discord-bot:to-discord',
          JSON.stringify({
            guildId: data.guildId,
            payload: {
              op: 'ephemeral_message',
              message: 'No track currently playing.',
              textChannelId: data.channelId
            }
          })
        );
        return;
      }

      // Format basic text response for free version
      const formatTime = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const sec = seconds % 60;
        return `${minutes}:${sec.toString().padStart(2, '0')}`;
      };

      const position = player?.position ?? 0;
      const duration = info.duration ?? 0;
      const percentage = duration > 0 ? Math.round((position / duration) * 100) : 0;

      let response = `🎵 **Now Playing**\n`;
      response += `**${info.title}**\n`;
      if (info.author) {
        response += `*by ${info.author}*\n`;
      }
      if (!info.isStream) {
        response += `**${formatTime(position)}** / **${formatTime(duration)}** (${percentage}%)\n`;
      } else {
        response += `**Live Stream**\n`;
      }
      if (player?.paused) {
        response += `Status: **Paused**`;
      } else {
        response += `Status: **Playing**`;
      }

      // Send formatted message to Discord
      await redisPub.publish(
        'discord-bot:to-discord',
        JSON.stringify({
          guildId: data.guildId,
          payload: {
            op: 'ephemeral_message',
            message: response,
            textChannelId: data.channelId
          }
        })
      );
      return;
    }
    if (data.type === 'queue') {
      logger.info({ guildId: data.guildId, requestId: data.requestId, page: data.page }, 'audio: queue command received');

      const player = manager.getPlayer(data.guildId);
      const allTracks = player?.queue.tracks ?? [];

      // Pagination settings
      const page = parseInt(data.page || '1', 10);
      const pageSize = 10;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const totalPages = Math.ceil(allTracks.length / pageSize);

      const items = allTracks.slice(startIndex, endIndex).map((t: { info?: { title?: string; uri?: string } }) => {
        const info = t.info;
        return { title: info?.title ?? 'Unknown', uri: info?.uri };
      });

      const response = {
        items,
        page,
        totalPages,
        totalTracks: allTracks.length
      };
      const responseChannel = `discord-bot:response:${data.requestId}`;

      logger.info({
        guildId: data.guildId,
        requestId: data.requestId,
        responseChannel,
        queueSize: items.length,
        totalTracks: allTracks.length,
        page,
        totalPages,
        hasPlayer: !!player
      }, 'audio: publishing queue response');

      await redisPub.publish(responseChannel, JSON.stringify(response));
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
      logger.info({ guildId: data.guildId, from: data.from, to: data.to }, 'audio: move command received');

      const player = manager.getPlayer(data.guildId);
      if (player) {
        const from = Math.max(1, data.from) - 1;
        const to = Math.max(1, data.to) - 1;
        const track = player.queue.tracks[from];

        logger.info({
          guildId: data.guildId,
          fromIndex: from,
          toIndex: to,
          trackTitle: track?.info?.title,
          queueLength: player.queue.tracks.length
        }, 'audio: executing move operation');

        if (track) {
          player.queue.splice(from, 1);
          await player.queue.add(track, to);
          batchQueueSaver.scheduleUpdate(data.guildId, player);

          logger.info({
            guildId: data.guildId,
            trackTitle: track.info?.title,
            from: data.from,
            to: data.to
          }, 'audio: track moved successfully');
        } else {
          logger.warn({
            guildId: data.guildId,
            from: data.from,
            to: data.to,
            queueLength: player.queue.tracks.length
          }, 'audio: track not found at source position');
        }
      } else {
        logger.warn({ guildId: data.guildId }, 'audio: no player found for move command');
      }
      return;
    }

    // Previous track command - implements the double-tap logic
    if (data.type === 'previous') {
      logger.info({ guildId: data.guildId }, 'audio: previous command received');

      const player = manager.getPlayer(data.guildId);
      if (player && player.queue.current) {
        const now = Date.now();
        const guildKey = `previous_${data.guildId}`;
        const lastPreviousTime = previousTrackTimestamps.get(guildKey) || 0;

        // Check if this is a double-tap (within 3 seconds)
        if (now - lastPreviousTime < 3000) {
          // Double-tap: go to previous track
          const previousTrack = previousTracks.get(data.guildId);
          if (previousTrack) {
            const previousTrackInfo = extractTrackInfo(previousTrack);
            logger.info({
              guildId: data.guildId,
              previousTrackTitle: previousTrackInfo?.title
            }, 'audio: playing previous track (double-tap)');

            // Store current track as the new previous
            if (player.queue.current) {
              previousTracks.set(data.guildId, player.queue.current);
            }

            await player.play({ track: previousTrack });
          } else {
            // No previous track, just restart current
            logger.info({ guildId: data.guildId }, 'audio: no previous track, restarting current');
            await player.seek(0);
          }
        } else {
          // Single tap: restart current track
          logger.info({ guildId: data.guildId }, 'audio: restarting current track (single-tap)');
          await player.seek(0);
        }

        // Update timestamp for double-tap detection
        previousTrackTimestamps.set(guildKey, now);
      } else {
        logger.warn({ guildId: data.guildId }, 'audio: no player or track found for previous command');
      }
      return;
    }

    // Mute/unmute command
    if (data.type === 'mute') {
      logger.info({ guildId: data.guildId }, 'audio: mute command received');

      const player = manager.getPlayer(data.guildId);
      if (player) {
        const currentVolume = player.volume;
        const guildKey = `mute_${data.guildId}`;

        if (mutedVolumes.has(guildKey)) {
          // Unmute: restore previous volume
          const previousVolume = mutedVolumes.get(guildKey) || 100;
          await player.setVolume(previousVolume);
          mutedVolumes.delete(guildKey);

          logger.info({
            guildId: data.guildId,
            restoredVolume: previousVolume
          }, 'audio: unmuted, volume restored');
        } else {
          // Mute: store current volume and set to 0
          mutedVolumes.set(guildKey, currentVolume);
          await player.setVolume(0);

          logger.info({
            guildId: data.guildId,
            storedVolume: currentVolume
          }, 'audio: muted, volume stored');
        }
      } else {
        logger.warn({ guildId: data.guildId }, 'audio: no player found for mute command');
      }
      return;
    }

  } catch (e) {
    // CRITICAL FIX: Simplified error logging with guaranteed information
    const errorMessage = e instanceof Error ? e.message : String(e);
    const errorStack = e instanceof Error ? e.stack : 'No stack trace available';
    const errorName = e instanceof Error ? e.name : 'UnknownError';

    logger.error({
      error: {
        name: errorName,
        message: errorMessage,
        stack: errorStack
      },
      rawError: String(e),
      commandData: data ? {
        type: data.type,
        guildId: ('guildId' in data) ? data.guildId : 'unknown'
      } : null
    }, `COMMAND_PROCESSING_ERROR: ${errorMessage}`);
    try {
      if (data && data.type === 'play') {
        const playData = data as Extract<CommandMessage, { type: 'play' }>;
        if (playData.requestId) {
          await redisPub.publish(
            `discord-bot:response:${playData.requestId}`,
            JSON.stringify({ ok: false, reason: 'error', message: errorMessage || 'unknown' }),
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
    memoryUsage: 87, // Increased from 80 to align with adaptive cache thresholds
    cpuUsage: 75,
  },
  criticalThresholds: {
    responseTime: 8000,
    memoryUsage: 98, // Increased from 95 to align with emergency thresholds
    cpuUsage: 95,    // Increased from 90 for consistency
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
const youtubeErrorMetrics = new Counter({
  name: 'youtube_errors_total',
  help: 'YouTube playback errors by type',
  labelNames: ['errorType', 'retryable'],
  registers: [registry]
});

// Initialize audio metrics with shared registry
const audioMetrics = getAudioMetrics(registry);

manager.on('trackStart', (player, track) => {
  lavalinkEvents.labels('trackStart').inc();
  const info = extractTrackInfo(track);
  logger.info({ guildId: player.guildId, title: info?.title, uri: info?.uri }, 'audio: track start');

  // Store the current track as the new previous track for future use
  // We store each track when it starts playing for the previous track functionality
  const metadata = getPlayerMetadata(player);
  const currentTrackData = metadata.lastTrack ?? null;
  const previousTrackInfo = extractTrackInfo(currentTrackData);
  if (currentTrackData && currentTrackData !== track && isResolvedTrack(currentTrackData)) {
    previousTracks.set(player.guildId, currentTrackData);
    logger.debug({
      guildId: player.guildId,
      previousTrackTitle: previousTrackInfo?.title,
      currentTrackTitle: info?.title
    }, 'audio: stored previous track for double-tap functionality');
  }

  // Store current track for next time
  metadata.lastTrack = track;

  // Track listening analytics for predictive caching
  if (info?.title) {
    // Store track start time for later duration calculation
    metadata.trackStartTime = Date.now();
  }

  // push immediate now-playing snapshot
  void pushNowPlaying(player);
});
manager.on('trackEnd', () => lavalinkEvents.labels('trackEnd').inc());
manager.on('trackError', () => lavalinkEvents.labels('trackError').inc());
// Enhanced track error handler with YouTube error classification and recovery strategies
manager.on('trackError', async (player, track, errorData: TrackExceptionEvent) => {
  const trackInfo = (track as { info?: { title?: string; author?: string; uri?: string } })?.info;
  let retryCount = 0;
  const maxRetries = 2;

  try {
    // Classify the YouTube error to determine root cause and recovery strategy
    const classifiedError = classifyYouTubeError(errorData, trackInfo);

    // Log classified error with structured information
    logClassifiedError(classifiedError, trackInfo, player.guildId);

    // Track error metrics by type and retryability
    youtubeErrorMetrics.labels(classifiedError.type, String(classifiedError.retryable)).inc();

    // Implement recovery strategies based on error type
    switch (classifiedError.type) {
      case YouTubeErrorType.NETWORK_ERROR: {
        // Retry network errors with exponential backoff (max 2 attempts)
        logger.info({
          guildId: player.guildId,
          trackTitle: trackInfo?.title,
          attempt: retryCount + 1,
          maxAttempts: maxRetries
        }, 'Attempting to retry track due to network error');

        while (retryCount < maxRetries) {
          try {
            retryCount++;
            // Wait with exponential backoff: 1s, 2s
            const delayMs = Math.pow(2, retryCount - 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delayMs));

            // Re-queue the current track to retry playback
            if (player.queue.current && track) {
              player.queue.tracks.unshift(track);
              await player.skip();
              await saveQueue(player.guildId, player);
              logger.info({
                guildId: player.guildId,
                trackTitle: trackInfo?.title,
                attempt: retryCount
              }, 'Network error retry succeeded');
              return;
            }
          } catch (retryError) {
            logger.warn({
              guildId: player.guildId,
              trackTitle: trackInfo?.title,
              attempt: retryCount,
              error: retryError instanceof Error ? retryError.message : String(retryError)
            }, `Network error retry attempt ${retryCount} failed`);
          }
        }

        // If retries exhausted, fall through to skip the track
        logger.warn({
          guildId: player.guildId,
          trackTitle: trackInfo?.title,
          maxAttempts: maxRetries
        }, 'Network error retries exhausted, skipping track');
        break;
      }

      case YouTubeErrorType.REQUIRES_LOGIN: {
        // Log warning suggesting poToken configuration for age-restricted content
        logger.warn({
          guildId: player.guildId,
          trackTitle: trackInfo?.title,
          suggestion: 'Configure LAVALINK_YOUTUBE_PO_TOKEN in environment for age-restricted video support'
        }, 'Track requires YouTube authentication');
        break;
      }

      case YouTubeErrorType.REGION_BLOCKED:
      case YouTubeErrorType.UNAVAILABLE: {
        // Skip immediately for permanently blocked content
        logger.info({
          guildId: player.guildId,
          trackTitle: trackInfo?.title,
          errorType: classifiedError.type
        }, 'Skipping permanently unavailable or blocked track');
        break;
      }

      case YouTubeErrorType.AGE_RESTRICTED: {
        // Log info and skip age-restricted content
        logger.info({
          guildId: player.guildId,
          trackTitle: trackInfo?.title
        }, 'Skipping age-restricted track');
        break;
      }

      case YouTubeErrorType.UNKNOWN:
      default: {
        // For unknown errors, just skip the track to prevent stuck playback
        logger.warn({
          guildId: player.guildId,
          trackTitle: trackInfo?.title,
          originalError: classifiedError.originalError?.message
        }, 'Skipping track due to unknown error');
      }
    }

    // Standard recovery: skip to next track or trigger autoplay
    if (player.queue.tracks.length > 0) {
      await player.skip();
      await saveQueue(player.guildId, player);
      return;
    }

    // If no tracks in queue, attempt autoplay as fallback
    if ((player.repeatMode ?? 'off') === 'off' && !(player.playing || player.queue.current)) {
      if (await isAutomixEnabledCached(player.guildId)) {
        try {
          await enqueueAutomix(player, track as { info?: { title?: string; author?: string; uri?: string; duration?: number } });
        } catch (e) {
          logger.error({ e }, 'automix after trackError failed');
        }
      }
    }
  } catch (e) {
    logger.error({
      e,
      guildId: player.guildId,
      trackTitle: trackInfo?.title
    }, 'trackError handler failed');
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

        // Determine overall health status based on component results
        const componentStatuses = Array.from(componentResults.values());
        const unhealthyCount = componentStatuses.filter(c => c.status === 'unhealthy').length;
        const degradedCount = componentStatuses.filter(c => c.status === 'degraded').length;

        let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
        let statusCode = 200;

        if (unhealthyCount > 0) {
          overallStatus = 'unhealthy';
          // For testing purposes, still return 200 unless it's a critical system failure
          // In production, you might want to return 503 for unhealthy components
          statusCode = 200;
        } else if (degradedCount > 0) {
          overallStatus = 'degraded';
          statusCode = 200;
        }

        res.writeHead(statusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          service: 'audio',
          status: overallStatus,
          components: componentStatuses,
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

  // Business metrics endpoint - Returns Prometheus format (MUST come before /metrics)
  if (req.url.startsWith('/metrics/business')) {
    try {
      const prometheusMetrics = await audioMetrics.getPrometheusMetrics();

      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(prometheusMetrics);
    } catch (error) {
      logger.error({ error }, 'Failed to generate business metrics response');
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to generate business metrics' }));
    }
    return;
  }

  // Standard Prometheus metrics endpoint
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

    // Shutdown Redis Streams CommandProcessor
    await commandProcessor.shutdown();

    // Shutdown Redis Streams monitoring
    await audioStreamsMonitoring.shutdown();

    // Stop memory monitoring
    memoryManager.stopMonitoring();

    // Cleanup TTL maps
    autoplayCooldown.destroy();
    lastUiPush.destroy();
    guildTextChannels.destroy();

    // SCALABILITY FIX: Clear all global timers to prevent resource leaks
    logger.info({
      intervalCount: globalTimers.intervals.length,
      timeoutCount: globalTimers.timeouts.length
    }, 'Clearing global timers...');
    globalTimers.intervals.forEach(id => clearInterval(id));
    globalTimers.timeouts.forEach(id => clearTimeout(id));
    globalTimers.intervals = [];
    globalTimers.timeouts = [];

    // CRITICAL FIX: Reject any pending voice connections during shutdown
    for (const [, entry] of pendingPlayerConnections.entries()) {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error('Service shutting down'));
    }
    pendingPlayerConnections.clear();

    // SCALABILITY FIX: Clear all guild-specific Map entries
    logger.info({
      previousTracks: previousTracks.size,
      previousTrackTimestamps: previousTrackTimestamps.size,
      mutedVolumes: mutedVolumes.size,
      activeFilterPresets: activeFilterPresets.size
    }, 'Clearing guild-specific Maps...');
    previousTracks.clear();
    previousTrackTimestamps.clear();
    mutedVolumes.clear();
    activeFilterPresets.clear();

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
import { saveQueue, getQueueCached as _getQueueCached } from './services/database.js';

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
    const config = await prisma.serverConfiguration.findUnique({
      where: { guildId },
      select: { autoplayEnabled: true }
    });
    return !!config?.autoplayEnabled;
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

async function getAutoplayConfigCached(guildId: string): Promise<{ enabled: boolean; mode: 'off' | 'similar' | 'artist' | 'genre' | 'mixed' }> {
  const settings = await prisma.serverConfiguration.findUnique({
    where: { guildId },
    select: { autoplayEnabled: true, autoplayMode: true }
  });
  return {
    enabled: settings?.autoplayEnabled ?? false,
    mode: (settings?.autoplayMode || 'off') as 'off' | 'similar' | 'artist' | 'genre' | 'mixed'
  };
}

async function seedAutoplayTracks(
  player: import('lavalink-client').Player,
  current: { info?: { title?: string; author?: string; uri?: string } },
  mode: 'similar' | 'artist' | 'genre' | 'mixed',
  count: number
) {
  logger.info({
    guildId: player.guildId,
    mode,
    count,
    currentTrack: current.info?.title,
    hasPlayer: !!player,
    hasQueue: !!player.queue
  }, 'Seeding autoplay tracks');

  const searchFn = async (q: string) => {
    const res = await player.search({ query: q }, { id: 'automix' } as { id: string });
    return { tracks: res.tracks as unknown as import('./autoplay').LLTrack[] };
  };

  const baseTrack = current as unknown as import('./autoplay').LLTrack;
  let addedCount = 0;

  try {
    logger.info({ guildId: player.guildId, mode }, `About to call seed function for mode: ${mode}`);
    switch (mode) {
      case 'similar':
        addedCount = await seedRelatedQueue(player as unknown as import('./autoplay').LLPlayer, baseTrack, searchFn, count);
        break;
      case 'artist':
        addedCount = await seedByArtist(player as unknown as import('./autoplay').LLPlayer, baseTrack, searchFn, count);
        break;
      case 'genre':
        addedCount = await seedByGenre(player as unknown as import('./autoplay').LLPlayer, baseTrack, searchFn, count);
        break;
      case 'mixed':
        addedCount = await seedMixed(player as unknown as import('./autoplay').LLPlayer, baseTrack, searchFn, count);
        break;
      default:
        logger.warn({ guildId: player.guildId, mode }, 'Unknown autoplay mode, defaulting to similar');
        addedCount = await seedRelatedQueue(player as unknown as import('./autoplay').LLPlayer, baseTrack, searchFn, count);
    }

    // Trigger database save
    batchQueueSaver.scheduleUpdate(player.guildId, player);

    logger.info({ guildId: player.guildId, mode, requested: count, added: addedCount }, 'Finished seeding autoplay tracks');

    // Track autoplay success metric
    if (addedCount > 0) {
      audioMetrics.trackAutoplayRecommendation(player.guildId, mode, true);
    }
  } catch (error) {
    logger.error({
      error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
      guildId: player.guildId,
      mode
    }, 'Failed to seed autoplay tracks');
    audioMetrics.trackAutoplayRecommendation(player.guildId, mode, false);
  }

  return addedCount;
}

async function enqueueAutomix(player: import('lavalink-client').Player, last: { info?: { title?: string; author?: string; uri?: string; duration?: number } }) {
  const title = (last?.info?.title ?? '').trim();
  const author = (last?.info?.author ?? '').trim();
  const uri = last?.info?.uri ?? '';

  // Get autoplay configuration to respect user's selected mode
  const autoplayConfig = await getAutoplayConfigCached(player.guildId);
  const mode = autoplayConfig.mode === 'off' ? 'similar' : autoplayConfig.mode;

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
    logger.warn({ guildId: player.guildId, title, author, mode }, 'automix: no candidate found');

    // Track failed autoplay recommendation
    audioMetrics.trackAutoplayRecommendation(
      player.guildId,
      mode,
      false // Failed
    );

    return;
  }

  try {
    const info = extractTrackInfo(pick);
    logger.info({ guildId: player.guildId, nextTitle: info?.title, nextUri: info?.uri, mode }, 'automix: picked candidate');

    // Track successful autoplay recommendation
    audioMetrics.trackAutoplayRecommendation(
      player.guildId,
      mode,
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

  // Use seedAutoplayTracks to respect the user's selected autoplay mode
  try {
    const qlen = player.queue.tracks.length;
    if (qlen < 3) {
      const seeded = await seedAutoplayTracks(
        player,
        pick as { info?: { title?: string; author?: string; uri?: string } },
        mode,
        10
      );
      if (seeded > 0) logger.info({ guildId: player.guildId, seeded, mode }, 'automix: refilled tracks using configured mode');
    }
  } catch (e) {
    logger.error({ e, mode }, 'automix: failed to refill tracks');
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
    const trackInfo = extractTrackInfo(track);
    const metadata = getPlayerMetadata(player);
    const startTime = metadata.trackStartTime;
    if (trackInfo?.title && startTime) {
      const listenTime = Date.now() - startTime;
      const skipped = reason === 'REPLACED' || reason === 'STOPPED';
      const duration = trackInfo.duration || 0;

      // Track user listening analytics (use most recent user from player context)
      const lastUserId = metadata.lastUserId ?? 'unknown';
      void predictiveCacheManager.trackUserListening(
        lastUserId,
        player.guildId,
        trackInfo.title,
        duration,
        skipped,
        listenTime
      ).catch(e => logger.debug({ e }, 'Predictive listening tracking failed'));

      // Clear track start time
      metadata.trackStartTime = undefined;
    }

    if (isBlockReason(reason)) { logger.info({ guildId: player.guildId, reason }, 'audio: track end blocked for autoplay'); return; }
    // Pequeña espera para que el estado del player/cola se estabilice
    await delay(900);
    // Cooldown por guild para evitar dobles triggers
    const now = Date.now();
    const last = autoplayCooldown.get(player.guildId) ?? 0;
    if (now - last < 1500) return;
    autoplayCooldown.set(player.guildId, now);
    // No ejecutar autoplay si loop de track está activo (queue loop debe permitir autoplay cuando se acaba la cola)
    if ((player.repeatMode ?? 'off') === 'track') return;
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

    // Enqueue one track to start playing immediately
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
// Increased TTL to 24 hours to prevent UI freeze after 30 minutes
const guildTextChannels = new TTLMap<string, string>({
  maxSize: 300,           // Max 300 guilds
  defaultTTL: 86400000,   // 24 hours TTL (prevents UI freeze)
  cleanupInterval: 300000 // Cleanup every 5 minutes
});

// Track previous tracks for double-tap previous functionality
const previousTracks = new Map<string, Track>();

// Track timestamps for double-tap detection
const previousTrackTimestamps = new Map<string, number>();

// Store muted volumes for each guild
const mutedVolumes = new Map<string, number>();

// CRITICAL FIX: Track pending players waiting for voice credentials
const pendingPlayerConnections = new Map<string, {
  player: import('lavalink-client').Player;
  createdAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}>();

/**
 * SCALABILITY FIX: Centralized cleanup for all guild-specific Map entries
 * This prevents memory leaks when guilds disconnect or bot leaves server
 * @param guildId - The guild ID to clean up
 */
function cleanupGuildMaps(guildId: string): void {
  const deletedCount = {
    previousTracks: previousTracks.delete(guildId) ? 1 : 0,
    previousTrackTimestamps: previousTrackTimestamps.delete(guildId) ? 1 : 0,
    mutedVolumes: mutedVolumes.delete(guildId) ? 1 : 0,
    activeFilterPresets: activeFilterPresets.delete(guildId) ? 1 : 0,
    pendingConnections: pendingPlayerConnections.delete(guildId) ? 1 : 0,
  };

  const totalDeleted = Object.values(deletedCount).reduce((sum, count) => sum + count, 0);

  if (totalDeleted > 0) {
    logger.info({
      guildId,
      deletedEntries: deletedCount,
      totalDeleted,
      remainingMaps: {
        previousTracks: previousTracks.size,
        previousTrackTimestamps: previousTrackTimestamps.size,
        mutedVolumes: mutedVolumes.size,
        activeFilterPresets: activeFilterPresets.size,
        pendingConnections: pendingPlayerConnections.size,
      }
    }, 'MEMORY_CLEANUP: Cleaned up guild-specific Map entries');
  }
}

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
      logger.warn({
        guildId,
        pendingConnections: Array.from(pendingPlayerConnections.keys()),
        totalPending: pendingPlayerConnections.size
      }, 'VOICE_CONNECT: Player connection timed out waiting for credentials');
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
    // CRITICAL FIX: Get stored textChannelId for this guild and renew TTL
    const textChannelId = guildTextChannels.get(guildId);
    // Renew TTL by setting it again if it exists (keeps UI channel alive while playing)
    if (textChannelId) {
      guildTextChannels.set(guildId, textChannelId);
    }

    // Get autoplay state from database
    const autoplayConfig = await getAutoplayConfigCached(guildId);

    const payload: NowPlayingPayload = {
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
      volume: player.volume ?? 100,
      autoplay: autoplayConfig.enabled,
      autoplayMode: autoplayConfig.mode,
      ...(textChannelId ? { textChannelId } : {}),
    };

    const activePresetId = activeFilterPresets.get(guildId) ?? 'flat';
    const activePreset = FILTER_PRESETS[activePresetId] ?? FILTER_PRESETS.flat;
    payload.filter = {
      id: activePreset.id,
      label: activePreset.label,
      description: activePreset.description,
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
    // CRITICAL FIX: Get stored textChannelId for this guild and renew TTL
    const textChannelId = guildTextChannels.get(player.guildId);
    // Renew TTL by setting it again if it exists (keeps UI channel alive)
    if (textChannelId) {
      guildTextChannels.set(player.guildId, textChannelId);
    }

    // Get autoplay state from database
    const autoplayConfig = await getAutoplayConfigCached(player.guildId);

    const payload: NowPlayingPayload = {
      guildId: player.guildId,
      title: 'Nothing playing',
      durationMs: 0,
      positionMs: 0,
      isStream: false,
      paused: false,
      repeatMode: (player.repeatMode ?? 'off') as 'off' | 'track' | 'queue',
      queueLen: player.queue.tracks.length,
      hasTrack: false,
      canSeek: false,
      volume: player.volume ?? 100,
      autoplay: autoplayConfig.enabled,
      autoplayMode: autoplayConfig.mode,
      ...(textChannelId ? { textChannelId } : {}),
    };

    const activePresetId = activeFilterPresets.get(player.guildId) ?? 'flat';
    const activePreset = FILTER_PRESETS[activePresetId] ?? FILTER_PRESETS.flat;
    payload.filter = {
      id: activePreset.id,
      label: activePreset.label,
      description: activePreset.description,
    };
    await redisPub.publish('discord-bot:ui:now', JSON.stringify(payload));
  } catch { /* ignore */ }
}
