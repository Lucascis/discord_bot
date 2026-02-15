/**
 * Enterprise Dependency Injection Container
 * Provides centralized dependency management for the gateway service
 */

import { Client, GatewayIntentBits, Collection } from 'discord.js';
import Redis from 'ioredis';
import { prisma, injectLogger } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';

// Application Services
import { PlayMusicUseCase } from '../../application/use-cases/play-music-use-case.js';
import { ControlMusicUseCase } from '../../application/use-cases/control-music-use-case.js';
import { SubscriptionManagementUseCase } from '../../application/use-cases/subscription-management-use-case.js';

// Infrastructure
import { RedisEventBus } from '../messaging/redis-event-bus.js';
import { DatabaseMusicRepository } from '../persistence/database-music-repository.js';
import { DatabaseSubscriptionRepository } from '../persistence/database-subscription-repository.js';
import { RedisMusicSessionRepository } from '../redis/redis-music-session-repository.js';
import { MusicSessionRepository } from '../../domain/repositories/music-session-repository.js';

// Presentation
import { MusicController } from '../../presentation/controllers/music-controller.js';
import { MusicUIBuilder } from '../../presentation/ui/music-ui-builder.js';
import { InteractionResponseHandler } from '../../presentation/ui/interaction-response-handler.js';

// Services
import { SettingsService } from '../../services/settings-service.js';
import { DiscordPermissionService } from '../discord/discord-permission-service.js';
import { AudioCommandService } from '../../services/audio-command-service.js';

export interface DIContainer {
  // Infrastructure
  discordClient: Client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redisClient: any;
  eventBus: RedisEventBus;

  // Repositories
  musicRepository: DatabaseMusicRepository;
  musicSessionRepository: MusicSessionRepository;
  subscriptionRepository: DatabaseSubscriptionRepository;

  // Services
  settingsService: SettingsService;
  permissionService: DiscordPermissionService;
  audioCommandService: AudioCommandService;

  // Use Cases (optional - will be simplified)
  playMusicUseCase?: PlayMusicUseCase;
  controlMusicUseCase?: ControlMusicUseCase;
  subscriptionUseCase?: SubscriptionManagementUseCase;

  // Presentation
  musicController: MusicController;
  uiBuilder: MusicUIBuilder;
  responseHandler: InteractionResponseHandler;
}

/**
 * Enterprise DI Container Factory
 * Creates and wires all dependencies for production deployment
 */
export class EnterpriseContainer {
  private container: Partial<DIContainer> = {};

  async initialize(): Promise<DIContainer> {
    logger.info('🏗️ Initializing enterprise dependency injection container');

    // 1. Initialize core infrastructure
    await this.initializeInfrastructure();

    // 2. Initialize repositories
    this.initializeRepositories();

    // 3. Initialize services
    this.initializeServices();

    // 4. Initialize use cases
    this.initializeUseCases();

    // 5. Initialize presentation layer
    this.initializePresentationLayer();

    logger.info('✅ Enterprise DI container initialized with full dependency graph');
    return this.container as DIContainer;
  }

  private async initializeInfrastructure(): Promise<void> {
    // Discord client with enterprise configuration
    this.container.discordClient = this.createDiscordClient();

    // Redis client with connection pooling
    this.container.redisClient = await this.createRedisClient();

    // Event bus for inter-service communication
    this.container.eventBus = new RedisEventBus(this.container.redisClient);

    // Initialize database with logger injection
    injectLogger(logger);
    await prisma.$connect();

    logger.info('✅ Core infrastructure initialized');
  }

  private initializeRepositories(): void {
    this.container.musicRepository = new DatabaseMusicRepository(prisma);
    this.container.musicSessionRepository = new RedisMusicSessionRepository(this.container.redisClient);
    this.container.subscriptionRepository = new DatabaseSubscriptionRepository(prisma);

    logger.info('✅ Repository layer initialized');
  }

  private initializeServices(): void {
    this.container.settingsService = new SettingsService(prisma);
    this.container.permissionService = new DiscordPermissionService(this.container.discordClient!);
    this.container.audioCommandService = new AudioCommandService();

    logger.info('✅ Services layer initialized');
  }

  private initializeUseCases(): void {
    // Use cases will be simplified for now - controller will handle logic directly
    // This avoids complex dependency chain until all services are fully implemented

    logger.info('✅ Use case layer deferred - using direct controller implementation');
  }

  private initializePresentationLayer(): void {
    this.container.uiBuilder = new MusicUIBuilder();
    this.container.responseHandler = new InteractionResponseHandler(
      this.container.uiBuilder!
    );

    this.container.musicController = new MusicController(
      this.container.eventBus!,
      this.container.uiBuilder!,
      this.container.responseHandler!,
      this.container.settingsService!,
      this.container.permissionService!,
      this.container.musicSessionRepository!,
      this.container.audioCommandService!
    );

    logger.info('✅ Presentation layer initialized with commercial music controller');
  }

  private createDiscordClient(): Client {
    return new Client({
      intents: [
        'Guilds',
        'GuildVoiceStates',
        'GuildMessages',
        'MessageContent'
      ].map(intent => GatewayIntentBits[intent as keyof typeof GatewayIntentBits]),

      // Enterprise optimizations
      sweepers: {
        messages: {
          interval: 3600, // 1 hour
          lifetime: 1800   // 30 minutes
        },
        users: {
          interval: 3600,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter: () => (user: any) => user.bot
        }
      },

      // Production sharding
      shards: 'auto',

      // Cache optimizations
      makeCache: () => new Collection(),

      // Rate limiting
      rest: {
        timeout: 15000,
        retries: 3,
        globalRequestsPerSecond: 50
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async createRedisClient(): Promise<any> {
    const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');

    const redisConfig = {
      host: redisUrl.hostname || 'localhost',
      port: parseInt(redisUrl.port, 10) || 6379,
      password: redisUrl.password || undefined,
      enableReadyCheck: true,
      maxLoadingTimeout: 30000,
      lazyConnect: true,
      family: 4,
      connectTimeout: 60000,
      commandTimeout: 5000,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 100, 2000),
      keepAlive: 5000
    };

    const client = new Redis(redisConfig);

    client.on('error', (err: Error) => {
      logger.error({ err }, 'Redis connection error');
    });

    client.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    client.on('ready', () => {
      logger.info('Redis client ready for operations');
    });

    const status = client.status as string;
    if (status !== 'ready' && status !== 'connecting') {
      await client.connect();
    }
    return client;
  }

  async dispose(): Promise<void> {
    logger.info('🛑 Disposing enterprise DI container');

    try {
      // Close Discord connection
      this.container.discordClient?.destroy();

      // Close Redis connection
      await this.container.redisClient?.quit();

      // Close database connection
      await prisma.$disconnect();

      logger.info('✅ Enterprise DI container disposed successfully');
    } catch (error) {
      logger.error({ error }, 'Error disposing DI container');
      throw error;
    }
  }
}
