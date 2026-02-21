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
  type TrackStuckEvent,
  type LavalinkNode,
} from 'lavalink-client';
// Import config AFTER dotenv has loaded environment variables
import { env } from '@discord-bot/config';
import { logger, HealthChecker, CommonHealthChecks, getAdvancedHealthMonitor, initializeSentry } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import {
  RedisCircuitBreaker,
  type RedisCircuitBreakerConfig,
  safeValidateVoiceCredentials,
  safeValidateVoiceCredentialsMessage,
  type VoiceCredentials,
  type StreamCommandData,
  redisStreams,
  RedisStreamsManager,
  type StreamMessage
} from '@discord-bot/cache';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Counter, Registry, collectDefaultMetrics, Histogram, Gauge } from 'prom-client';
// import { NodeSDK } from '@opentelemetry/sdk-node';
// import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
// import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { isBlockReason, pickAutomixTrack, ensurePlayback, seedRelatedQueue, seedByArtist, seedByGenre, seedMixed } from './autoplay/index.js';
import { guildMutex } from './guildMutex.js';
import { TTLMap } from '@discord-bot/cache';
import { shouldAutomixAfterSkip, shouldSeedOnFirstPlay } from './logic.js';
import { validateCommandMessage } from './validation.js';
import {
  withErrorHandling
} from './errors.js';
import { shouldAttemptPlaybackRecovery, validatePlaybackPreconditions } from './playback/playback-guard.js';
import {
  classifyYouTubeError,
  logClassifiedError,
  YouTubeErrorType
} from './utils/youtube-error-classifier.js';
import { automixCache } from './cache.js';
import { audioCacheManager, featureFlagCache } from './services/cache.js';
import { getAudioMetrics } from './services/metrics.js';
import { predictiveCacheManager } from './services/predictive-cache.js';
import { searchPrewarmer } from './services/search-prewarmer.js';
import { YouTubeTokenSyncService } from './services/youtube-token-sync.js';
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

import { RedisManager } from './infrastructure/redis/redis-manager.js';

// ... imports

const redisManager = new RedisManager();
await redisManager.connect();

const redisPub = redisManager.getPublisher();
logger.info('VOICE_CONNECT: Redis subscriber connected and ready for discord-bot:to-audio messages');

type FilterPresetId =
  | 'flat'
  | 'bassboost'
  | 'nightcore'
  | 'vaporwave'
  | 'karaoke'
  | 'clarity'
  | 'tremolo'
  | 'vibrato'
  | 'surround'
  | 'lowpass'
  | 'distortion';

interface FilterPresetDefinition {
  id: FilterPresetId;
  label: string;
  description: string;
  apply(player: Player): Promise<void>;
}

interface LavalinkFilterPayload {
  volume?: number;
  equalizer?: Array<{ band: number; gain: number }>;
  karaoke?: {
    level?: number;
    monoLevel?: number;
    filterBand?: number;
    filterWidth?: number;
  };
  timescale?: {
    speed?: number;
    pitch?: number;
    rate?: number;
  };
  tremolo?: {
    frequency?: number;
    depth?: number;
  };
  vibrato?: {
    frequency?: number;
    depth?: number;
  };
  rotation?: {
    rotationHz?: number;
  };
  distortion?: {
    sinOffset?: number;
    sinScale?: number;
    cosOffset?: number;
    cosScale?: number;
    tanOffset?: number;
    tanScale?: number;
    offset?: number;
    scale?: number;
  };
  channelMix?: {
    leftToLeft?: number;
    leftToRight?: number;
    rightToLeft?: number;
    rightToRight?: number;
  };
  lowPass?: {
    smoothing?: number;
  };
}

const activeFilterPresets = new Map<string, FilterPresetId>();

async function applyLavalinkFilters(player: Player, filters: LavalinkFilterPayload): Promise<void> {
  const node = player.node as LavalinkNode | undefined;
  if (!node?.sessionId) {
    throw new Error('Lavalink node session is not ready for filter update');
  }

  await node.updatePlayer({
    guildId: player.guildId,
    playerOptions: {
      // Lavalink v4 overrides previously applied filters when filters is provided.
      filters,
    },
  });
}

const NOW_PLAYING_CACHE_PREFIX = 'discord-bot:now-playing:';
const NOW_PLAYING_CACHE_TTL_SECONDS = 30;

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
  voiceChannelId?: string;
  filter?: NowPlayingFilter;
  uri?: string;
  author?: string;
  artworkUrl?: string;
  updatedAt?: number;
  streamable?: boolean;
  source?: string;
  uiPushSource?: 'periodic' | 'control' | 'track_event';
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
      await applyLavalinkFilters(player, {});
    },
  },
  bassboost: {
    id: 'bassboost',
    label: 'Bass Boost',
    description: 'Enhances low frequencies for a punchier mix.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        equalizer: [...BASS_BOOST_BANDS],
      });
    },
  },
  nightcore: {
    id: 'nightcore',
    label: 'Nightcore',
    description: 'Raises tempo and pitch for energetic playback.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        timescale: { speed: 1.25, pitch: 1.12, rate: 1.0 },
      });
    },
  },
  vaporwave: {
    id: 'vaporwave',
    label: 'Vaporwave',
    description: 'Slowed, detuned ambience for chill sessions.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        timescale: { speed: 0.85, pitch: 0.8, rate: 1.0 },
      });
    },
  },
  karaoke: {
    id: 'karaoke',
    label: 'Karaoke',
    description: 'Suppresses lead vocals to highlight instrumentals.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 },
      });
    },
  },
  clarity: {
    id: 'clarity',
    label: 'Studio Clarity',
    description: 'Boosts vocals and highs for crisp detail.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        equalizer: [...CLARITY_BANDS],
      });
    },
  },
  tremolo: {
    id: 'tremolo',
    label: 'Tremolo',
    description: 'Adds rhythmic volume modulation for texture.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        tremolo: { frequency: 4.0, depth: 0.75 },
      });
    },
  },
  vibrato: {
    id: 'vibrato',
    label: 'Vibrato',
    description: 'Adds controlled pitch modulation.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        vibrato: { frequency: 6.0, depth: 0.65 },
      });
    },
  },
  surround: {
    id: 'surround',
    label: '8D Surround',
    description: 'Stereo rotation + channel mix for immersive movement.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        rotation: { rotationHz: 0.22 },
        channelMix: {
          leftToLeft: 0.5,
          leftToRight: 0.5,
          rightToLeft: 0.5,
          rightToRight: 0.5,
        },
      });
    },
  },
  lowpass: {
    id: 'lowpass',
    label: 'Low Pass',
    description: 'Softens highs for a warm, smooth tone.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        lowPass: { smoothing: 20.0 },
      });
    },
  },
  distortion: {
    id: 'distortion',
    label: 'Tube Drive',
    description: 'Subtle harmonic distortion for character.',
    apply: async (player) => {
      await applyLavalinkFilters(player, {
        distortion: {
          sinOffset: 0.0,
          sinScale: 0.9,
          cosOffset: 0.0,
          cosScale: 0.95,
          tanOffset: 0.0,
          tanScale: 0.08,
          offset: 0.0,
          scale: 1.0,
        },
      });
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
    NOWPLAYING_UPDATE_MS: env.NOWPLAYING_UPDATE_MS,
    NOWPLAYING_CONTROL_MIN_INTERVAL_MS: env.NOWPLAYING_CONTROL_MIN_INTERVAL_MS
  }, 'Audio startup config - Redis circuit breaker initialized');
} catch (error) {
  logger.error({ error }, 'CRITICAL: Redis circuit breaker connection failed');
  process.exit(1);
}

logger.info({
  NOWPLAYING_UPDATE_MS: env.NOWPLAYING_UPDATE_MS,
  NOWPLAYING_CONTROL_MIN_INTERVAL_MS: env.NOWPLAYING_CONTROL_MIN_INTERVAL_MS
}, 'Audio startup config');

// Monitoring Service initialization will happen after LavalinkManager is created
import { LavalinkManager } from './infrastructure/lavalink/lavalink-manager.js';
import { MonitoringService } from './infrastructure/monitoring/monitoring-service.js';
import { HealthService } from './infrastructure/health/health-service.js';

const lavalinkManager = new LavalinkManager(redisManager);
const manager = lavalinkManager.library;

export { manager };

const monitoringService = new MonitoringService(lavalinkManager);
await monitoringService.initialize();
const youtubeTokenSyncService = new YouTubeTokenSyncService();

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
import { AutoplayService } from './services/autoplay-service.js';
import { AiDjService } from './services/ai-dj-service.js';
import { LlmService } from './services/llm-service.js';
import { extractTrackInfo, isResolvedTrack, type TrackInfo } from './utils/track.js';

// Initialize audio metrics with shared registry
const audioMetrics = getAudioMetrics(registry);
const llmService = new LlmService();
const autoplayService = new AutoplayService(redisManager, audioMetrics, llmService);
const aiDjService = new AiDjService(llmService);

// --- Real-time push updates to Gateway ---
const lastUiPush = new TTLMap<string, number>({
  maxSize: 300,           // Max 300 guilds
  defaultTTL: 900000,     // 15 minutes TTL
  cleanupInterval: 300000 // Cleanup every 5 minutes
});
const lastPublishedTrackSignature = new TTLMap<string, string>({
  maxSize: 300,
  defaultTTL: 900000,
  cleanupInterval: 300000
});
const minUiInterval = Math.max(1000, env.NOWPLAYING_UPDATE_MS ?? 1000);
const controlUiMinInterval = Math.max(100, env.NOWPLAYING_CONTROL_MIN_INTERVAL_MS ?? 200);

