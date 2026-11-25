#!/usr/bin/env node
// Deterministically classify changed files of a PR into "needs tests" vs "skip".
// Zero dependencies; safe to run outside the agent sandbox.
//
// Usage:
//   node classify-changes.mjs --base <git-ref> [--head <git-ref>] [--out file.json]
//   git diff --name-status -z -M base...head | node classify-changes.mjs --stdin
//
// Output (JSON): { base, head, testable[], skipped[], testsChanged[], summary }
// File existence (test files, importers) is checked in the working tree, so run it on the PR head.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
// Resolve test-file existence against the repo root, wherever the script is run from.
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const exists = (file) => existsSync(path.join(root, file));

// Every coverage exclude in frontend/vite.config.ts and backend/vitest.config.ts is skipped here
// (enforced by scripts/test/skill-scripts.test.mjs), plus files that hold no unit-testable logic.
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
// Skipped files whose *values* can change behaviour elsewhere: their importers become candidates.
const RUNTIME_VALUE_REASONS = new Set(['constants']);

const TEST_FILE = /(\.test\.tsx?$)|(^backend\/tests\/)/;
const SOURCE_FILE = /^(frontend|backend)\/src\/.+\.(ts|tsx)$/;

const changes = readChanges(args);
const result = { base: args.base ?? null, head: args.head ?? 'HEAD', testable: [], skipped: [], testsChanged: [] };
const valueSources = [];

for (const change of changes) {
  const { status, file, oldFile, similarity } = change;
  const meta = { status, ...(oldFile && { oldFile, similarity }) };
  if (TEST_FILE.test(file)) {
    result.testsChanged.push({ file, ...meta });
    continue;
  }
  if (!SOURCE_FILE.test(file)) {
    result.skipped.push({ file, ...meta, reason: 'not application source (config, docs, lockfile, schema, CI)' });
    continue;
  }
  const rule = SKIP_RULES.find(([pattern]) => pattern.test(file));
  if (rule) {
    result.skipped.push({ file, ...meta, reason: rule[1] });
    if (RUNTIME_VALUE_REASONS.has(rule[1]) && status !== 'D') valueSources.push(file);
    continue;
  }
  if (status === 'D') {
    const testFile = existingTestFile(file);
    result.skipped.push({ file, status, reason: 'source deleted', followUp: testFile ? `remove or update ${testFile}` : null });
    continue;
  }
  const oldTestFile = oldFile && SOURCE_FILE.test(oldFile) ? existingTestFile(oldFile) : null;
  if (status === 'R' && similarity === 100) {
    // Content unchanged: the behaviour is tested (or not) exactly as before the rename.
    const testFile = existingTestFile(file);
    result.skipped.push({
      file, ...meta, reason: 'renamed without content changes',
      followUp: !testFile && oldTestFile ? `test file still at the old path: ${oldTestFile}` : null,
    });
    continue;
  }
  result.testable.push(testableEntry(file, meta, oldTestFile));
}

// Files that import a changed constants module: a changed value may change their behaviour.
for (const source of valueSources) {
  for (const importer of importersOf(source)) {
    const known = result.testable.find((entry) => entry.file === importer);
    if (known) {
      known.via = [...(known.via ?? []), source];
      continue;
    }
    if (SKIP_RULES.some(([pattern]) => pattern.test(importer))) continue;
    result.testable.push({ ...testableEntry(importer, { status: 'dependent' }), via: [source] });
  }
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

function testableEntry(file, meta, oldTestFile = null) {
  const existing = existingTestFile(file);
  return {
    file, ...meta, package: packageOf(file),
    testFile: existing ?? testFileCandidates(file)[0],
    testFileExists: Boolean(existing),
    ...(oldTestFile && oldTestFile !== existing && { oldTestFile }),
  };
}

function packageOf(file) {
  return file.startsWith('backend/') ? 'backend' : 'frontend';
}

// Test file paths in the repository's conventions, preferred one first.
function testFileCandidates(file) {
  const ext = path.extname(file);
  if (packageOf(file) === 'backend') return [`backend/tests/${path.basename(file, ext)}.test.ts`]; // flat folder
  const stem = file.slice(0, -ext.length); // co-located frontend tests
  // Hooks and helpers (.ts) are often tested in .test.tsx because the test renders a JSX wrapper.
  return ext === '.tsx' ? [`${stem}.test.tsx`, `${stem}.test.ts`] : [`${stem}.test.ts`, `${stem}.test.tsx`];
}

function existingTestFile(file) {
  return testFileCandidates(file).find(exists) ?? null;
}

// Relative imports only (the repo uses no path aliases). Backend imports carry `.ts`, frontend none.
function importersOf(target) {
  const targetStem = target.replace(/\.(tsx?|jsx?)$/, '');
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  return listFiles(`${packageOf(target)}/src`)
    .filter((file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && file !== target)
    .filter((file) => {
      const text = readFileSync(path.join(root, file), 'utf8');
      for (const [, specifier] of text.matchAll(importPattern)) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        if (resolved.replace(/\.(tsx?|jsx?)$/, '') === targetStem) return true;
      }
      return false;
    })
    .sort();
}

function listFiles(dir) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((name) => {
    if (name === 'node_modules' || name === 'generated') return [];
    const relative = `${dir}/${name}`;
    return statSync(path.join(root, relative)).isDirectory() ? listFiles(relative) : [relative];
  });
}

function readChanges({ stdin, base, head = 'HEAD' }) {
  let raw;
  if (stdin) raw = readFileSync(0, 'utf8');
  else if (base) {
    raw = execFileSync('git', ['diff', '--name-status', '-z', '-M', `${base}...${head}`], { encoding: 'utf8', cwd: root });
  } else {
    console.error('Provide --base <ref> or --stdin');
    process.exit(2);
  }
  // Accept both `-z` (NUL-separated, safe for any filename) and plain tab/newline output.
  if (!raw.includes('\0')) raw = raw.split('\n').filter(Boolean).map((line) => line.split('\t').join('\0')).join('\0');
  const tokens = raw.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i++]; // M, A, D, R087, C100 …
    const status = code[0];
    if (status === 'R' || status === 'C') {
      const oldFile = tokens[i++].replaceAll('\\', '/');
      changes.push({ status, file: tokens[i++].replaceAll('\\', '/'), oldFile, similarity: Number(code.slice(1)) || 0 });
    } else {
      changes.push({ status, file: tokens[i++].replaceAll('\\', '/') });
    }
  }
  return changes;
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
