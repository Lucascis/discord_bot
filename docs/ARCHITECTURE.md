# 🏗️ Discord Bot Architecture

## Overview

Production-ready Discord music bot with microservices architecture, enterprise-grade features, and comprehensive observability.

## 🎯 Architecture Pattern

**Microservices with Event-Driven Communication**
- **Gateway Service** - Discord interface & command handling
- **Audio Service** - Lavalink integration & music processing
- **API Service** - REST endpoints & external integrations
- **Worker Service** - Background jobs & scheduled tasks

## 🔗 Inter-Service Communication

### Redis Pub/Sub Channels
```
discord-bot:commands     → Gateway → Audio (command routing)
discord-bot:to-audio     → Gateway → Audio (Discord events & raw voice events)
discord-bot:to-discord   → Audio → Gateway (Lavalink events)
discord-bot:ui:now       → Audio → Gateway (real-time UI updates)
```

### Critical Raw Events Handler (Fixed September 24, 2025)
```typescript
// Gateway Service: Forward raw Discord voice events to Audio service
this.discordClient.on('raw', async (data: any) => {
  await this.audioRedisClient.publish('discord-bot:to-audio', JSON.stringify(data));
});

// Audio Service: Process raw events for Lavalink voice connection
audioRedisClient.on('message', (channel, message) => {
  if (channel === 'discord-bot:to-audio') {
    const rawEvent = JSON.parse(message);
    // Forward to Lavalink for voice credential processing
    lavalinkManager.sendRawData(rawEvent);
  }
});
```

### Shared Database
- **PostgreSQL** with Prisma ORM
- Persistent storage for queues, settings, feature flags
- ACID transactions for critical operations

## 📦 Package Architecture

### Services (`/services`)

#### Gateway Service (`gateway/`)
- **Discord.js v14** interface
- Slash commands & button interactions
- Voice connection management
- UI message orchestration
- **Port**: <gateway_port>

#### Audio Service (`audio/`)
- **Lavalink v4** client integration
- Music queue management
- Search & autoplay algorithms
- Performance optimization
- **Port**: <audio_port>

#### API Service (`api/`)
- Express.js REST endpoints
- Health checks & monitoring
- External webhooks
- **Port**: <api_port>

#### Worker Service (`worker/`)
- BullMQ job queues
- Scheduled maintenance tasks
- Background processing
- **Port**: <worker_port>

### Shared Packages (`packages/`)

#### @discord-bot/database
```typescript
// Prisma ORM with optimized schema
models: GuildConfig, Queue, QueueItem, UserProfile, AuditLog, FeatureFlag
features: Transactions, migrations, seeding
database: PostgreSQL with connection pooling
```

#### @discord-bot/logger
```typescript
// Structured logging with health monitoring
transport: Pino with Sentry integration
features: Request correlation, performance metrics
outputs: Console, file rotation, external aggregation
```

#### @discord-bot/config
```typescript
// Environment configuration with validation
validation: Zod schemas for type safety
features: Hot reloading, environment-specific configs
sources: .env files, environment variables
```

#### @discord-bot/cache
```typescript
// Multi-level caching strategy
layers: Memory (TTL) → Redis → PostgreSQL
patterns: Cache-aside, write-through
eviction: LRU with intelligent prefetching
```

#### @discord-bot/observability
```typescript
// Enterprise monitoring stack
metrics: Prometheus with custom collectors
tracing: OpenTelemetry distributed tracing
alerts: Grafana dashboards with alerting
```

## 🎵 Music System Architecture

### Lavalink Integration
```yaml
Version: v4.1.1
Plugins:
  - YouTube Plugin v1.13.5 (MUSIC, ANDROID_VR, WEB)
  - SponsorBlock (automatic sponsor skipping)
  - LavaSrc v4.8.1 (multi-platform support)
  - LavaSearch v1.0.0 (advanced search)
```

