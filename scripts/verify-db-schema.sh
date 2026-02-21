#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/_docker-main.sh"

ensure_docker_main

REQUIRED_TABLES=(
  "Playlist"
  "PlaylistItem"
  "PlaylistCollaborator"
)

echo "[db-schema] Verifying critical tables exist in PostgreSQL..."

missing_tables=()
for table in "${REQUIRED_TABLES[@]}"; do
  count="$(compose_main exec -T postgres psql -U postgres -d discord -t -A -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}';" | tr -d '\r' | tr -d '[:space:]')"
  if [[ "${count}" != "1" ]]; then
    missing_tables+=("${table}")
  fi
done

if (( ${#missing_tables[@]} > 0 )); then
  echo "[db-schema] ERROR: Missing required tables: ${missing_tables[*]}"
  echo "[db-schema] Run this repair command (when safe to apply changes):"
  echo "  docker compose exec -T api pnpm --filter @discord-bot/database exec prisma db push"
  exit 1
fi

echo "[db-schema] OK: Required tables are present."
