# 🔧 Technical Context - Production Excellence Implementation

Este documento proporciona el contexto técnico detallado para implementar todas las mejoras del Production Roadmap.

---

## 🚨 **ANÁLISIS DEL PROBLEMA: node_modules DUPLICADOS**

### **Estado Actual Problemático**
```bash
# Estructura actual (INCORRECTA):
├── node_modules/                    # ✅ Correcto - dependencias raíz
├── api/node_modules/               # ❌ Problemático - duplicación
├── audio/node_modules/             # ❌ Problemático - duplicación
├── gateway/node_modules/           # ❌ Problemático - duplicación
├── worker/node_modules/            # ❌ Problemático - duplicación
└── packages/
    ├── commands/node_modules/      # ❌ Problemático - duplicación
    ├── config/node_modules/        # ❌ Problemático - duplicación
    ├── database/node_modules/      # ❌ Problemático - duplicación
    └── logger/node_modules/        # ❌ Problemático - duplicación
```

### **Problemas Causados**
1. **Espacio en disco**: ~200MB extra por cada node_modules duplicado
2. **Tiempo de instalación**: 3-5x más lento
3. **Inconsistencias de versiones**: Diferentes versiones entre servicios
4. **Cache inefficiency**: pnpm no puede compartir packages
5. **Build problems**: Puede causar conflictos de resolución de módulos

### **Configuración Correcta pnpm Workspace**

#### **1. Verificar pnpm-workspace.yaml**
```yaml
# pnpm-workspace.yaml (CORRECTO)
packages:
  - 'packages/*'
  - 'api'
  - 'audio'
  - 'gateway'
  - 'worker'
```

#### **2. Configurar .pnpmfile.cjs**
```javascript
// .pnpmfile.cjs
function readPackage(pkg, context) {
  // Fix dependency hoisting issues
  if (pkg.name && pkg.name.startsWith('@discord-bot/')) {
    // Ensure workspace packages are properly hoisted
    pkg.installConfig = {
      hoistPattern: ['*']
    };
  }

  return pkg;
}

module.exports = { readPackage };
```

#### **3. Configurar .npmrc**
```bash
# .npmrc (ACTUALIZAR)
shamefully-hoist=true
strict-peer-dependencies=false
auto-install-peers=true
dedupe-peer-dependents=true
shared-workspace-lockfile=true
link-workspace-packages=true
prefer-workspace-packages=true
```

#### **4. Script de Limpieza**
```bash
#!/bin/bash
# scripts/fix-workspace.sh

echo "🧹 Limpiando node_modules duplicados..."

# Remover todos los node_modules locales
rm -rf api/node_modules
rm -rf audio/node_modules
rm -rf gateway/node_modules
rm -rf worker/node_modules
rm -rf packages/*/node_modules

# Limpiar cache
pnpm store prune

# Reinstalar correctamente
echo "📦 Reinstalando con configuración correcta..."
pnpm install

# Verificar estructura correcta
echo "✅ Verificando estructura..."
if [ ! -d "api/node_modules" ] && [ ! -d "audio/node_modules" ]; then
  echo "✅ Configuración workspace correcta!"
else
  echo "❌ Aún hay node_modules locales"
  exit 1
fi
```

---

## 🔒 **IMPLEMENTACIONES DE SEGURIDAD DETALLADAS**

### **1. Rate Limiting Fail-Safe**

#### **Problema Actual**
```typescript
// gateway/src/index.ts:345-354 (PROBLEMÁTICO)
allow: async (interaction, cmd, limit = 10, windowSec = 60) => {
  try {
    const current = await redisPub.incr(key);
    if (current === 1) { await redisPub.expire(key, windowSec); }
    return current <= limit;
  } catch {
    return true; // ❌ CRÍTICO: Permite bypass total
  }
}
```

#### **Solución Segura**
```typescript
// packages/security/src/rate-limiter.ts
export class SecureRateLimiter {
  private fallbackLimiter = new Map<string, { count: number; resetTime: number }>();

  async isAllowed(
    interaction: CommandInteraction,
    command: string,
    limit = 10,
    windowSec = 60
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const key = `ratelimit:${interaction.guildId}:${interaction.user.id}:${command}`;

    try {
      // Primary: Redis-based rate limiting
      const current = await this.redis.incr(key);
      if (current === 1) {
        await this.redis.expire(key, windowSec);
      }

      const remaining = Math.max(0, limit - current);
      const resetTime = Date.now() + (windowSec * 1000);

      return {
        allowed: current <= limit,
        remaining,
        resetTime
      };

    } catch (error) {
      logger.warn({ error, key }, 'Redis rate limiter failed, using fallback');

      // Fallback: Memory-based rate limiting (MORE RESTRICTIVE)
      const fallbackLimit = Math.floor(limit * 0.5); // 50% of normal limit
      const fallbackKey = `${interaction.guildId}:${interaction.user.id}:${command}`;

      const entry = this.fallbackLimiter.get(fallbackKey);
      const now = Date.now();

      if (!entry || now > entry.resetTime) {
        // Reset window
        this.fallbackLimiter.set(fallbackKey, {
          count: 1,
          resetTime: now + (windowSec * 1000)
        });
        return { allowed: true, remaining: fallbackLimit - 1, resetTime: now + (windowSec * 1000) };
      }

      // Increment count
      entry.count++;
      const remaining = Math.max(0, fallbackLimit - entry.count);

      return {
        allowed: entry.count <= fallbackLimit,
        remaining,
        resetTime: entry.resetTime
      };
    }
  }

  // Cleanup fallback cache periodically
  private cleanupFallbackCache() {
    const now = Date.now();
    for (const [key, entry] of this.fallbackLimiter.entries()) {
      if (now > entry.resetTime) {
        this.fallbackLimiter.delete(key);
      }
    }
  }
}
```

