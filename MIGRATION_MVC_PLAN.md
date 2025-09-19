# 🚀 PLAN DE MIGRACIÓN A ARQUITECTURA MVC

## 📋 RESUMEN EJECUTIVO

### Estado Actual
- **Arquitectura**: Hexagonal/Clean Architecture + Legacy funcional
- **Tecnologías**: Discord.js v14.16.3, Lavalink v4, TypeScript, Redis, PostgreSQL
- **Microservicios**: Gateway, Audio, API, Worker

### Objetivo
Migrar a arquitectura **MVC (Model-View-Controller)** manteniendo las mejores prácticas y funcionalidades actuales.

## 🏗️ NUEVA ARQUITECTURA MVC

### Estructura por Servicio

```
services/
├── gateway/
│   ├── src/
│   │   ├── models/          # Modelos de datos y lógica de negocio
│   │   │   ├── guild.model.ts
│   │   │   ├── music-session.model.ts
│   │   │   ├── user.model.ts
│   │   │   └── queue.model.ts
│   │   ├── views/           # Vistas (Discord embeds, buttons, UI)
│   │   │   ├── music-player.view.ts
│   │   │   ├── queue.view.ts
│   │   │   ├── error.view.ts
│   │   │   └── settings.view.ts
│   │   ├── controllers/     # Controladores (manejo de comandos e interacciones)
│   │   │   ├── music.controller.ts
│   │   │   ├── queue.controller.ts
│   │   │   ├── settings.controller.ts
│   │   │   └── interaction.controller.ts
│   │   ├── services/        # Servicios auxiliares
│   │   │   ├── discord.service.ts
│   │   │   ├── redis.service.ts
│   │   │   ├── validation.service.ts
│   │   │   └── rate-limit.service.ts
│   │   ├── middleware/      # Middleware para procesamiento
│   │   │   ├── auth.middleware.ts
│   │   │   ├── error.middleware.ts
│   │   │   └── logging.middleware.ts
│   │   ├── config/          # Configuración
│   │   │   ├── database.config.ts
│   │   │   ├── discord.config.ts
│   │   │   └── redis.config.ts
│   │   ├── routes/          # Rutas de comandos
│   │   │   └── command.routes.ts
│   │   └── app.ts          # Aplicación principal
├── audio/
│   ├── src/
│   │   ├── models/
│   │   │   ├── track.model.ts
│   │   │   ├── player.model.ts
│   │   │   └── autoplay.model.ts
│   │   ├── views/
│   │   │   └── player-status.view.ts
│   │   ├── controllers/
│   │   │   ├── player.controller.ts
│   │   │   ├── queue.controller.ts
│   │   │   └── autoplay.controller.ts
│   │   └── services/
│   │       ├── lavalink.service.ts
│   │       └── recommendation.service.ts
├── api/
│   ├── src/
│   │   ├── models/
│   │   ├── views/
│   │   ├── controllers/
│   │   └── routes/
└── worker/
    ├── src/
    │   ├── models/
    │   ├── controllers/
    │   └── services/
```

## 📐 DISEÑO DETALLADO MVC

### 1. MODEL (Modelos)
```typescript
// gateway/src/models/guild.model.ts
export class GuildModel {
  constructor(
    private prisma: PrismaClient,
    private cache: RedisClient
  ) {}

  async findById(guildId: string): Promise<Guild | null> {
    // Lógica de negocio para obtener guild
  }

  async updateSettings(guildId: string, settings: GuildSettings): Promise<void> {
    // Lógica de negocio para actualizar configuración
  }

  async getActiveSession(guildId: string): Promise<MusicSession | null> {
    // Lógica de negocio para obtener sesión activa
  }
}

// gateway/src/models/music-session.model.ts
export class MusicSessionModel {
  async createSession(guildId: string, userId: string): Promise<MusicSession> {
    // Lógica de creación de sesión
  }

  async addTrack(sessionId: string, track: Track): Promise<void> {
    // Lógica para agregar pista
  }

  async getQueue(sessionId: string): Promise<Track[]> {
    // Lógica para obtener cola
  }
}
```

