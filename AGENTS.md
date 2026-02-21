# Agents

Purpose: Define specialized agents per service for analysis and coordination. This is internal documentation and does not change runtime behavior.

Rules of engagement:
- Each agent owns its scope and coordinates via handoffs.
- Do not change code outside an agent's scope without a handoff.
- For audio/voice incidents, follow the coordination protocol at the end.

## Env/Security Governance (Mandatory)

Owner: Shared/Infra Agent

Any new runtime variable requires all of:
1. Add/update entry in `/Users/lucascisterna/Documents/repos/discord_bot/config/env.contract.json` (`classification`, `ownerAgent`, `required`, `sensitive`, `default`, `description`).
2. Sync every env file (`.env`, `.env.example`, `.env.test`, `.env.staging`, `.env.production`) keeping the same key order.
3. Classify explicitly as `env_only`, `db_only`, or `mixed`.
4. Pass checks:
   - `pnpm env:check`
   - `pnpm env:security:check`
5. For `mixed`/`db_only` keys, define handoff to RuntimeConfig migration backlog before service rollout.
6. Panel security baseline:
   - Nunca exponer `API_KEY` en browser (meta tags, `NEXT_PUBLIC_*`, HTML inline).
   - Panel web debe consumir `/api/v1/*` via BFF server-side con sesión (`x-discord-user-id`).

## Runtime Config Governance (Mandatory)

Owners: Shared/Infra Agent + API Agent + Gateway Agent

Any change in runtime behavior configuration requires all of:
1. Keep canonical runtime keys aligned between API, Gateway y panel.
2. Apply DB seed/update flow when new runtime keys are introduced:
   - `docker compose -p discordbot_main exec -T worker pnpm --filter @discord-bot/database prisma db seed`
3. Validate consistency:
   - `GET /api/v1/admin/config/definitions`
   - `GET /api/v1/admin/config/global`
   - `GET /api/v1/guilds/:guildId/runtime-config`
4. Update docs:
   - `docs/CHANGELOG.md`

## Agent Directory

| Agent | Mission | Owned Paths | External Interfaces | Key Logs / Signals | Local Run / Debug | Handoff Rules |
| --- | --- | --- | --- | --- | --- | --- |
| Gateway Agent | Discord gateway, commands, interactions, voice connection | /Users/lucascisterna/Documents/repos/discord_bot/gateway | Redis pub/sub: `discord-bot:commands`, `discord-bot:voice-events`, `discord-bot:to-audio`; Discord events `VOICE_STATE_UPDATE`, `VOICE_SERVER_UPDATE` | `GATEWAY_RAW: Forwarding voice event...` | `pnpm --filter gateway dev`; `docker-compose logs -f gateway` | If raw voice events are missing on `discord-bot:voice-events`, take ownership. If payload validation fails in Audio, take ownership. |
| Audio Agent | Playback, Lavalink integration, queues, voice sync, **audio quality controls**, **persistentConnection (24/7)**, YouTube token refresh | audio; lavalink | Redis: `discord-bot:voice-events`, `discord-bot:to-audio`; Lavalink client `sendRawData`; Lavalink REST `POST /youtube` | `LAVALINK: Received raw Discord gateway event...`; `VOICE_CONNECT: Processing ...`; `youtube_token_sync:*`; `audio: track end` | `pnpm --filter audio dev`; `docker-compose logs -f audio` | Lead for audio/voice incidents. Owns audio quality and 24/7 logic. Handoff to Shared/Infra if Lavalink unhealthy. |
| API Agent | REST API, health checks, webhooks, **guild settings (maxAudioQuality, persistentConnection)** | api | HTTP `/health`, `/api/v1/*` | API service errors; health endpoint failures | `pnpm --filter api dev`; `docker-compose logs -f api` | If issues are in shared DB/Redis, handoff to Shared/Infra. |
| Panel Agent | Next.js web panel, auth UX, **dashboard with tabs** (General, Audio, DJ, Autoplay, Conexión 24/7, Studio Mode), panel-side playback UI | apps/panel | NextAuth `/api/auth/*`; API consumption via `/api/v1/*`; panel player SSE | Next.js runtime/build errors; dashboard fetch failures; web player state | `pnpm --filter @discord-bot/panel dev`; `docker-compose logs -f panel` | If panel failure is caused by upstream API contract/permissions, handoff to API Agent. |
| Reliability Agent | 24/7 stability, timeouts, YouTube token refresh, diagnósticos de microcortes, validación playback prolongado | audio; gateway; scripts; docs | `YOUTUBE_TOKEN_AUTO_*`; `persistentConnection`; `diag:voice:microcut` | `youtube_token_sync:*`; playback stop after 30 min; microcuts | `pnpm diag:voice:microcut`; `/play` 60+ min test | Lead para bug 30 min y estabilidad 24/7. Coordina con Audio + Shared/Infra. |
| Worker Agent | Background jobs, scheduled tasks | /Users/lucascisterna/Documents/repos/discord_bot/worker | Redis queues (BullMQ) | Worker job failures or queue stalls | `pnpm --filter worker dev`; `docker-compose logs -f worker` | If queues or Redis are unhealthy, handoff to Shared/Infra. |
| Shared/Infra Agent | Shared libs, config, docker, Redis/DB, observability, project documentation | /Users/lucascisterna/Documents/repos/discord_bot/packages; /Users/lucascisterna/Documents/repos/discord_bot/config; /Users/lucascisterna/Documents/repos/discord_bot/docker-compose*.yml; /Users/lucascisterna/Documents/repos/discord_bot/k8s; /Users/lucascisterna/Documents/repos/discord_bot/monitoring; /Users/lucascisterna/Documents/repos/discord_bot/scripts; /Users/lucascisterna/Documents/repos/discord_bot/docs | Redis, PostgreSQL, Lavalink configuration, Docker orchestration | Docker health, Redis/DB connection errors, Lavalink startup logs | `docker-compose up -d`; `docker-compose ps`; `docker-compose logs -f redis postgres lavalink`; `pnpm diag:voice:microcut` | If a service-level symptom is actually infra/config, take ownership. |
| Test Agent | End-to-end validation, real-audio probe, CI diagnostics | /Users/lucascisterna/Documents/repos/discord_bot/tests; /Users/lucascisterna/Documents/repos/discord_bot/vitest.e2e.config.ts | Discord probe bot token, Redis response channels, Lavalink REST `/v4/stats` | `ui_push_success`; e2e probe RMS windows; `playingPlayers` > 0 | `pnpm test:web:panel:main`; `pnpm test:voice:diag`; `pnpm test:e2e:audio`; `pnpm test:voice:diag:main`; `pnpm test:e2e:audio:main`; `pnpm test:voice:smoke:main`; `pnpm test:voice:release:main` | If probe detects no PCM with active UI, handoff to Audio Agent. If Lavalink stats/health fail, handoff to Shared/Infra Agent. |

