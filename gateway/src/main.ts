// Load environment variables FIRST, before any other imports
import './env-loader.js';

import {
  Events,
  GatewayDispatchEvents,
  ButtonInteraction,
  StringSelectMenuInteraction,
  Guild
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { prisma, injectLogger } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';
import { loadPlansFromDatabase } from '@discord-bot/subscription';

// Infrastructure Layer
import { PrismaGuildSettingsRepository } from './infrastructure/database/prisma-guild-settings-repository.js';
import { RedisMusicSessionRepository } from './infrastructure/redis/redis-music-session-repository.js';
import { DiscordAudioService } from './infrastructure/discord/discord-audio-service.js';
import { DiscordPermissionService } from './infrastructure/discord/discord-permission-service.js';
import { RedisManager } from './infrastructure/redis/redis-manager.js';
import { DiscordClientManager } from './infrastructure/discord/discord-client-manager.js';

// Cache system imports
import { RedisCircuitBreaker } from '@discord-bot/cache';
import { SearchCache, UserCache, QueueCache, SettingsCache } from '@discord-bot/cache';
// Message validation imports
import {
  safeValidateVoiceCredentialsMessage,
  safeValidateVoiceCredentials,
  safeValidateCommand,
  safeValidateTrackQueued
} from '@discord-bot/cache';

// Redis Streams services
import { AudioCommandService } from './services/audio-command-service.js';
import type { AudioCommand } from '@discord-bot/audio-control';

// Domain Layer
import { MusicSessionDomainService } from './domain/services/music-session-domain-service.js';
import { VoiceManager } from './domain/services/voice-manager.js';

// Application Layer
import { PlayMusicUseCase } from './application/use-cases/play-music-use-case.js';

// Presentation Layer
import { MusicController } from './presentation/controllers/music-controller.js';
import { MusicUIBuilder, FilterPanelState } from './presentation/ui/music-ui-builder.js';
import { InteractionResponseHandler } from './presentation/ui/interaction-response-handler.js';
import { PremiumController } from './presentation/controllers/premium-controller.js';

// Settings Service
import { SettingsService } from './services/settings-service.js';
import { VoteSkipService } from './services/vote-skip-service.js';

// Commercial Use Cases
import { SubscriptionManagementUseCase } from './application/use-cases/subscription-management-use-case.js';

// Commercial Infrastructure
import { InMemoryCustomerRepository } from './infrastructure/repositories/in-memory-customer-repository.js';
import { ActivePaymentService } from './infrastructure/payment/active-payment-service.js';
import { StubNotificationService } from './infrastructure/notifications/stub-notification-service.js';

// Enterprise Health Monitoring
import { ApplicationHealthChecker } from './infrastructure/health/application-health-checker.js';
import { HealthServer } from './infrastructure/http/health-server.js';

/**
 * Composition Root
 * Dependency injection and application bootstrapping
 */
export class GatewayApplication {
  private redisManager!: RedisManager;
  private discordClientManager!: DiscordClientManager;
  private voiceManager!: VoiceManager;

  private audioCommandService!: AudioCommandService;
  private musicController!: MusicController;
  private healthChecker!: ApplicationHealthChecker;
  private healthServer!: HealthServer;
  private guildSettingsRepository!: PrismaGuildSettingsRepository;
  private settingsService!: SettingsService;
  private uiBuilder!: MusicUIBuilder;
  private permissionService!: DiscordPermissionService;
  private voteSkipService!: VoteSkipService;
  private premiumController!: PremiumController;

  // UI Message Tracking System (Rule 1: Only one UI PRINCIPAL per voice session)
  private activeInteractions: Map<string, {
    messageId: string;
    channelId: string;
    guildId: string;
    lastUpdated: number;
    processingMessageId?: string;
    uiBlocked?: boolean; // New: Prevents UI recreation after manual deletion
  }> = new Map();

  // Request Deduplication System (prevents concurrent queue requests)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingQueueRequests: Map<string, { requestId: string; timestamp: number; promise: Promise<any> }> = new Map();

  // Enterprise Cache System
  private cacheSystem!: {
    redisCircuitBreaker: RedisCircuitBreaker;
    searchCache: SearchCache;
    userCache: UserCache;
    queueCache: QueueCache;
    settingsCache: SettingsCache;
  };

  // Preferred text channel for music UI per guild/voice combination
  private lastUIChannel: Map<string, string> = new Map();
  private guildThemeCache: Map<string, { playingColor: number; pausedColor: number; fetchedAt: number }> = new Map();
  private voiceRequestContext: Map<string, {
    requestId: string;
    voiceChannelId: string;
    createdAt: number;
    lastEventAt: number;
    voiceStateUpdates: number;
    voiceServerUpdates: number;
  }> = new Map();
  private pendingVoiceDisconnectStops: Map<string, NodeJS.Timeout> = new Map();
  private readonly transientVoiceDisconnectGraceMs = 8_000;

  private getUIChannelMapKey(guildId: string, voiceChannelId?: string | null): string {
    return `${guildId}:${voiceChannelId ?? 'default'}`;
  }

  private getUISessionKey(guildId: string, voiceChannelId?: string | null, channelId?: string | null): string {
    if (voiceChannelId) return this.getUIChannelMapKey(guildId, voiceChannelId);
    return `${guildId}:${channelId ?? 'default'}`;
  }

  private rememberUIChannel(guildId: string, textChannelId: string, voiceChannelId?: string | null): void {
    this.lastUIChannel.set(this.getUIChannelMapKey(guildId, voiceChannelId), textChannelId);
    this.lastUIChannel.set(this.getUIChannelMapKey(guildId, null), textChannelId);
  }

  private registerVoiceRequestContext(guildId: string, requestId: string, voiceChannelId: string): void {
    this.voiceRequestContext.set(guildId, {
      requestId,
      voiceChannelId,
      createdAt: Date.now(),
      lastEventAt: Date.now(),
      voiceStateUpdates: 0,
      voiceServerUpdates: 0,
    });
  }

  private getVoiceRequestContext(guildId: string): {
    requestId: string;
    voiceChannelId: string;
    createdAt: number;
    lastEventAt: number;
    voiceStateUpdates: number;
    voiceServerUpdates: number;
  } | undefined {
    const context = this.voiceRequestContext.get(guildId);
    if (!context) return undefined;
    if ((Date.now() - context.createdAt) > 10 * 60_000) {
      this.voiceRequestContext.delete(guildId);
      return undefined;
    }
    return context;
  }

  private trackVoiceEvent(guildId: string, eventType: 'VOICE_STATE_UPDATE' | 'VOICE_SERVER_UPDATE'): {
    requestId?: string;
    voiceChannelId?: string;
    voiceStateUpdates: number;
    voiceServerUpdates: number;
  } {
    const context = this.getVoiceRequestContext(guildId);
    if (!context) {
      return {
        voiceStateUpdates: 0,
        voiceServerUpdates: 0,
      };
    }

    if (eventType === 'VOICE_STATE_UPDATE') {
      context.voiceStateUpdates += 1;
    } else {
      context.voiceServerUpdates += 1;
    }
    context.lastEventAt = Date.now();
    this.voiceRequestContext.set(guildId, context);

    return {
      requestId: context.requestId,
      voiceChannelId: context.voiceChannelId,
      voiceStateUpdates: context.voiceStateUpdates,
      voiceServerUpdates: context.voiceServerUpdates,
    };
  }

  private clearPendingVoiceDisconnectStop(guildId: string): void {
    const timer = this.pendingVoiceDisconnectStops.get(guildId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingVoiceDisconnectStops.delete(guildId);
  }

  private parseHexColorToInt(value?: string): number | undefined {
    if (!value || typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return undefined;
    return parseInt(trimmed.replace('#', ''), 16);
  }

  private async resolveGuildTheme(guildId: string): Promise<{ playingColor: number; pausedColor: number }> {
    const cached = this.guildThemeCache.get(guildId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < 30_000) {
      return { playingColor: cached.playingColor, pausedColor: cached.pausedColor };
    }

    const fallback = { playingColor: 0x6A0DAD, pausedColor: 0xFFAA00 };

    try {
      const metaRaw = await this.redisManager.getClient().get(`discord-bot:guild-settings:${guildId}:meta`);
      if (metaRaw) {
        const meta = JSON.parse(metaRaw) as { uiTheme?: { playingColor?: string; pausedColor?: string } };
        const playingColor = this.parseHexColorToInt(meta.uiTheme?.playingColor) ?? fallback.playingColor;
        const pausedColor = this.parseHexColorToInt(meta.uiTheme?.pausedColor) ?? fallback.pausedColor;
        this.guildThemeCache.set(guildId, { playingColor, pausedColor, fetchedAt: now });
        this.uiBuilder.setGuildTheme(guildId, { playingColor, pausedColor });
        return { playingColor, pausedColor };
      }
    } catch (error) {
      logger.warn({ error, guildId }, 'Failed to resolve guild theme, using defaults');
    }

    this.guildThemeCache.set(guildId, { ...fallback, fetchedAt: now });
    this.uiBuilder.setGuildTheme(guildId, fallback);
    return fallback;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Gateway application with Clean Architecture...');

    // Inject logger dependency for database package
    injectLogger(logger);

    // Load subscription plan overrides from database if available
    await loadPlansFromDatabase(prisma);

    // Initialize external services
    this.redisManager = new RedisManager();
    await this.redisManager.connect();

    this.discordClientManager = new DiscordClientManager();
    this.voiceManager = new VoiceManager();

    // Initialize enterprise cache system
    await this.initializeCacheSystem();

    // Wire up dependencies
    this.wireUpDependencies();

    // Initialize AudioCommandService for Redis Streams
    await this.audioCommandService.initialize();

    // Ensure demo guilds start on premium tier for QA
    await this.premiumController.initializeTestGuilds();

    // Setup Redis subscriptions for Audio service communication
    this.setupRedisSubscriptions();

    // Initialize enterprise health monitoring
    this.setupHealthMonitoring();

    // Start the application
    await this.start();

    logger.info('Gateway application initialized successfully');
  }

  private getActiveInstanceKey(guildId: string): string {
    return `discord-bot:active-instances:${guildId}`;
  }

  private async initializeCacheSystem(): Promise<void> {
    logger.info('Initializing enterprise multi-layer cache system...');

    // Initialize Redis Circuit Breaker with enterprise configuration
    // Parse REDIS_URL to extract host and port for backwards compatibility
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisUrlParsed = new URL(redisUrl);
    const redisHost = redisUrlParsed.hostname;
    const redisPort = parseInt(redisUrlParsed.port || '6379');

    const redisCircuitBreaker = new RedisCircuitBreaker('gateway-cache', {
      failureThreshold: 5,
      timeout: 5000,
      volumeThreshold: 10,
      monitoringWindow: 60000,
      redis: {
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true
      }
    }, {
      host: redisHost,
      port: redisPort
    });

    // Initialize specialized caches with enterprise-grade configuration
    const searchCache = new SearchCache(redisCircuitBreaker);
    const userCache = new UserCache(redisCircuitBreaker);
    const queueCache = new QueueCache(redisCircuitBreaker);
    const settingsCache = new SettingsCache(redisCircuitBreaker);

    this.cacheSystem = {
      redisCircuitBreaker,
      searchCache,
      userCache,
      queueCache,
      settingsCache,
    };

    // Warm up critical caches for immediate performance
    logger.info('Warming up enterprise cache layers...');

    // Enable cache monitoring and periodic stats reporting
    setInterval(() => {
      const searchStats = searchCache.getStats();
      const userStats = userCache.getStats();
      const queueStats = queueCache.getStats();

      logger.info({
        cachePerformance: {
          search: {
            hitRate: searchStats.overall.hitRate.toFixed(2) + '%',
            totalHits: searchStats.overall.totalHits,
            l1HitRate: searchStats.l1.hitRate.toFixed(2) + '%',
            l2HitRate: searchStats.l2.hitRate.toFixed(2) + '%',
            avgResponseTime: searchStats.l1.avgResponseTime.toFixed(2) + 'ms'
          },
          user: {
            hitRate: userStats.overall.hitRate.toFixed(2) + '%',
            totalHits: userStats.overall.totalHits,
            memoryUsageMB: userCache.getSizeInfo().estimatedMemoryMB.toFixed(2)
          },
          queue: {
            hitRate: queueStats.overall.hitRate.toFixed(2) + '%',
            totalHits: queueStats.overall.totalHits,
            cacheSize: queueCache.getSizeInfo().l1Size
          }
        }
      }, 'Enterprise cache performance metrics');
    }, 900000); // Every 15 minutes

    logger.info('Enterprise cache system initialized with multi-layer architecture');
  }

  private wireUpDependencies(): void {
    // Infrastructure Layer (Adapters)
    this.guildSettingsRepository = new PrismaGuildSettingsRepository(prisma);
    this.settingsService = new SettingsService(prisma, this.cacheSystem.settingsCache);
    const musicSessionRepository = new RedisMusicSessionRepository(this.redisManager.getClient());

    // Use enterprise-grade cache system instead of basic stub
    const audioService = new DiscordAudioService(
      { publish: this.redisManager.publish.bind(this.redisManager) },
      {
        subscribe: this.redisManager.subscribe.bind(this.redisManager),
        unsubscribe: this.redisManager.unsubscribe.bind(this.redisManager)
      },
      this.cacheSystem.searchCache
    );
    const permissionService = new DiscordPermissionService(this.discordClientManager.getClient());
    this.permissionService = permissionService;

    // Initialize VoteSkipService
    this.voteSkipService = new VoteSkipService(this.permissionService, this.settingsService);

    // Commercial Infrastructure
    const customerRepository = new InMemoryCustomerRepository();
    const paymentService = new ActivePaymentService();
    const notificationService = new StubNotificationService();

    // Domain Layer (Business Logic)
    const musicSessionDomainService = new MusicSessionDomainService();

    // Application Layer (Use Cases)
    const _playMusicUseCase = new PlayMusicUseCase(
      musicSessionRepository,
      this.guildSettingsRepository,
      musicSessionDomainService,
      audioService,
      permissionService
    );

    // Commercial Use Cases
    const _subscriptionManagementUseCase = new SubscriptionManagementUseCase(
      customerRepository,
      paymentService,
      notificationService
    );

    // Presentation Layer (UI & Controllers)
    this.uiBuilder = new MusicUIBuilder();
    const responseHandler = new InteractionResponseHandler(this.uiBuilder);


    // Create event bus instance for controller
    const eventBus = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      publish: async (channel: string, message: any): Promise<void> => {
        await this.redisManager.publish(channel, message);
      },
      subscribe: async (channel: string, callback: (channel: string, message: string) => void) => {
        await this.redisManager.subscribe(channel, (message, receivedChannel) => {
          callback(receivedChannel, message);
        });
      }
    };

    // Processing message registration callback for the music controller
    const registerProcessingMessage = (guildId: string, channelId: string, messageId: string, voiceChannelId?: string | null) => {
      const channelKey = this.getUISessionKey(guildId, voiceChannelId ?? null, channelId);
      const existingInteraction = this.activeInteractions.get(channelKey);

      if (existingInteraction) {
        // Update existing interaction with processing message ID
        this.activeInteractions.set(channelKey, {
          ...existingInteraction,
          processingMessageId: messageId
        });
      } else {
        // Create new tracking entry for processing message
        this.activeInteractions.set(channelKey, {
          messageId: '', // Will be set when UI PRINCIPAL is created
          channelId: channelId,
          guildId: guildId,
          lastUpdated: Date.now(),
          processingMessageId: messageId
        });
      }

      logger.debug({
        guildId,
        channelId,
        processingMessageId: messageId
      }, 'Registered processing message for cleanup');
    };

    // Clear UI block callback for the music controller
    const clearUIBlock = (guildId: string, channelId: string, voiceChannelId?: string | null) => {
      const channelKey = this.getUISessionKey(guildId, voiceChannelId ?? null, channelId);
      const existingInteraction = this.activeInteractions.get(channelKey);

      if (existingInteraction?.uiBlocked) {
        this.activeInteractions.set(channelKey, {
          ...existingInteraction,
          uiBlocked: false,
          lastUpdated: Date.now()
        });

        logger.info({
          guildId,
          channelId
        }, 'Cleared UI block - allowing UI recreation for new command');
      }
    };

    const shouldForceVoiceReconnect = (guildId: string): boolean => {
      return !this.voiceManager.hasVoiceServerData(guildId);
    };

    const publishCachedVoiceServerUpdate = async (guildId: string): Promise<void> => {
      const cached = this.voiceManager.getVoiceServerData(guildId);
      if (!cached?.token || !cached?.endpoint) return;
      const packet = {
        t: 'VOICE_SERVER_UPDATE',
        d: {
          guild_id: guildId,
          token: cached.token,
          endpoint: cached.endpoint
        }
      };
      await this.redisManager.getAudioClient().publish('discord-bot:voice-events', JSON.stringify(packet));
    };

    const publishCachedVoiceStateUpdate = async (guildId: string, fallbackVoiceChannelId?: string): Promise<boolean> => {
      try {
        const client = this.discordClientManager.getClient();
        const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
        if (!guild || !client.user?.id) return false;

        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        const cachedState = this.voiceManager.getVoiceStateData(guildId);
        const sessionId = me?.voice?.sessionId ?? cachedState?.sessionId;
        const channelId = me?.voice?.channelId ?? fallbackVoiceChannelId ?? cachedState?.channelId ?? null;
        if (!sessionId) {
          logger.warn({ guildId }, 'VOICE_CONNECT: No cached sessionId available for VOICE_STATE_UPDATE publish');
          return false;
        }

        const packet = {
          t: 'VOICE_STATE_UPDATE',
          d: {
            guild_id: guildId,
            channel_id: channelId,
            user_id: client.user.id,
            session_id: sessionId,
            self_mute: me?.voice?.selfMute ?? false,
            self_deaf: me?.voice?.selfDeaf ?? true,
          }
        };

        await this.redisManager.getAudioClient().publish('discord-bot:voice-events', JSON.stringify(packet));
        return true;
      } catch (error) {
        logger.warn({
          guildId,
          error: error instanceof Error ? error.message : String(error),
        }, 'VOICE_CONNECT: Failed to publish cached VOICE_STATE_UPDATE');
        return false;
      }
    };

    // Initialize AudioCommandService for Redis Streams
    this.audioCommandService = new AudioCommandService();

    this.musicController = new MusicController(
      eventBus,
      this.uiBuilder,
      responseHandler,
      this.settingsService,
      this.permissionService,
      musicSessionRepository,
      this.audioCommandService,
      registerProcessingMessage,
      clearUIBlock,
      shouldForceVoiceReconnect,
      publishCachedVoiceStateUpdate,
      publishCachedVoiceServerUpdate,
      this.registerVoiceRequestContext.bind(this)
    );

    // Initialize Premium Controller
    this.premiumController = new PremiumController({
      testGuildIds: env.PREMIUM_TEST_GUILD_IDS_LIST,
    });

    logger.info('Clean Architecture dependencies wired up successfully');
  }

  private setupHealthMonitoring(): void {
    // Initialize health checker with all dependencies
    this.healthChecker = new ApplicationHealthChecker(
      this.redisManager.getClient(),
      this.discordClientManager.getClient()
    );

    // Start health server on port 3001
    this.healthServer = new HealthServer(this.healthChecker, env.GATEWAY_HTTP_PORT || 3001);
    let lastManualGcAt = 0;
    const manualGcEnabled = process.env.GATEWAY_MANUAL_GC_ENABLED === 'true';
    const parsedHeapThreshold = Number.parseFloat(process.env.GATEWAY_GC_HEAP_THRESHOLD ?? '0.9');
    const parsedMinGcIntervalMs = Number.parseInt(process.env.GATEWAY_GC_MIN_INTERVAL_MS ?? '600000', 10);
    const gcHeapThreshold = Number.isFinite(parsedHeapThreshold) ? Math.min(0.99, Math.max(0.5, parsedHeapThreshold)) : 0.9;
    const gcMinIntervalMs = Number.isFinite(parsedMinGcIntervalMs) ? Math.max(60_000, parsedMinGcIntervalMs) : 600_000;

    // Enhanced health monitoring with enterprise metrics
    setInterval(async () => {
      await this.healthChecker.logHealthStatus();

      // Log comprehensive system metrics
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      const client = this.discordClientManager.getClient();

      logger.info({
        systemHealth: {
          memory: {
            heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
            externalMB: Math.round(memoryUsage.external / 1024 / 1024),
            heapUsagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
          },
          uptime: {
            seconds: Math.round(uptime),
            hours: Math.round(uptime / 3600 * 100) / 100
          },
          discordGuilds: client.guilds.cache.size,
          discordUsers: client.users.cache.size,
          discordPing: client.ws.ping,
          nodeVersion: process.version,
          pid: process.pid
        }
      }, 'Enterprise system health metrics');

      // Memory cleanup trigger for high usage
      const heapUsageRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;
      const heapUsagePercent = Math.round(heapUsageRatio * 100);
      const threshold = gcHeapThreshold;
      const shouldConsiderGc = heapUsageRatio > threshold;
      if (shouldConsiderGc) {
        logger.warn({
          heapUsagePercent,
          heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          thresholdPercent: Math.round(threshold * 100),
          manualGcEnabled,
        }, 'High memory usage detected');

        if (manualGcEnabled && global.gc) {
          const elapsed = Date.now() - lastManualGcAt;
          if (elapsed >= gcMinIntervalMs) {
            global.gc();
            lastManualGcAt = Date.now();
            logger.info({
              heapUsagePercent,
              thresholdPercent: Math.round(threshold * 100),
            }, 'Manual garbage collection completed');
          } else {
            logger.debug({
              heapUsagePercent,
              nextAllowedInMs: gcMinIntervalMs - elapsed,
            }, 'Skipping manual GC due to cooldown');
          }
        }
      }
    }, 300000);

    // Performance monitoring for enterprise insights
    if (process.env.ENABLE_PERFORMANCE_MONITORING === 'true') {
      setInterval(() => {
        const startTime = process.hrtime.bigint();

        setImmediate(() => {
          const eventLoopDelay = Number(process.hrtime.bigint() - startTime) / 1000000; // Convert to ms

          if (eventLoopDelay > 10) { // Log if event loop delay > 10ms
            logger.warn({
              eventLoopDelayMs: eventLoopDelay.toFixed(2),
            }, 'Event loop delay detected');
          }
        });
      }, 30000); // Check every 30 seconds
    }

    // Setup cleanup interval for activeInteractions Map to prevent memory leaks
    setInterval(() => {
      this.cleanupActiveInteractions();
      const now = Date.now();
      for (const [guildId, context] of this.voiceRequestContext.entries()) {
        if (now - context.lastEventAt > 10 * 60_000) {
          this.voiceRequestContext.delete(guildId);
        }
      }
    }, 300000); // Every 5 minutes (300000ms)

    logger.info('Enterprise health monitoring initialized with comprehensive metrics');
  }

  private setupRedisSubscriptions(): void {
    // Subscribe to Audio service channels according to documentation
    // discord-bot:to-discord   → Audio → Gateway (Lavalink events)
    // discord-bot:ui:now       → Audio → Gateway (real-time UI updates)

    this.redisManager.subscribe('discord-bot:to-discord', (message: string) => {
      try {
        const data = JSON.parse(message);
        logger.info({ data }, 'Received message from Audio service on discord-bot:to-discord');
        this.handleAudioServiceMessage(data);
      } catch (error) {
        logger.error({ error, message }, 'Failed to parse message from discord-bot:to-discord');
      }
    });

    this.redisManager.subscribe('discord-bot:ui:now', (message: string) => {
      try {
        const data = JSON.parse(message);
        const context = this.getVoiceRequestContext(data.guildId);
        const uiLogPayload = {
          guildId: data.guildId,
          requestId: context?.requestId,
          voiceChannelId: data.voiceChannelId,
          channelId: data.channelId ?? data.textChannelId,
          uiPushSource: data.uiPushSource,
          title: data.title,
          positionMs: data.positionMs,
          durationMs: data.durationMs
        };
        if (data.uiPushSource === 'control' || data.uiPushSource === 'track_event') {
          logger.info(uiLogPayload, 'Gateway received UI payload from audio');
        } else {
          logger.debug(uiLogPayload, 'Gateway received UI payload from audio');
        }
        this.handleUIUpdate(data);
      } catch (error) {
        logger.error({ error, message }, 'Failed to parse UI update message');
      }
    });

    this.redisManager.subscribe('discord-bot:panel-commands', (message: string) => {
      try {
        const data = JSON.parse(message);
        this.handlePanelCommand(data);
      } catch (error) {
        logger.error({ error, message }, 'Failed to parse panel command message');
      }
    });

    logger.info('Gateway subscribed to Audio service channels: discord-bot:to-discord, discord-bot:ui:now, discord-bot:panel-commands');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleAudioServiceMessage(data: any): Promise<void> {
    // Handle messages from Audio service (track_queued, track_started, etc.)
    logger.info({ operation: data.payload?.op }, 'Processing Audio service message');

    // Handle string-based operations (custom operations from audio service)
    if (data.payload?.op === 'track_queued') {
      // Remember the text channel where the queue operation was triggered
      if (data.payload?.textChannelId && data.guildId) {
        this.rememberUIChannel(data.guildId, data.payload.textChannelId, data.payload.voiceChannelId ?? null);
      }
      // Show "Track Added to Queue" message (always visible, not ephemeral)
      if (data.payload?.textChannelId) {
        try {
          const client = this.discordClientManager.getClient();
          const channel = await client.channels.fetch(data.payload.textChannelId);
          if (channel?.isTextBased() && 'send' in channel) {
            const user = await client.users.fetch(data.payload.requestedBy);

            const embed = this.uiBuilder.buildAddedToQueueEmbed({
              trackTitle: data.payload.track.title,
              artist: data.payload.track.artist,
              duration: data.payload.track.duration,
              queuePosition: data.payload.queuePosition,
              artworkUrl: data.payload.track.thumbnail,
              requestedBy: user
            });

            await channel.send({ embeds: [embed] });
            logger.info({ guildId: data.guildId, track: data.payload.track.title }, 'Track queued notification sent');

            // Keep the existing UI message for this voice session; do not force creation of a new one.
          }
        } catch (error) {
          logger.error({ error, guildId: data.guildId }, 'Failed to send track queued notification');
        }
      }
    } else if (data.payload?.op === 'trackStart') {
      // Handle track start - this triggers the main UI update
      // We don't need to do anything here as the Audio service will send a UI update
      // via discord-bot:ui:now channel which is handled by handleUIUpdate
      logger.debug({ guildId: data.guildId }, 'Track start event received');
    } else if (data.payload?.op === 'queueEnd') {
      // Handle queue end
      logger.debug({ guildId: data.guildId }, 'Queue end event received');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleUIUpdate(data: any): Promise<void> {
    // Map textChannelId to channelId if needed (handling data from Audio service)
    const channelId = data.channelId || data.textChannelId;
    const context = data.guildId ? this.getVoiceRequestContext(data.guildId) : undefined;

    if (!data.guildId || !channelId) return;

    // Rule 1: Only one UI PRINCIPAL per voice session
    const sessionKey = this.getUISessionKey(data.guildId, data.voiceChannelId ?? null, channelId);
    const rawPositionMs = typeof data.positionMs === 'number' ? data.positionMs : 0;
    const durationMs = typeof data.durationMs === 'number' ? data.durationMs : 0;
    const normalizedPositionMs = Math.min(durationMs || rawPositionMs, Math.max(0, rawPositionMs));

    const uiUpdateLogPayload = {
      guildId: data.guildId,
      requestId: context?.requestId,
      voiceChannelId: data.voiceChannelId,
      channelId,
      uiPushSource: data.uiPushSource,
      paused: data.paused,
      isMuted: data.isMuted,
      volume: data.volume,
      title: data.title,
      positionMs: normalizedPositionMs
    };
    if (data.uiPushSource === 'control' || data.uiPushSource === 'track_event') {
      logger.info(uiUpdateLogPayload, 'Gateway received UI update');
    } else {
      logger.debug(uiUpdateLogPayload, 'Gateway received UI update');
    }

    const trackingInfo = this.activeInteractions.get(sessionKey);

    // If we have a blocked UI (e.g. user just deleted it), don't recreate it immediately
    if (trackingInfo?.uiBlocked) {
      logger.debug({ guildId: data.guildId, channelId }, 'UI update skipped - UI is blocked');
      return;
    }

    try {
      const client = this.discordClientManager.getClient();
      const targetChannelId = trackingInfo?.channelId ?? channelId;
      const channel = client.channels.cache.get(targetChannelId) ?? await client.channels.fetch(targetChannelId);
      if (!channel?.isTextBased() || !('send' in channel)) return;

      // Resolve guild theme for UI colors
      const theme = await this.resolveGuildTheme(data.guildId);

      // Build the UI payload
      // Map fields from Audio service payload to MusicUIBuilder expectations
      const uiPayload = this.uiBuilder.buildMusicUI({
        ...data,
        trackTitle: data.title,
        artist: data.author,
        duration: durationMs,
        position: normalizedPositionMs,
        queueLength: data.queueLen,
        isPaused: data.paused,
        theme // Pass resolved theme to UI builder
      });

      // Check if we have an existing message to edit
      if (trackingInfo?.messageId) {
        try {
          const message = await channel.messages.edit(trackingInfo.messageId, uiPayload);
          if (message) {
            const editLogPayload = {
              guildId: data.guildId,
              requestId: context?.requestId,
              uiPushSource: data.uiPushSource,
              messageId: message.id,
              channelId: targetChannelId
            };
            if (data.uiPushSource === 'control' || data.uiPushSource === 'track_event') {
              logger.info(editLogPayload, 'Gateway UI edit success');
            } else {
              logger.debug(editLogPayload, 'Gateway UI edit success');
            }

            // Update timestamp
            this.activeInteractions.set(sessionKey, {
              ...trackingInfo,
              lastUpdated: Date.now()
            });
            return;
          }
        } catch (error) {
          // Message not found or deleted, clear tracking info and create new one
          logger.warn({
            guildId: data.guildId,
            messageId: trackingInfo.messageId,
            error: error instanceof Error ? error.message : String(error)
          }, 'Tracked UI message not found or edit failed, creating new one');
        }
      } else {
        logger.info({ guildId: data.guildId, reason: 'no_tracking_id' }, 'No existing UI message tracked, creating new one');
      }

      // Create new message if no existing one or edit failed
      const message = await channel.send(uiPayload);

      // Update tracking info
      this.activeInteractions.set(sessionKey, {
        messageId: message.id,
        channelId: targetChannelId,
        guildId: data.guildId,
        lastUpdated: Date.now(),
        processingMessageId: trackingInfo?.processingMessageId
      });

      const createLogPayload = {
        guildId: data.guildId,
        requestId: context?.requestId,
        uiPushSource: data.uiPushSource,
        messageId: message.id,
        channelId: targetChannelId
      };
      if (data.uiPushSource === 'control' || data.uiPushSource === 'track_event') {
        logger.info(createLogPayload, 'Gateway UI create success');
      } else {
        logger.debug(createLogPayload, 'Gateway UI create success');
      }
    } catch (error) {
      logger.error({ error, guildId: data.guildId }, 'Failed to handle UI update');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handlePanelCommand(message: any): Promise<void> {
    logger.info({ type: message.type, guildId: message.guildId }, 'Received panel command');

    if (message.type === 'summon') {
      const guildId = typeof message.guildId === 'string' ? message.guildId : null;
      const voiceChannelId = typeof message.voiceChannelId === 'string' ? message.voiceChannelId : null;
      const textChannelId = typeof message.textChannelId === 'string' ? message.textChannelId : null;
      const requestId = typeof message.requestId === 'string' ? message.requestId : null;
      const responseChannel = requestId ? `discord-bot:response:${requestId}` : null;

      if (!guildId || !voiceChannelId || !textChannelId) {
        logger.warn({ message }, 'Invalid summon panel command payload');
        if (responseChannel) {
          await this.redisManager.getClient().publish(responseChannel, JSON.stringify({
            success: false,
            error: 'Invalid summon payload',
          }));
        }
        return;
      }

      try {
        const client = this.discordClientManager.getClient();
        const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId);
        const voiceChannel = await guild.channels.fetch(voiceChannelId);

        if (!voiceChannel?.isVoiceBased()) {
          throw new Error(`Channel ${voiceChannelId} is not a voice channel`);
        }

        this.rememberUIChannel(guildId, textChannelId, voiceChannelId);
        this.registerVoiceRequestContext(guildId, requestId ?? `panel_summon_${Date.now()}`, voiceChannelId);

        const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } = await import('@discordjs/voice');
        const existing = getVoiceConnection(guildId);
        const inTargetChannel = existing?.joinConfig.channelId === voiceChannelId;
        const isReusable = Boolean(
          existing &&
          inTargetChannel &&
          (existing.state.status === VoiceConnectionStatus.Ready ||
            existing.state.status === VoiceConnectionStatus.Connecting)
        );

        let connection = existing ?? null;
        if (!isReusable) {
          if (existing) {
            try {
              existing.destroy();
            } catch (error) {
              logger.warn({ error, guildId }, 'Failed to destroy stale summon voice connection');
            }
          }

          connection = joinVoiceChannel({
            channelId: voiceChannelId,
            guildId,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true
          });
        }

        await entersState(connection!, VoiceConnectionStatus.Ready, 15_000);

        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        const sessionId = me?.voice?.sessionId ?? this.voiceManager.getVoiceStateData(guildId)?.sessionId;
        const voiceServer = this.voiceManager.getVoiceServerData(guildId);

        if (sessionId) {
          const voiceStatePacket = {
            t: 'VOICE_STATE_UPDATE',
            d: {
              guild_id: guildId,
              channel_id: voiceChannelId,
              user_id: client.user?.id,
              session_id: sessionId,
              self_mute: me?.voice?.selfMute ?? false,
              self_deaf: me?.voice?.selfDeaf ?? true,
            }
          };
          await this.redisManager.getAudioClient().publish('discord-bot:voice-events', JSON.stringify(voiceStatePacket));
        }

        if (voiceServer?.token && voiceServer?.endpoint) {
          const voiceServerPacket = {
            t: 'VOICE_SERVER_UPDATE',
            d: {
              guild_id: guildId,
              token: voiceServer.token,
              endpoint: voiceServer.endpoint
            }
          };
          await this.redisManager.getAudioClient().publish('discord-bot:voice-events', JSON.stringify(voiceServerPacket));

          if (sessionId) {
            await this.redisManager.getAudioClient().publish('discord-bot:to-audio', JSON.stringify({
              type: 'VOICE_CREDENTIALS',
              guildId,
              voiceCredentials: {
                guildId,
                sessionId,
                token: voiceServer.token,
                endpoint: voiceServer.endpoint
              }
            }));
          }
        }

        logger.info({
          guildId,
          voiceChannelId,
          textChannelId,
          requestId
        }, 'Panel summon voice connection ready');

        if (responseChannel) {
          await this.redisManager.getClient().publish(responseChannel, JSON.stringify({
            success: true,
            guildId,
            voiceChannelId,
            textChannelId
          }));
        }
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
          guildId,
          voiceChannelId,
          textChannelId,
          requestId
        }, 'Failed to process summon panel command');

        if (responseChannel) {
          await this.redisManager.getClient().publish(responseChannel, JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
      return;
    }

    if (message.type === 'open_filters') {
      await this.openFiltersPanel(message.guildId, message.channelId);
    }
  }

  private async openFiltersPanel(guildId: string, channelId: string): Promise<void> {
    try {
      const client = this.discordClientManager.getClient();
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !('send' in channel)) return;

      // Get current filter state from Audio service via Redis
      // For now, we'll use default state, but in production this should fetch from Audio service
      const filterState: FilterPanelState = {
        success: true,
        presets: [
          { id: 'flat', label: 'Flat', description: 'No filter applied' },
          { id: 'bassboost', label: 'Bass Boost', description: 'Boost low frequencies' },
          { id: 'nightcore', label: 'Nightcore', description: 'Higher pitch and speed' },
          { id: 'vaporwave', label: 'Vaporwave', description: 'Lower pitch and speed' }
        ],
        preset: { id: 'flat', label: 'Flat', description: 'No filter applied' }
      };

      // Try to fetch actual state if available
      try {
        const stateRaw = await this.redisManager.getClient().get(`discord-bot:filters:${guildId}`);
        if (stateRaw) {
          const state = JSON.parse(stateRaw);
          if (state.filter) {
            const active = filterState.presets.find(p => p.id === state.filter);
            if (active) filterState.preset = active;
          }
        }
      } catch (error) {
        logger.warn({ error, guildId }, 'Failed to fetch filter state');
      }

      const panel = this.uiBuilder.buildFilterPanel(filterState);
      await channel.send(panel);
      logger.info({ guildId, channelId }, 'Opened filters panel');
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to open filters panel');
    }
  }

  private async start(): Promise<void> {
    // Initialize AudioCommandService
    await this.audioCommandService.initialize();

    // Register Discord event handlers
    const client = this.discordClientManager.getClient();
    const syncGuildConfiguration = async (guild: Guild): Promise<void> => {
      await this.settingsService.ensureGuildConfigurationExists(guild.id, {
        name: guild.name,
        icon: guild.icon,
        ownerId: guild.ownerId ?? null,
        isTestGuild: env.PREMIUM_TEST_GUILD_IDS_LIST.includes(guild.id),
      });
    };

    client.on(Events.ClientReady, () => {
      logger.info(`Logged in as ${client.user?.tag}!`);

      // Set initial presence
      client.user?.setPresence({
        activities: [{ name: 'High Quality Music 🎵' }],
        status: 'online'
      });

      const guilds = [...client.guilds.cache.values()];
      void Promise.allSettled(guilds.map((guild) => syncGuildConfiguration(guild)))
        .then((results) => {
          const failed = results.filter((result) => result.status === 'rejected').length;
          logger.info({
            totalGuilds: guilds.length,
            syncedGuilds: guilds.length - failed,
            failedGuilds: failed,
          }, 'Synchronized guild metadata into configuration tables');
        });
    });

    client.on(Events.GuildCreate, (guild) => {
      void syncGuildConfiguration(guild)
        .then(() => logger.info({ guildId: guild.id, guildName: guild.name }, 'Synchronized new guild metadata'))
        .catch((error) => logger.error({
          error: error instanceof Error ? error.message : String(error),
          guildId: guild.id,
        }, 'Failed to synchronize guild metadata on GuildCreate'));
    });

    client.on(Events.GuildUpdate, (_oldGuild, newGuild) => {
      void syncGuildConfiguration(newGuild)
        .catch((error) => logger.warn({
          error: error instanceof Error ? error.message : String(error),
          guildId: newGuild.id,
        }, 'Failed to refresh guild metadata on GuildUpdate'));
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        await this.musicController.handleInteraction(interaction);
      } catch (error) {
        logger.error({ error, interactionId: interaction.id }, 'Interaction handling failed');
      }
    });

    client.on(Events.MessageDelete, async (message) => {
      if (!message.guildId) return;

      // Check if this message is a tracked UI Principal (by messageId across sessions)
      let matchedKey: string | null = null;
      let trackingInfo: {
        messageId: string;
        channelId: string;
        guildId: string;
        lastUpdated: number;
        processingMessageId?: string;
        uiBlocked?: boolean;
      } | undefined;

      for (const [key, info] of this.activeInteractions.entries()) {
        if (info.messageId === message.id) {
          matchedKey = key;
          trackingInfo = info;
          break;
        }
      }

      if (trackingInfo && matchedKey) {
        logger.info({ guildId: message.guildId, messageId: message.id }, 'UI Principal deleted - allowing recreation without disconnect');

        // Clear tracking so the next UI update recreates the message.
        this.activeInteractions.set(matchedKey, {
          ...trackingInfo,
          messageId: '', // Clear message ID since it's gone
          uiBlocked: false,
          lastUpdated: Date.now()
        });
      }
    });

    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      // Handle voice state updates (disconnects, channel moves)
      // This is critical for tracking bot's voice connection status
      if (newState.member?.id === client.user?.id) {
        const transitionReason = !newState.channelId
          ? 'disconnected'
          : (oldState.channelId && oldState.channelId !== newState.channelId ? 'channel_moved' : 'state_refreshed');
        const context = this.getVoiceRequestContext(newState.guild.id);
        if (!newState.channelId) {
          // Bot was disconnected. Apply short grace period to avoid stopping playback
          // on transient Discord voice transitions.
          logger.info({
            guildId: newState.guild.id,
            oldChannelId: oldState.channelId,
            newChannelId: newState.channelId,
            requestId: context?.requestId,
            reason: transitionReason,
            graceMs: this.transientVoiceDisconnectGraceMs,
          }, 'VOICE_CONNECT: Bot disconnected from voice channel, scheduling grace stop');

          this.clearPendingVoiceDisconnectStop(newState.guild.id);
          const disconnectTimer = setTimeout(async () => {
            this.pendingVoiceDisconnectStops.delete(newState.guild.id);
            const activeConnection = getVoiceConnection(newState.guild.id);
            if (activeConnection?.joinConfig.channelId) {
              logger.info({
                guildId: newState.guild.id,
                channelId: activeConnection.joinConfig.channelId,
              }, 'VOICE_CONNECT: Skipping delayed stop because voice connection recovered');
              return;
            }

            this.voiceManager.clearVoiceServerData(newState.guild.id);
            this.voiceManager.clearVoiceStateData(newState.guild.id);

            await this.redisManager.publish('discord-bot:commands', {
              guildId: newState.guild.id,
              type: 'stop',
              reason: 'voice_disconnect'
            });

            logger.warn({
              guildId: newState.guild.id,
              requestId: context?.requestId,
            }, 'VOICE_CONNECT: Executed delayed stop after disconnect grace period');
          }, this.transientVoiceDisconnectGraceMs);

          this.pendingVoiceDisconnectStops.set(newState.guild.id, disconnectTimer);
        } else {
          this.clearPendingVoiceDisconnectStop(newState.guild.id);
          // Bot joined or moved channel
          if (newState.sessionId) {
            this.voiceManager.setVoiceStateData(newState.guild.id, newState.sessionId, newState.channelId);
          }
          logger.info({
            guildId: newState.guild.id,
            oldChannelId: oldState.channelId,
            channelId: newState.channelId,
            sessionId: newState.sessionId,
            requestId: context?.requestId,
            reason: transitionReason,
          }, 'VOICE_CONNECT: Bot voice state updated');
        }
      }

      // Listener Limit Check
      // Check if a user joined the channel where the bot is currently playing
      const botChannelId = newState.guild.members.me?.voice.channelId;
      if (botChannelId && newState.channelId === botChannelId && !newState.member?.user.bot) {
        // A user joined the bot's channel
        const channel = newState.channel;
        if (channel && channel.isVoiceBased()) {
          const memberCount = channel.members.filter(m => !m.user.bot).size;

          try {
            // Get guild owner's tier (or guild subscription if implemented)
            // For now, we check the guild owner's subscription
            const { subscriptionService } = await import('@discord-bot/database');
            const { getQuotaForTier } = await import('@discord-bot/config');

            const dbTier = await subscriptionService.getUserTier(newState.guild.ownerId);

            // Map database tier (uppercase) to config tier (lowercase)
            // FREE -> free, GOLD -> basic, DIAMOND -> premium
            let configTier: 'free' | 'basic' | 'premium' | 'enterprise' = 'free';
            if (dbTier === 'GOLD') configTier = 'basic';
            else if (dbTier === 'DIAMOND') configTier = 'premium';
            else if (dbTier === 'ENTERPRISE') configTier = 'enterprise';

            const maxListeners = getQuotaForTier(configTier, 'maxListeners');

            if (maxListeners !== -1 && memberCount > maxListeners) {
              logger.warn({
                guildId: newState.guild.id,
                memberCount,
                maxListeners,
                tier: configTier
              }, 'Listener limit exceeded');

              // Send warning to the last known UI channel
              const textChannelId = this.lastUIChannel.get(this.getUIChannelMapKey(newState.guild.id, botChannelId));
              if (textChannelId) {
                const textChannel = await newState.guild.channels.fetch(textChannelId);
                if (textChannel?.isTextBased() && 'send' in textChannel) {
                  await textChannel.send({
                    content: `⚠️ **Listener Limit Exceeded**\nYour current plan (**${dbTier}**) supports up to **${maxListeners}** listeners. There are currently **${memberCount}** users in the channel.\n\nPlease upgrade to **Premium** or **Enterprise** for unlimited listeners.`
                  });
                }
              }
            }

          } catch (error) {
            logger.error({ error }, 'Failed to check listener limits');
          }
        }
      }
    });


    // Handle raw voice events for Lavalink
    client.on(Events.Raw, (d) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const packet = d as any;
      if (!['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(packet.t)) return;

      const guildId = packet.d.guild_id;
      if (!guildId) return;

      // Store voice server data when received
      if (packet.t === 'VOICE_SERVER_UPDATE') {
        this.voiceManager.setVoiceServerData(guildId, packet.d.token, packet.d.endpoint);
      } else if (packet.t === 'VOICE_STATE_UPDATE') {
        // Only forward voice state updates for the bot itself
        if (client.user?.id && packet.d.user_id !== client.user.id) {
          return;
        }
        if (packet.d.session_id) {
          this.voiceManager.setVoiceStateData(guildId, packet.d.session_id, packet.d.channel_id ?? null);
        }
      }
      const counter = this.trackVoiceEvent(guildId, packet.t as 'VOICE_STATE_UPDATE' | 'VOICE_SERVER_UPDATE');

      // Forward to Audio service via dedicated Redis client
      // Lavalink needs these events to establish voice connection
      logger.info({
        type: packet.t,
        guildId,
        requestId: counter.requestId,
        voiceChannelId: packet.d.channel_id,
        expectedVoiceChannelId: counter.voiceChannelId,
        voiceStateUpdateCount: counter.voiceStateUpdates,
        voiceServerUpdateCount: counter.voiceServerUpdates,
        endpoint: packet.t === 'VOICE_SERVER_UPDATE' ? packet.d.endpoint : undefined,
        hasToken: packet.t === 'VOICE_SERVER_UPDATE' ? !!packet.d.token : undefined,
        sessionId: packet.t === 'VOICE_STATE_UPDATE' ? packet.d.session_id : undefined
      }, 'GATEWAY_RAW: Forwarding voice event to discord-bot:voice-events');
      this.redisManager.getAudioClient().publish('discord-bot:voice-events', JSON.stringify(packet))
        .then(() => logger.debug({ type: packet.t, guildId }, 'GATEWAY_RAW: Successfully published voice event'))
        .catch(error => logger.error({ error }, 'Failed to forward voice event to Audio service'));
    });

    // Fallback: forward VOICE_SERVER_UPDATE via dedicated event to avoid missing tokens/endpoints
    // Some gateway/client states may not surface this via Raw in time for Audio service.
    client.on(Events.VoiceServerUpdate, (data) => {
      try {
        const guildId = data.guild_id;
        if (!guildId) return;

        const existing = this.voiceManager.getVoiceServerData(guildId);
        const isRecent = existing?.processedAt && (Date.now() - existing.processedAt) < 5000;
        const isSame = existing?.token === data.token && existing?.endpoint === data.endpoint;
        if (isRecent && isSame) {
          return;
        }

        this.voiceManager.setVoiceServerData(guildId, data.token, data.endpoint);
        const counter = this.trackVoiceEvent(guildId, 'VOICE_SERVER_UPDATE');

        const packet = {
          t: 'VOICE_SERVER_UPDATE',
          d: data
        };

        logger.info({
          type: 'VOICE_SERVER_UPDATE',
          guildId,
          requestId: counter.requestId,
          voiceChannelId: counter.voiceChannelId,
          voiceStateUpdateCount: counter.voiceStateUpdates,
          voiceServerUpdateCount: counter.voiceServerUpdates,
          endpoint: data.endpoint,
          hasToken: !!data.token
        }, 'GATEWAY_RAW: Forwarding voice event to discord-bot:voice-events (fallback)');
        this.redisManager.getAudioClient().publish('discord-bot:voice-events', JSON.stringify(packet))
          .then(() => logger.debug({ type: 'VOICE_SERVER_UPDATE', guildId }, 'GATEWAY_RAW: Successfully published voice event (fallback)'))
          .catch(error => logger.error({ error }, 'Failed to forward voice event to Audio service (fallback)'));
      } catch (error) {
        logger.error({ error }, 'Failed to process VoiceServerUpdate event');
      }
    });

    // Login to Discord
    await this.discordClientManager.login(env.DISCORD_TOKEN);
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down Gateway application...');

    for (const timer of this.pendingVoiceDisconnectStops.values()) {
      clearTimeout(timer);
    }
    this.pendingVoiceDisconnectStops.clear();

    if (this.healthServer) {
      await this.healthServer.stop();
    }

    if (this.discordClientManager) {
      await this.discordClientManager.logout();
    }

    if (this.redisManager) {
      await this.redisManager.disconnect();
    }

    logger.info('Gateway application shutdown complete');
  }

  private cleanupActiveInteractions(): void {
    const now = Date.now();
    const expiryTime = 3600000; // 1 hour

    let cleanedCount = 0;
    for (const [key, info] of this.activeInteractions.entries()) {
      if (now - info.lastUpdated > expiryTime) {
        this.activeInteractions.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount, remaining: this.activeInteractions.size }, 'Cleaned up expired interaction tracking entries');
    }
  }
}
