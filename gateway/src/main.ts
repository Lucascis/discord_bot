import { Client, GatewayIntentBits } from 'discord.js';
import { createClient } from 'redis';
import { prisma } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';

// Infrastructure Layer
import { PrismaGuildSettingsRepository } from './infrastructure/database/prisma-guild-settings-repository.js';
import { RedisMusicSessionRepository } from './infrastructure/redis/redis-music-session-repository.js';
import { DiscordAudioService } from './infrastructure/discord/discord-audio-service.js';
import { DiscordPermissionService } from './infrastructure/discord/discord-permission-service.js';

// Domain Layer
import { MusicSessionDomainService } from './domain/services/music-session-domain-service.js';

// Application Layer
import { PlayMusicUseCase } from './application/use-cases/play-music-use-case.js';
import { ControlMusicUseCase } from './application/use-cases/control-music-use-case.js';

// Presentation Layer
import { MusicController } from './presentation/controllers/music-controller.js';
import { MusicUIBuilder } from './presentation/ui/music-ui-builder.js';
import { InteractionResponseHandler } from './presentation/ui/interaction-response-handler.js';

/**
 * Composition Root
 * Dependency injection and application bootstrapping
 */
class GatewayApplication {
  private discordClient!: Client;
  private redisClient!: any;
  private musicController!: MusicController;

  async initialize(): Promise<void> {
    logger.info('Initializing Gateway application with Clean Architecture...');

    // Initialize external services
    await this.initializeClients();

    // Wire up dependencies
    this.wireUpDependencies();

    // Start the application
    await this.start();

    logger.info('Gateway application initialized successfully');
  }

  private async initializeClients(): Promise<void> {
    // Initialize Discord client
    this.discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
      ]
    });

    // Initialize Redis client
    this.redisClient = createClient({
      url: env.REDIS_URL
    });

    await this.redisClient.connect();
    logger.info('Redis client connected');
  }

  private wireUpDependencies(): void {
    // Infrastructure Layer (Adapters)
    const guildSettingsRepository = new PrismaGuildSettingsRepository(prisma);
    const musicSessionRepository = new RedisMusicSessionRepository(this.redisClient);
    const audioService = new DiscordAudioService(this.redisClient, {} /* search cache */);
    const permissionService = new DiscordPermissionService(this.discordClient);

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

    // Presentation Layer (UI & Controllers)
    const musicUIBuilder = new MusicUIBuilder();
    const responseHandler = new InteractionResponseHandler(musicUIBuilder);

    this.musicController = new MusicController(
      playMusicUseCase,
      controlMusicUseCase,
      musicUIBuilder,
      responseHandler
    );

    logger.info('Dependencies wired up successfully');
  }

  private async start(): Promise<void> {
    // Set up Discord event handlers
    this.setupDiscordEventHandlers();

    // Login to Discord
    await this.discordClient.login(env.DISCORD_TOKEN);
    logger.info('Discord client logged in');
  }

  private setupDiscordEventHandlers(): void {
    this.discordClient.once('ready', () => {
      logger.info(`Gateway ready! Logged in as ${this.discordClient.user?.tag}`);
    });

    this.discordClient.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isChatInputCommand()) return;

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