# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Building and Running
- `pnpm dev` - Start gateway service in development mode
- `pnpm dev:all` - Start all services in parallel development mode
- `pnpm build` - Build all services
- `pnpm start` - Start all services in production mode

### Code Quality
- `pnpm lint` - Run ESLint across all packages
- `pnpm typecheck` - Run TypeScript type checking on all packages
- `pnpm test` - Run Vitest test suite

### Database Operations
- `pnpm db:migrate` - Run Prisma database migrations
- `pnpm db:seed` - Seed database with initial data
- `pnpm --filter @discord-bot/database prisma:generate` - Generate Prisma client (runs automatically after install)

### Package Management
- `pnpm install` - Install dependencies for all workspaces
- `pnpm -r <command>` - Run command in all workspace packages
- `pnpm --filter <package> <command>` - Run command in specific package

## Architecture Overview

This Discord music bot uses a microservices architecture with four main services:

### Services
- **Gateway** (`gateway/`) - Discord.js interface, handles slash commands and user interactions
- **Audio** (`audio/`) - Lavalink integration, music playback logic, and autoplay system  
- **API** (`api/`) - Express.js REST endpoints for external access and health checks
- **Worker** (`worker/`) - Background task processing (minimal implementation)

### Shared Packages (`packages/`)
- **@discord-bot/config** - Environment configuration with Zod validation
- **@discord-bot/database** - Prisma ORM, database models, and migrations
- **@discord-bot/logger** - Centralized Pino logging with Sentry integration
- **@discord-bot/commands** - Unified command system with decorators and middleware

### Communication
- **Redis pub/sub** - Primary inter-service communication via channels:
  - `discord-bot:commands` - Gateway → Audio command routing
  - `discord-bot:to-audio` - Gateway → Audio Discord events
  - `discord-bot:to-discord` - Audio → Gateway Lavalink events
  - `discord-bot:ui:now` - Audio → Gateway real-time UI updates
  - `discord-bot:lavalink-raw-events` - Gateway → Audio raw Discord gateway events (November 2025)
- **PostgreSQL** - Persistent storage for queues, settings, and feature flags
- **Lavalink** - External audio processing server

### Voice Connection Architecture (November 2025)
**Critical Implementation**: Lavalink-client requires raw Discord gateway events to establish voice connections. The bot implements a dedicated raw event forwarding system:

#### Gateway Service ([gateway/src/main.ts:2422-2536](gateway/src/main.ts#L2422-L2536))
- Subscribes to raw Discord gateway events via `client.ws.on(GatewayDispatchEvents.*)`
- Forwards `VOICE_SERVER_UPDATE`, `VOICE_STATE_UPDATE`, and `CHANNEL_DELETE` events to Audio service
- Implements deduplication with 1-second window to prevent duplicate processing
- Uses proper Discord.js v14 pattern (not deprecated `client.on('raw')`)
- Publishes events to Redis channel `discord-bot:lavalink-raw-events` in Discord gateway packet format: `{t: "EVENT_NAME", d: {...}}`

#### Audio Service ([audio/src/index.ts:1135-1169](audio/src/index.ts#L1135-L1169))
- Subscribes to `discord-bot:lavalink-raw-events` Redis channel
- Receives raw Discord gateway events and forwards to `manager.sendRawData(packet)`
- Enables Lavalink to establish UDP connection to Discord voice servers
- Results in `player.connected = true` and functional audio playback

**Why This Is Required**: Without raw gateway events, Lavalink cannot establish the WebSocket and UDP connections needed for voice communication. The standard Discord.js events don't provide the low-level data Lavalink needs for voice server connection.

## Key Technologies
- **TypeScript + Node.js** with ES modules
- **pnpm workspaces** for monorepo management
- **Discord.js v14** for Discord API integration
- **Lavalink v4.1.1** for audio streaming with advanced plugins:
  - **YouTube Plugin v1.13.5** - Multi-client YouTube support (MUSIC, ANDROID_VR, WEB, WEB_EMBEDDED)
  - **SponsorBlock Plugin** - Automatic sponsor segment skipping for long sets
  - **LavaSrc Plugin v4.8.1** - Multi-platform support (Spotify, YouTube Music)
  - **LavaSearch Plugin v1.0.0** - Advanced search capabilities
- **lavalink-client v2.5.9** - Unified across all services with raw event forwarding (November 2025)
- **Prisma** for database ORM
- **Vitest** for testing
- **OpenTelemetry** for observability
- **Sentry** for error monitoring and performance tracking

## Testing

Tests use Vitest with workspace package aliasing configured in `vitest.config.ts`. When adding new workspace packages that are imported in tested code, add their alias to avoid CI failures:

```typescript
alias: {
  '@discord-bot/database': path.resolve(__dirname, 'packages/database/src/index.ts'),
  '@discord-bot/logger': path.resolve(__dirname, 'packages/logger/src/index.ts'),
  '@discord-bot/config': path.resolve(__dirname, 'packages/config/src/index.ts'),
}
```

## Development Patterns

### Service Communication
Services communicate asynchronously via Redis pub/sub. Commands flow from Gateway to Audio, while UI updates flow back from Audio to Gateway.

### Error Handling
All services implement graceful shutdown, health checks, and structured error logging. Error monitoring is integrated across all services using Sentry for production-grade observability. Use the shared logger package for consistent log formatting and automatic error tracking.

#### Interaction Management
- **Processing Messages**: Immediate ephemeral "🎵 Processing..." responses prevent Discord timeout errors
- **Message Cleanup**: Automatic deletion of processing messages when UI is ready
- **Fallback Strategies**: Automatic fallback to new messages when edits fail
- **Command Context**: Audio service receives command type (`play`, `playnext`, `playnow`) for differential behavior
- **Voice Connection Persistence**: UI message deletion no longer triggers voice disconnection, preventing progressive delays

#### Discord API Error Resilience
- **Robust Error Classification**: Automatic detection of retryable vs non-retryable Discord API errors
- **Smart Retry Logic**: Exponential backoff for rate limits (code 20028), immediate fallback for non-retryable errors (10008, 50001, etc.)
- **Automatic Fallbacks**: Failed message edits automatically create new messages with cleanup of old ones
- **UI Message Management**: Single UI message per channel with automatic cleanup
- **Interaction Timeout Prevention**: Immediate ephemeral responses prevent "application did not respond" errors
- **Error Metrics**: Comprehensive Prometheus metrics for Discord operation monitoring:
  - `discord_api_errors_total` - Errors by operation, code, and retryable status
  - `discord_operation_retries_total` - Retry attempts by operation
  - `discord_operation_duration_seconds_total` - Operation timing and success rates
- **Transparent Recovery**: Message update failures are handled silently with fallback strategies

### Performance Optimizations
- Search results cached for 5 minutes
- Search throttling prevents API abuse
- Batch queue updates to reduce database load
- Memory monitoring for garbage collection
- **Lavalink optimizations**: High-quality opus encoding (quality: 10), advanced resampling, optimized buffer settings
- **YouTube bypass**: Multiple client configurations for maximum compatibility

### Scalability & Resource Management (November 2025)
**Production-ready for thousands of concurrent users with automatic resource cleanup:**

