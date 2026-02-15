#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/_docker-main.sh"
cd "${ROOT_DIR}"

GUILD_ID="${DISCORD_TEST_GUILD_ID:-$(grep '^DISCORD_TEST_GUILD_ID=' .env | head -n1 | cut -d= -f2-)}"
STAFF_ID="${PANEL_STAFF_DISCORD_IDS:-$(grep '^PANEL_STAFF_DISCORD_IDS=' .env | head -n1 | cut -d= -f2- | cut -d',' -f1)}"
API_KEY="${API_KEY:-$(grep '^API_KEY=' .env | head -n1 | cut -d= -f2-)}"

PANEL_BASE_URL="${PANEL_BASE_URL:-http://localhost:3004}"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"

ensure_docker_main
check_conflicting_projects_main

echo "[panel-web-smoke] Compose status snapshot"
compose_main ps >/dev/null

assert_http() {
  local url="$1"
  local expected="$2"
  local label="$3"
  local body_file
  body_file="$(mktemp)"

  local status
  status="$(curl -sS -L -o "${body_file}" -w "%{http_code}" "${url}")"
  if [[ "${status}" != "${expected}" ]]; then
    echo "[panel-web-smoke] FAIL ${label}: expected ${expected}, got ${status} (${url})" >&2
    head -c 400 "${body_file}" >&2 || true
    rm -f "${body_file}"
    exit 1
  fi

  cat "${body_file}"
  rm -f "${body_file}"
}

echo "[panel-web-smoke] Checking panel root"
root_html="$(assert_http "${PANEL_BASE_URL}/" "200" "panel-root")"
if grep -q 'name=\"panel-api-base\"' <<<"${root_html}" || grep -q 'name=\"panel-api-key\"' <<<"${root_html}"; then
  echo "[panel-web-smoke] FAIL panel-root: found deprecated runtime API meta tags" >&2
  exit 1
fi

echo "[panel-web-smoke] Checking auth provider wiring"
providers_json="$(assert_http "${PANEL_BASE_URL}/api/auth/providers" "200" "panel-auth-providers")"
if ! jq -e '.discord.signinUrl and .discord.callbackUrl' >/dev/null <<<"${providers_json}"; then
  echo "[panel-web-smoke] FAIL panel-auth-providers: discord provider not configured" >&2
  echo "${providers_json}" >&2
  exit 1
fi

echo "[panel-web-smoke] Checking protected routes redirect when unauthenticated"
dashboard_status="$(curl -sS -o /dev/null -w "%{http_code}" "${PANEL_BASE_URL}/dashboard")"
if [[ "${dashboard_status}" != "307" ]]; then
  echo "[panel-web-smoke] FAIL dashboard redirect: expected 307, got ${dashboard_status}" >&2
  exit 1
fi

echo "[panel-web-smoke] Checking BFF public route"
runtime_plans="$(curl -sS "${PANEL_BASE_URL}/api/v1/plans/runtime")"
if ! jq -e '.data | arrays and length >= 1' >/dev/null <<<"${runtime_plans}"; then
  echo "[panel-web-smoke] FAIL BFF plans runtime payload invalid" >&2
  echo "${runtime_plans}" >&2
  exit 1
fi

echo "[panel-web-smoke] Checking BFF protected route rejects unauthenticated requests"
panel_guilds_status="$(curl -sS -o /tmp/panel_guilds_unauth.json -w "%{http_code}" "${PANEL_BASE_URL}/api/v1/panel/guilds")"
if [[ "${panel_guilds_status}" != "401" ]]; then
  echo "[panel-web-smoke] FAIL expected 401 for unauthenticated panel guilds route, got ${panel_guilds_status}" >&2
  cat /tmp/panel_guilds_unauth.json >&2 || true
  rm -f /tmp/panel_guilds_unauth.json
  exit 1
fi
rm -f /tmp/panel_guilds_unauth.json

if [[ -n "${API_KEY}" && -n "${STAFF_ID}" ]]; then
  echo "[panel-web-smoke] Checking API panel RBAC route with superadmin/staff identity"
  panel_payload="$(curl -sS \
    -H "X-API-Key: ${API_KEY}" \
    -H "X-Discord-User-Id: ${STAFF_ID}" \
    "${API_BASE_URL}/api/v1/panel/guilds")"
  if ! jq -e '.data | arrays' >/dev/null <<<"${panel_payload}"; then
    echo "[panel-web-smoke] FAIL panel guilds payload invalid for staff identity" >&2
    echo "${panel_payload}" >&2
    exit 1
  fi
fi

if [[ -n "${API_KEY}" && -n "${GUILD_ID}" ]]; then
  echo "[panel-web-smoke] Checking now-playing payload for guild ${GUILD_ID}"
  now_playing_payload="$(curl -sS -H "X-API-Key: ${API_KEY}" "${API_BASE_URL}/api/v1/player/${GUILD_ID}/now-playing")"
  if ! jq -e '.data.guildId == "'"${GUILD_ID}"'" or .data.guildId == null' >/dev/null <<<"${now_playing_payload}"; then
    echo "[panel-web-smoke] FAIL now-playing payload invalid for guild ${GUILD_ID}" >&2
    echo "${now_playing_payload}" >&2
    exit 1
  fi
fi

echo "[panel-web-smoke] PASS"
