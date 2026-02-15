#!/bin/bash

echo "🔄 Intentando push con diferentes estrategias..."

# Strategy 1: Simple push con timeout largo
echo ""
echo "📤 Estrategia 1: Push simple..."
GIT_TRACE=1 git push origin main 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Push exitoso!"
    exit 0
fi

# Strategy 2: Push con compresión baja
echo ""
echo "📤 Estrategia 2: Push con compresión reducida..."
git config --local pack.compression 1
git config --local pack.windowMemory 10m
git config --local pack.packSizeLimit 20m
git push origin main 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Push exitoso!"
    git config --local --unset pack.compression
    git config --local --unset pack.windowMemory
    git config --local --unset pack.packSizeLimit
    exit 0
fi

# Strategy 3: Push con objetos individuales
echo ""
echo "📤 Estrategia 3: Push con thin pack..."
git push --thin origin main 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Push exitoso!"
    exit 0
fi

# Strategy 4: Información de diagnóstico
echo ""
echo "❌ Todas las estrategias fallaron."
echo ""
echo "📊 Diagnóstico:"
echo "Commit local:"
git log --oneline -1
echo ""
echo "Estado:"
git status --short | wc -l
echo "archivos modificados"
echo ""
echo "💡 Sugerencias:"
echo "1. Ejecuta este script desde Terminal nativo de macOS (no VS Code)"
echo "2. Verifica tu conexión a internet"
echo "3. Prueba: gh auth login && gh repo sync"
echo "4. Como última opción: sube manualmente los archivos via web"

exit 1