#### Memory Leak Prevention
- **Automatic Map Cleanup**: Guild-specific data (`previousTracks`, `previousTrackTimestamps`, `mutedVolumes`, `activeFilterPresets`) automatically cleared on player disconnect
- **Centralized Cleanup Function**: `cleanupGuildMaps()` in [audio/src/index.ts:3218-3248](audio/src/index.ts#L3218-L3248)
- **Logging**: Comprehensive cleanup metrics track memory usage

#### Timer Management
- **Global Timer Tracking**: All `setInterval`/`setTimeout` calls registered in `globalTimers` object
- **Graceful Shutdown**: All timers cleared on SIGINT/SIGTERM to prevent resource leaks
- **Implementation**: [audio/src/index.ts:340-343](audio/src/index.ts#L340-L343), [audio/src/index.ts:2897-2905](audio/src/index.ts#L2897-L2905)

#### Connection Pooling
- **PostgreSQL**: 25 connection pool (Prisma default for production)
- **Redis**: Circuit breaker pattern with automatic reconnection
- **Lavalink**: HTTP pool size 32, max pending requests 128 (optimized for concurrent operations)

#### Configuration
- **Audio Service**: 1GB memory limit, 512MB reserved
- **Lavalink**: 3 CPUs, 2GB memory, optimized for audio processing
- **Buffer Settings**: 800ms buffer, 10s frame buffer (prevents lag without excessive memory)

### Autoplay System
The bot features an advanced autoplay system with multiple recommendation modes:

- **Similar** (default) - Tracks similar to currently playing song
- **Artist** - More tracks from the same artist
- **Genre** - Tracks from detected genre (house, techno, trance, etc.)
- **Mixed** - Combination of artist (40%), genre (40%), and similar (20%) tracks

#### Electronic Music Support
- **Remix Support**: Allows official remixes while filtering low-quality content
- **Genre Detection**: Automatically detects electronic music genres from track titles/artists
- **Quality Filtering**: Advanced blacklist system blocks aggregator channels and low-quality content

### UI Controls & Command Behavior
The Discord interface features an organized 3-row button layout:

**Row 1**: ⏯️ Play/Pause | ⏪ -10s | ⏩ +10s | ⏭️ Skip
**Row 2**: 🔊 Vol + | 🔉 Vol - | 🔁 Loop | ⏹️ Stop
**Row 3**: 🔀 Shuffle | 🗒️ Queue | 🧹 Clear | ▶️ Autoplay

#### Music Command Behavior
- **`/play`**:
  - No music playing: Creates channel UI message with track info
  - Music playing: Sends ephemeral "Track Queued" message, maintains existing UI
- **`/playnext`**:
  - No music playing: Creates channel UI message (behaves like `/play`)
  - Music playing: Sends ephemeral "Track Queued" message, adds track to front of queue
- **`/playnow`**:
  - Immediately plays track without sending "Track Queued" notifications
  - Updates existing UI or creates new one if none exists
- **Queue Display**: Excludes currently playing track, shows only upcoming tracks
- **UI Management**: Single UI message per channel with automatic cleanup

### Configuration
Environment variables are validated through `@discord-bot/config` using Zod schemas. Check existing config schemas before adding new environment variables.

#### Lavalink Configuration
The bot uses an optimized Lavalink configuration (`lavalink/application.yml`) with:
- **High-quality audio**: 10/10 opus encoding, HIGH resampling
- **Performance tuning**: 400ms buffer, 5s frame buffer, seek ghosting enabled
- **Multiple YouTube clients**: Ensures maximum compatibility and bypass capabilities
- **SponsorBlock integration**: Automatically skips sponsor segments in long DJ sets

## SaaS Platform Features (Phase 1 - November 2025)

### Guild-Based Subscription Management
The bot implements a complete guild-based subscription system that separates Discord servers from user billing:

#### Guild Models
- **Guild**: Represents a Discord server in the platform database
  - `discordGuildId`: Unique Discord server ID
  - `name`, `icon`, `ownerId`: Server metadata
  - `isTestGuild`: Flag for test/development servers
- **GuildSubscription**: Manages subscription tier per server
  - `tier`: FREE, BASIC, PREMIUM, or ENTERPRISE
  - `status`: ACTIVE, TRIALING, CANCELED, etc.
  - Support for multiple payment providers (Stripe, MercadoPago, PayPal)

#### Test Guild Auto-Provisioning
Environment variable `PREMIUM_TEST_GUILD_IDS` enables automatic ENTERPRISE tier for development/testing:

```bash
# .env
PREMIUM_TEST_GUILD_IDS=123456789012345678,987654321098765432
```

**How it works:**
1. Configure test guild IDs in environment
2. GuildService reads IDs on initialization
3. First request to test guild automatically provisions:
   - Creates Guild record with `isTestGuild=true`
   - Creates GuildSubscription with tier=ENTERPRISE
   - All premium features instantly unlocked
4. Subsequent requests use fast indexed database lookup

#### GuildService API
Located in `packages/subscription/src/guild-service.ts`:

```typescript
import { GuildService } from '@discord-bot/subscription';

const guildService = new GuildService(prisma, testGuildIds);

// Get tier (auto-provisions if test guild)
const tier = await guildService.getGuildTier(guildId);

// Get complete guild info
const info = await guildService.getGuildInfo(guildId);

// Update subscription tier
await guildService.updateGuildTier(guildId, SubscriptionTier.PREMIUM);

// Cancel subscription
await guildService.cancelGuildSubscription(guildId, immediately, reason);
```

#### Integration Points
- **Gateway Middleware**: `gateway/src/middleware/subscription-middleware.ts` uses GuildService for tier checks
- **Database**: Prisma models in `packages/database/prisma/schema.prisma`
- **Config**: Environment variable parsing in `packages/config/src/index.ts`
- **Tests**: Comprehensive test suite in `packages/subscription/test/guild-service.test.ts` (15 tests)

#### Migration Path
Database migration available at:
- `packages/database/prisma/migrations/20251107000000_add_guild_models/migration.sql`

Run migration: `cd packages/database && pnpm prisma migrate deploy`

## Code Quality & Security

### Automated Quality Assurance
- **ESLint**: Strict TypeScript linting with no-any rules
- **Type Safety**: Full TypeScript coverage with strict type checking
- **Testing**: Comprehensive test suite with 181+ tests using Vitest
- **Pre-commit Hooks**: Automated linting and testing before commits

### Security Measures
- **Dependabot**: Automated dependency updates
- **Security Policies**: Vulnerability reporting guidelines in `.github/SECURITY.md`
- **Input Validation**: Zod schemas for all environment variables and user inputs
- **Error Monitoring**: Sentry integration for production error tracking
- **Type-safe Error Handling**: Custom error wrapper with proper generics
- **Discord API Resilience**: Automatic retry logic and fallback strategies prevent service disruptions

### CI/CD Pipeline
- **Continuous Integration**: Automated testing, linting, and building
- **Security Scanning**: Dependency vulnerability checks
- **Docker Multi-stage**: Optimized container builds with proper security practices