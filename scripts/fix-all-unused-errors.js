#!/usr/bin/env node

/**
 * Fix all unused error variables in catch blocks across the codebase
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get lint output to find files with unused error variables
let lintOutput;
try {
  lintOutput = execSync('pnpm lint 2>&1', { encoding: 'utf8', cwd: path.resolve(__dirname, '..') });
} catch (err) {
  // Lint returns exit code 1 when there are errors, but we still get the output
  lintOutput = err.stdout || err.output?.[1] || '';
}
const lines = lintOutput.split('\n');

const filesToFix = new Map();

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Match lines like: "  298:14  error  'error' is defined but never used"
  const match = line.match(/^\s+(\d+):(\d+)\s+error\s+'error' is defined but never used/);

  if (match) {
    // Get the file path from previous lines
    for (let j = i - 1; j >= 0; j--) {
      const prevLine = lines[j];
      if (prevLine.match(/^[A-Z]:/)) { // Windows path
        const filePath = prevLine.trim();
        if (!filesToFix.has(filePath)) {
          filesToFix.set(filePath, []);
        }
        filesToFix.get(filePath).push(parseInt(match[1]));
        break;
      }
    }
  }
}

console.log(`🔧 Found ${filesToFix.size} files with unused error variables\n`);

let _totalFixed = 0;

for (const [filePath, lineNumbers] of filesToFix.entries()) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const contentLines = content.split('\n');

    // Sort line numbers in descending order to fix from bottom to top
    lineNumbers.sort((a, b) => b - a);

    for (const lineNum of lineNumbers) {
      const lineIndex = lineNum - 1;
      if (lineIndex < 0 || lineIndex >= contentLines.length) continue;

      const line = contentLines[lineIndex];

      // Check if it's a catch block with unused error
      if (line.match(/catch\s*\(\s*error\s*\)/)) {
        // Check if error is used in the block
        // Simple heuristic: look at next few lines for error reference
        let usesError = false;
        let braceCount = 0;
        let foundOpenBrace = false;

        for (let i = lineIndex; i < Math.min(lineIndex + 50, contentLines.length); i++) {
          const checkLine = contentLines[i];

          if (checkLine.includes('{')) {
            braceCount++;
            foundOpenBrace = true;
          }
          if (checkLine.includes('}')) {
            braceCount--;
            if (foundOpenBrace && braceCount === 0) break;
          }

          // Check if error is referenced (not in the catch line itself)
          if (i > lineIndex && /\berror\b/.test(checkLine.replace(/\/\/.*/g, ''))) {
            usesError = true;
            break;
          }
        }

        if (!usesError) {
          contentLines[lineIndex] = line.replace(/catch\s*\(\s*error\s*\)/, 'catch');
          _totalFixed++;
        }
      }
    }

    fs.writeFileSync(filePath, contentLines.join('\n'), 'utf8');
    console.log(`  ✓ Fixed ${filePath}`);

  } catch (err) {
    console.log(`  ✗ Error fixing ${filePath}: ${err.message}`);
  }
}

console.log(`\n✅ Fixed ${_totalFixed} unused error variables\n`);