### Audio Processing Flow (Updated September 24, 2025)
```
Discord User → Gateway → Redis → Audio → Lavalink → Voice
     ↑                                              ↓
     ← UI Updates ← Redis ← Audio ← Events ← Voice Stream
                 ↑
         Raw Voice Events (VOICE_SERVER_UPDATE, VOICE_STATE_UPDATE)
```

**Critical Voice Connection Fix:**
- Gateway forwards raw Discord voice events via `discord-bot:to-audio` channel
- Audio service processes raw events and forwards to Lavalink
- This enables `player.connected = true` and functional audio playback
- Resolves race condition that prevented voice connection establishment

### Search & Discovery
- **Multi-source search**: YouTube, Spotify, YouTube Music
- **Intelligent autoplay**: Similar, Artist, Genre, Mixed modes
- **Quality filtering**: Blacklist aggregators, prefer official
- **Performance optimization**: 5-minute cache, search throttling

## 🔧 Data Flow Architecture

### Command Processing
```
1. Discord Interaction → Gateway Service
2. Command Validation → Slash Command Handler
3. Redis Publish → discord-bot:commands
4. Audio Service → Command Processor
5. Lavalink Operations → Music Playback
6. UI Updates → Redis → Gateway → Discord
```

### State Management
```
- Persistent State: PostgreSQL (queues, settings, history)
- Session State: Redis (current playing, voice connections)
- Cache Layer: Memory (frequent queries, search results)
- Real-time: WebSocket-like via Redis pub/sub
```

## 🛡️ Security Architecture

### Input Validation
- **Zod schemas** for all environment variables
- **Command sanitization** with XSS prevention
- **Discord snowflake validation** for proper ID formats
- **Rate limiting** with configurable thresholds

### Error Handling
- **Circuit breaker pattern** with exponential backoff
- **Graceful degradation** rather than complete failure
- **Structured error logging** with correlation IDs
- **Health checks** with dependency monitoring

## 📊 Monitoring & Observability

### Metrics Collection
```typescript
// Custom Prometheus metrics
- discord_commands_total{command, status}
- audio_track_duration_seconds_total
- redis_operations_total{operation, status}
- lavalink_events_total{type, status}
```

### Health Endpoints
```
GET /health    - Service health status
GET /ready     - Readiness probe for K8s
GET /metrics   - Prometheus metrics endpoint
GET /info      - Service information & dependencies
```

### Performance Monitoring
- **Request tracing** with OpenTelemetry
- **Database query analysis** with slow query logging
- **Memory usage tracking** with garbage collection metrics
- **Cache hit/miss ratios** with optimization recommendations

## 🚀 Deployment Architecture

### Container Strategy
- **Multi-stage Docker builds** for optimization
- **Health checks** with dependency validation
- **Resource limits** with horizontal scaling
- **Security hardening** with non-root users

### Orchestration Options
```yaml
Development: docker-compose with hot reloading
Production: Kubernetes with Istio service mesh
Monitoring: Prometheus + Grafana stack
Logging: ELK stack with log aggregation
```

### Scaling Considerations
- **Horizontal scaling**: Multiple gateway instances
- **Database sharding**: By guild ID for large deployments
- **Cache distribution**: Redis cluster for high availability
- **Load balancing**: Service mesh with intelligent routing

## 🔄 Development Workflow

### Package Management
```bash
pnpm workspaces  # Monorepo management
pnpm dev:all     # Start all services in development
pnpm -r build    # Build all packages
pnpm test        # Run comprehensive test suite
```

### Service Dependencies
```
Gateway → @discord-bot/config, @discord-bot/logger, @discord-bot/database
Audio → @discord-bot/config, @discord-bot/logger, @discord-bot/cache
API → @discord-bot/config, @discord-bot/logger, @discord-bot/observability
Worker → @discord-bot/config, @discord-bot/logger, @discord-bot/database
```

This architecture ensures scalability, maintainability, and production reliability while providing enterprise-grade features for Discord music bot operations.