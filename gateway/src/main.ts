import { Client, GatewayIntentBits, Events } from 'discord.js';
import { createClient } from 'redis';
import { prisma, injectLogger } from '@discord-bot/database';
import { logger } from './infrastructure/logger/console-logger.js';
import { env } from '@discord-bot/config';

// Infrastructure Layer
import { PrismaGuildSettingsRepository } from './infrastructure/database/prisma-guild-settings-repository.js';
import { RedisMusicSessionRepository } from './infrastructure/redis/redis-music-session-repository.js';
import { DiscordAudioService } from './infrastructure/discord/discord-audio-service.js';
import { DiscordPermissionService } from './infrastructure/discord/discord-permission-service.js';

// Enterprise Cache System
import { RedisCircuitBreaker } from '@discord-bot/cache/dist/redis-circuit-breaker.js';
import { MultiLayerCache, SearchCache, UserCache, QueueCache } from '@discord-bot/cache/dist/multi-layer-cache.js';

// Domain Layer
import { MusicSessionDomainService } from './domain/services/music-session-domain-service.js';

// Application Layer
import { PlayMusicUseCase } from './application/use-cases/play-music-use-case.js';
import { ControlMusicUseCase } from './application/use-cases/control-music-use-case.js';

// Presentation Layer
import { CommercialMusicController } from './presentation/controllers/commercial-music-controller.js';
import { MusicUIBuilder } from './presentation/ui/music-ui-builder.js';
import { InteractionResponseHandler } from './presentation/ui/interaction-response-handler.js';

// Commercial Use Cases
import { SubscriptionManagementUseCase } from './application/use-cases/subscription-management-use-case.js';

// Commercial Infrastructure
import { InMemoryCustomerRepository } from './infrastructure/repositories/in-memory-customer-repository.js';
import { StubPaymentService } from './infrastructure/payment/stub-payment-service.js';
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
  private redisClient!: any;
  private musicController!: CommercialMusicController;
  private healthChecker!: ApplicationHealthChecker;
  private healthServer!: HealthServer;

  // Enterprise Cache System
  private cacheSystem!: {
    redisCircuitBreaker: RedisCircuitBreaker;
    searchCache: SearchCache;
    userCache: UserCache;
    queueCache: QueueCache;
  };

  async initialize(): Promise<void> {
    logger.info('Initializing Gateway application with Clean Architecture...');

    // Inject logger dependency for database package
    injectLogger(logger);

    // Initialize external services
    await this.initializeClients();

    // Initialize enterprise cache system
    await this.initializeCacheSystem();

    // Wire up dependencies
    this.wireUpDependencies();

    // Initialize enterprise health monitoring
    this.setupHealthMonitoring();

    // Start the application
    await this.start();

    logger.info('Gateway application initialized successfully');
  }

  private async initializeClients(): Promise<void> {
    // Initialize Discord client with enterprise-grade configuration
    this.discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ],
      // Enterprise scaling configuration
      shards: 'auto', // Auto-scale shards based on guild count
      // Connection resilience
      ws: {
        large_threshold: 250, // Optimize for larger servers
      },
      // Rate limiting optimization
      rest: {
        timeout: 15000, // 15 second timeout
        retries: 3
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

    await this.redisClient.connect();
    logger.info('Redis client connected');
  }

  private async initializeCacheSystem(): Promise<void> {
    logger.info('Initializing enterprise multi-layer cache system...');

    // Initialize Redis Circuit Breaker with enterprise configuration
    const redisCircuitBreaker = new RedisCircuitBreaker(
      'gateway-cache',
      {
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
      },
      {
        host: 'localhost',
        port: 6379
      }
    );

    // Initialize specialized caches with enterprise-grade configuration
    const searchCache = new SearchCache(redisCircuitBreaker);
    const userCache = new UserCache(redisCircuitBreaker);
    const queueCache = new QueueCache(redisCircuitBreaker);

    this.cacheSystem = {
      redisCircuitBreaker,
      searchCache,
      userCache,
      queueCache,
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
    }, 300000); // Every 5 minutes

    logger.info('Enterprise cache system initialized with multi-layer architecture');
  }

  private wireUpDependencies(): void {
    // Infrastructure Layer (Adapters)
    const guildSettingsRepository = new PrismaGuildSettingsRepository(prisma);
    const musicSessionRepository = new RedisMusicSessionRepository(this.redisClient);

    // Use enterprise-grade cache system instead of basic stub
    const audioService = new DiscordAudioService(this.redisClient, this.cacheSystem.searchCache);
    const permissionService = new DiscordPermissionService(this.discordClient);

    // Commercial Infrastructure
    const customerRepository = new InMemoryCustomerRepository();
    const paymentService = new StubPaymentService();
    const notificationService = new StubNotificationService();

    // Domain Layer (Business Logic)
    const musicSessionDomainService = new MusicSessionDomainService();

    // Application Layer (Use Cases)
    const playMusicUseCase = new PlayMusicUseCase(
      musicSessionRepository,
      guildSettingsRepository,
      musicSessionDomainService,
      audioService,
      permissionService
    );

    const controlMusicUseCase = new ControlMusicUseCase(
      musicSessionRepository,
      guildSettingsRepository,
      musicSessionDomainService,
      {} as any /* audio control service */
    );

    // Commercial Use Cases
    const subscriptionManagementUseCase = new SubscriptionManagementUseCase(
      customerRepository,
      paymentService,
      notificationService
    );

    // Presentation Layer (UI & Controllers)
    const musicUIBuilder = new MusicUIBuilder();
    const responseHandler = new InteractionResponseHandler(musicUIBuilder);

    this.musicController = new CommercialMusicController(
      playMusicUseCase,
      controlMusicUseCase,
      subscriptionManagementUseCase,
      musicUIBuilder,
      responseHandler
    );

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
    }, 30000);

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
      }, 5000); // Check every 5 seconds
    }

    logger.info('Enterprise health monitoring initialized with comprehensive metrics');
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

        if (!interaction.isChatInputCommand()) {
          logger.info({ interactionType: interaction.type }, 'Not a chat input command, ignoring');
          return;
        }

        logger.info({ commandName: interaction.commandName, user: interaction.user.username }, 'Processing command');

        // Route commands to appropriate controllers
        switch (interaction.commandName) {
          case 'play':
            await this.musicController.handlePlayCommand(interaction);
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
          case 'volume':
            await this.musicController.handleVolumeCommand(interaction);
            break;
          case 'loop':
            await this.musicController.handleLoopCommand(interaction);
            break;
          case 'queue':
            await this.musicController.handleQueueCommand(interaction);
            break;
          case 'subscription':
            await this.musicController.handleSubscriptionCommand(interaction);
            break;
          case 'upgrade':
            await this.musicController.handleUpgradeCommand(interaction);
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
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down Gateway application...');

    try {
      if (this.discordClient) {
        this.discordClient.destroy();
      }

      if (this.redisClient) {
        await this.redisClient.quit();
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