#!/usr/bin/env bash
# Plan de Acción - Ejecución completa
# Ejecutar desde la raíz: bash scripts/run-action-plan.sh

set -e
cd "$(dirname "$0")/.."

log() { echo "[$(date +%H:%M:%S)] $1"; }
run() { log ">>> $1"; eval "$2" || { echo "FAILED: $1"; exit 1; }; }

log "=== ETAPA 1: Validación y diagnóstico ==="
run "Build" "pnpm build"
run "Typecheck" "pnpm typecheck"
run "Lint" "pnpm lint"
log "Etapa 1 OK"

log "=== ETAPA 2: Limpieza ==="
run "Clean" "pnpm clean"
run "Audit" "pnpm audit --audit-level=high || true"
run "Install" "pnpm install"
run "Build post-clean" "pnpm build"
log "Etapa 2 OK"

log "=== ETAPA 4: Tests ==="
run "Tests" "pnpm test"
log "Etapa 4 OK"

log "=== ETAPA 5: Env check ==="
run "Env check" "pnpm env:check"
run "Env security" "pnpm env:security:check"
log "Etapa 5 OK"

log "=== PLAN COMPLETADO ==="
