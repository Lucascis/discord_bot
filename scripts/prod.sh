#!/usr/bin/env bash
set -euo pipefail

INFO() { printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }
WARN() { printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
ERR()  { printf "\033[1;31m[ERR ]\033[0m %s\n" "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || { ERR "Missing command: $1"; exit 1; }; }

need curl

# Detect docker compose binary
if command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
elif docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  ERR "Docker Compose not found. Install Docker Desktop (or docker-compose)."
  exit 1
fi

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
PLUGINS_DIR="$ROOT_DIR/lavalink/plugins" # not used in remote mode, kept for reference

# Load .env into current shell so we can validate credentials
set +u
if [ -f "$ROOT_DIR/.env" ]; then
  INFO "Loading .env"
  set -a; . "$ROOT_DIR/.env"; set +a
fi
set -u

# Spotify credentials recommended for full Spotify support (mirror/search). Warn if missing.
if [ -z "${SPOTIFY_CLIENT_ID:-}" ] || [ -z "${SPOTIFY_CLIENT_SECRET:-}" ]; then
  WARN "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set. Spotify URLs may fail to resolve."
  WARN "Create a Spotify app: https://developer.spotify.com/dashboard"
fi

RESET_FLAG="${RESET:-0}"
for arg in "$@"; do
  case "$arg" in
    --reset|-r) RESET_FLAG=1 ; shift ;;
  esac
done

if [ "$RESET_FLAG" = "1" ]; then
  WARN "Reset flag enabled: removing containers and volumes"
  $DC down -v --remove-orphans || true
fi

INFO "Starting data services (postgres, redis)"
$DC up -d --build postgres redis

# Remote plugin mode: no local JAR downloads; Lavalink will fetch plugins configured in application.yml

INFO "Starting Lavalink (remote plugins)"
$DC up -d --build lavalink

INFO "Waiting for Lavalink /v4/info"
out=""
for i in {1..60}; do
  if out=$(curl -sf -H 'Authorization: youshallnotpass' http://localhost:2333/v4/info); then
    echo "$out" | grep -q 'sourceManagers' && break
  fi
  sleep 2
done

if ! echo "$out" | grep -q 'sourceManagers'; then
  ERR "Lavalink /v4/info not ready. Check lavalink logs. Aborting."
  $DC logs --no-color lavalink | tail -n 100 || true
  exit 1
fi

echo "$out" | jq . >/dev/null 2>&1 || true
if echo "$out" | grep -q 'youtube'; then INFO "YouTube source detected"; else ERR "YouTube NOT detected in /v4/info."; exit 1; fi
if echo "$out" | grep -qi 'lavasrc'; then INFO "LavaSrc plugin detected"; else ERR "LavaSrc NOT detected in /v4/info."; exit 1; fi

INFO "Building application images"
$DC build

INFO "Running DB migrations inside the api service (deploy)"
# Apply pending migrations without creating new ones
$DC run --rm -T api pnpm --filter @discord-bot/database exec prisma migrate deploy

INFO "Starting application services (gateway, api, audio, worker)"
$DC up -d --build gateway api audio worker

wait_http() {
  local url="$1"; local name="$2"; local tries=60
  for i in $(seq 1 $tries); do
    if curl -sf "$url" >/dev/null; then INFO "$name healthy: $url"; return 0; fi
    sleep 2
  done
  WARN "$name did not become healthy: $url"
}

wait_http http://localhost:3001/health Gateway
wait_http http://localhost:3002/health Audio
wait_http http://localhost:3000/health API

INFO "Done. Try /play in your Discord server."
