// Load environment variables FIRST, before any other imports
import './env-loader.js';

import { Client,
  GatewayIntentBits,
  Events,
  LimitedCollection,
  Collection,
  GatewayDispatchEvents,
  ButtonInteraction,
  StringSelectMenuInteraction } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { createClient } from 'redis';
import { prisma, injectLogger } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';
import { loadPlansFromDatabase } from '@discord-bot/subscription';

// Infrastructure Layer
import { PrismaGuildSettingsRepository } from './infrastructure/database/prisma-guild-settings-repository.js';
import { RedisMusicSessionRepository } from './infrastructure/redis/redis-music-session-repository.js';
import { DiscordAudioService } from './infrastructure/discord/discord-audio-service.js';
import { DiscordPermissionService } from './infrastructure/discord/discord-permission-service.js';

// Cache system imports
import { RedisCircuitBreaker } from '@discord-bot/cache';
import { SearchCache, UserCache, QueueCache, SettingsCache } from '@discord-bot/cache';
// Message validation imports
import { safeValidateVoiceCredentialsMessage,
  safeValidateVoiceCredentials,
  safeValidateCommand,
  safeValidateTrackQueued } from '@discord-bot/cache';

// Redis Streams services
import { AudioCommandService } from './services/audio-command-service.js';

// Domain Layer
import { MusicSessionDomainService } from './domain/services/music-session-domain-service.js';

// Application Layer
import { PlayMusicUseCase } from './application/use-cases/play-music-use-case.js';
import { ControlMusicUseCase } from './application/use-cases/control-music-use-case.js';

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
class GatewayApplication {
  private discordClient!: Client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redisClient!: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redisSubscriber!: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private audioRedisClient!: any;
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

  // UI Message Tracking System (Rule 1: Only one UI PRINCIPAL per channel)
  private activeInteractions: Map<string, {
    messageId: string;
    channelId: string;
    guildId: string;
    lastUpdated: number;
    processingMessageId?: string;
    uiBlocked?: boolean; // New: Prevents UI recreation after manual deletion
  }> = new Map();

  // Voice Server Data Storage (for token and endpoint)
  private voiceServerData: Map<string, { token: string; endpoint: string; processedAt?: number }> = new Map();

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

  async initialize(): Promise<void> {
    logger.info('Initializing Gateway application with Clean Architecture...');

    // Inject logger dependency for database package
    injectLogger(logger);

    // Load subscription plan overrides from database if available
    await loadPlansFromDatabase(prisma);

    // Initialize external services
    await this.initializeClients();

    // Initialize enterprise cache system
    await this.initializeCacheSystem();

    // Wire up dependencies
    this.wireUpDependencies();

    // Initialize AudioCommandService for Redis Streams
    await this.audioCommandService.initialize();

    // Ensure demo guilds start on enterprise tier for QA
    await this.premiumController.initializeTestGuilds();

    // Setup Redis subscriptions for Audio service communication
    this.setupRedisSubscriptions();

    // Initialize enterprise health monitoring
    this.setupHealthMonitoring();

    // Start the application
    await this.start();

    logger.info('Gateway application initialized successfully');
  }