// CRITICAL FIX: Store textChannelId for each guild to send UI updates to correct channel
// Increased TTL to 24 hours to prevent UI freeze after 30 minutes
const TEXT_CHANNEL_FALLBACK = '__default';

const guildTextChannels = new TTLMap<string, string>({
  maxSize: 1000,
  defaultTTL: 86400000,
  cleanupInterval: 300000
});

const textChannelMapKey = (guildId: string, voiceChannelId?: string | null): string =>
  `${guildId}:${voiceChannelId ?? TEXT_CHANNEL_FALLBACK}`;

function rememberTextChannelMapping(guildId: string, textChannelId: string, voiceChannelId?: string | null): void {
  guildTextChannels.set(textChannelMapKey(guildId, voiceChannelId), textChannelId);
  guildTextChannels.set(textChannelMapKey(guildId, null), textChannelId);
}

function resolveTextChannelForGuild(guildId: string, voiceChannelId?: string | null): string | undefined {
  return guildTextChannels.get(textChannelMapKey(guildId, voiceChannelId)) ??
    guildTextChannels.get(textChannelMapKey(guildId, null));
}

// Track previous tracks for double-tap previous functionality
const previousTracks = new Map<string, Track>();

// Track timestamps for double-tap detection
const previousTrackTimestamps = new Map<string, number>();

// Store muted volumes for each guild
const mutedVolumes = new Map<string, number>();

// Track when guild became idle (queue empty, no current) for persistentConnection logic
const idleSinceMs = new Map<string, number>();
const IDLE_DISCONNECT_THRESHOLD_MS = 300_000; // 5 min
const IDLE_CHECK_INTERVAL_MS = 120_000; // 2 min

// Playback watchdog: detect orphaned players where trackEnd was never emitted
const trackExpectedEndMs = new Map<string, number>();
const watchdogPositionSnapshot = new Map<string, { lastPositionMs: number; stagnantChecks: number }>();
const WATCHDOG_CHECK_INTERVAL_MS = 15_000; // check every 15s
const WATCHDOG_GRACE_PERIOD_MS = 30_000;   // 30s grace after expected end
const WATCHDOG_MIN_STAGNANT_CHECKS = 4;

async function applyMuteToggle(
  player: import('lavalink-client').Player,
  guildId: string,
): Promise<{ volume: number; muted: boolean }> {
  const currentVolume = player.volume ?? 100;
  let targetVolume = 0;

  if (currentVolume > 0) {
    mutedVolumes.set(guildId, currentVolume);
    targetVolume = 0;
  } else {
    targetVolume = mutedVolumes.get(guildId) ?? 100;
    mutedVolumes.delete(guildId);
  }

  // Optimistic UI first to keep button/state feedback under 1s even if Lavalink setVolume is slower.
  void pushNowPlaying(player, true, { volume: targetVolume }, 'control');
  const startedAt = Date.now();
  try {
    await player.setVolume(targetVolume);
  } catch (error) {
    // Roll back optimistic UI if Lavalink rejects the volume update.
    void pushNowPlaying(player, true, { volume: currentVolume }, 'control');
    throw error;
  }

  logger.debug({
    guildId,
    mute_set_volume_latency_ms: Date.now() - startedAt,
    fromVolume: currentVolume,
    toVolume: targetVolume
  }, 'audio: mute volume update applied');

  return { volume: targetVolume, muted: targetVolume === 0 };
}

// CRITICAL FIX: Track pending players waiting for voice credentials
const pendingPlayerConnections = new Map<string, {
  player: import('lavalink-client').Player;
  createdAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  promise: Promise<void>;
}>();

// Cache last known voice credentials to avoid reconnect waits on subsequent commands
const lastVoiceCredentials = new Map<string, {
  sessionId?: string;
  token?: string;
  endpoint?: string;
  updatedAt: number;
}>();

// Avoid repeated voice re-sync bursts that can introduce audible glitches.
const lastVoiceSyncState = new Map<string, {
  signature: string;
  syncedAt: number;
}>();
const voiceSyncInFlight = new Set<string>();

type GlitchIndicator = 'player_resync' | 'voice_reconnect_attempt' | 'track_interruption';
const playbackGlitchIndicators = new Map<string, {
  playerResyncCount: number;
  voiceReconnectAttempts: number;
  trackInterruptionMarkers: number;
  updatedAt: number;
}>();
let playbackCriticalModeUntil = 0;

type PlaybackFailureCode = 'voice_credentials_missing' | 'node_inactive' | 'transport_not_ready';

class PlaybackRecoveryError extends Error {
  constructor(
    message: string,
    public readonly code: PlaybackFailureCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PlaybackRecoveryError';
  }
}

function hasCompleteVoiceCredentials(guildId: string): boolean {
  const credentials = lastVoiceCredentials.get(guildId);
  return !!(credentials?.sessionId && credentials.token && credentials.endpoint);
}

function emitPlaybackStateTransition(
  guildId: string,
  requestId: string | undefined,
  from: string,
  to: string,
  details: Record<string, unknown> = {}
): void {
  const isRollback = from === 'recovering' && to === 'idle';
  if (to === 'playing') {
    enterPlaybackCriticalMode();
  }
  logger.info({
    signal: 'playback_state_transition',
    guildId,
    requestId,
    from,
    to,
    rollback: isRollback,
    ...details,
  }, 'Playback state transition');

  if (isRollback) {
    logger.error({
      signal: 'playback_state_rollback',
      guildId,
      requestId,
      from,
      to,
      ...details,
    }, 'Playback rollback detected after recovery');
  }
}

function emitVoiceTransportReady(
  guildId: string,
  requestId: string | undefined,
  ready: boolean,
  details: Record<string, unknown> = {}
): void {
  logger.info({
    signal: 'voice_transport_ready',
    guildId,
    requestId,
    ready,
    ...details,
  }, 'Voice transport readiness');
}

function publishUiPushResult(
  guildId: string,
  requestId: string | undefined,
  success: boolean,
  details: Record<string, unknown> = {}
): void {
  const payload = {
    signal: 'ui_push_success',
    guildId,
    requestId,
    success,
    ...details,
  };
  const source = String(details.ui_push_source ?? 'periodic');
  if (success && source === 'periodic') {
    logger.debug(payload, 'UI push result');
    return;
  }
  if (success) {
    logger.info(payload, 'UI push result');
    return;
  }
  logger.warn(payload, 'UI push result');
}

function recordGlitchIndicator(
  guildId: string,
  indicator: GlitchIndicator,
  details: Record<string, unknown> = {}
): void {
  const current = playbackGlitchIndicators.get(guildId) ?? {
    playerResyncCount: 0,
    voiceReconnectAttempts: 0,
    trackInterruptionMarkers: 0,
    updatedAt: 0,
  };

  if (indicator === 'player_resync') current.playerResyncCount += 1;
  if (indicator === 'voice_reconnect_attempt') current.voiceReconnectAttempts += 1;
  if (indicator === 'track_interruption') current.trackInterruptionMarkers += 1;
  current.updatedAt = Date.now();
  playbackGlitchIndicators.set(guildId, current);

  logger.warn({
    signal: 'playback_glitch_indicator',
    guildId,
    indicator,
    playerResyncCount: current.playerResyncCount,
    voiceReconnectAttempts: current.voiceReconnectAttempts,
    trackInterruptionMarkers: current.trackInterruptionMarkers,
    ...details,
  }, 'Playback glitch indicator updated');

  if (indicator === 'track_interruption') {
    logger.warn({
      signal: 'track_interruption_marker',
      guildId,
      trackInterruptionMarkers: current.trackInterruptionMarkers,
      ...details,
    }, 'Track interruption marker emitted');
  }
}

function enterPlaybackCriticalMode(durationMs = 30_000): void {
  playbackCriticalModeUntil = Math.max(playbackCriticalModeUntil, Date.now() + durationMs);
}

function isPlaybackCriticalMode(): boolean {
  return Date.now() < playbackCriticalModeUntil;
}

/**
 * SCALABILITY FIX: Centralized cleanup for all guild-specific Map entries
 * This prevents memory leaks when guilds disconnect or bot leaves server
 * @param guildId - The guild ID to clean up
 */
