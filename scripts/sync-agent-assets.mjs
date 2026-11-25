#!/usr/bin/env node
// Single source of truth for the agent and its skills is .github/{agents,skills}
// (consumed by the GitHub Agentic Workflow). This mirrors them into .claude/{agents,skills}
// so the very same agent and skills run locally in Claude Code.
//
//   node scripts/sync-agent-assets.mjs          # write the mirror
//   node scripts/sync-agent-assets.mjs --check  # exit 1 if the mirror drifted (used in CI)

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pairs = [
  ['.github/agents', '.claude/agents'],
  ['.github/skills', '.claude/skills'],
];
const check = process.argv.includes('--check');

let drift = [];
for (const [from, to] of pairs) {
  const source = path.join(root, from);
  const target = path.join(root, to);
  if (check) {
    drift = drift.concat(compare(source, target, from, to));
  } else {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
    console.log(`synced ${from} -> ${to}`);
  }
}

if (check) {
  if (drift.length) {
    console.error('Agent assets out of sync. Run: node scripts/sync-agent-assets.mjs');
    for (const line of drift) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log('Agent assets in sync.');
}

function compare(source, target, from, to) {
  const a = list(source);
  const b = list(target);
  const issues = [];
  for (const file of a) {
    if (!b.includes(file)) issues.push(`missing ${to}/${file}`);
    else if (!readFileSync(path.join(source, file)).equals(readFileSync(path.join(target, file)))) {
      issues.push(`differs ${to}/${file}`);
    }
  }
  for (const file of b) if (!a.includes(file)) issues.push(`extra ${to}/${file} (not in ${from})`);
  return issues;
}

function list(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(full).isDirectory() ? list(full, relative) : [relative];
  });
}
