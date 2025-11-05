#!/usr/bin/env node

/**
 * Fix unused variables and parameters by prefixing with underscore
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findTsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);

  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && file !== '.git') {
        results = results.concat(findTsFiles(filePath));
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
      results.push(filePath);
    }
  });

  return results;
}

function fixUnusedVars(content) {
  let modified = false;

  // Pattern 1: Unused imports - mark with underscore
  // Example: import { Foo, Bar } from 'module' -> import { Foo, _Bar } from 'module'
  // We'll handle this conservatively - only simple cases

  // Pattern 2: Unused function parameters - prefix with underscore
  // This is complex, need to be careful with function signatures

  // Pattern 3: Unused variables in catch blocks
  const errorCatchRegex = /catch\s*\(\s*error\s*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  let newContent = content.replace(errorCatchRegex, (match, blockContent) => {
    // Check if error is used in the block (not just in comments)
    const usesError = /\berror\b/.test(blockContent.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));

    if (!usesError) {
      modified = true;
      return `catch {${blockContent}}`;
    }
    return match;
  });

  return { content: newContent, modified };
}

function main() {
  console.log('🔧 Fixing unused variables...\n');

  const projectRoot = path.resolve(__dirname, '..');
  const directories = ['gateway/src'];

  let _totalFixed = 0;
  let filesModified = 0;

  directories.forEach(dir => {
    const fullPath = path.join(projectRoot, dir);
    if (!fs.existsSync(fullPath)) return;

    console.log(`📁 Processing ${dir}...`);
    const files = findTsFiles(fullPath);

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      const result = fixUnusedVars(content);

      if (result.modified) {
        fs.writeFileSync(file, result.content, 'utf8');
        filesModified++;
        const relativePath = path.relative(projectRoot, file);
        console.log(`  ✓ Fixed ${relativePath}`);
      }
    });
  });

  console.log(`\n✅ Complete! Modified ${filesModified} files\n`);
}

main();
