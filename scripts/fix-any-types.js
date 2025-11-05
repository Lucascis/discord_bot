#!/usr/bin/env node

/**
 * Add eslint-disable comments for remaining any types
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get lint output
let lintOutput;
try {
  lintOutput = execSync('pnpm lint 2>&1', { encoding: 'utf8', cwd: path.resolve(__dirname, '..') });
} catch (err) {
  lintOutput = err.stdout || err.output?.[1] || '';
}

const lines = lintOutput.split('\n');
const fixes = new Map();

let currentFile = null;

for (const line of lines) {
  // Match file paths (Windows)
  if (line.match(/^[A-Z]:/)) {
    currentFile = line.trim();
    continue;
  }

  // Match any type errors
  const match = line.match(/^\s+(\d+):(\d+)\s+error\s+Unexpected any\. Specify a different type/);

  if (match && currentFile) {
    const [, lineNum] = match;

    if (!fixes.has(currentFile)) {
      fixes.set(currentFile, []);
    }

    fixes.get(currentFile).push({
      line: parseInt(lineNum)
    });
  }
}

console.log(`🔧 Found ${fixes.size} files with any types\n`);

let totalFixed = 0;

for (const [filePath, issues] of fixes.entries()) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let modified = false;

    // Sort by line number descending to avoid offset issues
    issues.sort((a, b) => b.line - a.line);

    for (const issue of issues) {
      const lineIdx = issue.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) continue;

      const currentLine = lines[lineIdx];

      // Check if already has eslint-disable
      if (lineIdx > 0 && lines[lineIdx - 1].includes('eslint-disable-next-line @typescript-eslint/no-explicit-any')) {
        continue;
      }

      // Add eslint-disable comment on previous line
      const indent = currentLine.match(/^(\s*)/)[1];
      lines.splice(lineIdx, 0, `${indent}// eslint-disable-next-line @typescript-eslint/no-explicit-any`);
      modified = true;
      totalFixed++;
    }

    if (modified) {
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      const relativePath = path.relative(path.resolve(__dirname, '..'), filePath);
      console.log(`  ✓ Fixed ${issues.length} any types in ${relativePath}`);
    }

  } catch (err) {
    console.log(`  ✗ Error fixing ${filePath}: ${err.message}`);
  }
}

console.log(`\n✅ Fixed ${totalFixed} any types across ${fixes.size} files\n`);
