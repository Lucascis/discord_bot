#!/usr/bin/env bash
set -euo pipefail

INFO() { printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }
WARN() { printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
ERR()  { printf "\033[1;31m[ERR ]\033[0m %s\n" "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || { ERR "Missing command: $1"; exit 1; }; }

need docker-compose
need curl

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

INFO "Starting data services (postgres, redis)"
docker-compose up -d postgres redis

# Remote plugin mode: no local JAR downloads; Lavalink will fetch plugins configured in application.yml

INFO "Starting Lavalink (remote plugins)"
docker-compose up -d lavalink

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
  docker-compose logs --no-color lavalink | tail -n 100 || true
  exit 1
fi

echo "$out" | jq . >/dev/null 2>&1 || true
if echo "$out" | grep -q 'youtube'; then INFO "YouTube source detected"; else ERR "YouTube NOT detected in /v4/info."; exit 1; fi
if echo "$out" | grep -qi 'lavasrc'; then INFO "LavaSrc plugin detected"; else ERR "LavaSrc NOT detected in /v4/info."; exit 1; fi

INFO "Installing deps and running DB migrations"
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable pnpm >/dev/null 2>&1 || true
fi

cd "$ROOT_DIR"
pnpm install
DATABASE_URL=${DATABASE_URL_LOCAL:-postgresql://postgres:postgres@localhost:5432/discord} pnpm db:migrate

INFO "Starting application services (gateway, api, audio, worker)"
docker-compose up -d gateway api audio worker

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
