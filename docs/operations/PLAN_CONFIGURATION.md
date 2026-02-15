# Plan Configuration (Docker-first)

Last updated: 2026-02-15

## Purpose

Define a single, operational source of truth for commercial plans and how to apply them safely in the running stack.

## Runtime Plan Matrix

- `FREE` (Free): 1 guild, basic playback.
- `BASIC` (Plus): 1 guild, panel + dual-audio features.
- `PREMIUM` (Pro): up to 3 guilds in parallel (1 voice session per guild by Discord constraint).
- `ENTERPRISE`: internal/custom tier (not part of the default public offer).

Panel summon policy:
- `FREE`: no panel summon.
- `BASIC`, `PREMIUM`, `ENTERPRISE`: panel summon enabled.

## Agent Ownership

- `Shared/Infra Agent`
  - Applies plan templates to database.
  - Verifies Docker health before/after sync.
- `API Agent`
  - Exposes `/api/v1/plans` and `/api/v1/plans/runtime` for audit.
- `Gateway Agent`
  - Handles QA test-guild bootstrap from `PREMIUM_TEST_GUILD_IDS`.
  - Test guild bootstrap tier must be `PREMIUM` (not `ENTERPRISE`).

## Apply Plan Templates to DB

Run from host against main stack:

```bash
docker compose -p discordbot_main exec -T worker pnpm db:seed
```

This updates `subscription_plans` + `subscription_prices` from runtime templates.

## Quick Validation

```bash
docker compose -p discordbot_main exec -T postgres \
  psql -U postgres -d discord \
  -c "select name, limits->>'maxGuilds' as max_guilds, features->>'concurrentPlaybacks' as concurrent_playbacks from subscription_plans order by name;"
```

Expected:

- `free`: `maxGuilds=1`, `concurrentPlaybacks=1`
- `basic`: `maxGuilds=1`, `concurrentPlaybacks=1`
- `premium`: `maxGuilds=3`, `concurrentPlaybacks=3`
- `enterprise`: unlimited (`-1`)

## API Audit Endpoints

- `GET /api/v1/plans` -> persisted DB plans.
- `GET /api/v1/plans/runtime` -> in-memory runtime cache.
- `POST /api/v1/plans/reload` -> reload runtime cache from DB.
- `GET /api/v1/guilds/:guildId/tier-debug` -> verifies `dbTier` vs effective tier, including `PREMIUM_TEST_GUILD_IDS` override source.