function cleanupGuildMaps(guildId: string): void {
  const deletedCount = {
    idleSinceMs: idleSinceMs.delete(guildId) ? 1 : 0,
    trackExpectedEndMs: trackExpectedEndMs.delete(guildId) ? 1 : 0,
    watchdogPositionSnapshot: watchdogPositionSnapshot.delete(guildId) ? 1 : 0,
    previousTracks: previousTracks.delete(guildId) ? 1 : 0,
    previousTrackTimestamps: previousTrackTimestamps.delete(guildId) ? 1 : 0,
    mutedVolumes: mutedVolumes.delete(guildId) ? 1 : 0,
    activeFilterPresets: activeFilterPresets.delete(guildId) ? 1 : 0,
    pendingConnections: pendingPlayerConnections.delete(guildId) ? 1 : 0,
    voiceSyncState: lastVoiceSyncState.delete(guildId) ? 1 : 0,
    voiceSyncInFlight: voiceSyncInFlight.delete(guildId) ? 1 : 0,
    playbackGuardStallCount: playbackGuardStallCount.delete(guildId) ? 1 : 0,
    playbackGuardRecoveryCooldown: playbackGuardLastRecoveryAt.delete(guildId) ? 1 : 0,
    playbackGlitchIndicators: playbackGlitchIndicators.delete(guildId) ? 1 : 0,
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
        voiceSyncState: lastVoiceSyncState.size,
        voiceSyncInFlight: voiceSyncInFlight.size,
        playbackGuardStallCount: playbackGuardStallCount.size,
        playbackGuardRecoveryCooldown: playbackGuardLastRecoveryAt.size,
        playbackGlitchIndicators: playbackGlitchIndicators.size,
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

    // If we already have fresh credentials, try to connect immediately
    const cached = lastVoiceCredentials.get(guildId);
    if (cached?.sessionId && cached.token && cached.endpoint) {
      const ageMs = Date.now() - cached.updatedAt;
      if (ageMs < 120000) {
        try {
          player.voice.sessionId = cached.sessionId;
          player.voice.token = cached.token;
          player.voice.endpoint = cached.endpoint;
          void player.connect().then(async () => {
            try {
              await syncVoiceToLavalink(player, {
                sessionId: cached.sessionId!,
                token: cached.token!,
                endpoint: cached.endpoint!,
              }, 'existing');
            } catch (error) {
              logger.warn({
                guildId,
                error: error instanceof Error ? error.message : String(error)
              }, 'VOICE_CONNECT: syncVoiceToLavalink failed for cached credentials');
            }

            logger.info({ guildId }, 'VOICE_CONNECT: Connected using cached voice credentials');
            resolve();
          }).catch((error) => {
            logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, 'VOICE_CONNECT: Cached credential connect failed, waiting for fresh credentials');
          });
          return;
        } catch (error) {
          logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, 'VOICE_CONNECT: Failed to apply cached credentials, waiting for fresh credentials');
        }
      }
    }

    const existing = pendingPlayerConnections.get(guildId);
    if (existing) {
      logger.info({ guildId }, 'VOICE_CONNECT: Pending connection already exists, waiting for it');
      existing.promise.then(resolve).catch(reject);
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

    let resolvePromise: () => void;
    let rejectPromise: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolvePromise = res;
      rejectPromise = rej;
    });

    // Set up pending connection entry
    const entry = {
      player,
      createdAt: Date.now(),
      resolve: () => {
        clearTimeout(timeoutId);
        resolvePromise();
        resolve();
      },
      reject: (error: Error) => {
        clearTimeout(timeoutId);
        rejectPromise(error);
        reject(error);
      },
      timeoutId,
      promise
    };

    pendingPlayerConnections.set(guildId, entry);
    logger.info({ guildId }, 'VOICE_CONNECT: Player registered for pending voice connection');
  });
}

async function syncVoiceToLavalink(
  player: import('lavalink-client').Player,
  voice: { sessionId: string; token: string; endpoint: string },
  source: 'pending' | 'existing' | 'guard'
): Promise<void> {
  if (voiceSyncInFlight.has(player.guildId)) {
    logger.debug({
      guildId: player.guildId,
      source,
    }, 'VOICE_CONNECT: Skipping voice sync because another sync is already in-flight');
    return;
  }
  voiceSyncInFlight.add(player.guildId);
  try {
  const signature = `${voice.sessionId}:${voice.token}:${voice.endpoint}`;
  const previous = lastVoiceSyncState.get(player.guildId);
  const duplicateSignature = Boolean(previous && previous.signature === signature);
  const stablePlayback = player.playing && !player.paused && player.connected;
  const recentlySynced = Boolean(previous && (Date.now() - previous.syncedAt) < EXISTING_SYNC_COOLDOWN_MS);
  if (source === 'existing' && stablePlayback && recentlySynced) {
    logger.debug({
      guildId: player.guildId,
      source,
      syncedAt: previous?.syncedAt,
      cooldownMs: EXISTING_SYNC_COOLDOWN_MS,
    }, 'VOICE_CONNECT: Skipping existing-player voice sync during stable playback cooldown');
    return;
  }
  if (duplicateSignature && stablePlayback) {
    logger.debug({
      guildId: player.guildId,
      source,
      syncedAt: previous?.syncedAt,
      duplicateSignature,
    }, 'VOICE_CONNECT: Skipping redundant voice sync for stable playback');
    return;
  }

  const node = player.node as LavalinkNode | undefined;
  if (!node?.sessionId) {
    logger.warn({
      guildId: player.guildId,
      nodeId: node?.id,
      source,
    }, 'VOICE_CONNECT: Skipping voice sync to Lavalink because node session is not ready');
    return;
  }

  await node.updatePlayer({
    guildId: player.guildId,
    playerOptions: {
      voice: {
        token: voice.token,
        endpoint: voice.endpoint,
        sessionId: voice.sessionId,
      },
    },
  });

  logger.info({
    guildId: player.guildId,
    nodeId: node.id,
    source,
  }, 'VOICE_CONNECT: Forced voice sync to Lavalink via updatePlayer');

  recordGlitchIndicator(player.guildId, 'player_resync', {
    source,
    nodeId: node.id,
    stablePlayback,
  });

  lastVoiceSyncState.set(player.guildId, {
    signature,
    syncedAt: Date.now(),
  });
  } finally {
    voiceSyncInFlight.delete(player.guildId);
  }
}

async function validatePlaybackOrRecover(
  player: import('lavalink-client').Player,
  requestId?: string
): Promise<void> {
  const guildId = player.guildId;
  const node = player.node as LavalinkNode | undefined;
  const hasNode = !!node;
  const hasCreds = hasCompleteVoiceCredentials(guildId);
  const precondition = validatePlaybackPreconditions({
    hasNode,
    hasVoiceCredentials: hasCreds,
  });

  emitVoiceTransportReady(guildId, requestId, hasCreds, {
    hasNode,
    nodeId: node?.id,
    connected: player.connected,
    voiceChannelId: player.voiceChannelId,
  });

  if (!precondition.ok && precondition.reason === 'node_inactive') {
    throw new PlaybackRecoveryError('No active Lavalink node assigned to player', 'node_inactive', {
      guildId,
    });
  }

  if (!precondition.ok && precondition.reason === 'voice_credentials_missing') {
    throw new PlaybackRecoveryError('Missing Discord voice credentials', 'voice_credentials_missing', {
      guildId,
    });
  }

  await delay(1200);
  const initialStats = await lavalinkManager.fetchStats();
  if (!shouldAttemptPlaybackRecovery({
    isPlaying: player.playing,
    playingPlayers: initialStats?.playingPlayers,
  })) {
    emitPlaybackStateTransition(guildId, requestId, 'connecting', 'playing', {
      recovered: false,
      position: player.position,
      playingPlayers: initialStats?.playingPlayers,
    });
    void runPlaybackProgressGuard(player, requestId);
    return;
  }

  const statsBeforeRecovery = initialStats;
  logger.warn({
    guildId,
    requestId,
    position: player.position,
    statsBeforeRecovery,
    queueLength: player.queue.tracks.length,
  }, 'audio: playback not active after play(), attempting single recovery');

  if (player.playing && !player.paused && (statsBeforeRecovery?.playingPlayers ?? 0) > 0) {
    logger.info({
      guildId,
      requestId,
      playingPlayers: statsBeforeRecovery?.playingPlayers,
    }, 'audio: recovery skipped because playback recovered before reconnect stage');
    return;
  }

  try {
    await waitForVoiceCredentials(player);
  } catch (error) {
    logger.warn({
      guildId,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }, 'audio: waitForVoiceCredentials failed during recovery');
  }

  try {
    recordGlitchIndicator(guildId, 'voice_reconnect_attempt', {
      requestId,
      source: 'validatePlaybackOrRecover',
    });
    await player.connect();
  } catch (error) {
    logger.warn({
      guildId,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }, 'audio: player.connect failed during recovery');
  }

  if (!player.playing) {
    await player.play();
  }

  await delay(1500);
  if (player.playing) {
    emitPlaybackStateTransition(guildId, requestId, 'recovering', 'playing', {
      recovered: true,
      position: player.position,
    });
    void runPlaybackProgressGuard(player, requestId);
    return;
  }

  const statsAfterRecovery = await lavalinkManager.fetchStats();
  emitPlaybackStateTransition(guildId, requestId, 'recovering', 'idle', {
    source: 'validatePlaybackOrRecover',
    statsBeforeRecovery,
    statsAfterRecovery,
  });
  throw new PlaybackRecoveryError('Playback remained inactive after one recovery attempt', 'transport_not_ready', {
    guildId,
    queueLength: player.queue.tracks.length,
    statsBeforeRecovery,
    statsAfterRecovery,
  });
}

const PLAYBACK_GUARD_START_DELAY_MS = 10000;
const PLAYBACK_GUARD_SAMPLE_WINDOW_MS = 5000;
const PLAYBACK_GUARD_MIN_ADVANCE_MS = 2200;
const PLAYBACK_GUARD_MIN_STALL_SAMPLES = 6;
const PLAYBACK_GUARD_RECOVERY_COOLDOWN_MS = 60_000;
const EXISTING_SYNC_COOLDOWN_MS = 90_000;
const playbackGuardStallCount = new Map<string, number>();
const playbackGuardLastRecoveryAt = new Map<string, number>();

