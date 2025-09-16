#!/bin/bash
# scripts/fix-workspace.sh - Fix pnpm workspace configuration

set -e

echo "🧹 Iniciando limpieza de workspace..."

# Función para verificar comando
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ $1 no está instalado"
        exit 1
    fi
}

# Verificar herramientas necesarias
check_command pnpm
check_command node

echo "📦 Limpiando node_modules duplicados..."

# Remover todos los node_modules locales (pero no el principal)
echo "🗑️  Removiendo node_modules duplicados..."
rm -rf api/node_modules
rm -rf audio/node_modules
rm -rf gateway/node_modules
rm -rf worker/node_modules
rm -rf packages/*/node_modules

echo "✅ Node_modules locales removidos"

# Limpiar cache pnpm
echo "🧹 Limpiando cache pnpm..."
pnpm store prune

echo "📝 Configurando .npmrc optimizado..."
cat > .npmrc << 'EOF'
# Configuración optimizada para workspace monorepo
shamefully-hoist=true
strict-peer-dependencies=false
auto-install-peers=true
dedupe-peer-dependents=true
shared-workspace-lockfile=true
link-workspace-packages=true
prefer-workspace-packages=true

# Performance optimizations
store-dir=~/.pnpm-store
package-import-method=hardlink

# Security
audit-level=moderate
EOF

echo "🔧 Verificando pnpm-workspace.yaml..."
if [ ! -f "pnpm-workspace.yaml" ]; then
    echo "❌ pnpm-workspace.yaml no existe"
    exit 1
fi

echo "📦 Reinstalando dependencias con configuración corregida..."
pnpm install

echo "✅ Verificando estructura correcta..."
ISSUES=0

# Verificar que no hay node_modules locales
echo "🔍 Verificando node_modules locales..."
LOCAL_MODULES=$(find . -path "./*/node_modules" -not -path "./node_modules/*" 2>/dev/null || true)
if [ -n "$LOCAL_MODULES" ]; then
    echo "❌ Aún existen node_modules locales:"
    echo "$LOCAL_MODULES"
    ISSUES=$((ISSUES + 1))
else
    echo "✅ Sin node_modules locales duplicados"
fi

# Verificar que workspace packages están linkeados
echo "🔗 Verificando workspace linking..."
if pnpm list --depth 0 | grep -q "@discord-bot/"; then
    echo "✅ Workspace packages linkeados correctamente"
else
    echo "❌ Workspace packages no están linkeados correctamente"
    ISSUES=$((ISSUES + 1))
fi

# Verificar build básico
echo "🔨 Verificando build básico..."
if pnpm typecheck; then
    echo "✅ TypeScript compilation exitosa"
else
    echo "❌ TypeScript compilation falló"
    ISSUES=$((ISSUES + 1))
fi

if [ $ISSUES -eq 0 ]; then
    echo ""
    echo "🎉 ¡Workspace configurado correctamente!"
    echo "📊 Estadísticas:"
    echo "   - Node modules principal: $(du -sh node_modules 2>/dev/null | cut -f1 || echo 'N/A')"
    echo "   - Packages workspace: $(pnpm list --depth 0 | grep -c "@discord-bot/" || echo '0')"
    echo ""
    echo "✅ FASE 0.1 COMPLETADA - Workspace corregido"
else
    echo ""
    echo "❌ $ISSUES problemas encontrados en workspace"
    exit 1
fi