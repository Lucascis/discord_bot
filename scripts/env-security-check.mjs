#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'env.contract.json'), 'utf8'));

const filesToCheck = ['.env', '.env.test', '.env.staging', '.env.production'];
const exampleFile = '.env.example';

const sensitiveKeys = new Set(
  contract.sections
    .flatMap((section) => section.variables)
    .filter((variable) => variable.sensitive)
    .map((variable) => variable.key)
);

const insecureDefaults = new Set([
  'default-webhook-secret',
  'panel-stream-secret',
  'youshallnotpass',
  'changeme',
  'change-me',
  'password',
  'secret',
]);

function parseEnv(content) {
  const map = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1));
  }
  return map;
}

function looksLikeLiveSecret(value) {
  return /^sk_live_|^rk_live_|^xox[baprs]-|^mfa\.|^eyJ[A-Za-z0-9_-]+\./.test(value);
}

let failed = false;

for (const file of filesToCheck) {
  const filePath = path.join(repoRoot, file);
  if (!fs.existsSync(filePath)) continue;

  const envMap = parseEnv(fs.readFileSync(filePath, 'utf8'));
  const issues = [];

  for (const [key, value] of envMap.entries()) {
    const normalized = value.trim().toLowerCase();
    if (sensitiveKeys.has(key) && insecureDefaults.has(normalized)) {
      issues.push(`${key} uses insecure default value`);
    }

    if ((key === 'WEBHOOK_SECRET' || key === 'PANEL_STREAM_SECRET') && value.trim().length > 0 && value.trim().length < 16) {
      issues.push(`${key} must be at least 16 chars`);
    }

    if (key === 'LAVALINK_PASSWORD' && value.trim().length > 0 && value.trim().length < 8) {
      issues.push('LAVALINK_PASSWORD must be at least 8 chars');
    }
  }

  if (issues.length) {
    failed = true;
    console.error(`\n[env:security:check] ${file}`);
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
  }
}

const examplePath = path.join(repoRoot, exampleFile);
if (fs.existsSync(examplePath)) {
  const exampleMap = parseEnv(fs.readFileSync(examplePath, 'utf8'));
  const leaks = [];
  for (const [key, value] of exampleMap.entries()) {
    if (!sensitiveKeys.has(key)) continue;
    if (looksLikeLiveSecret(value.trim())) {
      leaks.push(`${key} appears to contain a live secret`);
    }
  }

  if (leaks.length) {
    failed = true;
    console.error(`\n[env:security:check] ${exampleFile}`);
    for (const leak of leaks) {
      console.error(`  - ${leak}`);
    }
  }
}

if (failed) {
  console.error('\n[env:security:check] FAILED');
  process.exit(1);
}

console.log('[env:security:check] OK - no insecure defaults or obvious secret leaks detected');