### **2. TTL Memory Management**

#### **Problema Actual**
```typescript
// gateway/src/index.ts:188,817 (PROBLEMÁTICO)
const nowLive = new Map<string, NowLive>(); // ❌ Sin límites ni TTL
const autoplayCooldown = new Map<string, number>(); // ❌ Sin límites ni TTL
```

#### **Solución con TTL**
```typescript
// packages/cache/src/ttl-map.ts
export class TTLMap<K, V> {
  private data = new Map<K, { value: V; expiry: number }>();
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(maxSize = 1000, defaultTTL = 300000) { // 5 min default
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;

    // Cleanup every minute
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
  }

  set(key: K, value: V, ttl?: number): void {
    const expiry = Date.now() + (ttl || this.defaultTTL);

    // Enforce size limit (LRU eviction)
    if (this.data.size >= this.maxSize && !this.data.has(key)) {
      const oldestKey = this.data.keys().next().value;
      this.data.delete(oldestKey);
    }

    this.data.set(key, { value, expiry });
  }

  get(key: K): V | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiry) {
      this.data.delete(key);
      return undefined;
    }

    return entry.value;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.data.entries()) {
      if (now > entry.expiry) {
        this.data.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.data.clear();
  }
}

// Implementación en gateway/src/index.ts
const nowLive = new TTLMap<string, NowLive>(1000, 300000); // 1000 entries, 5min TTL
const autoplayCooldown = new TTLMap<string, number>(500, 60000); // 500 entries, 1min TTL
```

### **3. Secure Lavalink Headers**

#### **Problema Actual**
```typescript
// audio/src/services/lavalink.ts:43 (PROBLEMÁTICO)
const headers = { Authorization: env.LAVALINK_PASSWORD }; // ❌ Puede exponerse en logs
```

#### **Solución Segura**
```typescript
// packages/security/src/secure-headers.ts
export class SecureHeaderManager {
  private readonly credentials: Map<string, string> = new Map();

  constructor() {
    // Store credentials securely
    this.credentials.set('lavalink', process.env.LAVALINK_PASSWORD || '');
  }

  getSecureHeaders(service: 'lavalink'): Record<string, string> {
    const credential = this.credentials.get(service);
    if (!credential) {
      throw new SecurityError(`No credential found for service: ${service}`);
    }

    // Create headers without exposing raw credential
    return {
      'Authorization': credential,
      'User-Agent': 'Discord-Bot/1.0',
      'X-Request-ID': crypto.randomUUID(),
      [Symbol.toStringTag]: '[SecureHeaders]' // Prevent credential exposure in logs
    };
  }

  // Override toString to prevent credential leakage
  toString(): string {
    return '[SecureHeaderManager]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[SecureHeaderManager - credentials hidden]';
  }
}

// Usage in audio/src/services/lavalink.ts
const headerManager = new SecureHeaderManager();
const headers = headerManager.getSecureHeaders('lavalink');
```

---

## 🏗️ **ARQUITECTURA HEXAGONAL - IMPLEMENTACIÓN DETALLADA**

### **1. Estructura de Directorios Target**

```
services/
└── gateway/
    ├── src/
    │   ├── application/                 # Application Layer
    │   │   ├── commands/               # Command Handlers
    │   │   │   ├── music/
    │   │   │   │   ├── play.handler.ts
    │   │   │   │   ├── pause.handler.ts
    │   │   │   │   └── skip.handler.ts
    │   │   │   └── settings/
    │   │   │       └── configure.handler.ts
    │   │   ├── queries/                # Query Handlers
    │   │   │   ├── now-playing.query.ts
    │   │   │   └── queue-status.query.ts
    │   │   ├── services/               # Application Services
    │   │   │   ├── command-dispatcher.ts
    │   │   │   └── interaction-processor.ts
    │   │   └── use-cases/              # Use Cases
    │   │       ├── handle-play-command.ts
    │   │       └── handle-button-interaction.ts
    │   ├── domain/                     # Domain Layer
    │   │   ├── entities/               # Domain Entities
    │   │   │   ├── guild.entity.ts
    │   │   │   ├── user.entity.ts
    │   │   │   └── music-session.entity.ts
    │   │   ├── events/                 # Domain Events
    │   │   │   ├── track-started.event.ts
    │   │   │   └── track-ended.event.ts
    │   │   ├── services/               # Domain Services
    │   │   │   ├── permission.service.ts
    │   │   │   └── validation.service.ts
    │   │   ├── repositories/           # Repository Interfaces
    │   │   │   ├── guild.repository.ts
    │   │   │   └── music-session.repository.ts
    │   │   └── value-objects/          # Value Objects
    │   │       ├── guild-id.ts
    │   │       └── track-id.ts
    │   ├── infrastructure/             # Infrastructure Layer
    │   │   ├── discord/                # Discord.js Adapters
    │   │   │   ├── discord-client.adapter.ts
    │   │   │   └── interaction.adapter.ts
    │   │   ├── redis/                  # Redis Adapters
    │   │   │   ├── redis-client.adapter.ts
    │   │   │   └── event-bus.adapter.ts
    │   │   ├── persistence/            # Database Implementations
    │   │   │   ├── prisma-guild.repository.ts
    │   │   │   └── prisma-session.repository.ts
    │   │   ├── external/               # External Service Adapters
    │   │   │   └── lavalink.adapter.ts
    │   │   └── health/                 # Health Check Implementations
    │   │       └── health-checker.ts
    │   ├── presentation/               # Presentation Layer
    │   │   ├── controllers/            # Controllers
    │   │   │   ├── music.controller.ts
    │   │   │   └── interaction.controller.ts
    │   │   ├── dto/                    # Data Transfer Objects
    │   │   │   ├── play-command.dto.ts
    │   │   │   └── interaction.dto.ts
    │   │   ├── mappers/                # Entity-DTO Mappers
    │   │   │   └── music-session.mapper.ts
    │   │   └── ui/                     # UI Components
    │   │       ├── embed.builder.ts
    │   │       └── button.builder.ts
    │   ├── shared/                     # Shared Utilities
    │   │   ├── errors/                 # Custom Errors
    │   │   ├── constants/              # Constants
    │   │   └── utils/                  # Utility Functions
    │   └── main.ts                     # Composition Root
    └── tests/
        ├── unit/                       # Unit Tests by Layer
        │   ├── domain/
        │   ├── application/
        │   └── infrastructure/
        ├── integration/                # Integration Tests
        └── e2e/                        # End-to-End Tests
```

