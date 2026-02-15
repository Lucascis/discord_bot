#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, 'config', 'env.contract.json');
const envFiles = ['.env', '.env.example', '.env.test', '.env.staging', '.env.production'];

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

function parseEnvFile(content) {
  const values = new Map();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1);
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function renderFile(currentValues, mode) {
  const lines = [];
  lines.push('# ============================================================');
  lines.push('# Discord Bot Environment');
  lines.push('# Generated from config/env.contract.json (ordered, categorized)');
  lines.push('# ============================================================');
  lines.push('');

  let sectionIndex = 1;
  for (const section of contract.sections) {
    const sectionNumber = String(sectionIndex).padStart(2, '0');
    lines.push(`# [${sectionNumber}] ${section.title}`);
    for (const variable of section.variables) {
      lines.push(`# ${variable.description}.`);
      lines.push(`# Tipo: ${variable.classification}. Responsable: ${variable.ownerAgent}.`);
      const current = currentValues.get(variable.key);
      const fallback = variable.default ?? '';
      let value = current ?? fallback;

      if (mode === '.env.example') {
        if (variable.sensitive) {
          value = value && value.length > 0 ? value : `your-${variable.key.toLowerCase()}`;
        } else if (!value) {
          value = fallback;
        }
      }

      const renderedValue = typeof value === 'string' && /\s/.test(value)
        ? `"${value.replace(/"/g, '\\"')}"`
        : value;
      lines.push(`${variable.key}=${renderedValue}`);
      lines.push('');
    }
    sectionIndex += 1;
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

for (const file of envFiles) {
  const filePath = path.join(repoRoot, file);
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const currentValues = parseEnvFile(content);
  const rendered = renderFile(currentValues, file);
  fs.writeFileSync(filePath, rendered, 'utf8');
  console.log(`Synced ${file}`);
}
