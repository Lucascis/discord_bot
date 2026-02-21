# 🏗️ Discord Bot Architecture

## Overview

Production-ready Discord music bot with microservices architecture, características operativas, and comprehensive observability.

## 🎯 Architecture Pattern

**Microservices with Event-Driven Communication**
- **Gateway Service** - Discord interface & command handling
- **Audio Service** - Lavalink integration & music processing
- **API Service** - REST endpoints & external integrations
- **Worker Service** - Background jobs & scheduled tasks

## 🔗 Inter-Service Communication

### Redis: Dual Transport (Streams + Pub/Sub)

#### Redis Streams (canal principal para comandos)
At-least-once delivery, consumer groups, respuestas síncronas.

| Stream | Dirección | Propósito |
|--------|-----------|-----------|
| `discord-bot:audio-commands` | Gateway → Audio | play, queue, shuffle, clear, remove, move, seek, stop, autoplay |
| `discord-bot:audio-controls` | Gateway → Audio | toggle, pause, resume, skip, volume, loop, mute, filters (prioridad alta) |
| `discord-bot:audio-responses` | Audio → Gateway | Respuestas síncronas (ej. queue paginado) |

#### Redis Pub/Sub (eventos y voz)
| Canal | Dirección | Propósito |
|-------|-----------|-----------|
| `discord-bot:voice-events` | Gateway → Audio | Raw VOICE_STATE_UPDATE, VOICE_SERVER_UPDATE para Lavalink |
| `discord-bot:to-audio` | Gateway → Audio | VOICE_CREDENTIALS estructurados, search, play (DiscordAudioService) |
| `discord-bot:to-discord` | Audio → Gateway | Eventos Lavalink (track_queued, trackStart, queueEnd) |
| `discord-bot:ui:now` | Audio → Gateway | Actualizaciones UI en tiempo real |
| `discord-bot:panel-commands` | Panel/API → Gateway | summon, open_filters |

### Raw Voice Events (crítico para Lavalink)

```typescript
// Gateway: Events.Raw (discord.js v14)
client.on(Events.Raw, (d) => {
  const packet = d;
  if (!['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(packet.t)) return;
  await redisManager.getAudioClient().publish('discord-bot:voice-events', JSON.stringify(packet));
});

// Audio: reenvío a Lavalink
await redisManager.subscribe('discord-bot:voice-events', async (message) => {
  const packet = JSON.parse(message);
  await manager.sendRawData(packet);
});
```

### guildMutex: Concurrencia por Guild

Todas las mutaciones de queue/player en Audio deben ejecutarse bajo el mutex por guild:

```typescript
// audio/src/guildMutex.ts
await guildMutex.run(guildId, async () => {
  // Operaciones atómicas sobre player/queue
});
```

### Shared Database

- **PostgreSQL** con Prisma ORM
- Almacenamiento persistente: queues, settings, feature flags
- Transacciones ACID para operaciones críticas

## 📦 Package Architecture

### Services

| Servicio | Puerto | Tecnología |
|----------|--------|------------|
| Gateway | 3001 | Discord.js v14, Clean Architecture |
| Audio | 3002 | Lavalink client v2.7, guildMutex |
| API | 3000 | Express.js |
| Worker | 3003 | BullMQ |

### Shared Packages (`packages/`)

| Paquete | Responsabilidad |
|---------|-----------------|
| **@discord-bot/config** | Validación Zod de variables de entorno, fuente de verdad para tipos |
| **@discord-bot/database** | Prisma ORM, migraciones, seeding |
| **@discord-bot/logger** | Pino, Sentry, health checks |
| **@discord-bot/cache** | Redis Streams, circuit breaker, SearchCache, QueueCache |
| **@discord-bot/audio-control** | AudioCommandClient para envío de comandos vía Streams |
| **@discord-bot/subscription** | Compatibilidad legacy para runtime templates (en remoción) |

## 🎵 Music System Architecture

### Lavalink

- **Cliente**: lavalink-client ^2.7.0
- **Servidor**: Lavalink v4 (JAR en `lavalink/`)
- **Plugins**: YouTube, LavaSrc, LavaSearch (config en `lavalink/application.yml`)

### Flujo de Audio

```
Discord User → Gateway → Redis Streams → Audio (command-processor) → Lavalink → Voice
     ↑                                              ↓
     ← UI Updates ← discord-bot:ui:now ← Audio ← Voice Stream
                 ↑
     Raw Voice Events (discord-bot:voice-events)
```

### Search & Discovery

- **Multi-source**: YouTube, Spotify, YouTube Music
- **Autoplay**: Similar, Artist, Genre, Mixed
- **Cache**: 5 min TTL, throttling de búsquedas

## 🔧 Data Flow

### Comandos (ruta principal)

```
1. Discord Interaction → MusicController
2. AudioCommandService.sendCommand() → Redis Streams
3. command-processor (Audio) → Handler registrado
4. Lavalink operations → Playback
5. discord-bot:ui:now → Gateway → Discord UI
```

### State Management

- **Persistente**: PostgreSQL (queues, settings, history)
- **Sesión**: Redis (now playing, voice connections)
- **Cache**: Memory + Redis (search, queue, settings)

## 🛡️ Security

- **Zod**: Todas las variables en `packages/config`
- **Validación**: Comandos con `safeValidateCommand`, `validateCommandMessage`
- **Circuit breaker**: Redis con umbrales configurables

## 📊 Monitoring

### Health Endpoints

```
GET /health   - Estado del servicio
GET /ready    - Readiness (K8s)
GET /metrics  - Prometheus
```

### Puertos por servicio

- API: 3000
- Gateway: 3001
- Audio: 3002
- Worker: 3003

## 🔄 Development

```bash
pnpm install
pnpm --filter @discord-bot/database prisma:generate
pnpm db:migrate
pnpm dev:all
```

### Dependencias entre servicios

```
Gateway → @discord-bot/audio-control, @discord-bot/cache, @discord-bot/config, @discord-bot/database
Audio   → @discord-bot/cache, @discord-bot/config, @discord-bot/database
API     → @discord-bot/config, @discord-bot/database
Worker  → @discord-bot/config, @discord-bot/database
```
