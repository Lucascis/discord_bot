#!/usr/bin/env node
/**
 * Workaround for upstream Next.js font CSS and eslint-plugin-react deps
 * without external dependencies (usable inside docker build).
 */
const fs = require('node:fs');
const path = require('node:path');

const candidatePnpmDirs = [
  path.resolve(process.cwd(), 'node_modules', '.pnpm'),
  path.resolve(process.cwd(), '..', '..', 'node_modules', '.pnpm'),
];
const pnpmDirs = [...new Set(candidatePnpmDirs)].filter((dir) => fs.existsSync(dir));
if (pnpmDirs.length === 0) {
  process.exit(0);
}

function ensureFile(fromPath, toPath) {
  try {
    if (!fs.existsSync(toPath) && fs.existsSync(fromPath)) {
      fs.copyFileSync(fromPath, toPath);
      console.log(`[patch-next-font] Copied "${fromPath}" -> "${toPath}"`);
    }
  } catch {
    // ignore
  }
}

// Fix only next packages (target.css)
for (const pnpmDir of pnpmDirs) {
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.startsWith('next@')) continue;
    const fontBase = path.join(pnpmDir, entry, 'node_modules', 'next', 'font');
    for (const source of ['google', 'local']) {
      const base = path.join(fontBase, source);
      ensureFile(path.join(base, 'target 2.css'), path.join(base, 'target.css'));
    }
  }
}

// Fix es-iterator-helpers index.js for eslint-plugin-react / jsx-a11y
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    }
  }
}

const iteratorTargets = [];
function collectIteratorDirs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'Iterator.prototype.forEach' && dir.includes('es-iterator-helpers')) {
        iteratorTargets.push(full);
      }
      collectIteratorDirs(full);
    }
  }
}

for (const pnpmDir of pnpmDirs) {
  collectIteratorDirs(pnpmDir);
}

for (const iteratorDir of iteratorTargets) {
  ensureFile(path.join(iteratorDir, 'index 2.js'), path.join(iteratorDir, 'index.js'));
}
