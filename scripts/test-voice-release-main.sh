#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/_docker-main.sh"

runs="${VOICE_RELEASE_RUNS:-5}"

load_env_value() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return
  fi
  if [[ -f ".env" ]]; then
    local value
    value="$(grep "^${key}=" .env | head -n1 | cut -d= -f2- || true)"
    value="${value%$'\r'}"
    value="${value%\"}"
    value="${value#\"}"
    printf '%s' "${value}"
    return
  fi
  printf ''
}

hydrate_probe_env() {
  export DISCORD_PROBE_TOKEN="$(load_env_value DISCORD_PROBE_TOKEN)"
  export DISCORD_TEST_GUILD_ID="$(load_env_value DISCORD_TEST_GUILD_ID)"
  export DISCORD_TEST_VOICE_CHANNEL_ID="$(load_env_value DISCORD_TEST_VOICE_CHANNEL_ID)"
  export DISCORD_TEST_TEXT_CHANNEL_ID="$(load_env_value DISCORD_TEST_TEXT_CHANNEL_ID)"
  export DISCORD_TEST_USER_ID="$(load_env_value DISCORD_TEST_USER_ID)"
  export API_KEY="$(load_env_value API_KEY)"
}

hydrate_runtime_test_env() {
  # Run e2e checks from host against docker-published ports.
  export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
  export LAVALINK_HOST="${LAVALINK_HOST:-127.0.0.1}"
  export LAVALINK_PORT="${LAVALINK_PORT:-2333}"
  export API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"

  local lavalink_password
  lavalink_password="$(load_env_value LAVALINK_PASSWORD)"
  if [[ -n "${lavalink_password}" ]]; then
    export LAVALINK_PASSWORD="${lavalink_password}"
  fi
}

check_probe_env() {
  local missing=0
  for key in DISCORD_PROBE_TOKEN DISCORD_TEST_GUILD_ID DISCORD_TEST_VOICE_CHANNEL_ID DISCORD_TEST_TEXT_CHANNEL_ID DISCORD_TEST_USER_ID API_KEY; do
    if [[ -z "${!key:-}" ]]; then
      echo "[voice-release] Missing required env: ${key}" >&2
      missing=1
    fi
  done

  if [[ "${missing}" -ne 0 ]]; then
    echo "[voice-release] Export required Discord probe vars before running release gate." >&2
    exit 1
  fi

  for key in DISCORD_TEST_GUILD_ID DISCORD_TEST_VOICE_CHANNEL_ID DISCORD_TEST_TEXT_CHANNEL_ID DISCORD_TEST_USER_ID; do
    if [[ ! "${!key}" =~ ^[0-9]{17,19}$ ]]; then
      echo "[voice-release] Invalid ${key}: expected Discord snowflake (17-19 digits)." >&2
      exit 1
    fi
  done
}

check_health() {
  echo "[voice-release] Checking docker compose service status..."
  compose_main ps

  for endpoint in \
    "http://localhost:3000/health" \
    "http://localhost:3001/health" \
    "http://localhost:3002/health" \
    "http://localhost:3003/health"; do
    echo "[voice-release] Health: ${endpoint}"
    curl -fsS "$endpoint" >/dev/null
  done

  local lavalink_password
  lavalink_password="$(grep '^LAVALINK_PASSWORD=' .env | cut -d= -f2- || true)"
  lavalink_password="${lavalink_password%$'\r'}"
  if [[ -z "${lavalink_password}" ]]; then
    echo "[voice-release] LAVALINK_PASSWORD is missing in .env" >&2
    exit 1
  fi

  echo "[voice-release] Lavalink /v4/stats"
  if ! curl -fsS -H "Authorization: ${lavalink_password}" "http://localhost:2333/v4/stats" >/dev/null; then
    echo "[voice-release] host localhost:2333 unavailable, retrying from docker network"
    compose_main exec -T worker sh -lc \
      "wget -qO- --header='Authorization: ${lavalink_password}' 'http://lavalink:2333/v4/stats' >/dev/null"
  fi
}

check_youtube_extractor_health() {
  local extractor_errors
  extractor_errors="$(
    compose_main logs --since=30m lavalink 2>&1 \
      | grep -E "Problematic YouTube player script|Could not parse YouTube|SignatureCipherManager" || true
  )"

  if [[ -n "${extractor_errors}" ]]; then
    if [[ "${VOICE_RELEASE_STRICT_YOUTUBE:-false}" == "true" ]]; then
      echo "[voice-release] Lavalink youtube-source extraction errors detected in recent logs" >&2
      echo "${extractor_errors}" >&2
      exit 1
    fi
    echo "[voice-release] WARN youtube extraction errors detected (non-strict mode). Audio audibility passed." >&2
    echo "${extractor_errors}" >&2
  fi
}

run_test_with_docker_fallback() {
  local host_cmd="$1"
  local container_cmd="$2"
  local label="$3"

  if bash -lc "${host_cmd}"; then
    return 0
  fi

  echo "[voice-release] ${label} failed on host, retrying inside worker container"
  compose_main exec -T worker sh -lc \
    "API_BASE_URL='http://api:3000' REDIS_URL='redis://redis:6379' LAVALINK_HOST='lavalink' ${container_cmd}"
}

hydrate_probe_env
hydrate_runtime_test_env
check_probe_env
ensure_docker_main
check_conflicting_projects_main
check_health

echo "[voice-release] Running voice diagnostic..."
run_test_with_docker_fallback "pnpm test:voice:diag:main" "pnpm test:voice:diag" "voice diagnostic"

for i in $(seq 1 "$runs"); do
  echo "[voice-release] Running audio audibility test ${i}/${runs}..."
  run_test_with_docker_fallback "pnpm test:e2e:audio:main" "pnpm test:e2e:audio" "audio audibility test ${i}/${runs}"
done

check_youtube_extractor_health

echo "[voice-release] Completed ${runs} successful audio audibility runs."
