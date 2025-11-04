# Copilot instructions for this repo

Purpose: give AI coding agents the minimum, concrete context to be productive in this monorepo.

## Big picture
- Services: gateway/ (Discord slash commands), audio/ (Lavalink + playback + queue/autoplay), api/ (REST + health), worker/ (background tasks). Shared packages live in packages/ (config, database, logger, etc.).
- Communication:
  - Redis pub/sub is the backbone. Gateway → Audio commands; Audio → Gateway UI updates and event notifications.
  - PostgreSQL via Prisma for queues, feature flags, and state; Prisma schema in packages/database/prisma/schema.prisma.
  - Lavalink v4 is the audio backend; config in lavalink/application.yml.
- Observability: Prometheus metrics on each service at /metrics. Common counters include lavalink_events_total and queue_ops_total (audio).

## Development workflow (Windows + pnpm)
- Install: pnpm install
- Typecheck: pnpm typecheck (tsc - noEmit across workspace)
- Build all: pnpm -r build
- Tests: pnpm test (Vitest); per package: pnpm --filter <pkg> test
- Database:
  - Generate client: pnpm --filter @discord-bot/database prisma:generate
  - Migrate: pnpm db:migrate (ensure DATABASE_URL is set; inside Docker it points to postgresql://postgres:postgres@postgres:5432/discord)
- Docker (recommended): docker compose up -d then check logs with docker compose logs -f gateway audio

## Key project conventions
- Per‑guild serialization: all queue/player mutations in audio/ must run under the per‑guild mutex. Use guildMutex.run(guildId, async () => { ... }) from audio/src/guildMutex.ts.
- Command routing: Gateway parses interactions and publishes typed messages to Audio via Redis. Audio discriminates on data.type (e.g., 'play', 'skip', etc.) and executes under the mutex.
- UI strategy: Gateway maintains a single message per channel for the now‑playing UI; ephemeral responses are used to avoid Discord timeouts.
- Config: Centralized in packages/config (Zod‑validated env). Prefer reading via that package, not process.env scattered across code.

## Files to know
- audio/src/index.ts — Audio command bus, queue/playback logic, metrics; make sure to narrow command types before accessing specific fields.
- audio/src/guildMutex.ts — Simple per‑guild mutex (promise chain). Always use this for any mutating operation.
- gateway/src/index.ts — Slash commands and Discord interaction wiring; forwards voice state/server updates to audio.
- packages/database/prisma/schema.prisma — DB models and migrations.
- vitest.config.ts — Workspace aliases; if you add a new shared package that tests import via path alias, mirror its alias here.

## Patterns and examples
- Metrics: import prom-client Registry/Counter; define once and register with the shared registry. Example in audio: queue_ops_total with label op (enqueue|skip|shuffle|remove|clear|move|loop).
- Post‑action persistence: After mutating the queue/player, persist with saveQueue(guildId, player) and consider autoplay triggers when queue empties.
- Health/metrics endpoints: Each service exposes /health and /metrics on its port (gateway:3001, audio:3002, api:3000, worker:3003 in Docker compose).

## Gotchas
- Prisma env loading: When running prisma inside containers, provide DATABASE_URL via env (compose sets service hostname to postgres). Locally, Prisma resolves .env next to schema.prisma or the shell env.
- TypeScript strictness: Narrow discriminated unions (data.type) into local constants before capturing in async closures to avoid TS18048 ('possibly undefined').
- Do not mutate queue/player outside the guild mutex; tests assume serialized behavior, and metrics depend on it.

## When you change behavior
- Update or add a small Vitest covering the happy path and one edge case. Concurrency tests for audio live in audio/test/.
- If introducing a new shared package, add a path alias in vitest.config.ts so tests can import it directly.
- If adding a new command, document its Redis message shape and update both gateway and audio handlers accordingly.