### 2. VIEW (Vistas)
```typescript
// gateway/src/views/music-player.view.ts
export class MusicPlayerView {
  static renderNowPlaying(track: Track, session: MusicSession): MessageOptions {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Now Playing')
      .setDescription(`**${track.title}**`)
      .addFields(
        { name: 'Artist', value: track.artist, inline: true },
        { name: 'Duration', value: track.duration, inline: true },
        { name: 'Requested by', value: `<@${track.requestedBy}>`, inline: true }
      )
      .setThumbnail(track.thumbnail)
      .setColor(0x00ff00);

    const components = this.createPlayerControls(session);

    return { embeds: [embed], components };
  }

  private static createPlayerControls(session: MusicSession): ActionRowBuilder[] {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('play_pause')
        .setEmoji(session.isPaused ? '▶️' : '⏸️')
        .setStyle(ButtonStyle.Primary),
      // ... más botones
    );

    return [row1, row2, row3];
  }
}

// gateway/src/views/error.view.ts
export class ErrorView {
  static renderError(error: Error): MessageOptions {
    const embed = new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription(error.message)
      .setColor(0xff0000);

    return { embeds: [embed], ephemeral: true };
  }
}
```

### 3. CONTROLLER (Controladores)
```typescript
// gateway/src/controllers/music.controller.ts
export class MusicController {
  constructor(
    private musicModel: MusicSessionModel,
    private guildModel: GuildModel,
    private musicView: MusicPlayerView,
    private audioService: AudioService
  ) {}

  async handlePlayCommand(interaction: CommandInteraction): Promise<void> {
    try {
      // 1. Validación
      await interaction.deferReply();

      const guildId = interaction.guildId!;
      const userId = interaction.user.id;
      const query = interaction.options.getString('query', true);

      // 2. Lógica de negocio (Model)
      const session = await this.musicModel.getOrCreateSession(guildId, userId);
      const track = await this.audioService.searchTrack(query);

      if (!track) {
        const errorView = ErrorView.renderError(new Error('Track not found'));
        await interaction.editReply(errorView);
        return;
      }

      await this.musicModel.addTrack(session.id, track);

      // 3. Renderizar vista (View)
      const view = MusicPlayerView.renderNowPlaying(track, session);

      // 4. Responder
      await interaction.editReply(view);

      // 5. Comunicación con servicio de audio
      await this.audioService.play(guildId, track);

    } catch (error) {
      const errorView = ErrorView.renderError(error as Error);
      await interaction.editReply(errorView);
    }
  }

  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const [action, ...params] = interaction.customId.split(':');

    switch(action) {
      case 'play_pause':
        await this.togglePlayPause(interaction);
        break;
      case 'skip':
        await this.skipTrack(interaction);
        break;
      case 'volume':
        await this.adjustVolume(interaction, params[0]);
        break;
      // ... más casos
    }
  }

  private async togglePlayPause(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const guildId = interaction.guildId!;
    const session = await this.musicModel.getActiveSession(guildId);

    if (!session) {
      return;
    }

    await this.audioService.togglePause(guildId);
    session.isPaused = !session.isPaused;

    const view = MusicPlayerView.renderNowPlaying(session.currentTrack, session);
    await interaction.editReply(view);
  }
}

// gateway/src/controllers/queue.controller.ts
export class QueueController {
  constructor(
    private queueModel: QueueModel,
    private queueView: QueueView
  ) {}

  async handleQueueCommand(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply();

    const guildId = interaction.guildId!;
    const queue = await this.queueModel.getQueue(guildId);

    const view = this.queueView.renderQueue(queue);
    await interaction.editReply(view);
  }

  async handleClearCommand(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply();

    const guildId = interaction.guildId!;
    await this.queueModel.clearQueue(guildId);

    await interaction.editReply({ content: '✅ Queue cleared!' });
  }
}
```

