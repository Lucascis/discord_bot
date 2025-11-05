#!/bin/bash

# Mass Refactor Script for ESLint Compliance
# This script performs automated fixes across the codebase

echo "🔧 Starting mass refactor..."

# Fix 1: Replace unused error variables in catch blocks
echo "📝 Fixing unused error variables..."
find gateway/src audio/src api/src worker/src -name "*.ts" -exec sed -i 's/catch (error)/catch (_error)/g' {} \;

# Fix 2: Prefix unused function parameters
echo "📝 Prefixing unused parameters..."
# This is more complex and needs manual review, so we'll document it

#Fix 3: Remove completely unused imports (will be done by ESLint --fix)
echo "📝 Running ESLint auto-fix..."
pnpm lint --fix

echo "✅ Mass refactor complete!"
echo ""
echo "Next steps:"
echo "1. Review remaining linter errors"
echo "2. Manually fix 'any' types"
echo "3. Remove unused imports that couldn't be auto-fixed"
echo "4. Test everything"