### **2. Domain Layer - Ejemplo Completo**

#### **Guild Entity**
```typescript
// gateway/src/domain/entities/guild.entity.ts
import { GuildId } from '../value-objects/guild-id.js';
import { GuildSettings } from '../value-objects/guild-settings.js';
import { DomainEvent } from '../events/domain-event.js';
import { GuildSettingsUpdatedEvent } from '../events/guild-settings-updated.event.js';

export class Guild {
  private events: DomainEvent[] = [];

  constructor(
    private readonly id: GuildId,
    private settings: GuildSettings,
    private readonly createdAt: Date = new Date()
  ) {}

  // Business Logic Methods
  enableAutoplay(): void {
    if (this.settings.isLoopEnabled()) {
      throw new BusinessRuleViolationError('Cannot enable autoplay while loop is active');
    }

    this.settings = this.settings.withAutoplay(true);
    this.addEvent(new GuildSettingsUpdatedEvent(this.id, this.settings));
  }

  disableAutoplay(): void {
    this.settings = this.settings.withAutoplay(false);
    this.addEvent(new GuildSettingsUpdatedEvent(this.id, this.settings));
  }

  updateDjRole(roleId: string): void {
    this.settings = this.settings.withDjRole(roleId);
    this.addEvent(new GuildSettingsUpdatedEvent(this.id, this.settings));
  }

  // Query Methods
  isAutomixEnabled(): boolean {
    return this.settings.isAutomixEnabled();
  }

  isLoopEnabled(): boolean {
    return this.settings.isLoopEnabled();
  }

  getDjRoleId(): string | null {
    return this.settings.getDjRoleId();
  }

  // Event Handling
  getUncommittedEvents(): DomainEvent[] {
    return [...this.events];
  }

  markEventsAsCommitted(): void {
    this.events = [];
  }

  private addEvent(event: DomainEvent): void {
    this.events.push(event);
  }

  // Getters
  getId(): GuildId {
    return this.id;
  }

  getSettings(): GuildSettings {
    return this.settings;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }
}
```

#### **Value Objects**
```typescript
// gateway/src/domain/value-objects/guild-id.ts
export class GuildId {
  constructor(private readonly value: string) {
    if (!value || !this.isValidSnowflake(value)) {
      throw new InvalidGuildIdError(`Invalid guild ID: ${value}`);
    }
  }

  equals(other: GuildId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  private isValidSnowflake(id: string): boolean {
    return /^\d{17,19}$/.test(id);
  }
}

// gateway/src/domain/value-objects/guild-settings.ts
export class GuildSettings {
  constructor(
    private readonly automixEnabled: boolean = false,
    private readonly loopEnabled: boolean = false,
    private readonly djRoleId: string | null = null,
    private readonly volume: number = 50
  ) {
    if (volume < 0 || volume > 200) {
      throw new InvalidVolumeError(`Volume must be between 0 and 200, got: ${volume}`);
    }
  }

  withAutoplay(enabled: boolean): GuildSettings {
    return new GuildSettings(enabled, this.loopEnabled, this.djRoleId, this.volume);
  }

  withLoop(enabled: boolean): GuildSettings {
    return new GuildSettings(this.automixEnabled, enabled, this.djRoleId, this.volume);
  }

  withDjRole(roleId: string | null): GuildSettings {
    return new GuildSettings(this.automixEnabled, this.loopEnabled, roleId, this.volume);
  }

  withVolume(volume: number): GuildSettings {
    return new GuildSettings(this.automixEnabled, this.loopEnabled, this.djRoleId, volume);
  }

  isAutomixEnabled(): boolean { return this.automixEnabled; }
  isLoopEnabled(): boolean { return this.loopEnabled; }
  getDjRoleId(): string | null { return this.djRoleId; }
  getVolume(): number { return this.volume; }
}
```

### **3. Application Layer - Use Cases**

