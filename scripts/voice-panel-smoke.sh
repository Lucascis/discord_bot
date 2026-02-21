#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/_docker-main.sh"
cd "${ROOT_DIR}"

ensure_docker_main
check_conflicting_projects_main

echo "[voice-panel-smoke] Compose status snapshot"
compose_main ps >/dev/null

API_KEY="${API_KEY:-$(grep '^API_KEY=' .env | head -n1 | cut -d= -f2-)}"
GUILD_ID="${DISCORD_TEST_GUILD_ID:-$(grep '^DISCORD_TEST_GUILD_ID=' .env | head -n1 | cut -d= -f2-)}"
VOICE_ID="${DISCORD_TEST_VOICE_CHANNEL_ID:-$(grep '^DISCORD_TEST_VOICE_CHANNEL_ID=' .env | head -n1 | cut -d= -f2-)}"
TEXT_ID="${DISCORD_TEST_TEXT_CHANNEL_ID:-$(grep '^DISCORD_TEST_TEXT_CHANNEL_ID=' .env | head -n1 | cut -d= -f2-)}"
USER_ID="${DISCORD_TEST_USER_ID:-$(grep '^DISCORD_TEST_USER_ID=' .env | head -n1 | cut -d= -f2-)}"
QUERY="${E2E_AUDIO_QUERY:-$(grep '^E2E_AUDIO_QUERY=' .env | head -n1 | cut -d= -f2- | sed 's/^\"//; s/\"$//')}"
API_KEY="$(printf '%s' "${API_KEY}" | tr -d '\r')"
GUILD_ID="$(printf '%s' "${GUILD_ID}" | tr -d '\r')"
VOICE_ID="$(printf '%s' "${VOICE_ID}" | tr -d '\r')"
TEXT_ID="$(printf '%s' "${TEXT_ID}" | tr -d '\r')"
USER_ID="$(printf '%s' "${USER_ID}" | tr -d '\r')"
QUERY="$(printf '%s' "${QUERY}" | tr -d '\r')"
QUERY="$(printf '%s' "${QUERY}" | sed "s/^'//; s/'$//; s/^\"//; s/\"$//")"
if [[ -z "${QUERY}" ]]; then
  QUERY="https://www.youtube.com/watch?v=8DIGGjaE5gg"
fi

if [[ -z "${API_KEY}" || -z "${GUILD_ID}" || -z "${VOICE_ID}" || -z "${TEXT_ID}" || -z "${USER_ID}" ]]; then
  echo "[voice-panel-smoke] Missing required env variables (API_KEY / DISCORD_TEST_*)." >&2
  exit 1
fi

echo "[voice-panel-smoke] Summon guild=${GUILD_ID} voice=${VOICE_ID} text=${TEXT_ID}"
curl -fsS -X POST "http://localhost:3000/api/v1/player/${GUILD_ID}/summon" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  --data "{\"voiceChannelId\":\"${VOICE_ID}\",\"textChannelId\":\"${TEXT_ID}\"}" >/dev/null

sleep 2

echo "[voice-panel-smoke] Play query='${QUERY}'"
curl -fsS -X POST "http://localhost:3000/api/v1/player/${GUILD_ID}/play" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  --data "{\"query\":\"${QUERY}\",\"voiceChannelId\":\"${VOICE_ID}\",\"textChannelId\":\"${TEXT_ID}\",\"userId\":\"${USER_ID}\"}" >/dev/null

for _ in {1..45}; do
  payload="$(curl -fsS -H "X-API-Key: ${API_KEY}" "http://localhost:3000/api/v1/player/${GUILD_ID}/now-playing")"
  position="$(printf '%s' "${payload}" | node -e "const fs=require('fs');const raw=fs.readFileSync(0,'utf8');try{const o=JSON.parse(raw);process.stdout.write(String(o?.data?.positionMs ?? 0));}catch{process.stdout.write('0');}")"
  title="$(printf '%s' "${payload}" | node -e "const fs=require('fs');const raw=fs.readFileSync(0,'utf8');try{const o=JSON.parse(raw);process.stdout.write(String(o?.data?.title ?? ''));}catch{process.stdout.write('');}")"

  if [[ "${position}" != "0" && "${position}" != "null" ]]; then
    echo "[voice-panel-smoke] PASS positionMs=${position} title=${title}"
    exit 0
  fi
  sleep 2
done

echo "[voice-panel-smoke] FAIL: now playing did not advance above 0ms"
exit 1
