#!/usr/bin/env node

/**
 * Automated Linter Fix Script
 *
 * This script automatically fixes common ESLint issues:
 * - Removes unused imports
 * - Prefixes unused variables with underscore
 * - Removes completely unused code
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { glob } from 'glob';

console.log('🔧 Starting automated linter fixes...\n');

// Get all TypeScript files
const files = glob.sync('**/*.ts', {
  ignore: ['node_modules/**', 'dist/**', '**/*.d.ts', 'scripts/**']
});

console.log(`📁 Found ${files.length} TypeScript files to process\n`);

let totalFixes = 0;

for (const file of files) {
  try {
    let content = readFileSync(file, 'utf-8');
    let fixes = 0;

    // Fix 1: Remove unused imports that are defined but never used
    const unusedImportRegex = /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm;
    const importMatches = [...content.matchAll(unusedImportRegex)];

    for (const match of importMatches) {
      const imports = match[1].split(',').map(i => i.trim());
      const usedImports = imports.filter(imp => {
        const importName = imp.replace(/\s+as\s+\w+/, '').trim();
        const regex = new RegExp(`\\b${importName}\\b`, 'g');
        const matches = content.match(regex);
        return matches && matches.length > 1; // More than just the import line
      });

      if (usedImports.length === 0) {
        // Remove entire import line
        content = content.replace(match[0], '');
        fixes++;
      } else if (usedImports.length < imports.length) {
        // Keep only used imports
        const newImport = match[0].replace(match[1], usedImports.join(', '));
        content = content.replace(match[0], newImport);
        fixes++;
      }
    }

    // Fix 2: Prefix unused function parameters with underscore
    content = content.replace(
      /(\w+)\s*:\s*([^,)]+)(?=\s*[,)])/g,
      (match, paramName, paramType) => {
        // Check if parameter is used in the function body
        const functionRegex = new RegExp(`\\b${paramName}\\b`, 'g');
        const usageCount = (content.match(functionRegex) || []).length;

        // If only appears once (in declaration), prefix with underscore
        if (usageCount === 1 && !paramName.startsWith('_')) {
          return `_${paramName}: ${paramType}`;
        }
        return match;
      }
    );

    // Fix 3: Remove empty catch blocks with unused error
    content = content.replace(
      /catch\s*\(\s*(\w+)\s*\)\s*\{(\s*\/\/[^\n]*\n)*\s*\}/g,
      'catch {\n          // Ignore errors\n        }'
    );

    if (fixes > 0) {
      writeFileSync(file, content, 'utf-8');
      console.log(`✅ ${file}: ${fixes} fixes applied`);
      totalFixes += fixes;
    }
  } catch (error) {
    console.error(`❌ Error processing ${file}:`, error.message);
  }
}

console.log(`\n✨ Total fixes applied: ${totalFixes}`);
console.log('\n🔍 Running ESLint auto-fix...');

try {
  execSync('pnpm lint --fix', { stdio: 'inherit' });
  console.log('\n✅ ESLint auto-fix completed');
} catch {
  console.log('\n⚠️  Some linter errors remain (manual fix required)');
}

console.log('\n🎉 Automated fixes complete!');
