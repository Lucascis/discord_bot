#!/usr/bin/env node

/**
 * Fix catch blocks that were incorrectly modified
 * - If catch block uses 'error', add it back as parameter
 * - If catch block doesn't use 'error', keep it without parameter
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
    } else if (file.endsWith('.ts')) {
      results.push(filePath);
    }
  });

  return results;
}

function fixCatchBlocks(content) {
  let modified = false;

  // Pattern: catch { ... } where ... contains references to 'error'
  // We need to add 'error' parameter back
  const catchBlockRegex = /catch\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;

  const newContent = content.replace(catchBlockRegex, (match, blockContent) => {
    // Check if block content references 'error'
    const usesError = /\berror\b/.test(blockContent);

    if (usesError) {
      modified = true;
      return `catch (error) {${blockContent}}`;
    }

    return match; // Keep as is if no error reference
  });

  return { content: newContent, modified };
}

function main() {
  console.log('🔧 Fixing catch blocks...\n');

  const projectRoot = path.resolve(__dirname, '..');
  const directories = ['gateway/src', 'audio/src', 'api/src', 'worker/src'];

  let _totalFixed = 0;
  let filesModified = 0;

  directories.forEach(dir => {
    const fullPath = path.join(projectRoot, dir);
    if (!fs.existsSync(fullPath)) return;

    console.log(`📁 Processing ${dir}...`);
    const files = findTsFiles(fullPath);

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      const result = fixCatchBlocks(content);

      if (result.modified) {
        fs.writeFileSync(file, result.content, 'utf8');
        filesModified++;
        const relativePath = path.relative(projectRoot, file);
        console.log(`  ✓ Fixed ${relativePath}`);
      }
    });
  });

  console.log(`\n✅ Complete! Fixed catch blocks in ${filesModified} files\n`);
}

main();