```typescript
// gateway/src/application/use-cases/handle-play-command.use-case.ts
export class HandlePlayCommandUseCase {
  constructor(
    private readonly guildRepository: GuildRepository,
    private readonly musicService: MusicService,
    private readonly eventBus: EventBus,
    private readonly logger: Logger
  ) {}

  async execute(request: PlayCommandRequest): Promise<PlayCommandResponse> {
    // 1. Load domain entities
    const guild = await this.guildRepository.findById(new GuildId(request.guildId));
    if (!guild) {
      throw new GuildNotFoundError(`Guild not found: ${request.guildId}`);
    }

    // 2. Business logic validation
    if (!guild.canUserPlay(request.userId)) {
      throw new InsufficientPermissionsError('User does not have DJ permissions');
    }

    // 3. Domain service interaction
    const track = await this.musicService.resolveTrack(request.query);
    if (!track) {
      throw new TrackNotFoundError(`Track not found: ${request.query}`);
    }

    // 4. Domain logic execution
    const musicSession = await this.musicService.getOrCreateSession(guild.getId());
    musicSession.addTrack(track, request.userId);

    // 5. Persistence
    await this.musicService.saveSession(musicSession);

    // 6. Event publishing
    const events = musicSession.getUncommittedEvents();
    for (const event of events) {
      await this.eventBus.publish(event);
    }
    musicSession.markEventsAsCommitted();

    // 7. Response
    return PlayCommandResponse.success(track, musicSession.getCurrentPosition());
  }
}
```

### **4. Infrastructure Layer - Adapters**

```typescript
// gateway/src/infrastructure/discord/discord-client.adapter.ts
export class DiscordClientAdapter implements DiscordGateway {
  constructor(
    private readonly client: Client,
    private readonly logger: Logger
  ) {}

  async sendMessage(channelId: string, content: MessageContent): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        throw new InvalidChannelError(`Channel ${channelId} is not text-based`);
      }

      const message = this.buildMessage(content);
      await channel.send(message);

    } catch (error) {
      this.logger.error({ error, channelId }, 'Failed to send Discord message');
      throw new DiscordCommunicationError('Failed to send message', error);
    }
  }

  private buildMessage(content: MessageContent): MessageCreateOptions {
    return {
      embeds: content.embeds?.map(embed => this.buildEmbed(embed)),
      components: content.components?.map(component => this.buildComponent(component))
    };
  }
}

// gateway/src/infrastructure/persistence/prisma-guild.repository.ts
export class PrismaGuildRepository implements GuildRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger
  ) {}

  async findById(guildId: GuildId): Promise<Guild | null> {
    try {
      const guildData = await this.prisma.guildConfig.findUnique({
        where: { guildId: guildId.toString() }
      });

      if (!guildData) return null;

      return this.toDomain(guildData);

    } catch (error) {
      this.logger.error({ error, guildId: guildId.toString() }, 'Failed to find guild');
      throw new RepositoryError('Failed to find guild', error);
    }
  }

  async save(guild: Guild): Promise<void> {
    try {
      const data = this.toDatabase(guild);

      await this.prisma.guildConfig.upsert({
        where: { guildId: guild.getId().toString() },
        create: data,
        update: data
      });

    } catch (error) {
      this.logger.error({ error, guildId: guild.getId().toString() }, 'Failed to save guild');
      throw new RepositoryError('Failed to save guild', error);
    }
  }

  private toDomain(data: any): Guild {
    const guildId = new GuildId(data.guildId);
    const settings = new GuildSettings(
      data.automixEnabled,
      data.loopEnabled,
      data.djRoleId,
      data.volume
    );

    return new Guild(guildId, settings, data.createdAt);
  }

  private toDatabase(guild: Guild): any {
    const settings = guild.getSettings();

    return {
      guildId: guild.getId().toString(),
      automixEnabled: settings.isAutomixEnabled(),
      loopEnabled: settings.isLoopEnabled(),
      djRoleId: settings.getDjRoleId(),
      volume: settings.getVolume(),
      updatedAt: new Date()
    };
  }
}
```

---

## 📊 **MONITORING & OBSERVABILIDAD DETALLADA**

### **1. Business Metrics Implementation**

