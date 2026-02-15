#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'env.contract.json'), 'utf8'));
const envFiles = ['.env', '.env.example', '.env.test', '.env.staging', '.env.production'];

const expectedKeys = contract.sections.flatMap((section) => section.variables.map((variable) => variable.key));

function parseEnvKeys(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim());
}

let hasErrors = false;
for (const file of envFiles) {
  const filePath = path.join(repoRoot, file);
  if (!fs.existsSync(filePath)) {
    console.error(`[env:check] Missing file: ${file}`);
    hasErrors = true;
    continue;
  }

  const keys = parseEnvKeys(fs.readFileSync(filePath, 'utf8'));
  const seen = new Set();
  const duplicates = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
  const missing = expectedKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !expectedKeys.includes(key));

  if (duplicates.length || missing.length || extra.length) {
    hasErrors = true;
    console.error(`\n[env:check] ${file} has issues:`);
    if (duplicates.length) console.error(`  Duplicated keys: ${[...new Set(duplicates)].join(', ')}`);
    if (missing.length) console.error(`  Missing keys: ${missing.join(', ')}`);
    if (extra.length) console.error(`  Extra keys (not in contract): ${extra.join(', ')}`);
  }

  if (keys.length === expectedKeys.length) {
    const wrongOrder = keys.findIndex((key, index) => key !== expectedKeys[index]);
    if (wrongOrder >= 0) {
      hasErrors = true;
      console.error(`\n[env:check] ${file} key order mismatch at position ${wrongOrder + 1}: expected ${expectedKeys[wrongOrder]}, got ${keys[wrongOrder]}`);
    }
  }
}

if (hasErrors) {
  console.error('\n[env:check] FAILED');
  process.exit(1);
}

console.log('[env:check] OK - all .env files match contract and order');