async function runPlaybackProgressGuard(
  player: import('lavalink-client').Player,
  requestId?: string
): Promise<void> {
  const guildId = player.guildId;

  await delay(PLAYBACK_GUARD_START_DELAY_MS);
  if (!player.queue.current || player.paused) return;

  const startPosition = player.position ?? 0;
  await delay(PLAYBACK_GUARD_SAMPLE_WINDOW_MS);
  const endPosition = player.position ?? 0;
  const advancedMs = Math.max(0, endPosition - startPosition);
  const stats = await lavalinkManager.fetchStats();
  const isAdvancing = advancedMs >= PLAYBACK_GUARD_MIN_ADVANCE_MS;
  const statsAvailable = typeof stats?.playingPlayers === 'number';
  const hasActivePlayback = statsAvailable && (stats?.playingPlayers ?? 0) > 0;
  const shouldTrustPlayerStateWithoutStats = player.playing && !player.paused && !statsAvailable;

  if (isAdvancing || hasActivePlayback || shouldTrustPlayerStateWithoutStats) {
    playbackGuardStallCount.set(guildId, 0);
    logger.debug({
      guildId,
      requestId,
      startPosition,
      endPosition,
      advancedMs,
      playingPlayers: stats?.playingPlayers,
      statsAvailable,
      trustedPlayerState: shouldTrustPlayerStateWithoutStats,
    }, 'audio: playback progress guard passed');
    return;
  }

  const stallCount = (playbackGuardStallCount.get(guildId) ?? 0) + 1;
  playbackGuardStallCount.set(guildId, stallCount);
  if (stallCount < PLAYBACK_GUARD_MIN_STALL_SAMPLES) {
    logger.warn({
      guildId,
      requestId,
      stallCount,
      required: PLAYBACK_GUARD_MIN_STALL_SAMPLES,
      startPosition,
      endPosition,
      advancedMs,
      playingPlayers: stats?.playingPlayers,
    }, 'audio: playback guard detected transient stall, waiting before recovery');
    return;
  }

  logger.warn({
    guildId,
    requestId,
    stallCount,
    startPosition,
    endPosition,
    advancedMs,
    playingPlayers: stats?.playingPlayers,
    playerPlaying: player.playing,
    playerPaused: player.paused,
  }, 'audio: playback stalled after initial start, attempting guarded recovery');

  const now = Date.now();
  const lastRecoveryAt = playbackGuardLastRecoveryAt.get(guildId) ?? 0;
  if (now - lastRecoveryAt < PLAYBACK_GUARD_RECOVERY_COOLDOWN_MS) {
    logger.warn({
      guildId,
      requestId,
      cooldownMsRemaining: PLAYBACK_GUARD_RECOVERY_COOLDOWN_MS - (now - lastRecoveryAt),
    }, 'audio: skipping guarded recovery due to cooldown');
    return;
  }
  playbackGuardLastRecoveryAt.set(guildId, now);

  try {
    await waitForVoiceCredentials(player);
  } catch (error) {
    logger.warn({
      guildId,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }, 'audio: playback guard waitForVoiceCredentials failed');
  }

  try {
    recordGlitchIndicator(guildId, 'voice_reconnect_attempt', {
      requestId,
      source: 'playbackProgressGuard',
    });
    await player.connect();
  } catch (error) {
    logger.warn({
      guildId,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }, 'audio: playback guard player.connect failed');
  }

  const credentials = lastVoiceCredentials.get(guildId);
  if (credentials?.sessionId && credentials.token && credentials.endpoint) {
    try {
      await syncVoiceToLavalink(player, {
        sessionId: credentials.sessionId,
        token: credentials.token,
        endpoint: credentials.endpoint,
      }, 'guard');
    } catch (error) {
      logger.warn({
        guildId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }, 'audio: playback guard syncVoiceToLavalink failed');
    }
  }

  if (!player.playing && player.queue.current) {
    try {
      await player.play();
    } catch (error) {
      logger.warn({
        guildId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }, 'audio: playback guard player.play failed');
    }
  }

  await delay(1500);
  const finalStats = await lavalinkManager.fetchStats();
  emitPlaybackStateTransition(guildId, requestId, 'recovering', player.playing ? 'playing' : 'idle', {
    source: 'playback_progress_guard',
    position: player.position,
    playingPlayers: finalStats?.playingPlayers,
  });
}

const healthService = new HealthService(
  lavalinkManager,
  redisManager,
  monitoringService,
  audioMetrics,
  registry,
  autoplayService.getCooldownMap(),
  lastUiPush
);
await healthService.initialize();

await lavalinkManager.initialize();
youtubeTokenSyncService.start();

// Idle disconnect for non-persistent guilds (24/7: persistentConnection=true skips)
setInterval(async () => {
  const now = Date.now();
  for (const [guildId, idleAt] of idleSinceMs) {
    if (now - idleAt < IDLE_DISCONNECT_THRESHOLD_MS) continue;
    const player = manager.getPlayer(guildId);
    if (!player || player.playing || player.queue.current || player.queue.tracks.length > 0) {
      idleSinceMs.delete(guildId);
      continue;
    }
    try {
      const config = await prisma.serverConfiguration.findUnique({
        where: { guildId },
        select: { persistentConnection: true }
      });
      if (config?.persistentConnection) continue; // 24/7: do not disconnect
      idleSinceMs.delete(guildId);
      await redisPub.publish('discord-bot:to-discord', JSON.stringify({
        guildId,
        payload: { op: 'leave_voice' }
      }));
      await player.destroy();
      logger.info({ guildId, idleMs: now - idleAt }, 'audio: idle disconnect (non-persistent)');
    } catch (e) {
      logger.warn({ guildId, error: e }, 'audio: idle disconnect check failed');
    }
  }
}, IDLE_CHECK_INTERVAL_MS);
logger.info('Idle disconnect checker started (persistentConnection guilds exempt)');

// Playback watchdog: detect orphaned players where trackEnd was never received
setInterval(async () => {
  const now = Date.now();
  for (const [guildId, expectedEnd] of trackExpectedEndMs) {
    if (now < expectedEnd) continue;

    const player = manager.getPlayer(guildId);
    if (!player) {
      trackExpectedEndMs.delete(guildId);
      watchdogPositionSnapshot.delete(guildId);
      continue;
    }

    // Double-check: is Lavalink actually still reporting this player as playing?
    const position = player.position ?? 0;
    const duration = player.queue.current
      ? (extractTrackInfo(player.queue.current)?.duration ?? 0)
      : 0;
    if (!player.queue.current || duration <= 0) {
      trackExpectedEndMs.delete(guildId);
      watchdogPositionSnapshot.delete(guildId);
      continue;
    }

    const snapshot = watchdogPositionSnapshot.get(guildId) ?? { lastPositionMs: 0, stagnantChecks: 0 };
    const advancing = position > (snapshot.lastPositionMs + 750);
    if (advancing || player.paused) {
      watchdogPositionSnapshot.set(guildId, { lastPositionMs: position, stagnantChecks: 0 });
      if (duration > 0 && position < duration - 5000) {
        trackExpectedEndMs.set(guildId, now + (duration - position) + WATCHDOG_GRACE_PERIOD_MS);
      } else {
        trackExpectedEndMs.set(guildId, now + WATCHDOG_GRACE_PERIOD_MS);
      }
      continue;
    }

    const stagnantChecks = snapshot.stagnantChecks + 1;
    watchdogPositionSnapshot.set(guildId, { lastPositionMs: position, stagnantChecks });
    if (stagnantChecks < WATCHDOG_MIN_STAGNANT_CHECKS) {
      trackExpectedEndMs.set(guildId, now + WATCHDOG_GRACE_PERIOD_MS);
      continue;
    }

    trackExpectedEndMs.delete(guildId);
    watchdogPositionSnapshot.delete(guildId);
    const overdueMs = now - expectedEnd + WATCHDOG_GRACE_PERIOD_MS;
    logger.warn({
      guildId,
      overdueMs,
      position,
      duration,
      playerPlaying: player.playing,
      hasCurrent: !!player.queue.current,
      queueLen: player.queue.tracks.length,
      stagnantChecks,
    }, 'audio: watchdog detected orphaned player (trackEnd never received)');

    try {
      // If there are more tracks in the queue, try to skip to next
      if (player.queue.tracks.length > 0) {
        logger.info({ guildId, queueLen: player.queue.tracks.length }, 'audio: watchdog forcing skip to next track');
        await player.skip();
        await saveQueue(guildId, player);
      } else {
        // No tracks left - stop player and trigger autoplay if enabled
        logger.info({ guildId }, 'audio: watchdog stopping orphaned player (empty queue)');
        await player.stopPlaying(true, false);

        // Mark as idle for persistentConnection logic
        if (!idleSinceMs.has(guildId)) idleSinceMs.set(guildId, Date.now());

        // Trigger autoplay if enabled
        if (await autoplayService.isAutomixEnabledCached(guildId)) {
          try {
            const lastTrack = player.queue.previous?.[0] ?? null;
            await autoplayService.enqueueAutomix(player, lastTrack as { info?: { title?: string; author?: string; uri?: string } });
          } catch (e) {
            logger.error({ e, guildId }, 'audio: watchdog autoplay recovery failed');
          }
        } else {
          // Push idle UI state
          void pushNowPlaying(player, true, { paused: false, positionMs: 0 }).catch(() => {});
        }
      }
    } catch (e) {
      logger.error({ e, guildId }, 'audio: watchdog recovery action failed');
    }
  }
}, WATCHDOG_CHECK_INTERVAL_MS);
logger.info('Playback watchdog started (detects orphaned players without trackEnd)');

// Ensure at least one node connect event (best-effort)
await new Promise<void>((resolve) => {
  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 3000);
  manager.nodeManager.once('connect', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
});

