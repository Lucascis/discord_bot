#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/_docker-main.sh"
OUT_BASE="${ROOT_DIR}/logs/diagnostics"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
OUT_DIR="${OUT_BASE}/${STAMP}"
mkdir -p "${OUT_DIR}"

SERVICES=("gateway" "audio" "lavalink")
CONTAINERS=("discord-gateway" "discord-audio" "discord-lavalink")

log() {
  printf '[voice-microcut-diag] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

load_lavalink_password() {
  if [[ -n "${LAVALINK_PASSWORD:-}" ]]; then
    printf '%s' "${LAVALINK_PASSWORD}"
    return
  fi

  if [[ -f "${ROOT_DIR}/.env" ]]; then
    local value
    value="$(grep '^LAVALINK_PASSWORD=' "${ROOT_DIR}/.env" | head -n1 | cut -d= -f2- || true)"
    value="${value%\"}"
    value="${value#\"}"
    printf '%s' "${value}"
    return
  fi

  printf ''
}

health_gate() {
  log "Running health gate for gateway/audio/lavalink"

  compose_main ps > "${OUT_DIR}/docker-compose-ps.txt"

  local unhealthy=0
  for idx in "${!CONTAINERS[@]}"; do
    local container="${CONTAINERS[$idx]}"
    local service="${SERVICES[$idx]}"
    local status
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
    printf '%s=%s\n' "${service}" "${status:-missing}" >> "${OUT_DIR}/health-gate.txt"

    if [[ -z "${status}" || "${status}" != "healthy" ]]; then
      unhealthy=1
      log "Health gate failed: ${service} is '${status:-missing}'"
    fi
  done

  if [[ "${unhealthy}" -ne 0 ]]; then
    log "Aborting diagnostics because health gate failed."
    exit 1
  fi
}

capture() {
  log "Capturing docker stats"
  docker stats --no-stream > "${OUT_DIR}/docker-stats.txt"

  log "Capturing recent service logs (last 15 minutes)"
  compose_main logs --since=15m gateway audio lavalink > "${OUT_DIR}/voice-chain-logs-last-15m.log" 2>&1

  local password
  password="$(load_lavalink_password)"
  if [[ -z "${password}" ]]; then
    log "LAVALINK_PASSWORD is missing; cannot fetch /v4/stats"
    exit 1
  fi

  log "Capturing Lavalink /v4/stats snapshot"
  curl -fsS -H "Authorization: ${password}" "http://localhost:2333/v4/stats" > "${OUT_DIR}/lavalink-stats.json"

  log "Capturing health endpoints snapshot"
  {
    curl -fsS "http://localhost:3001/health" || true
  } > "${OUT_DIR}/gateway-health.json"
  {
    curl -fsS "http://localhost:3002/health" || true
  } > "${OUT_DIR}/audio-health.json"
  {
    curl -fsS "http://localhost:3000/health" || true
  } > "${OUT_DIR}/api-health.json"
}

main() {
  require_cmd docker
  require_cmd curl
  ensure_docker_main
  check_conflicting_projects_main

  log "Writing diagnostics to ${OUT_DIR}"
  health_gate
  capture
  log "Done. Artifacts available at ${OUT_DIR}"
}

main "$@"