## Coordination Protocol: Audio/Voice Incidents (Docker local)

Lead: Audio Agent
Support: Gateway Agent + Shared/Infra Agent + Reliability Agent

Handoffs:
- If `discord-bot:voice-events` are not present or not forwarded, handoff to Gateway Agent.
- If Lavalink is unhealthy, not accepting connections, or missing in Docker, handoff to Shared/Infra Agent.
- If audio sees invalid voice credential payloads, handoff to Gateway Agent.
- If UI progresses but probe RMS remains below threshold, handoff to Audio Agent and keep Shared/Infra Agent in support.
- **Bug 30 min / 24/7**: Reliability Agent leads. Audio Agent implements `persistentConnection` and token refresh. Shared/Infra Agent owns `YOUTUBE_TOKEN_AUTO_*` env.

## Coordination Protocol: 24/7 & Playback Stability

Lead: Reliability Agent
Support: Audio Agent + Shared/Infra Agent

When playback stops after ~30 min or microcortes are reported:
1. Run `pnpm diag:voice:microcut` and capture logs.
2. Verify `YOUTUBE_TOKEN_AUTO_ENABLED=true` and `YOUTUBE_TOKEN_AUTO_REFRESH_MS=900000` (15 min) in production.
3. Audio Agent: ensure `persistentConnection` is read from DB and prevents auto-disconnect on empty queue para tier avanzado.
4. See `docs/MASTER_IMPROVEMENT_PLAN.md` for full remediación.

## Diagnostic Scenarios (for later execution)

1. `docker-compose up -d` and verify services are running.
2. `pnpm diag:voice:microcut` to capture deterministic evidence bundle.
3. `/play` in Discord should connect to voice.
4. Logs should include:
   - Gateway: `GATEWAY_RAW: Forwarding voice event...`
   - Audio: `LAVALINK: Received raw Discord gateway event...`
5. Lavalink logs show healthy startup and no connection errors.
6. Probe test confirms sustained RMS above threshold (`E2E_AUDIO_RMS_THRESHOLD`) for `E2E_AUDIO_CONSECUTIVE_WINDOWS`.

## WSL + Docker (Mandatory for Discord tests)

**Terminal**: Use WSL for all Docker and Discord-related tests. Do not use PowerShell/CMD.

```bash
wsl -e bash -c "cd /mnt/c/Users/lucas/Documents/discord_bot && docker compose up -d && pnpm test:voice:release:main"
```

See `.cursor/rules/wsl-docker-tests.mdc` for details.

## Deploy Gate (Docker-first)

Owner: Shared/Infra Agent with support from Test Agent

Before production promotion:
1. `pnpm env:check && pnpm env:security:check`
2. `pnpm build`
3. `pnpm deploy:docker:up`
4. `pnpm test:web:panel:main`
5. `pnpm test:voice:release:main`
6. Manual Discord validation: `/play` with 60-90s audible playback and progressing nowplaying UI.

## Reference Sources (Lavalink)

Audio Agent and Shared/Infra Agent must use these official sources when changing Lavalink behavior, configuration, plugins, REST or WebSocket usage:
- [Lavalink Docs](https://lavalink.dev/)
- [Lavalink REST API](https://lavalink.dev/api/rest)
- [Lavalink Docker Guide](https://lavalink.dev/getting-started/docker.html)
- [Lavalink Environment Variables](https://lavalink.dev/configuration/config/environment-variables)
- [Lavalink Plugins](https://lavalink.dev/plugins.html)
- [Lavalink GitHub](https://github.com/lavalink-devs/Lavalink)

## Reference Docs (Roadmap & Market)

- **Estrategia maestra**: `docs/MASTER_IMPROVEMENT_PLAN.md` – audio, 24/7, panel, competencia
- **Market research**: `docs/MARKET_RESEARCH.md` – competencia, diferenciadores, panel UX

## Reference Sources (Discord.js / Voice)

Gateway Agent, Panel Agent, and Test Agent must consult official Discord.js docs before changing interactions, components, gateway handling, or voice transport behavior:
- [Discord.js Guide](https://discordjs.guide/)
- [Discord.js Documentation](https://discord.js.org/docs/packages/discord.js/main)
- [Discord.js Voice Documentation](https://discord.js.org/docs/packages/voice/main)
- [Discord API Docs](https://discord.com/developers/docs/intro)