// Initialize search prewarmer after manager is ready
searchPrewarmer.initialize(manager);
logger.info('Search performance optimizations initialized');

type StreamPlayCommand = StreamCommandData & {
  type: 'play' | 'playnow' | 'playnext';
  voiceChannelId: string;
  textChannelId: string;
  userId: string;
  query: string;
};

async function forwardStreamPlayCommand(data: StreamPlayCommand) {
  const payload = {
    type: data.type,
    guildId: data.guildId,
    voiceChannelId: data.voiceChannelId,
    textChannelId: data.textChannelId,
    userId: data.userId,
    query: data.query,
    requestId: data.requestId
  };

  const publishResult = await redisPub.publish('discord-bot:commands', JSON.stringify(payload));
  if (publishResult === 0) {
    throw new Error('No subscribers available for play command');
  }

  return { forwarded: true };
}

// Register Redis Streams command handlers
try {
  (['play', 'playnow', 'playnext'] as const).forEach((playType) => {
    commandProcessor.registerHandler(playType, async (data) => {
      logger.info({ guildId: data.guildId, type: playType, requestId: data.requestId }, 'audio: play command received via Redis Streams, forwarding to play pipeline');
      return forwardStreamPlayCommand(data as StreamPlayCommand);
    });
  });

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

    const history = (player?.queue.previous ?? [])
      .slice(-10)
      .reverse()
      .map((t: { info?: { title?: string; uri?: string } }) => ({
        title: t.info?.title ?? 'Unknown',
        uri: t.info?.uri
      }));

    const current = player?.queue.current
      ? {
          title: player.queue.current.info?.title ?? 'Unknown',
          uri: player.queue.current.info?.uri
        }
      : null;

    const response = {
      items,
      history,
      current,
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
    void pushNowPlaying(player, true, { volume: newVol });

    logger.info({ guildId: data.guildId, oldVolume: player.volume, newVolume: newVol }, 'Volume adjusted');
    return { success: true, volume: newVol };
  });

  // Toggle mute handler
  commandProcessor.registerHandler('toggleMute', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: toggleMute command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };
    const result = await applyMuteToggle(player, data.guildId);
    logger.info({ guildId: data.guildId, volume: result.volume, muted: result.muted }, 'audio: toggleMute applied');
    return { success: true, ...result };
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
    void pushNowPlaying(player, true, { paused: player.paused });

    return { success: true, paused: player.paused };
  });

  // Pause handler
  commandProcessor.registerHandler('pause', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: pause command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    await player.pause();
    void pushNowPlaying(player, true, { paused: true });

    return { success: true, paused: true };
  });

  // Resume handler
  commandProcessor.registerHandler('resume', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: resume command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    await player.resume();
    void pushNowPlaying(player, true, { paused: false });

    return { success: true, paused: false };
  });

  // Skip handler
  commandProcessor.registerHandler('skip', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: skip command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    // Check if queue is empty and autoplay is enabled
    if (player.queue.tracks.length === 0) {
      const autoplayConfig = await autoplayService.getAutoplayConfigCached(data.guildId);
      if (autoplayConfig.enabled && autoplayConfig.mode !== 'off') {
        // Trigger autoplay with current track as seed
        const current = player.queue.current;
        if (current) {
          logger.info({ guildId: data.guildId, mode: autoplayConfig.mode }, 'Skip with empty queue - triggering autoplay');
          await autoplayService.enqueueAutomix(player, current as { info?: { title?: string; author?: string; uri?: string; duration?: number } });
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

    // Wait for track change to propagate
    await delay(300);
    // Force reset of progress to avoid stale position carry-over after skip.
    void pushNowPlaying(player, true, { positionMs: 0 });

    return { success: true };
  });

  // Stop handler
  commandProcessor.registerHandler('stop', async (data) => {
    logger.info({ guildId: data.guildId, reason: data.reason }, 'audio: stop command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    // If the stop was triggered by a voice disconnect, we should destroy the player
    // to prevent auto-reconnect loops
    const shouldDestroy = data.reason === 'voice_disconnect';

    if (shouldDestroy) {
      idleSinceMs.delete(data.guildId);
      await player.destroy();
      logger.info({ guildId: data.guildId }, 'Player destroyed due to voice disconnect');
    } else {
      await player.stopPlaying(true, false);
    }

    // Trigger immediate UI update to reflect stopped state
    // Note: If destroyed, this might fail or show empty state, which is fine
    try {
      if (!shouldDestroy) {
        void pushNowPlaying(player, true);
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to push UI update after stop');
    }

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
    void pushNowPlaying(player, true, { repeatMode: newMode });

    return { success: true, mode: newMode };
  });

  // Shuffle handler
  commandProcessor.registerHandler('shuffle', async (data) => {
    logger.info({ guildId: data.guildId }, 'audio: shuffle command received via Redis Streams');

    const player = manager.getPlayer(data.guildId);
    if (!player) return { success: false, error: 'No player found' };

    player.queue.shuffle();

    // Trigger immediate UI update to reflect shuffled queue
    void pushNowPlaying(player, true);

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
    void pushNowPlaying(player, true);

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
    const duration = extractTrackInfo(player.queue.current)?.duration ?? 0;
    if (duration > 0) {
      trackExpectedEndMs.set(data.guildId, Date.now() + Math.max(0, duration - newPosition) + WATCHDOG_GRACE_PERIOD_MS);
      watchdogPositionSnapshot.set(data.guildId, { lastPositionMs: newPosition, stagnantChecks: 0 });
    }

    // Trigger immediate UI update to reflect new position
    void pushNowPlaying(player, true, { positionMs: newPosition });

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
          await autoplayService.seedAutoplayTracks(player, current, nextMode as 'similar' | 'artist' | 'genre' | 'mixed', targetQueueSize);
        }
      } else if (!nextEnabled && nextMode === 'off') {
        // Autoplay disabled, clear queue
        player.queue.tracks.splice(0, player.queue.tracks.length);
        logger.info({ guildId: data.guildId }, 'Cleared queue - autoplay disabled');
      }

      // Trigger immediate UI update to reflect new autoplay mode
      void pushNowPlaying(player, true, {}, 'control');

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
        await autoplayService.seedAutoplayTracks(player, current, settings.autoplayMode as 'similar' | 'artist' | 'genre' | 'mixed', seedAmount);
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

      // Wait for track change to propagate
      await delay(300);
      // Force reset of progress to keep UI deterministic after previous/rewind actions.
      void pushNowPlaying(player, true, { positionMs: 0 });

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
    const result = await applyMuteToggle(player, data.guildId);
    logger.info({ guildId: data.guildId, volume: result.volume, muted: result.muted }, 'audio: mute applied');
    return { success: true, ...result };
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
        const currentPreset = activeFilterPresets.get(guildId);
        if (currentPreset === preset.id) {
          return buildFilterResponse(guildId, true, `${preset.label} is already active.`);
        }

        const startedAt = Date.now();
        await preset.apply(player);
        activeFilterPresets.set(guildId, preset.id);
        void pushNowPlaying(player, true, {}, 'control');
        logger.info({
          guildId,
          preset: preset.id,
          filter_apply_latency_ms: Date.now() - startedAt,
        }, 'audio: filter preset applied');
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

// Start consumers only after handlers are registered to avoid dropping early commands on restart.
try {
  await commandProcessor.initialize();
  logger.info('Redis Streams CommandProcessor initialized successfully');
} catch (error) {
  logger.error({ error }, 'Failed to initialize Redis Streams CommandProcessor');
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
  | { type: 'summon'; guildId: string; voiceChannelId: string; textChannelId: string; requestId?: string }
  | { type: 'filters'; guildId: string; action?: string; preset?: string };




// Handle raw events from Discord via Redis
await redisManager.subscribe('discord-bot:to-audio', async (message) => {
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
await redisManager.subscribe('discord-bot:voice-events', async (message) => {
  try {
    const packet = JSON.parse(message);

    logger.info({
      eventType: packet.t,
      guildId: packet.d?.guild_id,
      hasData: !!packet.d
    }, 'LAVALINK: Received raw Discord gateway event on discord-bot:voice-events');

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

      // CRITICAL FIX: Also update player credentials to resolve waitForVoiceCredentials()
      if (packet.d?.guild_id && packet.d?.token && packet.d?.endpoint) {
        await handleVoiceCredentials(packet.d.guild_id, {
          guildId: packet.d.guild_id,
          token: packet.d.token,
          endpoint: packet.d.endpoint
        });
      }
    } else if (packet.t === 'VOICE_STATE_UPDATE') {
      logger.debug({
        guildId: packet.d?.guild_id,
        userId: packet.d?.user_id,
        hasSessionId: !!packet.d?.session_id
      }, 'LAVALINK: Processed raw VOICE_STATE_UPDATE event via sendRawData()');

      // CRITICAL FIX: Also update player credentials to resolve waitForVoiceCredentials()
      // Gateway now filters this to only send updates for the bot itself
      if (packet.d?.guild_id && packet.d?.session_id) {
        await handleVoiceCredentials(packet.d.guild_id, {
          guildId: packet.d.guild_id,
          sessionId: packet.d.session_id
        });
      }
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

type PartialVoiceCredentials = Pick<VoiceCredentials, 'guildId'> & Partial<Omit<VoiceCredentials, 'guildId'>>;

/**
 * CRITICAL FIX: Unified voice credentials handler
 * Processes voice credentials from Discord and connects pending players
 */
async function handleVoiceCredentials(guildId: string, voiceCredentials: PartialVoiceCredentials): Promise<void> {
  try {
    const cached = lastVoiceCredentials.get(guildId) ?? { updatedAt: 0 };
    const merged = {
      sessionId: voiceCredentials.sessionId ?? cached.sessionId,
      token: voiceCredentials.token ?? cached.token,
      endpoint: voiceCredentials.endpoint ?? cached.endpoint,
      updatedAt: Date.now()
    };
    lastVoiceCredentials.set(guildId, merged);

    const hasAllCredentials = !!(merged.sessionId && merged.token && merged.endpoint);

    logger.debug({
      guildId,
      hasSessionId: !!voiceCredentials?.sessionId,
      hasToken: !!voiceCredentials?.token,
      hasEndpoint: !!voiceCredentials?.endpoint,
      hasPendingPlayer: pendingPlayerConnections.has(guildId)
    }, 'VOICE_CONNECT: Received Discord credentials from Gateway');

    if (!hasAllCredentials) {
      logger.debug({
        guildId,
        hasSessionId: !!merged.sessionId,
        hasToken: !!merged.token,
        hasEndpoint: !!merged.endpoint
      }, 'VOICE_CONNECT: Waiting for remaining voice credentials before connecting');
      return;
    }

    let establishedConnection = false;
    const signature = `${merged.sessionId!}:${merged.token!}:${merged.endpoint!}`;
    const lastSync = lastVoiceSyncState.get(guildId);
    const isDuplicateSignature = !!lastSync && lastSync.signature === signature;

    // CRITICAL FIX: Provide voice credentials to Lavalink manager
    if (voiceCredentials) {
      const pendingEntry = pendingPlayerConnections.get(guildId);
      if (pendingEntry) {
        try {
          logger.info({ guildId }, 'VOICE_CONNECT: Connecting pending player with complete credentials');

          // CRITICAL: Set voice credentials on the player before connecting
          // The player's voice property allows setting sessionId and server data
          pendingEntry.player.voice.sessionId = merged.sessionId!;
          pendingEntry.player.voice.token = merged.token!;
          pendingEntry.player.voice.endpoint = merged.endpoint!;

          recordGlitchIndicator(guildId, 'voice_reconnect_attempt', {
            source: 'pending_voice_credentials',
          });
          await pendingEntry.player.connect();
          await syncVoiceToLavalink(pendingEntry.player, {
            sessionId: merged.sessionId!,
            token: merged.token!,
            endpoint: merged.endpoint!,
          }, 'pending');

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
          establishedConnection = true;

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
        const existingPlayer = manager.getPlayer(guildId);
        if (existingPlayer) {
          try {
            const isPlayerActive = existingPlayer.playing || existingPlayer.paused || !!existingPlayer.queue?.current;
            const transportHealthy = existingPlayer.playing && !existingPlayer.paused && existingPlayer.connected;
            if (isDuplicateSignature && transportHealthy) {
              logger.debug({ guildId }, 'VOICE_CONNECT: Skipping duplicate voice sync for active player');
              logger.info({ guildId }, 'VOICE_CONNECT: Player connection established');
              return;
            }

            existingPlayer.voice.sessionId = merged.sessionId!;
            existingPlayer.voice.token = merged.token!;
            existingPlayer.voice.endpoint = merged.endpoint!;
            if (!isPlayerActive) {
              recordGlitchIndicator(guildId, 'voice_reconnect_attempt', {
                source: 'existing_player_connect',
              });
              await existingPlayer.connect();
            }
            await syncVoiceToLavalink(existingPlayer, {
              sessionId: merged.sessionId!,
              token: merged.token!,
              endpoint: merged.endpoint!,
            }, 'existing');
            logger.info({ guildId }, 'VOICE_CONNECT: Connected existing player with cached credentials');
            establishedConnection = true;
          } catch (error) {
            logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, 'VOICE_CONNECT: Failed to connect existing player with cached credentials');
          }
        } else {
          logger.debug({ guildId }, 'VOICE_CONNECT: No pending player found for this guild');
        }
      }
    }
    if (establishedConnection) {
      logger.info({ guildId }, 'VOICE_CONNECT: Player connection established');
    } else {
      logger.debug({ guildId }, 'VOICE_CONNECT: Credentials merged without additional reconnect');
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

await redisManager.subscribe('discord-bot:commands', withErrorHandling(async (message) => {
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
        const requestId = playData.requestId;
        logger.info({ guildId: playData.guildId, query: playData.query, commandType }, `audio: ${commandType} command received`);
        emitPlaybackStateTransition(playData.guildId, requestId, 'idle', 'connecting', { commandType });

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

        // CRITICAL FIX: Store textChannelId for UI updates (per voice channel)
        rememberTextChannelMapping(playData.guildId, playData.textChannelId, playData.voiceChannelId);

        // CRITICAL FIX: Wait for voice credentials instead of connecting immediately
        try {
          logger.info({ guildId: playData.guildId }, 'VOICE_CONNECT: Waiting for Discord voice credentials...');
          await waitForVoiceCredentials(player);
          logger.info({ guildId: playData.guildId }, 'VOICE_CONNECT: Player connection established');
          emitVoiceTransportReady(playData.guildId, requestId, true, {
            connected: player.connected,
            voiceChannelId: player.voiceChannelId,
          });
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

        if (!hasCompleteVoiceCredentials(playData.guildId)) {
          logger.warn({ guildId: playData.guildId, requestId }, 'audio: missing voice credentials before playback');
          emitVoiceTransportReady(playData.guildId, requestId, false, {
            connected: player.connected,
            voiceChannelId: player.voiceChannelId,
          });
          if (requestId) {
            await redisPub.publish(
              `discord-bot:response:${requestId}`,
              JSON.stringify({
                ok: false,
                reason: 'voice_credentials_missing',
                message: 'Voice credentials not available yet',
              })
            );
          }
          return;
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
              autoplayService.isAutomixEnabledCached(playData.guildId)
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
              await validatePlaybackOrRecover(player, requestId);
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

              if (!isPlaybackCriticalMode()) {
                void trackPlaybackAnalytics(
                  playData.guildId,
                  playData.userId,
                  first as Track,
                  'user_request'
                ).catch(e => logger.debug({ e }, 'Worker analytics tracking failed'));
              } else {
                logger.debug({ guildId: playData.guildId }, 'Skipping non-critical playback analytics in playback-critical mode');
              }
            }

            // Force UI update after playnow
            void (async () => {
              try {
                await delay(500); // Wait for player state to stabilize
                await pushNowPlaying(player, true, {}, 'track_event');
              } catch (e) {
                logger.error({ e }, 'Failed to push playnow UI state');
              }
            })();

          } else if (!player.playing && !player.paused || !player.queue.current) {
            // PLAY/PLAYNEXT: Start playback when idle OR when player state is stale (playing=true but no current track)
            logger.info({
              guildId: playData.guildId,
              playerPlaying: player.playing,
              playerPaused: player.paused,
              hasCurrent: !!player.queue.current,
            }, 'audio: adding track to queue and initiating playback');
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
              await validatePlaybackOrRecover(player, requestId);
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
              if (!isPlaybackCriticalMode()) {
                void trackPlaybackAnalytics(
                  playData.guildId,
                  playData.userId,
                  first as Track,
                  'user_request'
                ).catch(e => logger.debug({ e }, 'Worker analytics tracking failed'));
              } else {
                logger.debug({ guildId: playData.guildId }, 'Skipping non-critical playback analytics in playback-critical mode');
              }
            }

            // Note: Do NOT send track_queued for first track - UI is handled by pushNowPlaying()

            // CRITICAL FIX: Force UI creation after immediate playback
            void (async () => {
              try {
                await delay(800); // Wait for player state to stabilize
                await pushNowPlaying(player, true, {}, 'track_event');
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

            // Fallback queue seeding: when autoplay is OFF and we have search results,
            // add a limited number of remaining tracks so the user gets a queue
            if (!seedOnFirst && isPlaylist && playlistTracks.length > 1) {
              const maxFallbackTracks = 5;
              const fallbackTracks = playlistTracks.slice(1, 1 + maxFallbackTracks);
              if (fallbackTracks.length > 0) {
                for (const t of fallbackTracks) {
                  await player.queue.add(t);
                }
                logger.info({
                  guildId: playData.guildId,
                  added: fallbackTracks.length,
                  available: playlistTracks.length - 1,
                  query: playData.query
                }, 'PLAYLIST: Added search result tracks to queue (autoplay off fallback)');
                batchQueueSaver.scheduleUpdate(playData.guildId, player, playData.voiceChannelId, playData.textChannelId);
              }
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

            // Add remaining search results to queue when autoplay is off
            if (isPlaylist && playlistTracks.length > 1) {
              const maxExtraTracks = 5;
              const extraTracks = playlistTracks.slice(1, 1 + maxExtraTracks);
              if (extraTracks.length > 0) {
                const insertPos = isPlayNext ? 1 : undefined;
                for (const t of extraTracks) {
                  await player.queue.add(t, insertPos);
                }
                logger.info({
                  guildId: playData.guildId,
                  added: extraTracks.length,
                  available: playlistTracks.length - 1,
                  commandType: data?.type
                }, 'PLAYLIST: Added remaining search results to queue');
              }
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
            if (!isPlaybackCriticalMode()) {
              void trackQueueAnalytics(
                playData.guildId,
                playData.userId,
                'add',
                player.queue.tracks.length
              ).catch(e => logger.debug({ e }, 'Worker queue analytics failed'));
            } else {
              logger.debug({ guildId: playData.guildId }, 'Skipping non-critical queue analytics in playback-critical mode');
            }

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
          const enabled = await autoplayService.isAutomixEnabledCached(player.guildId);
          const currentState = {
            repeatMode: (player.repeatMode ?? 'off') as 'off' | 'track' | 'queue',
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

            await autoplayService.enqueueAutomix(player, prev);
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
      if (player) void pushNowPlaying(player, true, {}, 'control');
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
      void pushNowPlaying(player, true, {}, 'control');
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
    if (data.type === 'summon') {
      const summonData = data as Extract<CommandMessage, { type: 'summon' }>;
      const responseChannel = summonData.requestId ? `discord-bot:response:${summonData.requestId}` : null;

      try {
        await guildMutex.run(summonData.guildId, async () => {
          const player = manager.createPlayer({
            guildId: summonData.guildId,
            voiceChannelId: summonData.voiceChannelId,
            textChannelId: summonData.textChannelId,
            volume: 100,
            selfDeaf: true
          });

          rememberTextChannelMapping(summonData.guildId, summonData.textChannelId, summonData.voiceChannelId);
          logger.info({ guildId: summonData.guildId }, 'SUMMON: Waiting for Discord voice credentials...');
          await waitForVoiceCredentials(player);
          await pushIdleState(player);
        });

        if (responseChannel) {
          await redisPub.publish(responseChannel, JSON.stringify({ ok: true }));
        }

        await redisPub.publish(
          'discord-bot:to-discord',
          JSON.stringify({
            guildId: summonData.guildId,
            payload: {
              op: 'ephemeral_message',
              message: '✅ Bot invocado desde el panel premium.',
              textChannelId: summonData.textChannelId
            }
          })
        );
      } catch (error) {
        logger.error({ error, guildId: summonData.guildId }, 'Failed to process summon command');
        if (responseChannel) {
          await redisPub.publish(responseChannel, JSON.stringify({ ok: false, error: 'summon_failed' }));
        }
      }

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
        const result = await applyMuteToggle(player, data.guildId);
        logger.info({
          guildId: data.guildId,
          volume: result.volume,
          muted: result.muted
        }, 'audio: mute applied (legacy command path)');
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
      if (data && (data.type === 'play' || data.type === 'playnow' || data.type === 'playnext')) {
        const playData = data as Extract<CommandMessage, { type: 'play' }>;
        const reason = e instanceof PlaybackRecoveryError ? e.code : 'error';
        if (playData.requestId) {
          await redisPub.publish(
            `discord-bot:response:${playData.requestId}`,
            JSON.stringify({
              ok: false,
              reason,
              message: errorMessage || 'unknown',
              details: e instanceof PlaybackRecoveryError ? e.details : undefined,
            }),
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


manager.on('trackStart', (player, track) => {
  playbackGuardStallCount.set(player.guildId, 0);
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

  // Playback watchdog: record expected end time so we can detect orphaned players
  const duration = info?.duration ?? 0;
  if (duration > 0) {
    trackExpectedEndMs.set(player.guildId, Date.now() + duration + WATCHDOG_GRACE_PERIOD_MS);
    watchdogPositionSnapshot.set(player.guildId, { lastPositionMs: 0, stagnantChecks: 0 });
  } else {
    trackExpectedEndMs.delete(player.guildId);
    watchdogPositionSnapshot.delete(player.guildId);
  }

  // Push immediate now-playing snapshot and reset timeline baseline at track start.
  void pushNowPlaying(player, true, { positionMs: 0, paused: false });
});
manager.on('trackEnd', () => lavalinkEvents.labels('trackEnd').inc());
manager.on('trackError', () => lavalinkEvents.labels('trackError').inc());
// Enhanced track error handler with YouTube error classification and recovery strategies
manager.on('trackError', async (player, track, errorData: TrackExceptionEvent) => {
  const trackInfo = (track as { info?: { title?: string; author?: string; uri?: string } })?.info;
  let retryCount = 0;
  const maxRetries = 2;
  recordGlitchIndicator(player.guildId, 'track_interruption', {
    source: 'trackError',
    trackTitle: trackInfo?.title,
  });

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
      if (await autoplayService.isAutomixEnabledCached(player.guildId)) {
        try {
          await autoplayService.enqueueAutomix(player, track as { info?: { title?: string; author?: string; uri?: string; duration?: number } });
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

// Handle track stuck (e.g., problematic streams, cipher failures) similar to trackError
manager.on('trackStuck', async (player: Player, track: Track | null, payload: TrackStuckEvent) => {
  try {
    const trackInfo = extractTrackInfo(track);
    logger.warn({
      guildId: player.guildId,
      thresholdMs: payload.thresholdMs,
      trackTitle: trackInfo?.title,
      trackUri: trackInfo?.uri,
      position: player.position,
      duration: trackInfo?.duration,
      playerPlaying: player.playing,
      queueLen: player.queue.tracks.length,
    }, 'audio: track stuck detected - attempting recovery');

    // Clear watchdog for this guild since we're handling it here
    trackExpectedEndMs.delete(player.guildId);
    watchdogPositionSnapshot.delete(player.guildId);

    recordGlitchIndicator(player.guildId, 'track_interruption', {
      source: 'trackStuck',
      thresholdMs: payload.thresholdMs,
      trackTitle: trackInfo?.title,
    });

    if (player.queue.tracks.length > 0) {
      logger.info({ guildId: player.guildId, queueLen: player.queue.tracks.length }, 'audio: trackStuck - skipping to next track');
      await player.skip();
      await saveQueue(player.guildId, player);
      return;
    }
    if ((player.repeatMode ?? 'off') === 'off' && !(player.playing || player.queue.current)) {
      if (await autoplayService.isAutomixEnabledCached(player.guildId)) {
        try {
          logger.info({ guildId: player.guildId }, 'audio: trackStuck - triggering autoplay recovery');
          await autoplayService.enqueueAutomix(player, track as { info?: { title?: string; author?: string; uri?: string } });
        } catch (e) { logger.error({ e }, 'automix after trackStuck failed'); }
      } else {
        // No autoplay, stop and push idle state
        logger.info({ guildId: player.guildId }, 'audio: trackStuck - no autoplay, stopping player');
        await player.stopPlaying(true, false);
        if (!idleSinceMs.has(player.guildId)) idleSinceMs.set(player.guildId, Date.now());
        void pushNowPlaying(player, true, { paused: false, positionMs: 0 }).catch(() => {});
      }
    }
  } catch (e) {
    logger.error({ e, guildId: player.guildId }, 'trackStuck handler failed');
  }
});

// Metrics logic for 'discord-bot:commands' is now handled in the main command handler (see line 82).


// Tracing
/*
if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  void sdk.start();
}
*/

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

    // Stop monitoring services
    monitoringService.shutdown();
    youtubeTokenSyncService.stop();

    // Cleanup TTL maps
    autoplayService.getCooldownMap().destroy();
    lastUiPush.destroy();
    lastPublishedTrackSignature.destroy();
    guildTextChannels.destroy();

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
      activeFilterPresets: activeFilterPresets.size,
      playbackGlitchIndicators: playbackGlitchIndicators.size
    }, 'Clearing guild-specific Maps...');
    previousTracks.clear();
    previousTrackTimestamps.clear();
    mutedVolumes.clear();
    activeFilterPresets.clear();
    playbackGlitchIndicators.clear();

    // Cleanup cache system
    await audioCacheManager.flushAllCaches().catch(() => { });

    // Close Worker Service integration
    await closeWorkerIntegration().catch(() => { });

    // Close Redis connections
    await redisManager.disconnect().catch(() => { });

    // Close health service
    healthService.shutdown();

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


manager.on('trackEnd', async (player, track, payload?: unknown) => {
  try {
    // Clear watchdog - trackEnd arrived normally
    trackExpectedEndMs.delete(player.guildId);
    watchdogPositionSnapshot.delete(player.guildId);

    const reason = (payload as { reason?: string } | undefined)?.reason;
    const queueEmpty = !player.queue.current && player.queue.tracks.length === 0;
    logger.info({
      guildId: player.guildId,
      reason: reason ?? 'none',
      queueEmpty,
      queueLen: player.queue.tracks.length,
    }, 'audio: track end');

    // Track listening behavior for predictive caching
    const trackInfo = extractTrackInfo(track);
    const metadata = getPlayerMetadata(player);
    const startTime = metadata.trackStartTime;
    if (trackInfo?.title && startTime) {
      const listenTime = Date.now() - startTime;
      const skipped = reason === 'REPLACED' || reason === 'STOPPED';
      const duration = trackInfo.duration || 0;

      const lastUserId = metadata.lastUserId ?? 'unknown';
      void predictiveCacheManager.trackUserListening(
        lastUserId,
        player.guildId,
        trackInfo.title,
        duration,
        skipped,
        listenTime
      ).catch(e => logger.debug({ e }, 'Predictive listening tracking failed'));

      metadata.trackStartTime = undefined;
    }

    // Track idle state for persistentConnection (24/7) logic
    if (!player.queue.current && player.queue.tracks.length === 0) {
      if (!idleSinceMs.has(player.guildId)) idleSinceMs.set(player.guildId, Date.now());
    } else {
      idleSinceMs.delete(player.guildId);
    }

    await autoplayService.handleTrackEnd(player, track, reason, pushIdleState);

    // AI DJ Interjection Logic
    try {
      // Don't interject if we just played an interjection
      const isInterjection = (track?.userData as { isInterjection?: boolean })?.isInterjection;
      if (isInterjection) return;

      // Check if there is a next track to announce
      const nextTrack = player.queue.tracks[0];
      if (nextTrack && trackInfo?.title) {
        const nextInfo = extractTrackInfo(nextTrack);
        const userId = metadata.lastUserId ?? 'unknown';

        if (nextInfo?.title && userId !== 'unknown') {
          const audioUrl = await aiDjService.generateInterjection(
            player.guildId,
            userId,
            trackInfo.title,
            nextInfo.title
          );

          if (audioUrl) {
            // Resolve and play the interjection
            const res = await player.search({ query: audioUrl }, { id: 'tts' } as { id: string });
            const ttsTrack = res.tracks[0];

            if (ttsTrack) {
              // Mark as interjection to avoid loops
              (ttsTrack as any).userData = { isInterjection: true };

              // Insert at the front of the queue
              player.queue.add(ttsTrack, 0);

              // If player is idle (which it should be after trackEnd), play immediately
              if (!player.playing) {
                await player.play();
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to process AI DJ interjection');
    }

  } catch (e) {
    logger.error({ e }, 'trackEnd handler failed');
  }
});



manager.on('playerUpdate', (playerJson: unknown) => {
  const p = manager.getPlayer((playerJson as { guildId?: string }).guildId as string);
  if (p) void pushNowPlaying(p);
});

function nowPlayingCacheKey(guildId: string): string {
  return `${NOW_PLAYING_CACHE_PREFIX}${guildId}`;
}

async function cacheNowPlayingState(payload: NowPlayingPayload): Promise<void> {
  try {
    await redisPub.set(
      nowPlayingCacheKey(payload.guildId),
      JSON.stringify({ ...payload, updatedAt: Date.now() }),
      'EX',
      NOW_PLAYING_CACHE_TTL_SECONDS
    );
  } catch (error) {
    logger.warn({ error, guildId: payload.guildId }, 'Failed to cache now playing state');
  }
}

async function pushNowPlaying(
  player: import('lavalink-client').Player,
  force: boolean = false,
  overrideState: Partial<NowPlayingPayload> = {},
  source: 'periodic' | 'control' | 'track_event' = force ? 'control' : 'periodic',
) {
  const pushStartedAt = Date.now();
  try {
    const guildId = player.guildId;
    const current = player.queue.current as { info?: TrackInfo & { isStream?: boolean } } | undefined;
    const currentInfo = extractTrackInfo(current) ?? undefined;
    if (!currentInfo && !overrideState.hasTrack) return; // Allow update if we are forcing state even without track? Actually if no track, usually no UI.

    if (!currentInfo) return;

    const trackSignature = `${currentInfo.uri ?? currentInfo.title ?? 'unknown'}::${currentInfo.duration ?? 0}`;
    const lastTrackSignature = lastPublishedTrackSignature.get(guildId);
    const trackChanged = lastTrackSignature !== trackSignature;

    // CRITICAL FIX: Remove paused state blocking - UI should update regardless of pause state
    const now = Date.now();
    const last = lastUiPush.get(guildId) ?? 0;
    const throttlingInterval = force ? controlUiMinInterval : minUiInterval;
    // Never throttle the first UI payload for a new track title.
    if (!trackChanged && now - last < throttlingInterval) return;

    lastUiPush.set(guildId, now);
    // CRITICAL FIX: Get stored textChannelId for this guild and renew TTL
    const textChannelId = resolveTextChannelForGuild(guildId, player.voiceChannelId ?? null);
    if (textChannelId) {
      rememberTextChannelMapping(guildId, textChannelId, player.voiceChannelId ?? null);
    }

    // Get autoplay state from database
    const autoplayConfig = await autoplayService.getAutoplayConfigCached(guildId);

    const uri = currentInfo.uri ?? '';
    let streamable = false;
    if (typeof uri === 'string' && uri.startsWith('http')) {
      const sourceName = currentInfo.sourceName?.toLowerCase();
      if (sourceName === 'http') {
        streamable = true;
      } else {
        try {
          const url = new URL(uri);
          const pathname = url.pathname.toLowerCase();
          if (/\.(mp3|ogg|oga|opus|flac|aac|m4a|webm)$/.test(pathname)) {
            streamable = true;
          }
        } catch {
          streamable = false;
        }
      }
    }

    const isStreamTrack = !!((current as { info?: { isStream?: boolean } })?.info?.isStream);

    const payload: NowPlayingPayload = {
      guildId,
      title: currentInfo.title ?? 'Unknown',
      durationMs: Math.floor((currentInfo.duration ?? 0) as number),
      positionMs: player.position ?? 0,
      isStream: isStreamTrack,
      paused: !!player.paused,
      repeatMode: (player.repeatMode ?? 'off') as 'off' | 'track' | 'queue',
      queueLen: player.queue.tracks.length,
      hasTrack: !!player.queue.current,
      canSeek: !isStreamTrack,
      volume: player.volume ?? 100,
      autoplay: autoplayConfig.enabled,
      autoplayMode: autoplayConfig.mode,
      voiceChannelId: player.voiceChannelId ?? undefined,
      ...(textChannelId ? { textChannelId } : {}),
      ...overrideState // Merge override state
    };

    // Guarantee deterministic UI reset when track identity changes.
    if (trackChanged && overrideState.positionMs === undefined) {
      payload.positionMs = 0;
    }

    // Explicitly set isMuted based on volume or override
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (payload as any).isMuted = payload.volume === 0;

    const pushLogPayload = {
      guildId,
      paused: payload.paused,
      overrideState,
      force,
      ui_push_source: source,
      volume: payload.volume,
      isMuted: (payload as any).isMuted
    };
    if (source === 'periodic') {
      logger.debug(pushLogPayload, 'Pushing UI update');
    } else {
      logger.info(pushLogPayload, 'Pushing UI update');
    }

    const activePresetId = activeFilterPresets.get(guildId) ?? 'flat';
    const activePreset = FILTER_PRESETS[activePresetId] ?? FILTER_PRESETS.flat;
    payload.filter = {
      id: activePreset.id,
      label: activePreset.label,
      description: activePreset.description,
    };

    payload.source = currentInfo.sourceName;
    payload.uiPushSource = source;

    if (streamable && uri) {
      payload.uri = uri;
      payload.streamable = true;
    } else {
      payload.streamable = false;
    }

    payload.updatedAt = Date.now();

    if (currentInfo.author !== undefined) {
      payload.author = currentInfo.author;
    }

    if (currentInfo.artworkUrl !== undefined) {
      payload.artworkUrl = currentInfo.artworkUrl;
    }
    await redisPub.publish('discord-bot:ui:now', JSON.stringify(payload));
    lastPublishedTrackSignature.set(guildId, trackSignature);
    await cacheNowPlayingState(payload);
    const uiPushLatencyMs = Date.now() - pushStartedAt;
    publishUiPushResult(player.guildId, undefined, true, {
      voiceChannelId: player.voiceChannelId,
      ui_push_source: source,
      ui_push_latency_ms: uiPushLatencyMs,
    });
  } catch (error) {
    const uiPushLatencyMs = Date.now() - pushStartedAt;
    publishUiPushResult(player.guildId, undefined, false, {
      error: error instanceof Error ? error.message : String(error),
      voiceChannelId: player.voiceChannelId,
      ui_push_source: source,
      ui_push_latency_ms: uiPushLatencyMs,
    });
  }
}

// Push an explicit idle UI state (no current track) so Gateway can
// render controls enabled for autoplay while disabling playback actions.
async function pushIdleState(player: import('lavalink-client').Player) {
  try {
    lastPublishedTrackSignature.delete(player.guildId);
    // CRITICAL FIX: Get stored textChannelId for this guild and renew TTL
    const textChannelId = resolveTextChannelForGuild(player.guildId, player.voiceChannelId ?? null);
    if (textChannelId) {
      rememberTextChannelMapping(player.guildId, textChannelId, player.voiceChannelId ?? null);
    }

    // Get autoplay state from database
    const autoplayConfig = await autoplayService.getAutoplayConfigCached(player.guildId);

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
      voiceChannelId: player.voiceChannelId ?? undefined,
      ...(textChannelId ? { textChannelId } : {}),
      streamable: false,
    };

    const activePresetId = activeFilterPresets.get(player.guildId) ?? 'flat';
    const activePreset = FILTER_PRESETS[activePresetId] ?? FILTER_PRESETS.flat;
    payload.filter = {
      id: activePreset.id,
      label: activePreset.label,
      description: activePreset.description,
    };
    payload.updatedAt = Date.now();
    await redisPub.publish('discord-bot:ui:now', JSON.stringify(payload));
    await cacheNowPlayingState(payload);
    publishUiPushResult(player.guildId, undefined, true, {
      idleState: true,
      voiceChannelId: player.voiceChannelId,
    });
  } catch (error) {
    publishUiPushResult(player.guildId, undefined, false, {
      idleState: true,
      error: error instanceof Error ? error.message : String(error),
      voiceChannelId: player.voiceChannelId,
    });
  }
}

// Start UI update loop
const updateInterval = Math.max(1000, env.NOWPLAYING_UPDATE_MS ?? 5000);
logger.info({ updateInterval }, 'Starting UI update loop');

setInterval(() => {
  for (const player of manager.players.values()) {
    if (player.connected && player.queue.current) {
      void pushNowPlaying(player);
    }
  }
}, updateInterval);