### 4. SERVICES (Servicios)
```typescript
// gateway/src/services/discord.service.ts
export class DiscordService {
  private client: Client;
  private commands: Collection<string, Command>;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
      ]
    });

    this.commands = new Collection();
  }

  async initialize(): Promise<void> {
    await this.registerCommands();
    await this.setupEventHandlers();
    await this.client.login(process.env.DISCORD_TOKEN);
  }

  private async registerCommands(): Promise<void> {
    // Registro de comandos slash
  }

  private setupEventHandlers(): void {
    this.client.on('ready', this.onReady.bind(this));
    this.client.on('interactionCreate', this.onInteraction.bind(this));
    this.client.on('voiceStateUpdate', this.onVoiceStateUpdate.bind(this));
  }
}

// gateway/src/services/rate-limit.service.ts
export class RateLimitService {
  private limits = new Map<string, RateLimit>();

  async checkLimit(userId: string, command: string): Promise<boolean> {
    const key = `${userId}:${command}`;
    const limit = this.limits.get(key);

    if (!limit) {
      this.limits.set(key, {
        count: 1,
        resetAt: Date.now() + 60000
      });
      return true;
    }

    if (Date.now() > limit.resetAt) {
      limit.count = 1;
      limit.resetAt = Date.now() + 60000;
      return true;
    }

    if (limit.count >= 5) {
      return false;
    }

    limit.count++;
    return true;
  }
}
```

### 5. MIDDLEWARE
```typescript
// gateway/src/middleware/auth.middleware.ts
export class AuthMiddleware {
  static async checkPermissions(
    interaction: CommandInteraction,
    next: () => Promise<void>
  ): Promise<void> {
    const member = interaction.member as GuildMember;

    // Verificar permisos de DJ
    const guildModel = new GuildModel();
    const guild = await guildModel.findById(interaction.guildId!);

    if (guild?.djRoleId && !member.roles.cache.has(guild.djRoleId)) {
      await interaction.reply({
        content: '❌ You need DJ role to use this command!',
        ephemeral: true
      });
      return;
    }

    await next();
  }
}

// gateway/src/middleware/error.middleware.ts
export class ErrorMiddleware {
  static async handleErrors(
    interaction: CommandInteraction,
    next: () => Promise<void>
  ): Promise<void> {
    try {
      await next();
    } catch (error) {
      logger.error('Command error:', error);

      const errorView = ErrorView.renderError(error as Error);

      if (interaction.deferred) {
        await interaction.editReply(errorView);
      } else {
        await interaction.reply(errorView);
      }
    }
  }
}
```

### 6. ROUTES (Rutas)
```typescript
// gateway/src/routes/command.routes.ts
export class CommandRouter {
  private controllers: Map<string, BaseController>;

  constructor() {
    this.controllers = new Map();
    this.registerControllers();
  }

  private registerControllers(): void {
    this.controllers.set('music', new MusicController());
    this.controllers.set('queue', new QueueController());
    this.controllers.set('settings', new SettingsController());
  }

  async routeCommand(interaction: CommandInteraction): Promise<void> {
    const commandName = interaction.commandName;
    const category = this.getCategoryFromCommand(commandName);

    const controller = this.controllers.get(category);
    if (!controller) {
      throw new Error(`No controller for category: ${category}`);
    }

    // Aplicar middleware
    await AuthMiddleware.checkPermissions(interaction, async () => {
      await ErrorMiddleware.handleErrors(interaction, async () => {
        await controller.handleCommand(interaction);
      });
    });
  }

  async routeButton(interaction: ButtonInteraction): Promise<void> {
    const controller = this.controllers.get('music');
    await controller.handleButtonInteraction(interaction);
  }
}
```