```typescript
// packages/metrics/src/business-metrics.ts
import { register, Counter, Histogram, Gauge } from 'prom-client';

export class BusinessMetrics {
  // Music-specific metrics
  public readonly songsPlayed = new Counter({
    name: 'discord_bot_songs_played_total',
    help: 'Total number of songs played',
    labelNames: ['guild_id', 'source', 'genre', 'user_id'],
    registers: [register]
  });

  public readonly queueLength = new Histogram({
    name: 'discord_bot_queue_length',
    help: 'Distribution of queue lengths',
    labelNames: ['guild_id'],
    buckets: [0, 1, 5, 10, 25, 50, 100, 200],
    registers: [register]
  });

  public readonly userSessionDuration = new Histogram({
    name: 'discord_bot_user_session_duration_seconds',
    help: 'User session duration in voice channels',
    labelNames: ['guild_id', 'user_id'],
    buckets: [60, 300, 900, 1800, 3600, 7200, 14400], // 1min to 4h
    registers: [register]
  });

  public readonly autoplayAccuracy = new Histogram({
    name: 'discord_bot_autoplay_accuracy',
    help: 'Autoplay recommendation accuracy (skip rate)',
    labelNames: ['guild_id', 'recommendation_type'],
    buckets: [0.0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0],
    registers: [register]
  });

  public readonly commandLatency = new Histogram({
    name: 'discord_bot_command_latency_seconds',
    help: 'Command execution latency',
    labelNames: ['command', 'guild_id', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register]
  });

  public readonly activeGuilds = new Gauge({
    name: 'discord_bot_active_guilds',
    help: 'Number of active guilds',
    registers: [register]
  });

  public readonly concurrentSessions = new Gauge({
    name: 'discord_bot_concurrent_music_sessions',
    help: 'Number of concurrent music sessions',
    registers: [register]
  });

  // Rate limiting metrics
  public readonly rateLimitHits = new Counter({
    name: 'discord_bot_rate_limit_hits_total',
    help: 'Rate limit hits by type',
    labelNames: ['type', 'guild_id', 'user_id'],
    registers: [register]
  });

  // Error metrics
  public readonly errors = new Counter({
    name: 'discord_bot_errors_total',
    help: 'Total errors by type',
    labelNames: ['service', 'error_type', 'severity'],
    registers: [register]
  });

  // Track song play
  trackSongPlayed(guildId: string, source: string, genre: string, userId: string): void {
    this.songsPlayed.inc({ guild_id: guildId, source, genre, user_id: userId });
  }

  // Track queue length
  trackQueueLength(guildId: string, length: number): void {
    this.queueLength.observe({ guild_id: guildId }, length);
  }

  // Track user session
  trackUserSession(guildId: string, userId: string, durationSeconds: number): void {
    this.userSessionDuration.observe({ guild_id: guildId, user_id: userId }, durationSeconds);
  }

  // Track autoplay accuracy
  trackAutoplayAccuracy(guildId: string, recommendationType: string, accuracy: number): void {
    this.autoplayAccuracy.observe({ guild_id: guildId, recommendation_type: recommendationType }, accuracy);
  }

  // Track command latency
  trackCommandLatency(command: string, guildId: string, status: string, latencySeconds: number): void {
    this.commandLatency.observe({ command, guild_id: guildId, status }, latencySeconds);
  }

  // Update active guilds count
  updateActiveGuilds(count: number): void {
    this.activeGuilds.set(count);
  }

  // Update concurrent sessions
  updateConcurrentSessions(count: number): void {
    this.concurrentSessions.set(count);
  }

  // Track rate limit hit
  trackRateLimitHit(type: string, guildId: string, userId: string): void {
    this.rateLimitHits.inc({ type, guild_id: guildId, user_id: userId });
  }

  // Track error
  trackError(service: string, errorType: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.errors.inc({ service, error_type: errorType, severity });
  }
}
```

### **2. Distributed Tracing**

```typescript
// packages/tracing/src/tracer.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

export class DistributedTracer {
  private sdk: NodeSDK;

  constructor() {
    this.sdk = new NodeSDK({
      resource: Resource.default().merge(
        new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'discord-bot',
          [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
          [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
          [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: process.env.HOSTNAME || 'localhost',
        }),
      ),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            requestHook: (span, request) => {
              span.setAttributes({
                'discord.guild_id': request.headers['x-guild-id'],
                'discord.user_id': request.headers['x-user-id'],
                'discord.command': request.headers['x-command'],
              });
            }
          },
          '@opentelemetry/instrumentation-redis': { enabled: true },
          '@opentelemetry/instrumentation-prisma': { enabled: true }
        }),
      ],
    });
  }

  start(): void {
    this.sdk.start();
  }

  async trace<T>(
    operation: string,
    fn: () => Promise<T>,
    attributes?: Record<string, string | number | boolean>
  ): Promise<T> {
    const tracer = getTracer('discord-bot');

    return tracer.startActiveSpan(operation, { attributes }, async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async traceCommand<T>(
    command: string,
    guildId: string,
    userId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.trace(`command.${command}`, fn, {
      'discord.command': command,
      'discord.guild_id': guildId,
      'discord.user_id': userId,
      'service.type': 'command-handler'
    });
  }

  async traceQuery<T>(
    query: string,
    guildId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.trace(`query.${query}`, fn, {
      'discord.query': query,
      'discord.guild_id': guildId,
      'service.type': 'query-handler'
    });
  }
}
```

### **3. Proactive Alerting**

