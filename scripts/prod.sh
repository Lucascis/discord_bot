#!/usr/bin/env bash
set -euo pipefail

compose_file="docker-compose.production.yml"

if command -v docker-compose >/dev/null 2>&1; then
  dc="docker-compose"
else
  dc="docker compose"
fi

reset=0
if [[ "${RESET:-0}" == "1" ]]; then
  reset=1
fi

for arg in "$@"; do
  case "$arg" in
    --reset)
      reset=1
      ;;
  esac
done

if [[ "$reset" == "1" ]]; then
  echo "🧹 Reset requested: stopping and removing volumes..."
  $dc -f "$compose_file" down -v --remove-orphans
fi

echo "🐳 Building and starting production stack..."
$dc -f "$compose_file" up -d --build

echo "📋 Production stack status:"
$dc -f "$compose_file" ps
