#!/usr/bin/env node
// List the tests that fail on the PR head, from Vitest's JSON reporter output.
// A PR that breaks an existing test is the strongest "update (or suspected bug)" signal.
// Zero dependencies.
//
// Usage:
//   npx vitest run --reporter=default --reporter=json --outputFile.json=<pkg>.results.json
//   node failing-tests.mjs --results backend=backend.results.json [--results frontend=...] [--json out.json]
//
// Prints a Markdown list (or "no failing tests"); a missing results file is reported, not fatal.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const specs = [];
let jsonOut = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--results') specs.push(argv[++i]);
  else if (argv[i] === '--json') jsonOut = argv[++i];
}

const result = {};
for (const spec of specs) {
  const [pkg, file] = spec.split(/=(.*)/s);
  if (!existsSync(file)) {
    result[pkg] = { available: false, failing: [] };
    continue;
  }
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const failing = (report.testResults ?? [])
    .filter((suite) => suite.status === 'failed')
    .map((suite) => ({
      file: relative(suite.name),
      tests: (suite.assertionResults ?? []).filter((test) => test.status === 'failed').map((test) => ({
        name: test.fullName,
        message: firstLine(test.failureMessages?.[0]),
      })),
      // A suite can fail without a failing test, e.g. when the file doesn't compile or import.
      ...(suite.message && { error: firstLine(suite.message) }),
    }));
  result[pkg] = { available: true, failing };
}

if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${markdown(result)}\n`);

function markdown(data) {
  const lines = [];
  for (const [pkg, { available, failing }] of Object.entries(data)) {
    if (!available) lines.push(`- **${pkg}**: no test results (the run did not finish – see the log)`);
    else if (!failing.length) lines.push(`- **${pkg}**: no failing tests`);
    for (const suite of failing) {
      if (!suite.tests.length) lines.push(`- **${pkg}** \`${suite.file}\`: suite failed – ${suite.error ?? 'unknown error'}`);
      for (const test of suite.tests) lines.push(`- **${pkg}** \`${suite.file}\` › ${test.name}: ${test.message}`);
    }
  }
  return lines.join('\n') || '_No test results given._';
}

function relative(file) {
  const normalized = path.relative(root, file).replaceAll('\\', '/');
  return normalized.startsWith('..') ? file.replaceAll('\\', '/') : normalized;
}

function firstLine(text) {
  return String(text ?? '').split('\n').find((line) => line.trim())?.trim().slice(0, 300) ?? '';
}
