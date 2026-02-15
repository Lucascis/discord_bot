#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/_docker-main.sh"

ensure_docker_main
check_conflicting_projects_main

if [[ -z "${ROLLBACK_COMPOSE_FILE:-}" ]]; then
  echo "[rollback] Set ROLLBACK_COMPOSE_FILE to a compose file pointing to previous immutable image tags." >&2
  echo "[rollback] Example: ROLLBACK_COMPOSE_FILE=docker-compose.rollback.yml" >&2
  exit 1
fi

echo "[rollback] Bringing current stack down..."
compose_main down --remove-orphans

echo "[rollback] Bringing previous stack up from ${ROLLBACK_COMPOSE_FILE}..."
docker compose -p "${COMPOSE_PROJECT}" -f "${ROLLBACK_COMPOSE_FILE}" up -d

echo "[rollback] Rollback stack started"
