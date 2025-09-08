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
- **@discord-bot/logger** - Centralized Pino logging

### Communication
- **Redis pub/sub** - Primary inter-service communication via channels:
  - `discord-bot:commands` - Gateway → Audio command routing
  - `discord-bot:to-audio` - Gateway → Audio Discord events
  - `discord-bot:to-discord` - Audio → Gateway Lavalink events
  - `discord-bot:ui:now` - Audio → Gateway real-time UI updates
- **PostgreSQL** - Persistent storage for queues, settings, and feature flags
- **Lavalink** - External audio processing server

## Key Technologies
- **TypeScript + Node.js** with ES modules
- **pnpm workspaces** for monorepo management
- **Discord.js v14** for Discord API integration
- **Lavalink v4** for audio streaming with advanced plugins:
  - **YouTube Plugin v1.13.5** - Multi-client YouTube support (MUSIC, ANDROID_VR, WEB, WEB_EMBEDDED)
  - **SponsorBlock Plugin** - Automatic sponsor segment skipping for long sets
  - **LavaSrc Plugin v4.8.1** - Multi-platform support (Spotify, YouTube Music)
  - **LavaSearch Plugin v1.0.0** - Advanced search capabilities
- **Prisma** for database ORM
- **Vitest** for testing
- **OpenTelemetry** for observability

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
All services implement graceful shutdown, health checks, and structured error logging. Use the shared logger package for consistent log formatting.

### Performance Optimizations
- Search results cached for 5 minutes
- Search throttling prevents API abuse  
- Batch queue updates to reduce database load
- Memory monitoring for garbage collection
- **Lavalink optimizations**: High-quality opus encoding (quality: 10), advanced resampling, optimized buffer settings
- **YouTube bypass**: Multiple client configurations for maximum compatibility

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

### UI Controls
The Discord interface features an organized 3-row button layout:

**Row 1**: ⏯️ Play/Pause | ⏪ -10s | ⏩ +10s | ⏭️ Skip  
**Row 2**: 🔊 Vol + | 🔉 Vol - | 🔁 Loop | ⏹️ Stop  
**Row 3**: 🔀 Shuffle | 🗒️ Queue | 🧹 Clear | ▶️ Autoplay

### Configuration
Environment variables are validated through `@discord-bot/config` using Zod schemas. Check existing config schemas before adding new environment variables.

#### Lavalink Configuration
The bot uses an optimized Lavalink configuration (`lavalink/application.yml`) with:
- **High-quality audio**: 10/10 opus encoding, HIGH resampling
- **Performance tuning**: 400ms buffer, 5s frame buffer, seek ghosting enabled
- **Multiple YouTube clients**: Ensures maximum compatibility and bypass capabilities
- **SponsorBlock integration**: Automatically skips sponsor segments in long DJ sets