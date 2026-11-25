#!/usr/bin/env node
// Deterministically classify changed files of a PR into "needs tests" vs "skip".
// Zero dependencies; safe to run outside the agent sandbox.
//
// Usage:
//   node classify-changes.mjs --base <git-ref> [--head <git-ref>] [--out file.json]
//   git diff --name-status -M base...head | node classify-changes.mjs --stdin
//
// Output (JSON): { base, head, testable[], skipped[], testsChanged[], summary }

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

// Mirrors coverage excludes in frontend/vite.config.ts and backend/vitest.config.ts,
// plus files that hold no unit-testable logic.
const SKIP_RULES = [
  [/(^|\/)types\.ts$/, 'type declarations only'],
  [/\.types\.ts$/, 'type declarations only'],
  [/(^|\/)index\.ts$/, 'barrel re-export'],
  [/\.stories\.tsx?$/, 'Storybook story'],
  [/\.styles\.ts$/, 'styled-components styles'],
  [/\.variants\.ts$/, 'style variants'],
  [/(^|\/)(constants|.+\.constants)\.tsx?$/, 'constants'],
  [/^frontend\/src\/design-system\//, 'design system (covered by Storybook, excluded from coverage)'],
  [/^frontend\/src\/main\.tsx$/, 'application bootstrap'],
  [/^frontend\/src\/test\//, 'test infrastructure'],
  [/^frontend\/src\/features\/todos\/api\/queryKeys\.ts$/, 'static query keys (excluded from coverage)'],
  [/^frontend\/src\/lib\/queryClient\.ts$/, 'static client configuration (excluded from coverage)'],
  [/^backend\/src\/main\.ts$/, 'process entry point'],
  [/^backend\/src\/generated\//, 'generated Prisma client'],
  [/\.d\.ts$/, 'type declarations only'],
  [/\.css$/, 'stylesheet'],
];

const TEST_FILE = /(\.test\.tsx?$)|(^backend\/tests\/)/;
const SOURCE_FILE = /^(frontend|backend)\/src\/.+\.(ts|tsx)$/;

const changes = readChanges(args);
const result = { base: args.base ?? null, head: args.head ?? 'HEAD', testable: [], skipped: [], testsChanged: [] };

for (const { status, file } of changes) {
  if (TEST_FILE.test(file)) {
    result.testsChanged.push({ file, status });
    continue;
  }
  if (!SOURCE_FILE.test(file)) {
    result.skipped.push({ file, status, reason: 'not application source (config, docs, lockfile, schema, CI)' });
    continue;
  }
  const rule = SKIP_RULES.find(([pattern]) => pattern.test(file));
  if (rule) {
    result.skipped.push({ file, status, reason: rule[1] });
    continue;
  }
  const pkg = file.startsWith('backend/') ? 'backend' : 'frontend';
  const testFile = testFileFor(file, pkg);
  if (status === 'D') {
    result.skipped.push({
      file, status, reason: 'source deleted',
      followUp: existsSync(testFile) ? `remove or update ${testFile}` : null,
    });
    continue;
  }
  result.testable.push({ file, status, package: pkg, testFile, testFileExists: existsSync(testFile) });
}

result.summary = {
  testable: result.testable.length,
  skipped: result.skipped.length,
  testsChanged: result.testsChanged.length,
  packages: [...new Set(result.testable.map((entry) => entry.package))],
  decision: result.testable.length ? 'analyze' : 'noop',
};

const json = JSON.stringify(result, null, 2);
if (args.out) writeFileSync(args.out, `${json}\n`);
process.stdout.write(`${json}\n`);

function testFileFor(file, pkg) {
  const ext = path.extname(file);
  if (pkg === 'backend') {
    // Repository convention: flat backend/tests/<module>.test.ts
    return `backend/tests/${path.basename(file, ext)}.test.ts`;
  }
  // Repository convention: co-located frontend tests
  return file.slice(0, -ext.length) + `.test${ext}`;
}

function readChanges({ stdin, base, head = 'HEAD' }) {
  let raw;
  if (stdin) raw = readFileSync(0, 'utf8');
  else if (base) {
    raw = execFileSync('git', ['diff', '--name-status', '-M', `${base}...${head}`], { encoding: 'utf8' });
  } else {
    console.error('Provide --base <ref> or --stdin');
    process.exit(2);
  }
  return raw.split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t');
    const status = parts[0][0]; // R100 -> R
    const file = parts[parts.length - 1].replaceAll('\\', '/');
    return { status, file };
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'stdin') out.stdin = true;
    else out[key] = argv[++i];
  }
  return out;
}
