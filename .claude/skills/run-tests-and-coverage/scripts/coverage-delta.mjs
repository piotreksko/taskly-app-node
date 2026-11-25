#!/usr/bin/env node
// Compare two Vitest/Istanbul `coverage-summary.json` files and print a Markdown table.
// Numbers reported on the PR come from this script, never from the model.
//
// Usage:
//   node coverage-delta.mjs --label backend --before base.json --after head.json [--files a.ts,b.ts] [--json out.json]
//   (--before may be omitted or point to a missing file: delta is then shown as "n/a")

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);

const METRICS = ['statements', 'branches', 'functions', 'lines'];
const before = load(args.before);
const after = load(args.after);
if (!after) {
  console.error(`Missing --after coverage summary: ${args.after}`);
  process.exit(2);
}

const label = args.label ?? 'coverage';
const files = (args.files ?? '').split(',').map((file) => file.trim().replaceAll('\\', '/')).filter(Boolean);

const rows = [row(`**${label} total**`, before?.total, after.total)];
for (const file of files) {
  rows.push(row(`\`${file}\``, find(before, file), find(after, file)));
}

const lines = [
  `| Scope | ${METRICS.map(capitalize).join(' | ')} |`,
  `| --- | ${METRICS.map(() => '---:').join(' | ')} |`,
  ...rows.map((cells) => `| ${cells.join(' | ')} |`),
];
process.stdout.write(`${lines.join('\n')}\n`);

if (args.json) {
  const data = {
    label,
    total: summarize(before?.total, after.total),
    files: Object.fromEntries(files.map((file) => [file, summarize(find(before, file), find(after, file))])),
  };
  writeFileSync(args.json, `${JSON.stringify(data, null, 2)}\n`);
}

function row(name, base, head) {
  return [name, ...METRICS.map((metric) => cell(base?.[metric]?.pct, head?.[metric]?.pct))];
}

function cell(basePct, headPct) {
  if (headPct === undefined) return 'not measured';
  if (basePct === undefined) return `${fmt(headPct)} (new)`;
  const delta = Math.round((headPct - basePct) * 10) / 10;
  if (delta === 0) return `${fmt(headPct)} (±0)`;
  const sign = delta > 0 ? '+' : '';
  const marker = delta > 0 ? ' ⬆' : ' ⬇';
  return `${fmt(headPct)} (${sign}${delta.toFixed(1)} pp)${marker}`;
}

function summarize(base, head) {
  return Object.fromEntries(METRICS.map((metric) => [metric, {
    before: base?.[metric]?.pct ?? null,
    after: head?.[metric]?.pct ?? null,
  }]));
}

function find(summary, file) {
  if (!summary) return undefined;
  // Keys are absolute paths; match on a repo-relative suffix, ignoring the package folder prefix.
  const relative = file.replace(/^(backend|frontend)\//, '');
  const key = Object.keys(summary).find((candidate) => {
    const normalized = candidate.replaceAll('\\', '/');
    return normalized.endsWith(`/${file}`) || normalized.endsWith(`/${relative}`);
  });
  return key ? summary[key] : undefined;
}

function load(file) {
  if (!file || !existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function fmt(value) {
  return `${Number(value).toFixed(1)}%`;
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}