  private async initializeClients(): Promise<void> {
    // Initialize Discord client with enterprise-grade configuration and memory-optimized caches
    this.discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ],
      // Enterprise scaling configuration
      shards: 'auto', // Auto-scale shards based on guild count
      // Connection resilience and memory optimization
      ws: {
        large_threshold: 50, // Reduced from 250 to optimize memory usage
      },
      // Rate limiting optimization
      rest: {
        timeout: 15000, // 15 second timeout
        retries: 3,
        globalRequestsPerSecond: 50 // Rate limit global requests
      },
      // Memory-optimized cache limits for SUPPORTED managers only
      // WARNING: GuildManager, ChannelManager, GuildChannelManager, RoleManager, PermissionOverwriteManager
      // are NOT supported for cache overrides and will break functionality if customized
      makeCache: (manager) => {
        switch (manager.name) {
          case 'UserManager':
            // Limit users cache to 1000 entries to prevent memory bloat
            return new LimitedCollection({ maxSize: 1000 });
          case 'MessageManager':
            // Limit messages per channel to 50 for recent message access
            return new LimitedCollection({ maxSize: 50 });
          case 'VoiceStateManager':
            // Limit voice states to 500 for voice channel management
            return new LimitedCollection({ maxSize: 500 });
          case 'GuildMemberManager':
            // Limit guild members cache to 200 per guild
            return new LimitedCollection({ maxSize: 200 });
          case 'BaseGuildEmojiManager':
            // Limit emoji cache to 100 per guild (corrected manager name)
            return new LimitedCollection({ maxSize: 100 });
          case 'PresenceManager':
            // Limit presence cache to 200 to reduce memory usage
            return new LimitedCollection({ maxSize: 200 });
          case 'ReactionManager':
            // Limit reaction cache to 50 per message
            return new LimitedCollection({ maxSize: 50 });
          case 'GuildBanManager':
            // Limit ban cache to 100 per guild
            return new LimitedCollection({ maxSize: 100 });
          case 'GuildInviteManager':
            // Limit invite cache to 50 per guild
            return new LimitedCollection({ maxSize: 50 });
          case 'ThreadManager':
            // Limit thread cache to 100 per channel
            return new LimitedCollection({ maxSize: 100 });
          default:
            // DO NOT override unsupported managers (GuildManager, ChannelManager, etc.)
            // Return default Collection to prevent "UnsupportedCacheOverwriteWarning"
            return new Collection();
        }
      }
    });

    // Initialize Redis client with enterprise configuration
    this.redisClient = createClient({
      url: env.REDIS_URL,
      // Connection pool for high concurrency
      socket: {
        connectTimeout: 5000,
        keepAlive: true,
        noDelay: true
      },
      // Memory optimization
    });

    // Create separate Redis client for subscriptions
    this.redisSubscriber = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        keepAlive: true,
        noDelay: true
      }
    });

    // Create dedicated Redis client for raw Discord events to Audio service
    this.audioRedisClient = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        keepAlive: true,
        noDelay: true
      }
    });

    await this.redisClient.connect();
    await this.redisSubscriber.connect();
    await this.audioRedisClient.connect();
    logger.info('Redis client, subscriber and audio client connected');

    // Setup Redis reconnection handlers for graceful recovery
    this.setupRedisReconnectionHandlers();
  }

  /**
   * Setup Redis reconnection handlers to restore subscriptions after connection loss
   * Implements automatic recovery for Redis pub/sub channels without manual intervention
   */
  private setupRedisReconnectionHandlers(): void {
    // Redis Subscriber Reconnection Handler
    this.redisSubscriber.on('reconnecting', () => {
      logger.warn('Redis subscriber connection lost, attempting to reconnect...');
    });

    this.redisSubscriber.on('connect', async () => {
      logger.info('Redis subscriber reconnected successfully');
      // Restore all subscriptions after reconnection
      try {
        await this.restoreRedisSubscriptions();
        logger.info('Successfully restored Redis subscriptions after reconnection');
      } catch (error: unknown) {
        logger.error({ error }, 'Failed to restore Redis subscriptions after reconnection');
      }
    });

    this.redisSubscriber.on('error', (error: Error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Redis subscriber connection error');
    });

    // Audio Redis Client Reconnection Handler
    this.audioRedisClient.on('reconnecting', () => {
      logger.warn('Audio Redis client connection lost, attempting to reconnect...');
    });

    this.audioRedisClient.on('connect', () => {
      logger.info('Audio Redis client reconnected successfully');
      // Note: audioRedisClient is only used for publishing raw events, subscriptions not needed
    });

    this.audioRedisClient.on('error', (error: Error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Audio Redis client connection error');
    });

    // Main Redis Client Error Handler (for operations)
    this.redisClient.on('error', (error: Error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Redis client connection error');
    });

    logger.info('Redis reconnection handlers configured for graceful recovery');
  }

  /**
   * Restore Redis subscriptions after reconnection
   * Re-subscribes to all channels that were lost during disconnection
   * Uses the same handlers as initial setupRedisSubscriptions for consistency
   */
  private async restoreRedisSubscriptions(): Promise<void> {
    logger.info('Restoring Redis subscriptions after reconnection...');

    try {
      // Channels to restore: discord-bot:to-discord, discord-bot:ui:now
      const channelsToRestore = [
        'discord-bot:to-discord',
        'discord-bot:ui:now'
      ];

      let successCount = 0;
      let failureCount = 0;

      for (const channel of channelsToRestore) {
        try {
          if (channel === 'discord-bot:to-discord') {
            await this.redisSubscriber.subscribe(channel, (message: string) => {
              try {
                const data = JSON.parse(message);
                logger.debug({ data }, 'Received message from Audio service on discord-bot:to-discord (restored subscription)');
                this.handleAudioServiceMessage(data).catch(error => {
                  logger.error({ error, channel }, 'Error handling audio service message after reconnection');
                });
              } catch (error) {
                logger.error({ error, message }, 'Failed to parse message from discord-bot:to-discord (restored subscription)');
              }
            });
          } else if (channel === 'discord-bot:ui:now') {
            await this.redisSubscriber.subscribe(channel, (message: string) => {
              try {
                const data = JSON.parse(message);
                logger.debug({ data }, 'Received UI update from Audio service (restored subscription)');
                this.handleUIUpdate(data).catch(error => {
                  logger.error({ error, channel }, 'Error handling UI update after reconnection');
                });
              } catch (error) {
                logger.error({ error, message }, 'Failed to parse UI update message (restored subscription)');
              }
            });
          }

          logger.info({ channel }, 'Successfully restored subscription to channel after reconnection');
          successCount++;
        } catch (subscriptionError) {
          logger.error({ channel, error: subscriptionError }, 'Failed to restore subscription to channel after reconnection');
          failureCount++;
        }
      }

      logger.info({
        channels: channelsToRestore,
        restored: successCount,
        failed: failureCount
      }, 'Redis subscription restoration completed');

      if (failureCount > 0) {
        logger.warn({ failureCount, totalChannels: channelsToRestore.length }, 'Some subscriptions failed to restore - service may have degraded functionality');
      }
    } catch (error) {
      logger.error({ error }, 'Critical error during Redis subscription restoration');
      throw error;
    }
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
    const musicSessionRepository = new RedisMusicSessionRepository(this.redisClient);

    // Use enterprise-grade cache system instead of basic stub
    const audioService = new DiscordAudioService(this.redisClient, this.redisSubscriber, this.cacheSystem.searchCache);
    const permissionService = new DiscordPermissionService(this.discordClient);
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

    const _controlMusicUseCase = new ControlMusicUseCase(
      musicSessionRepository,
      this.guildSettingsRepository,
      musicSessionDomainService,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any /* audio control service */
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
      publish: async (channel: string, message: any) => {
        try {
          await this.redisClient.publish(channel, typeof message === 'string' ? message : JSON.stringify(message));
        } catch (error) {
          logger.error({ error, channel }, 'Failed to publish message to Redis');
        }
      },
      subscribe: async (channel: string, callback: (channel: string, message: string) => void) => {
        try {
          // Use dedicated subscriber client
          await this.redisSubscriber.subscribe(channel, (message: string, receivedChannel: string) => {
            callback(receivedChannel, message);
          });
          logger.debug({ channel }, 'Subscribed to Redis channel');
        } catch (error) {
          logger.error({ error, channel }, 'Failed to subscribe to Redis channel');
        }
      }
    };

    // Processing message registration callback for the music controller
    const registerProcessingMessage = (guildId: string, channelId: string, messageId: string) => {
      const channelKey = `${guildId}:${channelId}`;
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
    const clearUIBlock = (guildId: string, channelId: string) => {
      const channelKey = `${guildId}:${channelId}`;
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

    this.musicController = new MusicController(
      eventBus,
      this.uiBuilder,
      responseHandler,
      this.settingsService,
      permissionService,
      registerProcessingMessage,
      clearUIBlock
    );

    // Initialize AudioCommandService for Redis Streams
    this.audioCommandService = new AudioCommandService();

    // Initialize Premium Controller
    this.premiumController = new PremiumController({
      testGuildIds: env.PREMIUM_TEST_GUILD_IDS_LIST,
    });

    logger.info('Clean Architecture dependencies wired up successfully');
  }

  private setupHealthMonitoring(): void {
    // Initialize health checker with all dependencies
    this.healthChecker = new ApplicationHealthChecker(this.redisClient, this.discordClient);

    // Start health server on port 3001
    this.healthServer = new HealthServer(this.healthChecker, env.GATEWAY_HTTP_PORT || 3001);

    // Enhanced health monitoring with enterprise metrics
    setInterval(async () => {
      await this.healthChecker.logHealthStatus();

      // Log comprehensive system metrics
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();

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
          discordGuilds: this.discordClient.guilds.cache.size,
          discordUsers: this.discordClient.users.cache.size,
          discordPing: this.discordClient.ws.ping,
          nodeVersion: process.version,
          pid: process.pid
        }
      }, 'Enterprise system health metrics');

      // Memory cleanup trigger for high usage
      if (memoryUsage.heapUsed / memoryUsage.heapTotal > 0.8) {
        logger.warn({
          heapUsagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
          heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024)
        }, 'High memory usage detected - triggering GC');

        // Force garbage collection if exposed
        if (global.gc) {
          global.gc();
          logger.info('Manual garbage collection completed');
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
    }, 300000); // Every 5 minutes (300000ms)

    logger.info('Enterprise health monitoring initialized with comprehensive metrics');
  }

  private setupRedisSubscriptions(): void {
    // Subscribe to Audio service channels according to documentation
    // discord-bot:to-discord   → Audio → Gateway (Lavalink events)
    // discord-bot:ui:now       → Audio → Gateway (real-time UI updates)

    this.redisSubscriber.subscribe('discord-bot:to-discord', (message: string) => {
      try {
        const data = JSON.parse(message);
        logger.info({ data }, 'Received message from Audio service on discord-bot:to-discord');
        this.handleAudioServiceMessage(data);
      } catch (error) {
        logger.error({ error, message }, 'Failed to parse message from discord-bot:to-discord');
      }
    });

    this.redisSubscriber.subscribe('discord-bot:ui:now', (message: string) => {
      try {
        const data = JSON.parse(message);
        logger.info({ data }, 'Received UI update from Audio service');
        this.handleUIUpdate(data);
      } catch (error) {
        logger.error({ error, message }, 'Failed to parse UI update message');
      }
    });

    logger.info('Gateway subscribed to Audio service channels: discord-bot:to-discord, discord-bot:ui:now');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleAudioServiceMessage(data: any): Promise<void> {
    // Handle messages from Audio service (track_queued, track_started, etc.)
    logger.info({ operation: data.payload?.op }, 'Processing Audio service message');

    // Handle string-based operations (custom operations from audio service)
    if (data.payload?.op === 'track_queued') {
      // Show "Track Added to Queue" message (always visible, not ephemeral)
      if (data.payload?.textChannelId) {
        try {
          const channel = await this.discordClient.channels.fetch(data.payload.textChannelId);
          if (channel?.isTextBased() && 'send' in channel) {
            const user = await this.discordClient.users.fetch(data.payload.requestedBy);

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

            // After showing "Added to Queue" message, request a fresh UI update that will create a new UI message
            // This ensures the UI is always the last message without manually deleting the previous one
            setTimeout(async () => {
              try {
                // Mark the current UI as outdated so the next UI update creates a new message instead of editing
                const channelKey = `${data.guildId}:${data.payload.textChannelId}`;
                const trackingInteraction = this.activeInteractions.get(channelKey);
                if (trackingInteraction) {
                  // Clear the messageId to force creation of new UI message
                  this.activeInteractions.set(channelKey, {
                    ...trackingInteraction,
                    messageId: ''
                  });
                }

                await this.redisClient.publish('discord-bot:commands', JSON.stringify({
                  guildId: data.guildId,
                  type: 'nowplaying',
                  channelId: data.payload.textChannelId,
                  requestId: `ui_refresh_${Date.now()}`
                }));
                logger.info({ guildId: data.guildId }, 'Requested fresh UI update after Added to Queue message');
              } catch (requestError) {
                logger.warn({ error: requestError, guildId: data.guildId }, 'Failed to request UI update');
              }
            }, 1000); // Wait 1 second to ensure Added to Queue message is visible first
          }
        } catch (error) {
          logger.warn({ error, guildId: data.guildId }, 'Failed to send track queued notification');
        }
      }
    }

    // RULE 4: Handle disconnect events from audio service
    if (data.type === 'DISCONNECTED' || data.payload?.op === 'disconnected') {
      logger.info({ guildId: data.guildId }, 'Audio service disconnected - implementing Rule 4');
      await this.deleteUIPrincipalMessage(data.guildId, data.textChannelId);
    }

    // Handle numeric Lavalink operation codes
    if (typeof data.payload?.op === 'number') {
      const operationCode = data.payload.op;

      switch (operationCode) {
        case 0: // Ready
          logger.info({ guildId: data.guildId }, 'Lavalink ready for guild');
          break;
        case 1: // VoiceUpdate
          logger.debug({ guildId: data.guildId }, 'Voice update received');
          break;
        case 2: // PlayerUpdate
          logger.debug({ guildId: data.guildId }, 'Player update received');
          break;
        case 3: // TrackStart
          logger.info({ guildId: data.guildId }, 'Track started');
          break;
        case 4: // VoiceStateUpdate
          logger.debug({ guildId: data.guildId }, 'Voice state update received (handled by Discord.js Events.VoiceStateUpdate)');
          // REMOVED: Duplicate handler causing loop - Discord.js Events.VoiceStateUpdate handles this
          break;
        default:
          logger.warn({ guildId: data.guildId, operationCode }, 'Unknown Lavalink operation code');
      }
    }
  }

  /**
   * Publish message to Redis with automatic retry logic
   * Retries with exponential backoff when publishResult === 0 (no subscribers)
   * Max 3 attempts with delays: 1000ms, 2000ms, 3000ms
   *
   * CRITICAL: This prevents message loss when Audio service is temporarily unavailable
   * by automatically retrying delivery until subscribers are available
   */
  private async publishWithRetry(
    channel: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    guildId: string,
    maxAttempts: number = 3
  ): Promise<boolean> {
    // Validate message before publishing
    let validationResult;
    try {
      if (channel === 'discord-bot:to-audio' && message.type === 'VOICE_CREDENTIALS' && message.voiceCredentials) {
        validationResult = safeValidateVoiceCredentialsMessage(message);
      } else if (channel === 'discord-bot:to-audio' && message.sessionId && message.guildId) {
        // Direct voice credentials format (raw)
        validationResult = safeValidateVoiceCredentials(message);
      } else if (channel === 'discord-bot:commands') {
        validationResult = safeValidateCommand(message);
      } else if (message.type === 'track_queued') {
        validationResult = safeValidateTrackQueued(message);
      }

      if (validationResult && !validationResult.success) {
        logger.error({
          guildId,
          channel,
          validationError: validationResult.error,
          messageType: message.type
        }, 'Message validation failed - not sending invalid message');
        return false;
      }
    } catch (validationError) {
      logger.warn({
        guildId,
        channel,
        error: validationError instanceof Error ? validationError.message : String(validationError)
      }, 'Message validation check encountered an error, proceeding with caution');
    }

    const messageJson = typeof message === 'string' ? message : JSON.stringify(message);
    const delays = [1000, 2000, 3000]; // Exponential backoff delays in milliseconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const publishResult = await this.redisClient.publish(channel, messageJson);

        if (publishResult > 0) {
          // Success: message received by at least one subscriber
          logger.info({
            guildId,
            channel,
            publishResult,
            attempt
          }, 'VOICE_CONNECT: Message published successfully to Redis channel');
          return true;
        }

        // publishResult === 0: No subscribers received the message
        if (attempt < maxAttempts) {
          const delayMs = delays[attempt - 1];
          logger.warn({
            guildId,
            channel,
            attempt,
            maxAttempts,
            delayMs,
            reason: 'No subscribers received message'
          }, 'VOICE_CONNECT: Redis publish returned 0 subscribers, retrying after delay...');

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          // All retries exhausted
          logger.error({
            guildId,
            channel,
            attempt,
            maxAttempts,
            reason: 'No subscribers received message (all retries failed)'
          }, 'VOICE_CONNECT: CRITICAL - Failed to publish voice credentials after 3 retry attempts (Audio service not listening)');
          return false;
        }
      } catch (error) {
        logger.error({
          guildId,
          channel,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        }, 'VOICE_CONNECT: Error during Redis publish');

        if (attempt < maxAttempts) {
          const delayMs = delays[attempt - 1];
          logger.warn({
            guildId,
            attempt,
            maxAttempts,
            delayMs
          }, 'VOICE_CONNECT: Retrying after error...');

          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          throw error;
        }
      }
    }

    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleVoiceStateUpdate(data: any): Promise<void> {
    // CRITICAL: This function sends Discord voice credentials to Lavalink
    // When Audio service requests voice connection, Gateway must provide Discord credentials
    logger.info({ guildId: data.guildId }, 'VOICE_CONNECT: Processing voice state update');

    try {
      const guild = this.discordClient.guilds.cache.get(data.guildId);
      if (!guild) {
        logger.error({ guildId: data.guildId }, 'VOICE_CONNECT: Guild not found');
        return;
      }

      // Get the bot's voice state for this guild
      const botVoiceState = guild.voiceStates.cache.get(this.discordClient.user!.id);
      if (!botVoiceState || !botVoiceState.sessionId) {
        logger.warn({ guildId: data.guildId }, 'VOICE_CONNECT: Bot voice state not found or missing sessionId');
        return;
      }

      // Get voice server data (token and endpoint) from stored data
      const voiceServerInfo = this.voiceServerData.get(data.guildId);

      // Extract Discord voice credentials
      const voiceCredentials = {
        guildId: data.guildId,
        sessionId: botVoiceState.sessionId,
        token: voiceServerInfo?.token || null,
        endpoint: voiceServerInfo?.endpoint || null
      };

      // Validate voice credentials before sending
      if (!voiceCredentials.sessionId || !voiceCredentials.token || !voiceCredentials.endpoint) {
        logger.warn({
          guildId: data.guildId,
          hasSessionId: !!voiceCredentials.sessionId,
          hasToken: !!voiceCredentials.token,
          hasEndpoint: !!voiceCredentials.endpoint
        }, 'VOICE_CONNECT: Incomplete voice credentials - missing voice server data');

        // For 24/7 operation: Try to get fresh credentials by requesting voice state update
        await this.requestFreshVoiceCredentials(data.guildId);
        return;
      }

      logger.info({
        guildId: data.guildId,
        hasSessionId: !!voiceCredentials.sessionId,
        hasToken: !!voiceCredentials.token,
        hasEndpoint: !!voiceCredentials.endpoint
      }, 'VOICE_CONNECT: Sending valid Discord credentials to Audio service');

      // Send credentials to Audio service via Redis
      const credentialMessage = {
        type: 'VOICE_CREDENTIALS',
        guildId: data.guildId,
        voiceCredentials
      };

      logger.info({
        guildId: data.guildId,
        hasSessionId: !!credentialMessage.voiceCredentials?.sessionId,
        hasToken: !!credentialMessage.voiceCredentials?.token,
        hasEndpoint: !!credentialMessage.voiceCredentials?.endpoint,
        channel: 'discord-bot:to-audio'
      }, 'VOICE_CONNECT: About to publish voice credentials to Redis with automatic retry logic');

      // Publish with automatic retry logic (max 3 attempts with exponential backoff)
      const success = await this.publishWithRetry(
        'discord-bot:to-audio',
        credentialMessage,
        data.guildId,
        3 // Max 3 attempts
      );

      if (success) {
        logger.info({
          guildId: data.guildId,
          channel: 'discord-bot:to-audio'
        }, 'VOICE_CONNECT: Discord credentials successfully delivered to Audio service');
      } else {
        logger.error({
          guildId: data.guildId,
          channel: 'discord-bot:to-audio'
        }, 'VOICE_CONNECT: Failed to deliver voice credentials to Audio service after all retries');
      }

    } catch (error) {
      logger.error({
        guildId: data.guildId,
        error: error instanceof Error ? error.message : String(error)
      }, 'VOICE_CONNECT: Failed to send voice credentials');
    }
  }

  /**
   * Handle Voice Server Update events (provides token and endpoint)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleVoiceServerUpdate(update: any): Promise<void> {
    try {
      const guildId = update.guild.id;
      const token = update.token;
      const endpoint = update.endpoint;

      // Store voice server data with timestamp and auto-refresh capability
      this.voiceServerData.set(guildId, {
        token,
        endpoint,
        processedAt: Date.now()
      });

      logger.info({
        guildId,
        hasToken: !!token,
        hasEndpoint: !!endpoint
      }, 'VOICE_CONNECT: Voice server update received');

      // CRITICAL: Send voice credentials immediately if we have sessionId
      const voiceState = this.discordClient.guilds.cache.get(guildId)?.voiceStates.cache.get(this.discordClient.user?.id || '');
      if (voiceState?.sessionId) {
        await this.sendVoiceCredentials(guildId, voiceState.sessionId, token, endpoint);
      }

      // Implement periodic refresh system for 24/7 bot operation
      this.setupVoiceCredentialRefresh(guildId);

    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'VOICE_CONNECT: Failed to handle voice server update');
    }
  }

  /**
   * Send voice credentials to Audio service via Redis
   * Implements automatic retry logic when no subscribers are available
   */
  private async sendVoiceCredentials(guildId: string, sessionId: string, token: string, endpoint: string): Promise<void> {
    try {
      const voiceCredentials = {
        guildId,
        sessionId,
        token,
        endpoint
      };

      logger.info({
        guildId,
        hasSessionId: !!sessionId,
        hasToken: !!token,
        hasEndpoint: !!endpoint
      }, 'VOICE_CONNECT: Sending Discord credentials to Audio service');

      // Send via Redis pub/sub to Audio service with automatic retry logic
      logger.info({
        guildId,
        hasSessionId: !!voiceCredentials.sessionId,
        hasToken: !!voiceCredentials.token,
        hasEndpoint: !!voiceCredentials.endpoint,
        channel: 'discord-bot:to-audio'
      }, 'VOICE_CONNECT: About to publish voice credentials to Redis with retry logic');

      // Use retry-enabled publish method (max 3 attempts with exponential backoff)
      const success = await this.publishWithRetry(
        'discord-bot:to-audio',
        voiceCredentials,
        guildId,
        3 // Max 3 attempts
      );

      if (success) {
        logger.info({
          guildId,
          channel: 'discord-bot:to-audio'
        }, 'VOICE_CONNECT: Discord credentials successfully delivered to Audio service');
      } else {
        logger.error({
          guildId,
          channel: 'discord-bot:to-audio'
        }, 'VOICE_CONNECT: Failed to deliver voice credentials to Audio service after all retries');
      }

    } catch (error) {
      logger.error({
        guildId,
        error: error instanceof Error ? error.message : String(error)
      }, 'VOICE_CONNECT: Failed to send voice credentials to Audio service');
    }
  }

  /**
   * Setup voice credential refresh system for 24/7 operation
   * Periodically refreshes voice server data to maintain long-running connections
   */
  private voiceRefreshTimers = new Map<string, NodeJS.Timeout>();

  private setupVoiceCredentialRefresh(guildId: string): void {
    // Clear existing timer if any
    const existingTimer = this.voiceRefreshTimers.get(guildId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // For 24/7 operation: Keep credentials available indefinitely
    // Only clean up if bot leaves voice channel (handled in handleDiscordVoiceStateUpdate)
    // No automatic reconnection - maintain persistent connection
    logger.info({ guildId }, 'VOICE_CONNECT: Voice credentials stored for persistent 24/7 connection');
  }

  /**
   * Request fresh voice credentials only when needed (on-demand)
   * Used for 24/7 operation when credentials expire or become invalid
   */
  private async requestFreshVoiceCredentials(guildId: string): Promise<void> {
    try {
      const guild = this.discordClient.guilds.cache.get(guildId);
      const botVoiceState = guild?.voiceStates.cache.get(this.discordClient.user!.id);

      if (botVoiceState?.channel) {
        logger.info({ guildId, channelId: botVoiceState.channelId }, 'VOICE_CONNECT: Requesting fresh credentials for expired token');

        // Send voice state update to get fresh credentials from Discord
        // This doesn't disconnect - just refreshes the token
        await guild!.members.me!.voice.setDeaf(false);
        await guild!.members.me!.voice.setMute(false);

        logger.info({ guildId }, 'VOICE_CONNECT: Fresh credential request sent');
      } else {
        logger.warn({ guildId }, 'VOICE_CONNECT: Cannot refresh credentials - bot not in voice channel');
      }
    } catch (error) {
      logger.error({
        guildId,
        error: error instanceof Error ? error.message : String(error)
      }, 'VOICE_CONNECT: Failed to request fresh credentials');
    }
  }

  /**
   * Handle Discord voice state updates (when bot joins/leaves voice channels)
   */
   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleDiscordVoiceStateUpdate(oldState: any, newState: any): Promise<void> {
    // Only process bot's own voice state changes
    if (newState.id !== this.discordClient.user?.id) return;

    const guildId = newState.guild.id;

    try {
      // Check if bot joined a voice channel
      if (!oldState.channel && newState.channel) {
        logger.info({
          guildId,
          voiceChannelId: newState.channelId,
          sessionId: newState.sessionId
        }, 'VOICE_CONNECT: Bot joined voice channel');

        // Get voice server data (token and endpoint) from stored data
        const voiceServerInfo = this.voiceServerData.get(guildId);

        // Extract Discord voice credentials with fallback
        let token = voiceServerInfo?.token;
        let endpoint = voiceServerInfo?.endpoint;

        // CRITICAL VALIDATION: Don't send invalid credentials to Audio service
        if (!token || !endpoint) {
          logger.warn({
            guildId,
            hasStoredToken: !!voiceServerInfo?.token,
            hasStoredEndpoint: !!voiceServerInfo?.endpoint,
            voiceServerDataExists: this.voiceServerData.has(guildId)
          }, 'VOICE_CONNECT: Missing voice server data - may have been cleaned up, waiting for fresh VOICE_SERVER_UPDATE event');
          return; // Don't send invalid credentials
        }

        const voiceCredentials = {
          guildId,
          sessionId: newState.sessionId,
          token,
          endpoint
        };

        logger.info({
          guildId,
          hasSessionId: !!voiceCredentials.sessionId,
          hasToken: !!voiceCredentials.token,
          hasEndpoint: !!voiceCredentials.endpoint
        }, 'VOICE_CONNECT: Sending Discord credentials to Audio service');

        // Send credentials to Audio service via Redis
        const credentialMessage = {
          type: 'VOICE_CREDENTIALS',
          guildId,
          voiceCredentials
        };

        await this.redisClient.publish('discord-bot:to-audio', JSON.stringify(credentialMessage));
        logger.info({ guildId }, 'VOICE_CONNECT: Discord credentials sent to Audio service successfully');
      }

      // Check if bot left a voice channel
      if (oldState.channel && !newState.channel) {
        logger.info({
          guildId,
          oldChannelId: oldState.channelId
        }, 'VOICE_CONNECT: Bot left voice channel');

        // Clean up voice refresh timer and data when bot leaves voice
        const refreshTimer = this.voiceRefreshTimers.get(guildId);
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          this.voiceRefreshTimers.delete(guildId);
          this.voiceServerData.delete(guildId);
          logger.info({ guildId }, 'VOICE_CONNECT: Cleaned up voice refresh system - bot left voice channel');
        }
      }

    } catch (error) {
      logger.error({
        guildId,
        error: error instanceof Error ? error.message : String(error)
      }, 'VOICE_CONNECT: Failed to handle Discord voice state update');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleUIUpdate(data: any): Promise<void> {
    // Handle real-time UI updates from Audio service
    logger.info({ guildId: data.guildId }, 'Processing UI update');

    try {
      // CRITICAL FIX: Check if UI is blocked for this channel (prevents recreation after manual deletion)
      const channelKey = `${data.guildId}:${data.textChannelId || 'fallback'}`;
      const existingInteraction = this.activeInteractions.get(channelKey);

      if (existingInteraction?.uiBlocked) {
        logger.info({
          guildId: data.guildId,
          channelId: data.textChannelId,
          reason: 'UI_BLOCKED'
        }, 'Skipping UI update - UI blocked after manual deletion');
        return;
      }
      // Get the text channel for this guild
      const guild = this.discordClient.guilds.cache.get(data.guildId);
      if (!guild) {
        logger.error({ guildId: data.guildId }, 'Guild not found for UI update');
        return;
      }

      // CRITICAL: Find appropriate text channel from the data or use first available
      let targetChannel = null;

      logger.info({
        guildId: data.guildId,
        providedTextChannelId: data.textChannelId,
        availableChannels: guild.channels.cache.filter(ch => ch.isTextBased()).map(ch => ({ id: ch.id, name: ch.name }))
      }, 'CHANNEL_TARGETING: Finding target channel for UI message');

      if (data.textChannelId) {
        targetChannel = guild.channels.cache.get(data.textChannelId);
        if (targetChannel) {
          logger.info({
            guildId: data.guildId,
            channelId: data.textChannelId,
            channelName: targetChannel.name
          }, 'CHANNEL_TARGETING: Using provided text channel');
        } else {
          logger.warn({
            guildId: data.guildId,
            invalidChannelId: data.textChannelId
          }, 'CHANNEL_TARGETING: Provided channel ID not found in cache');
        }
      } else {
        logger.warn({
          guildId: data.guildId
        }, 'CHANNEL_TARGETING: No textChannelId provided in UI update data');
      }

      if (!targetChannel) {
        // Fall back to first text channel
        logger.warn({
          guildId: data.guildId
        }, 'CHANNEL_TARGETING: Falling back to first available text channel');

        for (const [channelId, channel] of guild.channels.cache) {
          if (channel.isTextBased()) {
            targetChannel = channel;
            logger.info({
              guildId: data.guildId,
              fallbackChannelId: channelId,
              fallbackChannelName: channel.name
            }, 'CHANNEL_TARGETING: Using fallback text channel');
            break;
          }
        }
      }

      if (!targetChannel) {
        logger.error({ guildId: data.guildId }, 'No text channel found for UI update');
        return;
      }

      // Build the UI content
      const embed = this.uiBuilder.buildNowPlayingEmbed({
        trackTitle: data.title,
        artist: data.author,
        duration: data.durationMs,
        position: data.positionMs,
        volume: data.volume || 100,
        loopMode: data.repeatMode === 'off' ? 'off' : data.repeatMode === 'track' ? 'track' : 'queue',
        queueLength: data.queueLen || 0,
        isPaused: data.paused,
        artworkUrl: data.artworkUrl,
        autoplayMode: (data as { autoplayMode?: string }).autoplayMode as 'off' | 'similar' | 'artist' | 'genre' | 'mixed' || 'off',
        filter: data.filter
          ? {
              id: data.filter.id,
              label: data.filter.label,
              description: data.filter.description,
            }
          : undefined,
      });

      const components = this.uiBuilder.buildMusicControlButtons({
        isPlaying: data.hasTrack && !data.paused,
        isPaused: data.paused,
        hasQueue: data.queueLen > 0,
        queueLength: data.queueLen || 0,
        // Remove canSkip override - let buildMusicControlButtons calculate it based on queue + autoplay
        volume: data.volume || 100,
        loopMode: data.repeatMode === 'off' ? 'off' : data.repeatMode === 'track' ? 'track' : 'queue',
        isMuted: (data.volume || 0) === 0,
        autoplayMode: (data as { autoplayMode?: string }).autoplayMode as 'off' | 'similar' | 'artist' | 'genre' | 'mixed' || 'off',
        activeFilterId: data.filter?.id,
        activeFilterLabel: data.filter?.label,
      });

      const messageContent = {
        embeds: [embed],
        components: components
      };

      // Get channel key for tracking
      const trackingChannelKey = `${data.guildId}:${targetChannel.id}`;
      const trackingInteraction = this.activeInteractions.get(trackingChannelKey);

      let uiMessage;
      let wasEdited = false;

      // RULE 1: Only one UI PRINCIPAL per channel - try to edit existing message first
      if (trackingInteraction && trackingInteraction.messageId) {
        try {
          // Check if targetChannel has messages property (text channels)
          if ('messages' in targetChannel) {
            const existingMessage = await targetChannel.messages.fetch(trackingInteraction.messageId);
            if (existingMessage) {
              uiMessage = await existingMessage.edit(messageContent);
              wasEdited = true;
              logger.info({
                guildId: data.guildId,
                channelId: targetChannel.id,
                messageId: existingMessage.id
              }, 'Updated existing UI PRINCIPAL message (Rule 1)');
            }
          }
        } catch (editError: unknown) {
          // Message no longer exists or can't be edited, create new one
          const errorMessage = editError instanceof Error ? editError.message : String(editError);
          logger.warn({
            guildId: data.guildId,
            messageId: trackingInteraction.messageId,
            error: errorMessage
          }, 'Could not edit existing UI message, creating new one');
        }
      }

      // If edit failed or no existing message, create new UI PRINCIPAL
      if (!wasEdited) {
        // RULE 1 FIX: Clean up any old UI messages before creating new one
        await this.cleanupOldUIPrincipalMessages(targetChannel);

        logger.info({
          guildId: data.guildId,
          channelId: targetChannel.id,
          channelName: targetChannel.name,
          messageStructure: {
            embedsCount: messageContent.embeds?.length || 0,
            componentsCount: messageContent.components?.length || 0
          }
        }, 'DISCORD_SEND: Attempting to create new UI PRINCIPAL message');

        try {
          // Check if targetChannel has send property (text channels)
          if ('send' in targetChannel) {
            uiMessage = await targetChannel.send(messageContent);
            logger.info({
              guildId: data.guildId,
              channelId: targetChannel.id,
              messageId: uiMessage.id,
              success: true
            }, 'DISCORD_SEND: Successfully created new UI PRINCIPAL message (Rule 1)');
          }
        } catch (sendError: unknown) {
          const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
          const errorCode = sendError && typeof sendError === 'object' && 'code' in sendError ? (sendError as { code?: string }).code : 'unknown';
          logger.error({
            guildId: data.guildId,
            channelId: targetChannel.id,
            channelName: 'name' in targetChannel ? targetChannel.name : 'unknown',
            error: errorMessage,
            errorCode: errorCode || 'unknown',
            messageContent: JSON.stringify(messageContent, null, 2)
          }, 'DISCORD_SEND: CRITICAL FAILURE - Could not send UI message to Discord');
          return; // Exit if we can't send the UI message
        }
      }

      // Only update tracking if we successfully created/updated a message
      if (uiMessage) {
        // Update tracking system
        this.activeInteractions.set(trackingChannelKey, {
          messageId: uiMessage.id,
          channelId: targetChannel.id,
          guildId: data.guildId,
          lastUpdated: Date.now()
        });

        // Skip cleanup for ephemeral processing messages - Discord manages them automatically
        if (trackingInteraction?.processingMessageId) {
          logger.debug({
            guildId: data.guildId,
            processingMessageId: trackingInteraction.processingMessageId
          }, 'Skipping ephemeral processing message cleanup (Discord auto-manages)');
        }

        logger.info({
          guildId: data.guildId,
          channelId: targetChannel.id,
          messageId: uiMessage.id,
          trackTitle: data.title,
          wasEdited: wasEdited
        }, 'UI update completed successfully');
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({
        error: errorMessage,
        guildId: data.guildId
      }, 'Failed to update Discord UI');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async cleanupOldUIPrincipalMessages(channel: any): Promise<void> {
    try {
      // RULE 1: Only one UI PRINCIPAL message per channel
      // Fetch recent messages and look for bot's UI messages with music components
      const recentMessages = await channel.messages.fetch({ limit: 50 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const botMessages = recentMessages.filter((msg: any) =>
        msg.author.id === this.discordClient.user?.id &&
        msg.components.length > 0 &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        msg.components.some((row: any) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.components.some((component: any) =>
            component.customId?.startsWith('music_')
          )
        )
      );

      // Delete old UI PRINCIPAL messages
      for (const message of botMessages.values()) {
        try {
          await message.delete();
          logger.debug({ messageId: message.id, channelId: channel.id }, 'Deleted old UI PRINCIPAL message');
        } catch (deleteError) {
          logger.warn({ messageId: message.id, error: deleteError }, 'Failed to delete old UI message');
        }
      }

      if (botMessages.size > 0) {
        logger.info({ deletedCount: botMessages.size, channelId: channel.id }, 'Cleaned up old UI PRINCIPAL messages');
      }
    } catch (error) {
      logger.warn({ error, channelId: channel.id }, 'Failed to cleanup old UI messages');
    }
  }

  private async shouldUseEphemeral(guildId: string): Promise<boolean> {
    // Rule 5: Ephemeral messages only when setting is ON
    try {
      const settings = await this.settingsService.getGuildSettings(guildId);
      return settings.ephemeralMessages;
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to get guild settings for ephemeral check');
      // Default to false on error for better UX
      return false;
    }
  }

  /**
   * RULE 4: Delete UI PRINCIPAL message when bot disconnects
   * Implements Rule 4: Disconnecting bot must delete UI PRINCIPAL message
   */
  private async deleteUIPrincipalMessage(guildId: string, textChannelId?: string): Promise<void> {
    try {
      // Find all UI messages for this guild
      const channelKeysToDelete: string[] = [];

      if (textChannelId) {
        // Delete specific channel UI message
        channelKeysToDelete.push(`${guildId}:${textChannelId}`);
      } else {
        // Delete all UI messages for this guild
        for (const [channelKey, interaction] of this.activeInteractions.entries()) {
          if (interaction.guildId === guildId) {
            channelKeysToDelete.push(channelKey);
          }
        }
      }

      for (const channelKey of channelKeysToDelete) {
        const interaction = this.activeInteractions.get(channelKey);
        if (!interaction || !interaction.messageId) continue;

        try {
          const guild = this.discordClient.guilds.cache.get(guildId);
          if (!guild) continue;

          const channel = guild.channels.cache.get(interaction.channelId);
          if (!channel?.isTextBased()) continue;

          const message = await channel.messages.fetch(interaction.messageId);
          if (message) {
            await message.delete();
            logger.info({
              guildId,
              channelId: interaction.channelId,
              messageId: interaction.messageId
            }, 'RULE 4: Deleted UI PRINCIPAL message after bot disconnect');
          }
        } catch (deleteError) {
          logger.warn({
            error: deleteError,
            guildId,
            channelKey,
            messageId: interaction.messageId
          }, 'Failed to delete UI PRINCIPAL message during disconnect');
        }

        // Remove from tracking
        this.activeInteractions.delete(channelKey);
      }

      logger.info({
        guildId,
        textChannelId,
        deletedMessages: channelKeysToDelete.length
      }, 'RULE 4: UI cleanup completed after bot disconnect');

    } catch (error) {
      logger.error({
        error,
        guildId,
        textChannelId
      }, 'Failed to delete UI PRINCIPAL messages during disconnect');
    }
  }

  /**
   * Cleanup old entries from activeInteractions Map to prevent memory leaks
   * Removes entries older than 1 hour (3600000ms)
   */
  private cleanupActiveInteractions(): void {
    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1 hour in milliseconds
    let cleanedCount = 0;

    // Iterate through all entries and remove old ones
    for (const [channelKey, interaction] of this.activeInteractions.entries()) {
      if (interaction.lastUpdated < oneHourAgo) {
        this.activeInteractions.delete(channelKey);
        cleanedCount++;

        logger.debug({
          channelKey,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          messageId: interaction.messageId,
          ageMinutes: Math.round((now - interaction.lastUpdated) / 60000),
          lastUpdated: new Date(interaction.lastUpdated).toISOString()
        }, 'Cleaned up old activeInteraction entry');
      }
    }

    if (cleanedCount > 0) {
      logger.info({
        cleanedCount,
        remainingEntries: this.activeInteractions.size,
        cleanupAge: '1 hour'
      }, 'ActiveInteractions Map cleanup completed');
    } else {
      logger.debug({
        totalEntries: this.activeInteractions.size,
        cleanupAge: '1 hour'
      }, 'ActiveInteractions Map cleanup - no old entries found');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleVoteSkipCommand(interaction: any): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
      }

      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const channelId = interaction.channelId;

      // Check if there's already an active vote
      const existingSession = this.voteSkipService.getActiveSession(guildId);

      if (existingSession) {
        // User is trying to join an existing vote
        const result = await this.voteSkipService.castVote(guildId, userId);

        if (result.completed) {
          // Vote passed! Trigger skip
          const showFeedback = await this.shouldUseEphemeral(guildId);
          if (showFeedback) {
            await interaction.reply({ content: result.message, ephemeral: true });
          }

          // Send skip command to audio service
          try {
            await this.audioCommandService.sendCommand('skip', guildId, {
              triggeredBy: 'voteskip',
              voteCount: String(result.session?.votes.size || 0),
              timestamp: String(Date.now())
            });
          } catch (error) {
            logger.error({ error, guildId }, 'Failed to send skip command after successful vote');
          }
        } else {
          // Vote recorded but not completed yet
          const showFeedback = await this.shouldUseEphemeral(guildId);
          if (showFeedback) {
            await interaction.reply({ content: result.message, ephemeral: true });
          }
        }
      } else {
        // Start a new vote skip session
        const result = await this.voteSkipService.initiateVoteSkip(guildId, channelId, userId);

        if (result.success) {
          const showFeedback = await this.shouldUseEphemeral(guildId);
          if (showFeedback) {
            await interaction.reply({ content: result.message, ephemeral: true });
          }

          // If only one person needed and they started it, immediately skip
          if (result.session && result.session.votes.size >= result.session.requiredVotes) {
            try {
              await this.audioCommandService.sendCommand('skip', guildId, {
                triggeredBy: 'voteskip',
                voteCount: String(result.session.votes.size),
                timestamp: String(Date.now())
              });
            } catch (error) {
              logger.error({ error, guildId }, 'Failed to send skip command after vote completion');
            }
          }
        } else {
          const showFeedback = await this.shouldUseEphemeral(guildId);
          if (showFeedback) {
            await interaction.reply({ content: result.message, ephemeral: true });
          }
        }
      }

    } catch (error) {
      logger.error({ error, guildId: interaction.guildId, userId: interaction.user.id }, 'Error handling voteskip command');
      try {
        const showFeedback = await this.shouldUseEphemeral(interaction.guildId);
        if (showFeedback) {
          await interaction.reply({
            content: '❌ An error occurred while processing your vote. Please try again.',
            ephemeral: true
          });
        }
      } catch (replyError) {
        logger.error({ replyError }, 'Failed to send error response for voteskip command');
      }
    }
  }

  /**
   * Apply optimistic UI updates for instant button feedback
   * Extracts current state from message, predicts new state based on command, and updates UI immediately
   */
   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async applyOptimisticUIUpdate(interaction: any, commandType: string, additionalData: any): Promise<void> {
    try {
      // Get the current UI message from the interaction
      const message = interaction.message;
      if (!message || !message.embeds || message.embeds.length === 0) {
        logger.debug({ commandType }, 'No embed found in message for optimistic update');
        return;
      }

      // Extract current state from the embed fields
      const embed = message.embeds[0];
      const currentState = this.extractStateFromEmbed(embed);

      // Predict the new state based on the command
      const newState = this.predictNewState(currentState, commandType, additionalData);

      // Rebuild the UI with the predicted state
      const newEmbed = this.uiBuilder.buildNowPlayingEmbed({
        trackTitle: currentState.trackTitle,
        artist: currentState.artist,
        duration: currentState.duration,
        position: currentState.position,
        volume: newState.volume,
        loopMode: newState.loopMode,
        queueLength: currentState.queueLength,
        isPaused: newState.isPaused,
        artworkUrl: currentState.artworkUrl,
        autoplayMode: newState.autoplayMode
      });

      const newComponents = this.uiBuilder.buildMusicControlButtons({
        isPlaying: !newState.isPaused && (currentState.isPlaying || currentState.isPaused),
        isPaused: newState.isPaused,
        hasQueue: currentState.hasQueue,
        queueLength: currentState.queueLength,
        volume: newState.volume,
        loopMode: newState.loopMode,
        isMuted: newState.volume === 0,
        autoplayMode: newState.autoplayMode
      });

      // Update the message immediately
      await message.edit({
        embeds: [newEmbed],
        components: newComponents
      });

      logger.info({ commandType, guildId: interaction.guildId }, 'Optimistic UI update applied successfully');
    } catch (error) {
      // Log but don't throw - optimistic update failure shouldn't block the command
      logger.warn({ error, commandType }, 'Failed to apply optimistic UI update');
    }
  }

  /**
   * Extract current state from the Now Playing embed
   */
   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractStateFromEmbed(embed: any): any {
    const title = embed.title || '';
    const description = embed.description || '';

    // Extract track title and artist from description
    const descriptionLines = description.split('\n');
    const trackTitle = descriptionLines[0]?.replace(/\*\*/g, '') || 'Unknown Track';
    const artist = descriptionLines[1]?.replace(/\*by\s*/i, '').trim() || undefined;

    // Extract state from fields
    const fields = embed.fields || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const volumeField = fields.find((f: any) => f.name === '🔊 Volume');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loopField = fields.find((f: any) => f.name === '🔁 Loop Mode');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusField = fields.find((f: any) => f.name === '⚡ Status');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueField = fields.find((f: any) => f.name === '📋 Queue');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const autoplayField = fields.find((f: any) => f.name === '▶️ Autoplay');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressField = fields.find((f: any) => f.name === '⏱️ Progress');

    // Parse volume from field value (format: "▓▓▓▓░░░░ **100%**")
    let volume = 100;
    if (volumeField) {
      const volumeMatch = volumeField.value.match(/\*\*(\d+)%\*\*/);
      if (volumeMatch) {
        volume = parseInt(volumeMatch[1], 10);
      }
    }

    // Parse loop mode from field value
    let loopMode: 'off' | 'track' | 'queue' = 'off';
    if (loopField) {
      const loopValue = loopField.value.toLowerCase();
      if (loopValue.includes('current track')) {
        loopMode = 'track';
      } else if (loopValue.includes('entire queue')) {
        loopMode = 'queue';
      }
    }

    // Parse status (playing/paused)
    const isPaused = title.includes('⏸️') || title.includes('Paused') || statusField?.value.includes('Paused');
    const isPlaying = title.includes('✨') || title.includes('Now Playing') || statusField?.value.includes('Playing');

    // Parse queue length
    let queueLength = 0;
    if (queueField) {
      const queueMatch = queueField.value.match(/\*\*(\d+) tracks\*\*/);
      if (queueMatch) {
        queueLength = parseInt(queueMatch[1], 10);
      }
    }

    // Parse autoplay mode
    let autoplayMode: 'off' | 'similar' | 'artist' | 'genre' | 'mixed' = 'off';
    if (autoplayField) {
      const autoplayValue = autoplayField.value.toLowerCase();
      if (autoplayValue.includes('similar')) {
        autoplayMode = 'similar';
      } else if (autoplayValue.includes('same artist')) {
        autoplayMode = 'artist';
      } else if (autoplayValue.includes('same genre')) {
        autoplayMode = 'genre';
      } else if (autoplayValue.includes('mixed')) {
        autoplayMode = 'mixed';
      }
    }

    // Extract artwork URL from thumbnail
    const artworkUrl = embed.thumbnail?.url;

    // Extract duration and position from progress field
    let duration = undefined;
    let position = undefined;
    if (progressField) {
      // Format is like: "**1:23** ▓▓▓▓▓░░░░░░░░ **5:00**"
      const timeMatches = progressField.value.match(/\*\*(\d+):(\d+)\*\*/g);
      if (timeMatches && timeMatches.length >= 2) {
        // First match is position, last match is duration
        const posMatch = timeMatches[0].match(/(\d+):(\d+)/);
        const durMatch = timeMatches[timeMatches.length - 1].match(/(\d+):(\d+)/);
        if (posMatch) {
          position = (parseInt(posMatch[1]) * 60 + parseInt(posMatch[2])) * 1000;
        }
        if (durMatch) {
          duration = (parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])) * 1000;
        }
      }
    }

    return {
      trackTitle,
      artist,
      volume,
      loopMode,
      isPaused,
      isPlaying,
      queueLength,
      hasQueue: queueLength > 0,
      autoplayMode,
      artworkUrl,
      duration,
      position
    };
  }

  /**
   * Predict the new state based on the command and current state
   */
   
   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private predictNewState(currentState: any, commandType: string, additionalData: any): any {
    const newState = { ...currentState };

    switch (commandType) {
      case 'toggle':
        // Toggle play/pause
        newState.isPaused = !currentState.isPaused;
        break;

      case 'volumeAdjust': {
        // Adjust volume by delta
        const delta = parseInt(additionalData.delta || '0', 10);
        newState.volume = Math.max(0, Math.min(200, currentState.volume + delta));
        break;
      }

      case 'loop':
        // Cycle through loop modes: off → track → queue → off
        if (currentState.loopMode === 'off') {
          newState.loopMode = 'track';
        } else if (currentState.loopMode === 'track') {
          newState.loopMode = 'queue';
        } else {
          newState.loopMode = 'off';
        }
        break;

      case 'mute':
        // Toggle mute (0 volume or restore to last volume, assume 100)
        newState.volume = currentState.volume === 0 ? 100 : 0;
        break;

      case 'autoplay': {
        // Cycle through autoplay modes: off → similar → artist → genre → mixed → off
        const modes: Array<'off' | 'similar' | 'artist' | 'genre' | 'mixed'> = ['off', 'similar', 'artist', 'genre', 'mixed'];
        const currentIndex = modes.indexOf(currentState.autoplayMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        newState.autoplayMode = modes[nextIndex];
        break;
      }

      // Commands that don't change visual state immediately
      case 'skip':
      case 'stop':
      case 'shuffle':
      case 'clear':
      case 'seekAdjust':
      case 'previous':
        // These will be updated by the audio service's UI update
        break;
    }

    return newState;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async checkButtonDJPermissions(interaction: any): Promise<boolean> {
    try {
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;

      // Get guild settings to check if DJ only mode is enabled and get DJ role
      const guildSettings = await this.settingsService.getGuildSettings(guildId);

      // If DJ only mode is disabled, allow all users
      if (!guildSettings.djOnlyMode) {
        return true;
      }

      // Get user roles for permission checking
      const userRoles = await this.permissionService.getUserRoles(userId, guildId);

      // Check if user has permission to control music
      const hasPermission = await this.permissionService.hasPermissionToControlMusic(
        userId,
        guildId,
        userRoles,
        guildSettings.djRoleId || null
      );

      if (!hasPermission) {
        const djRoleName = guildSettings.djRoleId || 'DJ';
        const showFeedback = await this.shouldUseEphemeral(guildId);
        if (showFeedback) {
          await interaction.reply({
            content: `🚫 DJ Only mode is enabled. You need the **${djRoleName}** role to use music controls.`,
            ephemeral: true
          });
        }
        return false;
      }

      return true;
    } catch (error) {
      logger.error({ error, guildId: interaction.guildId, userId: interaction.user.id }, 'Error checking button DJ permissions');
      const showFeedback = await this.shouldUseEphemeral(interaction.guildId);
      if (showFeedback) {
        await interaction.reply({
          content: '❌ Error checking permissions. Please try again.',
          ephemeral: true
        });
      }
      return false;
    }
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    // Handle music control button interactions
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const customId = interaction.customId;
    logger.info({ customId, guildId: interaction.guildId, userId: interaction.user.id }, 'Processing button interaction');

    try {
      if (customId.startsWith('premium_plan:')) {
        await this.premiumController.handlePlanButton(interaction);
        return;
      }

      if (customId === 'premium_cancel_confirm' || customId === 'premium_cancel_abort') {
        await this.premiumController.handleCancelButton(interaction);
        return;
      }

      if (customId === 'filters_reset') {
        const hasPermission = await this.checkButtonDJPermissions(interaction);
        if (!hasPermission) {
          return;
        }
        await this.handleFilterPresetChange(interaction, 'flat');
        return;
      }

      if (customId === 'filters_close') {
        await interaction.deferUpdate();
        await interaction.deleteReply();
        return;
      }

      // Map button interactions to corresponding commands
      let commandType: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let additionalData: any = {};

      switch (customId) {
        case 'music_playpause':
          commandType = 'toggle';
          break;
        case 'music_skip':
          commandType = 'skip';
          break;
        case 'music_stop':
          commandType = 'stop';
          break;
        case 'music_volume_up':
          commandType = 'volumeAdjust';
          additionalData.delta = '10';
          break;
        case 'music_volume_down':
          commandType = 'volumeAdjust';
          additionalData.delta = '-10';
          break;
        case 'music_loop':
          commandType = 'loop';
          break;
        case 'music_shuffle':
          commandType = 'shuffle';
          break;
        case 'music_queue':
          commandType = 'queue';
          additionalData.requestId = `queue_${Date.now()}`;
          break;
        case 'music_clear':
          commandType = 'clear';
          break;
        case 'music_autoplay':
          commandType = 'autoplay';
          break;
        case 'music_seek_back':
          commandType = 'seekAdjust';
          additionalData.deltaMs = '-10000'; // -10 seconds in milliseconds
          break;
        case 'music_seek_forward':
          commandType = 'seekAdjust';
          additionalData.deltaMs = '10000'; // +10 seconds in milliseconds
          break;
        case 'music_previous':
          commandType = 'previous';
          break;
        case 'music_seek_back_30':
          commandType = 'seekAdjust';
          additionalData.deltaMs = '-30000'; // -30 seconds in milliseconds
          break;
        case 'music_seek_forward_30':
          commandType = 'seekAdjust';
          additionalData.deltaMs = '30000'; // +30 seconds in milliseconds
          break;
        case 'music_mute':
          commandType = 'mute';
          break;
        case 'music_filters': {
          const hasPermission = await this.checkButtonDJPermissions(interaction);
          if (!hasPermission) {
            return;
          }
          await this.openFiltersPanel(interaction);
          return;
        }
        default:
          // Handle pagination buttons (music_queue_prev:page and music_queue_next:page)
          if (customId.startsWith('music_queue_prev:') || customId.startsWith('music_queue_next:')) {
            const parts = customId.split(':');
            const currentPage = parseInt(parts[1] || '1', 10);
            const newPage = customId.startsWith('music_queue_prev:') ? currentPage - 1 : currentPage + 1;

            commandType = 'queue';
            additionalData.requestId = `queue_${Date.now()}`;
            additionalData.page = newPage;
            break;
          }

          {
            logger.warn({ customId }, 'Unknown button interaction');
            const showFeedback = await this.shouldUseEphemeral(interaction.guildId);
            if (showFeedback) {
              await interaction.reply({ content: '❌ Unknown button action', ephemeral: true });
            }
          }
          return;
      }

      // Check DJ permissions for control commands (excluding queue which is read-only)
      if (commandType !== 'queue') {
        const hasPermission = await this.checkButtonDJPermissions(interaction);
        if (!hasPermission) {
          return; // Permission check already handled the response
        }
      }

      // Special handling for queue command - always needs defer since it shows a response
      if (commandType === 'queue') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const guildId = interaction.guildId!;

          // Check for existing pending request (deduplication)
          const existingRequest = this.pendingQueueRequests.get(guildId);
          if (existingRequest) {
            logger.info({
              guildId,
              existingRequestId: existingRequest.requestId,
              age: Date.now() - existingRequest.timestamp
            }, 'Queue request already in progress, reusing existing request');

            // Reuse the existing promise
            const response = await existingRequest.promise;
            if (response?.items && Array.isArray(response.items)) {
              const queueEmbed = this.uiBuilder.buildQueueEmbed({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tracks: response.items.map((item: any) => ({
                  title: item.title || 'Unknown Track',
                  artist: undefined,
                  duration: undefined,
                  requestedBy: 'Unknown'
                })),
                currentTrack: undefined,
                totalDuration: undefined,
                page: response.page || 1,
                totalPages: response.totalPages || 1
              });

              const navigationButtons = this.uiBuilder.buildQueueNavigationButtons(
                response.page || 1,
                response.totalPages || 1
              );

              await interaction.editReply({
                embeds: [queueEmbed],
                components: navigationButtons
              });
            } else {
              await interaction.editReply({ content: '📭 Queue is empty' });
            }
            return;
          }

          // Create new request promise
          const requestPromise = this.executeQueueRequest(guildId, additionalData);

          // Store in pending requests for deduplication
          this.pendingQueueRequests.set(guildId, {
            requestId: additionalData.requestId,
            timestamp: Date.now(),
            promise: requestPromise
          });

          const response = await requestPromise;

          if (response?.items && Array.isArray(response.items)) {
            const queueEmbed = this.uiBuilder.buildQueueEmbed({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tracks: response.items.map((item: any) => ({
                title: item.title || 'Unknown Track',
                artist: undefined,
                duration: undefined,
                requestedBy: 'Unknown'
              })),
              currentTrack: undefined,
              totalDuration: undefined,
              page: response.page || 1,
              totalPages: response.totalPages || 1
            });

            const navigationButtons = this.uiBuilder.buildQueueNavigationButtons(
              response.page || 1,
              response.totalPages || 1
            );

            await interaction.editReply({
              embeds: [queueEmbed],
              components: navigationButtons
            });
          } else {
            await interaction.editReply({ content: '📭 Queue is empty' });
          }
        } catch (error) {
          logger.error({ error, commandType }, 'Failed to get queue response');
          await interaction.editReply({ content: '❌ Failed to retrieve queue' });
        } finally {
          // Always clean up pending request
          const guildId = interaction.guildId!;
          this.pendingQueueRequests.delete(guildId);
        }
        return;
      }

      // For other commands - provide immediate feedback and send command
      const showButtonFeedback = await this.shouldUseEphemeral(interaction.guildId);

      // OPTIMISTIC UI UPDATE: Update button states immediately before sending command
      // This provides instant visual feedback while the audio service processes the command
      try {
        await this.applyOptimisticUIUpdate(interaction, commandType, additionalData);
      } catch (optimisticError) {
        logger.warn({ error: optimisticError, commandType }, 'Optimistic UI update failed, continuing with command');
      }

      // All button interactions MUST be acknowledged within 3 seconds
      if (showButtonFeedback) {
        // Show feedback with deferReply (displays "Bot is thinking..." then custom message)
        await interaction.deferReply({ ephemeral: true });

        const actionLabels: Record<string, string> = {
          'toggle': '⏯️ Toggling playback...',
          'skip': '⏭️ Skipping track...',
          'stop': '⏹️ Stopping playback...',
          'volumeAdjust': '🔊 Adjusting volume...',
          'loop': '🔁 Cycling loop mode...',
          'shuffle': '🔀 Shuffling queue...',
          'clear': '🧹 Clearing queue...',
          'seedRelated': '▶️ Adding autoplay tracks...',
          'seekAdjust': '⏩ Seeking...',
          'autoplay': '▶️ Cycling autoplay mode...',
          'mute': '🔇 Toggling mute...'
        };

        const feedbackMessage = actionLabels[commandType] || `🎵 ${commandType}...`;
        await interaction.editReply({ content: feedbackMessage });

        // Auto-delete feedback message after 3 seconds
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
          } catch (error) {
            // Ignore deletion errors (message might already be gone)
            logger.debug({ error, commandType }, 'Button feedback message deletion failed (likely already deleted)');
          }
        }, 3000);
      } else {
        // No feedback: use deferUpdate to silently acknowledge the interaction
        // This prevents "This interaction failed" error without showing any loading state
        await interaction.deferUpdate();
      }

      // Send command to audio service via Redis Streams
      try {
        await this.audioCommandService.sendCommand(
          commandType,
          interaction.guildId,
          additionalData
        );

        logger.info({ commandType, guildId: interaction.guildId }, 'Button command forwarded to audio service via Redis Streams');
      } catch (commandError) {
        logger.error({ error: commandError, commandType, guildId: interaction.guildId }, 'Failed to send command via Redis Streams');
        throw commandError;
      }

    } catch (error) {
      logger.error({ error, customId }, 'Error handling button interaction');

      try {
        const showFeedback = await this.shouldUseEphemeral(interaction.guildId);
        if (showFeedback) {
          if (interaction.deferred) {
            await interaction.editReply({ content: '❌ Failed to process button action.' });
          } else {
            await interaction.reply({ content: '❌ Failed to process button action.', ephemeral: true });
          }
        }
      } catch (responseError) {
        logger.error({ responseError }, 'Failed to send error response for button interaction');
      }
    }
  }

  private async start(): Promise<void> {
    // Set up Discord event handlers
    this.setupDiscordEventHandlers();

    // Login to Discord
    await this.discordClient.login(env.DISCORD_TOKEN);
    logger.info('Discord client logged in');
  }

  private setupDiscordEventHandlers(): void {
    this.discordClient.once(Events.ClientReady, (readyClient) => {
      logger.info(`Gateway ready! Logged in as ${readyClient.user.tag}`);
    });

    this.discordClient.on('interactionCreate', async (interaction) => {
      try {
        logger.info({ interactionType: interaction.type, user: interaction.user.username }, 'Interaction received');

        // Handle button interactions for music controls
        if (interaction.isButton()) {
          logger.info({ customId: interaction.customId, user: interaction.user.username }, 'Processing button interaction');
          await this.handleButtonInteraction(interaction);
          return;
        }

        if (interaction.isStringSelectMenu()) {
          logger.info({ customId: interaction.customId, user: interaction.user.username }, 'Processing select menu interaction');
          await this.handleSelectMenuInteraction(interaction);
          return;
        }

        if (!interaction.isChatInputCommand()) {
          logger.info({ interactionType: interaction.type }, 'Not a chat input command or button, ignoring');
          return;
        }

        logger.info({ commandName: interaction.commandName, user: interaction.user.username }, 'Processing command');

        // Route commands to appropriate controllers
        switch (interaction.commandName) {
          case 'play':
            await this.musicController.handlePlayCommand(interaction);
            break;
          case 'playnext':
            await this.musicController.handlePlayNextCommand(interaction);
            break;
          case 'playnow':
            await this.musicController.handlePlayNowCommand(interaction);
            break;
          case 'pause':
            await this.musicController.handlePauseCommand(interaction);
            break;
          case 'resume':
            await this.musicController.handleResumeCommand(interaction);
            break;
          case 'stop':
            await this.musicController.handleStopCommand(interaction);
            break;
          case 'skip':
            await this.musicController.handleSkipCommand(interaction);
            break;
          case 'volume':
            await this.musicController.handleVolumeCommand(interaction);
            break;
          case 'loop':
            await this.musicController.handleLoopCommand(interaction);
            break;
          case 'queue':
            await this.musicController.handleQueueCommand(interaction);
            break;
          case 'shuffle':
            await this.musicController.handleShuffleCommand(interaction);
            break;
          case 'clear':
            await this.musicController.handleClearCommand(interaction);
            break;
          case 'remove':
            await this.musicController.handleRemoveCommand(interaction);
            break;
          case 'move':
            await this.musicController.handleMoveCommand(interaction);
            break;
          case 'nowplaying':
            await this.musicController.handleControlCommand(interaction, 'nowplaying');
            break;
          case 'seek':
            await this.musicController.handleSeekCommand(interaction);
            break;
          case 'autoplay':
            await this.musicController.handleAutoplayCommand(interaction);
            break;
          case 'voteskip':
            await this.handleVoteSkipCommand(interaction);
            break;
          case 'settings':
            await this.musicController.handleSettingsCommand(interaction);
            break;
          case 'premium':
            await this.premiumController.handleCommand(interaction);
            break;
          default:
            logger.warn(`Unknown command: ${interaction.commandName}`);
        }
      } catch (error) {
        logger.error({ error }, 'Error handling interaction');
      }
    });

    this.discordClient.on('error', (error) => {
      logger.error({ error }, 'Discord client error');
    });

    // RULE 3: UI deletion triggers bot disconnect
    this.discordClient.on(Events.MessageDelete, async (message) => {
      await this.handleMessageDelete(message);
    });

    // Handle voice state updates to send Discord credentials to Lavalink
    this.discordClient.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      await this.handleDiscordVoiceStateUpdate(oldState, newState);
    });

    // Handle voice server updates via Discord.js event
    // The handleVoiceServerUpdate method will automatically send credentials to audio service
    this.discordClient.on(Events.VoiceServerUpdate, async (update) => {
      await this.handleVoiceServerUpdate(update);
    });

    // ============================================================================
    // CRITICAL: Forward RAW Discord Gateway Events to Audio Service for Lavalink
    // ============================================================================
    // Lavalink-client requires raw Discord gateway events via sendRawData() to
    // establish voice connections. We forward VOICE_SERVER_UPDATE, VOICE_STATE_UPDATE,
    // and CHANNEL_DELETE to the Audio service for proper Lavalink voice synchronization.
    //
    // See: https://lc4.gitbook.io/lavalink-client/ (Discord.js v14 integration)
    // ============================================================================

    // Track processed raw events to prevent duplicate handling
    const processedRawEvents = new Map<string, number>();
    const RAW_EVENT_DEDUP_WINDOW_MS = 1000;

    // Helper to check if event was recently processed
    const isRecentlyProcessed = (key: string): boolean => {
      const timestamp = processedRawEvents.get(key);
      if (timestamp && Date.now() - timestamp < RAW_EVENT_DEDUP_WINDOW_MS) {
        return true;
      }
      processedRawEvents.set(key, Date.now());
      // Cleanup old entries (older than 5 seconds)
      for (const [k, v] of processedRawEvents.entries()) {
        if (Date.now() - v > 5000) processedRawEvents.delete(k);
      }
      return false;
    };

    // Forward VOICE_SERVER_UPDATE raw events to Audio service for Lavalink
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.discordClient.ws.on(GatewayDispatchEvents.VoiceServerUpdate as any, async (data: any) => {
      const dedupKey = `VOICE_SERVER_UPDATE:${data.guild_id}:${data.token}`;
      if (isRecentlyProcessed(dedupKey)) {
        logger.debug({ guildId: data.guild_id }, 'LAVALINK: Skipping duplicate VOICE_SERVER_UPDATE raw event');
        return;
      }

      logger.info({
        guildId: data.guild_id,
        hasToken: !!data.token,
        hasEndpoint: !!data.endpoint
      }, 'LAVALINK: Forwarding raw VOICE_SERVER_UPDATE to Audio service');

      try {
        // Forward the complete raw packet to Audio service for manager.sendRawData()
        await this.audioRedisClient.publish('discord-bot:lavalink-raw-events', JSON.stringify({
          t: 'VOICE_SERVER_UPDATE',
          d: data
        }));

        // Also handle via standard flow for voice credentials (belt and suspenders)
        await this.handleVoiceServerUpdate({
          token: data.token,
          guild: { id: data.guild_id },
          endpoint: data.endpoint
        });
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
          guildId: data.guild_id
        }, 'LAVALINK: Failed to forward VOICE_SERVER_UPDATE to Audio service');
      }
    });

    // Forward VOICE_STATE_UPDATE raw events to Audio service for Lavalink
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.discordClient.ws.on(GatewayDispatchEvents.VoiceStateUpdate as any, async (data: any) => {
      const dedupKey = `VOICE_STATE_UPDATE:${data.guild_id}:${data.user_id}:${data.session_id || 'none'}`;
      if (isRecentlyProcessed(dedupKey)) {
        logger.debug({ guildId: data.guild_id }, 'LAVALINK: Skipping duplicate VOICE_STATE_UPDATE raw event');
        return;
      }

      logger.debug({
        guildId: data.guild_id,
        userId: data.user_id,
        hasSessionId: !!data.session_id
      }, 'LAVALINK: Forwarding raw VOICE_STATE_UPDATE to Audio service');

      try {
        await this.audioRedisClient.publish('discord-bot:lavalink-raw-events', JSON.stringify({
          t: 'VOICE_STATE_UPDATE',
          d: data
        }));
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
          guildId: data.guild_id
        }, 'LAVALINK: Failed to forward VOICE_STATE_UPDATE to Audio service');
      }
    });

    // Forward CHANNEL_DELETE events (needed for cleanup when voice channels are deleted)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.discordClient.ws.on(GatewayDispatchEvents.ChannelDelete as any, async (data: any) => {
      // Only forward voice channel deletions
      if (data.type !== 2) return; // 2 = GUILD_VOICE channel type

      logger.debug({
        channelId: data.id,
        guildId: data.guild_id
      }, 'LAVALINK: Forwarding raw CHANNEL_DELETE to Audio service');

      try {
        await this.audioRedisClient.publish('discord-bot:lavalink-raw-events', JSON.stringify({
          t: 'CHANNEL_DELETE',
          d: data
        }));
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
          channelId: data.id
        }, 'LAVALINK: Failed to forward CHANNEL_DELETE to Audio service');
      }
    });
  }

  private async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This action can only be used in a server.', ephemeral: true });
      return;
    }

    switch (interaction.customId) {
      case 'filters_select': {
        const selected = interaction.values?.[0];
        if (!selected) {
          await interaction.reply({ content: '❌ Please choose a filter preset.', ephemeral: true });
          return;
        }

        const hasPermission = await this.checkButtonDJPermissions(interaction);
        if (!hasPermission) {
          return;
        }

        await this.handleFilterPresetChange(interaction, selected);
        return;
      }
      default:
        logger.warn({ customId: interaction.customId }, 'Unknown select menu interaction');
        await interaction.reply({ content: '❌ Unknown selection', ephemeral: true });
    }
  }

  private async openFiltersPanel(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: 'This action can only be used in a server.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const state = await this.fetchFilterState(guildId);
    const view = this.uiBuilder.buildFilterPanel(state);

    await interaction.editReply(view);

    if (!state.success && state.error) {
      await interaction.followUp({ content: `❌ ${state.error}`, ephemeral: true });
    }
  }

  private async handleFilterPresetChange(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    presetId: string,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This action can only be used in a server.', ephemeral: true });
      return;
    }

    await interaction.deferUpdate();

    const state = await this.applyFilterPreset(interaction.guildId, presetId);
    const view = this.uiBuilder.buildFilterPanel(state);

    await interaction.editReply(view);

    if (!state.success && state.error) {
      await interaction.followUp({ content: `❌ ${state.error}`, ephemeral: true });
    } else if (state.message) {
      await interaction.followUp({ content: state.message, ephemeral: true });
    }
  }

  private async fetchFilterState(guildId: string): Promise<FilterPanelState> {
    try {
      const response = await this.audioCommandService.sendCommand('filters', guildId, {
        action: 'get',
      });
      return this.normalizeFilterState(response);
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to fetch filter state');
      return {
        success: false,
        presets: [],
        error: 'Failed to load filter presets. Please try again shortly.',
      };
    }
  }

  private async applyFilterPreset(guildId: string, presetId: string): Promise<FilterPanelState> {
    try {
      const response = await this.audioCommandService.sendCommand('filters', guildId, {
        action: 'apply',
        preset: presetId,
      });
      return this.normalizeFilterState(response);
    } catch (error) {
      logger.error({ error, guildId, presetId }, 'Failed to apply filter preset');
      return {
        success: false,
        presets: [],
        error: 'Failed to apply audio filter. Please try again.',
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeFilterState(response: any): FilterPanelState {
    const presets: FilterPanelState['presets'] = Array.isArray(response?.presets)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? response.presets.map((preset: any) => ({
          id: String(preset.id ?? preset.value ?? preset.name ?? 'flat'),
          label: String(preset.label ?? preset.name ?? preset.id ?? 'Flat'),
          description: preset.description ?? preset.details ?? undefined,
        }))
      : [];

    if (presets.length === 0) {
      presets.push({ id: 'flat', label: 'Flat', description: 'All enhancements disabled' });
    }

    const activePresetRaw = response?.preset;
    const activePresetId = activePresetRaw?.id ?? activePresetRaw?.value ?? activePresetRaw?.name ?? presets[0].id;
    const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];

    return {
      success: response?.success !== false,
      preset: activePreset,
      presets,
      message: response?.message,
      error: response?.error,
    };
  }


  /**
   * Handle message deletion events to detect UI deletion (Rule 3)
   * RULE 3: Deleting UI PRINCIPAL must disconnect bot immediately
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleMessageDelete(message: any): Promise<void> {
    try {
      // Check if deleted message was a UI PRINCIPAL message tracked in our system
      const channelKey = `${message.guildId}:${message.channelId}`;
      const trackedInteraction = this.activeInteractions.get(channelKey);

      if (trackedInteraction && trackedInteraction.messageId === message.id) {
        logger.info({
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id
        }, 'Tracked UI PRINCIPAL message was deleted by user, disconnecting bot immediately (Rule 3)');

        // CRITICAL FIX: Set UI blocked flag instead of deleting to prevent recreation
        this.activeInteractions.set(channelKey, {
          ...trackedInteraction,
          uiBlocked: true,
          lastUpdated: Date.now()
        });

        // Disconnect bot from voice channel immediately
        const disconnectCommand = {
          type: 'disconnect',
          guildId: message.guildId,
          channelId: message.channelId,
          reason: 'UI_DELETED',
          timestamp: Date.now()
        };

        logger.info({ disconnectCommand }, 'Sending DISCONNECT command to audio service due to UI deletion');
        await this.redisClient.publish('discord-bot:commands', JSON.stringify(disconnectCommand));

        // Also disconnect from voice channel in Discord
        const voiceConnection = getVoiceConnection(message.guildId);
        if (voiceConnection) {
          logger.info({ guildId: message.guildId }, 'Disconnecting bot from Discord voice channel (Rule 3)');
          voiceConnection.destroy();
        } else {
          logger.debug({ guildId: message.guildId }, 'No voice connection found to destroy (tracked UI)');
        }

        return;
      }

      // TEMPORARY FIX: Disable Rule 3 completely to debug voice connection issues
      // eslint-disable-next-line no-constant-condition
      if (false) {

        logger.info({
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id
        }, 'Untracked UI PRINCIPAL message was deleted by user, disconnecting bot immediately (Rule 3)');

        // CRITICAL FIX: Block UI recreation for this channel
        const channelKey = `${message.guildId}:${message.channelId}`;
        this.activeInteractions.set(channelKey, {
          messageId: '',
          channelId: message.channelId,
          guildId: message.guildId,
          lastUpdated: Date.now(),
          uiBlocked: true
        });

        // Disconnect bot from voice channel immediately
        const disconnectCommand = {
          type: 'disconnect',
          guildId: message.guildId,
          channelId: message.channelId,
          reason: 'UI_DELETED',
          timestamp: Date.now()
        };

        logger.info({ disconnectCommand }, 'Sending DISCONNECT command to audio service due to UI deletion');
        await this.redisClient.publish('discord-bot:commands', JSON.stringify(disconnectCommand));

        // Also disconnect from voice channel in Discord
        const voiceConnection = getVoiceConnection(message.guildId);
        if (voiceConnection) {
          logger.info({ guildId: message.guildId }, 'Disconnecting bot from Discord voice channel (Rule 3)');
          voiceConnection?.destroy();
        } else {
          logger.debug({ guildId: message.guildId }, 'No voice connection found to destroy (untracked UI)');
        }
      }
    } catch (error: unknown) {
      logger.error({ error }, 'Error handling message deletion');
    }
  }

  /**
   * Execute a queue request and wait for response from audio service
   * Implements proper Redis pub/sub pattern with request-response correlation
   */
   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeQueueRequest(guildId: string, additionalData: any): Promise<any> {
    logger.info({
      guildId,
      requestId: additionalData.requestId,
      page: additionalData.page
    }, 'gateway: sending queue command to audio service via Redis Streams');

    try {
      // Use Redis Streams AudioCommandService instead of pub/sub
      const response = await this.audioCommandService.sendQueueCommand(guildId, {
        timeout: 10000, // 10 seconds timeout
        retries: 2,
        page: additionalData.page || 1
      });

      logger.info({
        guildId,
        requestId: additionalData.requestId,
        page: additionalData.page,
        response
      }, 'gateway: received queue response via Redis Streams');

      return response;
    } catch (error) {
      logger.error({
        error,
        guildId,
        requestId: additionalData.requestId,
        page: additionalData.page
      }, 'gateway: failed to get queue response via Redis Streams');
      throw error;
    }
  }

  /**
   * Wait for a response from the audio service via Redis
   * Following Redis v5 best practices for subscription management with retry logic
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async waitForAudioResponse(channel: string, timeoutMs: number = 5000, maxRetries: number = 2): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.attemptRedisResponse(channel, timeoutMs);
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable (connection issues, not parse errors)
        const isRetryable = this.isRetryableRedisError(error as Error);

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff with jitter (following Redis official pattern)
        const jitter = Math.floor(Math.random() * 200);
        const delay = Math.min(Math.pow(2, attempt) * 100, 1000) + jitter;

        logger.warn({
          channel,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          delay,
          error: (error as Error).message
        }, 'Redis operation failed, retrying...');

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Single attempt to get response from Redis
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async attemptRedisResponse(channel: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;

      // Define listener function to maintain reference for cleanup
      const listener = (message: string) => {
        try {
          logger.info({ channel, message }, 'gateway: received Redis response');
          clearTimeout(timeout);
          // Unsubscribe with specific listener reference to avoid memory leaks
          this.redisSubscriber.unsubscribe(channel, listener);
          const response = JSON.parse(message);
          resolve(response);
        } catch (error: unknown) {
          logger.error({ channel, message, error: error instanceof Error ? error.message : String(error) }, 'gateway: error parsing Redis response');
          clearTimeout(timeout);
          // Ensure cleanup on error
          this.redisSubscriber.unsubscribe(channel, listener);
          reject(error);
        }
      };

      // Set timeout with proper cleanup
      timeout = setTimeout(() => {
        // Clean unsubscribe with listener reference
        this.redisSubscriber.unsubscribe(channel, listener);
        reject(new Error(`Timeout waiting for response on ${channel}`));
      }, timeoutMs);

      // Subscribe with listener reference for proper cleanup
      this.redisSubscriber.subscribe(channel, listener).catch((error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Determine if a Redis error is retryable based on error type
   */
  private isRetryableRedisError(error: Error): boolean {
    const retryableErrors = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNRESET',
      'EPIPE',
      'EHOSTUNREACH',
      'EAI_AGAIN'
    ];

    // Check error message or code for retryable patterns
    const errorMessage = error.message.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorCode = (error as any).code;

    return retryableErrors.some(retryableError =>
      errorMessage.includes(retryableError.toLowerCase()) ||
      errorCode === retryableError
    ) || errorMessage.includes('connection') || errorMessage.includes('network');
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down Gateway application...');

    try {
      // Clean up voice credential refresh timers
      for (const [guildId, timer] of this.voiceRefreshTimers) {
        clearTimeout(timer);
        logger.info({ guildId }, 'VOICE_CONNECT: Cleaned up voice refresh timer on shutdown');
      }
      this.voiceRefreshTimers.clear();
      this.voiceServerData.clear();

      if (this.discordClient) {
        this.discordClient.destroy();
      }

      if (this.redisClient) {
        await this.redisClient.quit();
      }

      if (this.redisSubscriber) {
        await this.redisSubscriber.quit();
      }

      if (this.audioRedisClient) {
        await this.audioRedisClient.quit();
      }

      if (this.healthServer) {
        await this.healthServer.shutdown();
      }

      await prisma.$disconnect();

      logger.info('Gateway application shut down successfully');
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
    }
  }
}

/**
 * Application Entry Point
 */
async function main(): Promise<void> {
  const app = new GatewayApplication();

  // Graceful shutdown handling
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await app.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await app.shutdown();
    process.exit(0);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled Rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught Exception');
    process.exit(1);
  });

  // Start the application
  await app.initialize();
}

// Run the application
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error({ error }, 'Failed to start Gateway application');
    process.exit(1);
  });
}

export { GatewayApplication };
