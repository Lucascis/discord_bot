#!/usr/bin/env node

/**
 * Bulk fix for unused imports and variables
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

  // Match error lines
  const match = line.match(/^\s+(\d+):(\d+)\s+error\s+'(\w+)' is (defined but never used|assigned a value but never used)/);

  if (match && currentFile) {
    const [, lineNum, , varName, reason] = match;

    if (!fixes.has(currentFile)) {
      fixes.set(currentFile, []);
    }

    fixes.get(currentFile).push({
      line: parseInt(lineNum),
      name: varName,
      type: reason.includes('assigned') ? 'assigned' : 'unused'
    });
  }
}

console.log(`🔧 Found ${fixes.size} files with unused variables/imports\n`);

let _totalFixed = 0;

for (const [filePath, issues] of fixes.entries()) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Group by type
    const unusedImports = issues.filter(i => i.type === 'unused' && i.line < 50); // Likely imports
    const unusedVars = issues.filter(i => i.type !== 'unused' || i.line >= 50);

    // Remove unused imports
    for (const issue of unusedImports) {
      const _importRegex = new RegExp(`\\b${issue.name}\\b,?\\s*`, 'g');
      const beforeFix = content;

      // Remove from import statements
      content = content.replace(
        new RegExp(`import\\s*\\{([^}]*?)\\b${issue.name}\\b,?\\s*([^}]*?)\\}\\s*from`, 'g'),
        (match, before, after) => {
          const cleaned = [before, after].join(',').replace(/,+/g, ',').replace(/^,|,$/g, '').trim();
          return cleaned ? `import { ${cleaned} } from` : '';
        }
      );

      // Remove empty import lines
      content = content.replace(/import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\s*\n/g, '');

      if (content !== beforeFix) {
        modified = true;
        _totalFixed++;
      }
    }

    // Prefix unused variables/params
    for (const issue of unusedVars) {
      const lines = content.split('\n');
      if (issue.line - 1 < lines.length) {
        const originalLine = lines[issue.line - 1];

        // Only prefix if not already prefixed
        if (!originalLine.includes(`_${issue.name}`) && originalLine.includes(issue.name)) {
          lines[issue.line - 1] = originalLine.replace(
            new RegExp(`\\b${issue.name}\\b`),
            `_${issue.name}`
          );
          modified = true;
          _totalFixed++;
        }
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, typeof content === 'string' ? content : lines.join('\n'), 'utf8');
      const relativePath = path.relative(path.resolve(__dirname, '..'), filePath);
      console.log(`  ✓ Fixed ${relativePath}`);
    }

  } catch (err) {
    console.log(`  ✗ Error fixing ${filePath}: ${err.message}`);
  }
}

console.log(`\n✅ Fixed ${_totalFixed} issues across ${fixes.size} files\n`);