```typescript
// packages/alerting/src/alert-manager.ts
export interface AlertRule {
  name: string;
  condition: string;
  severity: 'info' | 'warning' | 'critical';
  threshold: number;
  duration: string;
  actions: AlertAction[];
  enabled: boolean;
}

export interface AlertAction {
  type: 'slack' | 'email' | 'webhook' | 'auto_restart';
  config: Record<string, any>;
}

export class AlertManager {
  private rules: AlertRule[] = [
    {
      name: 'high_error_rate',
      condition: 'error_rate > threshold for duration',
      severity: 'critical',
      threshold: 0.05, // 5%
      duration: '5m',
      actions: [
        { type: 'slack', config: { channel: '#alerts' } },
        { type: 'email', config: { recipients: ['team@company.com'] } }
      ],
      enabled: true
    },
    {
      name: 'memory_usage_high',
      condition: 'memory_usage > threshold for duration',
      severity: 'warning',
      threshold: 0.85, // 85%
      duration: '3m',
      actions: [
        { type: 'slack', config: { channel: '#monitoring' } }
      ],
      enabled: true
    },
    {
      name: 'command_latency_high',
      condition: 'avg(command_latency) > threshold for duration',
      severity: 'warning',
      threshold: 5, // 5 seconds
      duration: '2m',
      actions: [
        { type: 'slack', config: { channel: '#performance' } }
      ],
      enabled: true
    },
    {
      name: 'lavalink_disconnected',
      condition: 'lavalink_connected_nodes == 0',
      severity: 'critical',
      threshold: 0,
      duration: '1m',
      actions: [
        { type: 'slack', config: { channel: '#alerts' } },
        { type: 'auto_restart', config: { service: 'lavalink' } }
      ],
      enabled: true
    },
    {
      name: 'queue_processing_slow',
      condition: 'avg(queue_processing_time) > threshold for duration',
      severity: 'warning',
      threshold: 10, // 10 seconds
      duration: '2m',
      actions: [
        { type: 'slack', config: { channel: '#performance' } }
      ],
      enabled: true
    },
    {
      name: 'redis_connection_failures',
      condition: 'redis_connection_failures > threshold for duration',
      severity: 'critical',
      threshold: 5,
      duration: '1m',
      actions: [
        { type: 'slack', config: { channel: '#alerts' } },
        { type: 'email', config: { recipients: ['oncall@company.com'] } }
      ],
      enabled: true
    }
  ];

  constructor(
    private readonly metricsCollector: MetricsCollector,
    private readonly notificationService: NotificationService,
    private readonly logger: Logger
  ) {}

  async evaluateAlerts(): Promise<void> {
    for (const rule of this.rules.filter(r => r.enabled)) {
      try {
        const triggered = await this.evaluateRule(rule);
        if (triggered) {
          await this.executeActions(rule, triggered.value);
        }
      } catch (error) {
        this.logger.error({ error, rule: rule.name }, 'Failed to evaluate alert rule');
      }
    }
  }

  private async evaluateRule(rule: AlertRule): Promise<{ triggered: boolean; value: number } | null> {
    const metric = await this.metricsCollector.getMetric(rule.name, rule.duration);

    if (!metric) {
      this.logger.warn({ rule: rule.name }, 'No metric data available for alert rule');
      return null;
    }

    const triggered = this.checkThreshold(metric.value, rule.threshold, rule.condition);

    return {
      triggered,
      value: metric.value
    };
  }

  private checkThreshold(value: number, threshold: number, condition: string): boolean {
    if (condition.includes('>')) {
      return value > threshold;
    }
    if (condition.includes('<')) {
      return value < threshold;
    }
    if (condition.includes('==')) {
      return value === threshold;
    }
    return false;
  }

  private async executeActions(rule: AlertRule, value: number): Promise<void> {
    const alert = {
      rule: rule.name,
      severity: rule.severity,
      value,
      threshold: rule.threshold,
      timestamp: new Date().toISOString(),
      message: `Alert: ${rule.name} - Value: ${value}, Threshold: ${rule.threshold}`
    };

    for (const action of rule.actions) {
      try {
        await this.executeAction(action, alert);
      } catch (error) {
        this.logger.error({ error, action: action.type, rule: rule.name }, 'Failed to execute alert action');
      }
    }
  }

  private async executeAction(action: AlertAction, alert: any): Promise<void> {
    switch (action.type) {
      case 'slack':
        await this.notificationService.sendSlack(action.config.channel, alert);
        break;
      case 'email':
        await this.notificationService.sendEmail(action.config.recipients, alert);
        break;
      case 'webhook':
        await this.notificationService.sendWebhook(action.config.url, alert);
        break;
      case 'auto_restart':
        await this.executeAutoRestart(action.config.service);
        break;
    }
  }

  private async executeAutoRestart(service: string): Promise<void> {
    this.logger.warn({ service }, 'Executing auto-restart for service');
    // Implementation depends on deployment environment
    // Docker: docker-compose restart ${service}
    // Kubernetes: kubectl rollout restart deployment/${service}
  }
}
```

---

## 🛠️ **SCRIPTS DE MIGRACIÓN AUTOMÁTICA**

### **1. Script de Limpieza Workspace**

```bash
#!/bin/bash
# scripts/fix-workspace.sh

set -e

echo "🧹 Iniciando limpieza de workspace..."

# Función para verificar comando
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ $1 no está instalado"
        exit 1
    fi
}

# Verificar herramientas necesarias
check_command pnpm
check_command node

echo "📦 Limpiando node_modules duplicados..."

# Remover todos los node_modules locales
find . -name "node_modules" -type d -not -path "./node_modules" -exec rm -rf {} + 2>/dev/null || true

# Limpiar cache pnpm
pnpm store prune

# Limpiar lockfile si existe corrupción
if [ -f "pnpm-lock.yaml" ]; then
    echo "🔄 Verificando lockfile..."
    if ! pnpm install --frozen-lockfile --dry-run; then
        echo "⚠️  Regenerando lockfile corrupto..."
        rm pnpm-lock.yaml
    fi
fi

echo "📝 Configurando .npmrc optimizado..."
cat > .npmrc << EOF
shamefully-hoist=true
strict-peer-dependencies=false
auto-install-peers=true
dedupe-peer-dependents=true
shared-workspace-lockfile=true
link-workspace-packages=true
prefer-workspace-packages=true
EOF

echo "📦 Reinstalando dependencias..."
pnpm install

echo "✅ Verificando estructura correcta..."
ISSUES=0

# Verificar que no hay node_modules locales
if find . -name "node_modules" -type d -not -path "./node_modules" | grep -q .; then
    echo "❌ Aún existen node_modules locales:"
    find . -name "node_modules" -type d -not -path "./node_modules"
    ISSUES=$((ISSUES + 1))
fi

# Verificar que workspace packages están linkeados
echo "🔗 Verificando workspace linking..."
if ! pnpm list --depth 0 | grep -q "@discord-bot/"; then
    echo "❌ Workspace packages no están linkeados correctamente"
    ISSUES=$((ISSUES + 1))
fi

# Verificar build
echo "🔨 Verificando build..."
if ! pnpm build; then
    echo "❌ Build falló"
    ISSUES=$((ISSUES + 1))
fi

if [ $ISSUES -eq 0 ]; then
    echo "✅ Workspace configurado correctamente!"
    echo "📊 Estadísticas:"
    echo "   - Node modules: $(du -sh node_modules | cut -f1)"
    echo "   - Packages workspace: $(pnpm list --depth 0 | grep -c "@discord-bot/")"
else
    echo "❌ $ISSUES problemas encontrados"
    exit 1
fi
```

