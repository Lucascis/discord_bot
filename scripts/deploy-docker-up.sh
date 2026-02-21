#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/_docker-main.sh"

ensure_docker_main
check_conflicting_projects_main
cleanup_project_containers_main

echo "[deploy] Starting infra dependencies..."
compose_main up -d postgres redis lavalink

echo "[deploy] Running database migrations in worker container context..."
compose_main run --rm --no-deps worker pnpm --filter @discord-bot/database prisma:deploy

echo "[deploy] Verifying critical database schema..."
bash "${ROOT_DIR}/scripts/verify-db-schema.sh"

echo "[deploy] Starting full docker compose stack..."
compose_main up -d --build --remove-orphans

echo "[deploy] Waiting for health checks..."
for endpoint in \
  "http://localhost:3000/health" \
  "http://localhost:3001/health" \
  "http://localhost:3002/health" \
  "http://localhost:3003/health"; do
  for _ in {1..20}; do
    if curl -fsS "$endpoint" >/dev/null; then
      break
    fi
    sleep 2
  done
  curl -fsS "$endpoint" >/dev/null
  echo "[deploy] Healthy: $endpoint"
done

echo "[deploy] Current compose status:"
compose_main ps

echo "[deploy] Stack is healthy"
