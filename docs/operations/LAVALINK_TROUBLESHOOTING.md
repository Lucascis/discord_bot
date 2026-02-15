# Lavalink Troubleshooting (Docker-First)

## Scope
Quick runbook for incidents where Discord UI updates but audio is missing, gets stuck, or has microcuts in the main Docker stack.

## 1) Fast Triage (always first)
1. Ensure core containers are healthy:
   - `docker compose -p discordbot_main ps`
2. Capture deterministic evidence bundle:
   - `./scripts/voice-microcut-diag.sh`
3. Validate Lavalink stats:
   - `curl -H "Authorization: $LAVALINK_PASSWORD" http://localhost:2333/v4/stats`

Artifacts are written under:
- `/Users/lucascisterna/Documents/repos/discord_bot/logs/diagnostics/<timestamp>/`

Deployment note (important):
- Lavalink config is image-baked from `/Users/lucascisterna/Documents/repos/discord_bot/lavalink/application.yml` via `/Users/lucascisterna/Documents/repos/discord_bot/lavalink/Dockerfile`.
- There is no host bind mount for `application.yml` in main compose (prevents Docker Desktop file-lock deadlocks).

## 2) What To Check In Logs
1. Gateway:
   - `GATEWAY_RAW: Forwarding voice event...`
   - `VOICE_CONNECT: ... reconnect ... oldState`
2. Audio:
   - `LAVALINK: Received raw Discord gateway event...`
   - `VOICE_CONNECT: Forced voice sync to Lavalink via updatePlayer`
   - `playback_state_transition` and `voice_transport_ready`
3. Lavalink:
   - `Problematic YouTube player script` (youtube-source extraction breakage)
   - node reconnect or websocket failures

## 3) YouTube Script Breakage Handling
When Lavalink logs `Problematic YouTube player script`, playback may degrade for affected tracks.

Recommended order:
1. Keep youtube plugin enabled and current.
   - Current pinned dependency in Docker compose:
     - `dev.lavalink.youtube:youtube-plugin:1.17.0`
2. Keep a stable client order in `application.yml` (`MUSIC/MWEB/WEB/WEBEMBEDDED/ANDROID_VR`).
3. Enable automatic token sync in Audio (fallback chain):
   - Library provider (`youtube-po-token-generator`)
   - Optional endpoint provider (`YOUTUBE_TOKEN_AUTO_ENDPOINT`)
   - Static env fallback (`YOUTUBE_PO_TOKEN` + `YOUTUBE_VISITOR_DATA`)
4. If breakage persists for restricted content, provide optional static env:
   - `YOUTUBE_PO_TOKEN`
   - `YOUTUBE_VISITOR_DATA`
5. Restart only the Lavalink container after controlled config change:
   - `docker compose -p discordbot_main up -d --force-recreate lavalink`
6. Release gate behavior:
   - `scripts/test-voice-release-main.sh` fails if recent Lavalink logs include `Problematic YouTube player script`.
   - treat this as a hard blocker for V1 promotion until extraction path is stable in repeated runs.

Recommended env for automation:
- `YOUTUBE_TOKEN_AUTO_ENABLED=true`
- `YOUTUBE_TOKEN_AUTO_REFRESH_MS=1800000`
- `YOUTUBE_TOKEN_AUTO_ENDPOINT=` (optional)
- `YOUTUBE_TOKEN_AUTO_ENDPOINT_BEARER=` (optional)
- Runtime default in this repo:
  - `.env`, `.env.staging`, `.env.production`: auto enabled
  - `.env.test`: auto disabled to keep tests deterministic

Validation notes:
- Fallback order is strict: `library -> endpoint -> static env`.
- If `YOUTUBE_TOKEN_AUTO_ENABLED=false`, Audio skips auto providers and uses only static fallback when both values exist.
- To confirm runtime behavior, check Audio logs for `youtube_token_sync:*` signals.

## 4) Recovery Procedure
1. If only Lavalink is unhealthy:
   - restart `lavalink`, then validate `/v4/stats`.
2. If Gateway voice events are missing:
   - inspect `gateway` logs for forwarding failures.
3. If Audio has credentials but no playback:
   - inspect `VOICE_CONNECT` + `playback_state_transition` chain for transport recovery fail-fast cause.

## 5) Validation Gate Before Closing Incident
1. Run `/play <query>` in Discord test guild.
2. Confirm:
   - audible audio in voice channel
   - nowplaying UI progresses `0:00 -> >0`
   - no unexpected reconnect spam in 5+ minutes.

## References
- [Lavalink Configuration](https://lavalink.dev/configuration/config/file)
- [Lavalink Environment Variables](https://lavalink.dev/configuration/config/environment-variables)
- [Lavalink REST Stats](https://lavalink.dev/api/rest#operation/getLavalinkStats)
- [youtube-source GitHub](https://github.com/lavalink-devs/youtube-source)