### 7. APP PRINCIPAL
```typescript
// gateway/src/app.ts
export class GatewayApp {
  private discordService: DiscordService;
  private redisService: RedisService;
  private commandRouter: CommandRouter;

  constructor() {
    this.discordService = new DiscordService();
    this.redisService = new RedisService();
    this.commandRouter = new CommandRouter();
  }

  async start(): Promise<void> {
    try {
      // Inicializar servicios
      await this.redisService.connect();
      await this.discordService.initialize();

      // Configurar event handlers
      this.setupEventHandlers();

      logger.info('Gateway MVC started successfully');
    } catch (error) {
      logger.error('Failed to start gateway:', error);
      process.exit(1);
    }
  }

  private setupEventHandlers(): void {
    this.discordService.on('interactionCreate', async (interaction) => {
      if (interaction.isCommand()) {
        await this.commandRouter.routeCommand(interaction);
      } else if (interaction.isButton()) {
        await this.commandRouter.routeButton(interaction);
      }
    });
  }
}

// gateway/src/index.ts
import { GatewayApp } from './app';

const app = new GatewayApp();
app.start().catch(console.error);
```

## 🔄 PLAN DE MIGRACIÓN

### Fase 1: Preparación (1-2 días)
1. ✅ Análisis completo del código actual
2. ✅ Diseño de arquitectura MVC
3. Backup del código actual
4. Configurar estructura de directorios MVC

### Fase 2: Migración de Modelos (2-3 días)
1. Migrar entidades de domain/ a models/
2. Adaptar repositorios a pattern ActiveRecord/DataMapper
3. Implementar validaciones en modelos
4. Migrar lógica de negocio

### Fase 3: Migración de Vistas (1-2 días)
1. Crear vistas para embeds de Discord
2. Implementar builders para componentes UI
3. Crear templates reutilizables
4. Migrar lógica de presentación

### Fase 4: Migración de Controladores (2-3 días)
1. Crear controladores por dominio
2. Implementar manejo de comandos
3. Implementar manejo de interacciones
4. Configurar routing

### Fase 5: Servicios y Middleware (1-2 días)
1. Migrar servicios auxiliares
2. Implementar middleware de autenticación
3. Implementar middleware de errores
4. Configurar rate limiting

### Fase 6: Testing (2-3 días)
1. Escribir tests unitarios para modelos
2. Escribir tests de integración para controladores
3. Tests end-to-end
4. Performance testing

### Fase 7: Deployment (1 día)
1. Actualizar Docker configurations
2. Actualizar CI/CD pipelines
3. Deploy a staging
4. Deploy a producción

## 📊 COMPARACIÓN ARQUITECTURAS

| Aspecto | Clean Architecture Actual | MVC Propuesto | Beneficio |
|---------|--------------------------|---------------|-----------|
| **Complejidad** | Alta (4 capas) | Media (3 capas) | Más simple de mantener |
| **Separación** | Estricta | Clara | Más flexible |
| **Testing** | Complejo | Simple | Tests más directos |
| **Onboarding** | Difícil | Fácil | Menor curva de aprendizaje |
| **Performance** | Overhead por capas | Directo | Menos overhead |
| **Escalabilidad** | Excelente | Excelente | Mantiene escalabilidad |

## 🎯 BENEFICIOS DE LA MIGRACIÓN

1. **Simplicidad**: Arquitectura más directa y fácil de entender
2. **Mantenibilidad**: Menos capas de abstracción
3. **Developer Experience**: Más familiar para desarrolladores
4. **Performance**: Menos overhead por capas
5. **Testing**: Tests más simples y directos
6. **Flexibilidad**: Más fácil de modificar y extender

## ⚠️ CONSIDERACIONES

1. **Mantener funcionalidad**: No perder features durante migración
2. **Testing continuo**: Validar cada fase
3. **Rollback plan**: Poder volver atrás si necesario
4. **Documentación**: Actualizar docs durante migración
5. **Comunicación**: Coordinar con equipo si aplicable

## 🚀 SIGUIENTE PASO

Comenzar con Fase 1: Preparación y backup del código actual.