### **2. Script de Migración Arquitectónica**

```bash
#!/bin/bash
# scripts/migrate-architecture.sh

set -e

SERVICE=$1
if [ -z "$SERVICE" ]; then
    echo "Uso: $0 <service> (gateway|audio|api|worker)"
    exit 1
fi

echo "🏗️  Migrando $SERVICE a Clean Architecture..."

BASE_DIR="${SERVICE}/src"
BACKUP_DIR="${SERVICE}/src-backup-$(date +%Y%m%d-%H%M%S)"

# Backup
echo "💾 Creando backup..."
cp -r "$BASE_DIR" "$BACKUP_DIR"

# Crear nueva estructura
echo "📁 Creando estructura de directorios..."
mkdir -p "$BASE_DIR"/{application/{commands,queries,services,use-cases},domain/{entities,events,services,repositories,value-objects},infrastructure/{discord,redis,persistence,external,health},presentation/{controllers,dto,mappers,ui},shared/{errors,constants,utils}}

# Migrar archivos basándose en patrones
echo "📦 Migrando archivos..."

# Comandos -> Application Commands
find "$BACKUP_DIR" -name "*command*.ts" -not -path "*/test/*" -exec mv {} "$BASE_DIR/application/commands/" \;

# Servicios -> Domain Services (lógica de negocio) o Application Services
find "$BACKUP_DIR" -name "*service*.ts" -not -path "*/test/*" | while read file; do
    filename=$(basename "$file")
    if grep -q "business\|domain\|validation" "$file"; then
        mv "$file" "$BASE_DIR/domain/services/"
    else
        mv "$file" "$BASE_DIR/application/services/"
    fi
done

# Handlers -> Infrastructure o Presentation
find "$BACKUP_DIR" -name "*handler*.ts" -not -path "*/test/*" | while read file; do
    if grep -q "discord\|interaction" "$file"; then
        mv "$file" "$BASE_DIR/infrastructure/discord/"
    else
        mv "$file" "$BASE_DIR/presentation/controllers/"
    fi
done

# UI -> Presentation
find "$BACKUP_DIR" -name "*ui*.ts" -o -name "*embed*.ts" -o -name "*button*.ts" | while read file; do
    [ -f "$file" ] && mv "$file" "$BASE_DIR/presentation/ui/"
done

# Database/Prisma -> Infrastructure Persistence
find "$BACKUP_DIR" -name "*database*.ts" -o -name "*prisma*.ts" -o -name "*repository*.ts" | while read file; do
    [ -f "$file" ] && mv "$file" "$BASE_DIR/infrastructure/persistence/"
done

# Redis -> Infrastructure Redis
find "$BACKUP_DIR" -name "*redis*.ts" | while read file; do
    [ -f "$file" ] && mv "$file" "$BASE_DIR/infrastructure/redis/"
done

# Validation -> Domain Services
find "$BACKUP_DIR" -name "*validation*.ts" -not -path "*/test/*" | while read file; do
    [ -f "$file" ] && mv "$file" "$BASE_DIR/domain/services/"
done

# Error -> Shared Errors
find "$BACKUP_DIR" -name "*error*.ts" | while read file; do
    [ -f "$file" ] && mv "$file" "$BASE_DIR/shared/errors/"
done

# Resto a shared/utils
find "$BACKUP_DIR" -name "*.ts" -not -path "*/test/*" -not -name "index.ts" | while read file; do
    [ -f "$file" ] && mv "$file" "$BASE_DIR/shared/utils/"
done

# Crear archivos base necesarios
echo "📝 Creando archivos base..."

# Main composition root
cat > "$BASE_DIR/main.ts" << 'EOF'
import { Container } from 'inversify';
import { setupContainer } from './infrastructure/container.js';
import { DistributedTracer } from '@discord-bot/tracing';
import { logger } from '@discord-bot/logger';

async function bootstrap() {
  const tracer = new DistributedTracer();
  tracer.start();

  const container = setupContainer();

  // Start service
  const service = container.get('ServiceMain');
  await service.start();

  logger.info('Service started successfully');
}

bootstrap().catch(error => {
  logger.error({ error }, 'Failed to start service');
  process.exit(1);
});
EOF

# Container setup
mkdir -p "$BASE_DIR/infrastructure"
cat > "$BASE_DIR/infrastructure/container.ts" << 'EOF'
import { Container } from 'inversify';
import { TYPES } from './types.js';

export function setupContainer(): Container {
  const container = new Container();

  // Register dependencies
  // TODO: Add dependency registrations

  return container;
}
EOF

# Update imports
echo "🔧 Actualizando imports..."
find "$BASE_DIR" -name "*.ts" -exec sed -i.bak 's|from '\''[.]/|from '\''./|g' {} \;
find "$BASE_DIR" -name "*.ts.bak" -delete

echo "✅ Migración completada para $SERVICE"
echo "📁 Backup guardado en: $BACKUP_DIR"
echo "🔍 Revisar y ajustar imports manualmente"
```

### **3. Script de Validación Completa**

