# Plan de Acción - Ejecución completa
# Ejecutar desde la raíz: .\scripts\run-action-plan.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Log { param($msg) Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" }
function Run { param($name, $cmd) Log ">>> $name"; Invoke-Expression $cmd; if ($LASTEXITCODE -ne 0) { throw "$name failed" } }

Log "=== ETAPA 1: Validación y diagnóstico ==="
Run "Build" "pnpm build"
Run "Typecheck" "pnpm typecheck"
Run "Lint" "pnpm lint"
Log "Etapa 1 OK"

Log "=== ETAPA 2: Limpieza ==="
Run "Clean" "pnpm clean"
Run "Audit" "pnpm audit --audit-level=high 2>$null || true"
Run "Install" "pnpm install"
Run "Build post-clean" "pnpm build"
Log "Etapa 2 OK"

Log "=== ETAPA 4: Tests ==="
Run "Tests" "pnpm test"
Log "Etapa 4 OK"

Log "=== ETAPA 5: Env check ==="
Run "Env check" "pnpm env:check"
Run "Env security" "pnpm env:security:check"
Log "Etapa 5 OK"

Log "=== PLAN COMPLETADO ==="