```bash
#!/bin/bash
# scripts/validate-production.sh

set -e

echo "🔍 Iniciando validación de producción..."

ERRORS=0
WARNINGS=0

# Función para reportar error
error() {
    echo "❌ ERROR: $1"
    ERRORS=$((ERRORS + 1))
}

# Función para reportar warning
warning() {
    echo "⚠️  WARNING: $1"
    WARNINGS=$((WARNINGS + 1))
}

# Función para success
success() {
    echo "✅ $1"
}

echo "🛡️  Validando seguridad..."

# Verificar vulnerabilidades
if pnpm audit --audit-level high 2>&1 | grep -q "vulnerabilities"; then
    error "Vulnerabilidades de alta severidad encontradas"
else
    success "Sin vulnerabilidades críticas"
fi

# Verificar secrets en código
if grep -r "password.*=" --include="*.ts" --include="*.js" src/ 2>/dev/null | grep -v "process.env"; then
    error "Posibles secrets hardcodeados encontrados"
else
    success "Sin secrets hardcodeados"
fi

echo "🏗️  Validando arquitectura..."

# Verificar estructura de directorios
for service in gateway audio api worker; do
    if [ -d "$service/src/application" ] && [ -d "$service/src/domain" ] && [ -d "$service/src/infrastructure" ]; then
        success "$service tiene estructura Clean Architecture"
    else
        warning "$service no sigue Clean Architecture"
    fi
done

echo "🔧 Validando código..."

# TypeScript check
if pnpm typecheck; then
    success "TypeScript check pasó"
else
    error "TypeScript check falló"
fi

# Linting
if pnpm lint; then
    success "Linting pasó"
else
    error "Linting falló"
fi

# Tests
if pnpm test; then
    success "Tests pasaron"
else
    error "Tests fallaron"
fi

# Coverage check
if pnpm test:coverage 2>&1 | grep -q "Lines.*: 80"; then
    success "Coverage >80%"
else
    warning "Coverage <80%"
fi

echo "🚀 Validando build..."

# Build check
if pnpm build; then
    success "Build exitoso"
else
    error "Build falló"
fi

echo "🐳 Validando Docker..."

# Docker build
if docker build -t discord-bot-test .; then
    success "Docker build exitoso"
    docker rmi discord-bot-test
else
    error "Docker build falló"
fi

echo "📊 Validando métricas..."

# Verificar endpoints de métricas
for port in 3000 3001 3002 3003; do
    if curl -s http://localhost:$port/metrics >/dev/null 2>&1; then
        success "Métricas disponibles en puerto $port"
    else
        warning "Métricas no disponibles en puerto $port"
    fi
done

echo "📝 Validando documentación..."

# Verificar documentos requeridos
for doc in README.md ARCHITECTURE.md SECURITY.md DEPLOYMENT.md; do
    if [ -f "$doc" ]; then
        success "$doc existe"
    else
        warning "$doc faltante"
    fi
done

echo "📊 RESUMEN DE VALIDACIÓN"
echo "========================"
echo "✅ Éxitos: $(echo "$ERRORS + $WARNINGS" | bc)"
echo "⚠️  Warnings: $WARNINGS"
echo "❌ Errores: $ERRORS"

if [ $ERRORS -eq 0 ]; then
    echo "🎉 ¡Validación de producción exitosa!"
    exit 0
else
    echo "🚨 Validación falló - $ERRORS errores deben corregirse"
    exit 1
fi
```

---

## 📚 **TEMPLATES DE IMPLEMENTACIÓN**

### **1. Template de Circuit Breaker**

```typescript
// packages/resilience/src/circuit-breaker.template.ts
export class CircuitBreakerTemplate {
  static createForRedis(): CircuitBreaker {
    return new CircuitBreaker({
      name: 'redis',
      timeout: 3000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      fallback: () => {
        logger.warn('Redis circuit breaker open, using fallback');
        return null;
      }
    });
  }

  static createForDatabase(): CircuitBreaker {
    return new CircuitBreaker({
      name: 'database',
      timeout: 5000,
      errorThresholdPercentage: 30,
      resetTimeout: 60000,
      fallback: () => {
        throw new ServiceUnavailableError('Database temporarily unavailable');
      }
    });
  }

  static createForLavalink(): CircuitBreaker {
    return new CircuitBreaker({
      name: 'lavalink',
      timeout: 10000,
      errorThresholdPercentage: 40,
      resetTimeout: 45000,
      fallback: () => {
        throw new ServiceUnavailableError('Audio service temporarily unavailable');
      }
    });
  }
}
```

### **2. Template de Repository**

```typescript
// templates/repository.template.ts
export abstract class BaseRepository<T, ID> {
  constructor(
    protected readonly prisma: PrismaClient,
    protected readonly logger: Logger,
    protected readonly metrics: BusinessMetrics
  ) {}

  abstract findById(id: ID): Promise<T | null>;
  abstract save(entity: T): Promise<void>;
  abstract delete(id: ID): Promise<void>;

  protected async withMetrics<R>(
    operation: string,
    fn: () => Promise<R>
  ): Promise<R> {
    const start = Date.now();
    try {
      const result = await fn();
      this.metrics.trackCommandLatency(
        `repository.${operation}`,
        'success',
        (Date.now() - start) / 1000
      );
      return result;
    } catch (error) {
      this.metrics.trackCommandLatency(
        `repository.${operation}`,
        'error',
        (Date.now() - start) / 1000
      );
      throw error;
    }
  }

  protected async withTransaction<R>(
    fn: (tx: PrismaTransactionClient) => Promise<R>
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
```

Este contexto técnico proporciona todos los detalles necesarios para implementar el roadmap completo hacia la excelencia en producción.