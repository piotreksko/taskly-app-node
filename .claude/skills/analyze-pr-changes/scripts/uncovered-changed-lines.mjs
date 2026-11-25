#!/usr/bin/env node
// Intersect the lines a PR changed with line/branch coverage from Vitest's lcov report.
// Answers, per changed source file: which *changed* executable lines and branches are not covered by tests.
// Zero dependencies; numbers in the PR report come from this script, never from the model.
//
// Usage (from anywhere inside the repo):
//   node uncovered-changed-lines.mjs --base <ref> [--head <ref>] \
//     --lcov backend=backend/coverage/lcov.info --lcov frontend=frontend/coverage/lcov.info \
//     [--baseline-lcov backend=/tmp/gh-aw/context/baseline/backend.lcov.info ...] \
//     [--changes /tmp/gh-aw/context/changes.json] [--json out.json]
//   ... --diff file.patch      # instead of --base: a unified diff (any context size)
//
// --changes limits the files to `testable[]` from classify-changes.mjs; otherwise all changed
// backend/frontend src .ts/.tsx files are used. With --baseline-lcov a "Before" column is added.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const SOURCE_FILE = /^(frontend|backend)\/src\/.+\.(ts|tsx)$/;
const TEST_FILE = /(\.test\.tsx?$)|(^frontend\/src\/test\/)/; // tests and test infrastructure

const changed = parseDiff(readDiff(args));
let files = [...changed.keys()].filter((file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file));
if (args.changes) {
  const testable = new Set(JSON.parse(readFileSync(args.changes, 'utf8')).testable.map((entry) => entry.file));
  files = files.filter((file) => testable.has(file));
}
files.sort();

const after = loadLcovs(args.lcov);
// "Before" semantics: a baseline report that exists but lacks a file (or line) means "not covered before".
// Only when no baseline report could be read at all are the before numbers unknown (n/a).
const baselineRequested = args['baseline-lcov'].length > 0;
const baselineRecords = baselineRequested ? loadLcovs(args['baseline-lcov']) : [];
const baselineKnown = baselineRecords.length > 0;

const result = { base: args.base ?? null, head: args.head ?? 'HEAD', files: {}, total: null };
const totals = { executable: 0, covered: 0, coveredBefore: 0 };
for (const file of files) {
  const lines = changed.get(file);
  const record = find(after, file);
  const entry = analyze(lines, record);
  if (baselineRequested) {
    // Measured against the lines executable *now*, so before and after share one denominator.
    if (!baselineKnown || !entry.measured) entry.before = { measured: false };
    else {
      const hitsBefore = find(baselineRecords, file)?.lines ?? new Map();
      const executableNow = [...lines].filter((line) => record.lines.has(line));
      const covered = executableNow.filter((line) => (hitsBefore.get(line) ?? 0) > 0).length;
      entry.before = { measured: true, coveredChangedLines: covered, pct: pct(covered, executableNow.length) };
      totals.coveredBefore += covered;
    }
  }
  result.files[file] = entry;
  if (entry.measured) {
    totals.executable += entry.executableChangedLines;
    totals.covered += entry.coveredChangedLines;
  }
}
result.total = {
  executableChangedLines: totals.executable,
  coveredChangedLines: totals.covered,
  pct: pct(totals.covered, totals.executable),
  ...(baselineRequested && {
    before: baselineKnown
      ? { coveredChangedLines: totals.coveredBefore, pct: pct(totals.coveredBefore, totals.executable) }
      : { coveredChangedLines: null, pct: null },
  }),
};

if (args.json) writeFileSync(args.json, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${markdown(result, baselineRequested)}\n`);

// ---------------------------------------------------------------------------

function analyze(changedLines, record) {
  const changedCount = changedLines.size;
  if (!record) return { changedLines: changedCount, measured: false };
  const executable = [...changedLines].filter((line) => record.lines.has(line)).sort((a, b) => a - b);
  const uncovered = executable.filter((line) => record.lines.get(line) === 0);
  const uncoveredBranchLines = [...new Set(
    record.branches.filter((branch) => changedLines.has(branch.line) && !branch.taken).map((branch) => branch.line),
  )].sort((a, b) => a - b);
  return {
    changedLines: changedCount,
    measured: true,
    executableChangedLines: executable.length,
    coveredChangedLines: executable.length - uncovered.length,
    pct: pct(executable.length - uncovered.length, executable.length),
    uncoveredLines: ranges(uncovered),
    uncoveredBranchLines: ranges(uncoveredBranchLines),
  };
}

function markdown(data, withBefore) {
  const names = Object.keys(data.files);
  if (!names.length) return '_No changed source files to analyze._';
  const head = withBefore
    ? ['| File | Changed exec. lines | Covered before | Covered now | Uncovered lines | Uncovered branches |', '| --- | ---: | ---: | ---: | --- | --- |']
    : ['| File | Changed exec. lines | Covered | Uncovered lines | Uncovered branches |', '| --- | ---: | ---: | --- | --- |'];
  const rows = names.map((file) => {
    const entry = data.files[file];
    const name = `\`${file}\``;
    if (!entry.measured) {
      return withBefore ? `| ${name} | ${entry.changedLines} changed | – | not measured | – | – |` : `| ${name} | ${entry.changedLines} changed | not measured | – | – |`;
    }
    const now = fmtPct(entry);
    const lines = entry.uncoveredLines.join(', ') || '–';
    const branches = entry.uncoveredBranchLines.join(', ') || '–';
    return withBefore
      ? `| ${name} | ${entry.executableChangedLines} | ${!entry.before.measured ? 'n/a' : entry.executableChangedLines === 0 ? 'no executable lines' : `${entry.before.pct.toFixed(1)}% (${entry.before.coveredChangedLines}/${entry.executableChangedLines})`} | ${now} | ${lines} | ${branches} |`
      : `| ${name} | ${entry.executableChangedLines} | ${now} | ${lines} | ${branches} |`;
  });
  const total = data.total;
  const totalNow = total.pct === null ? '–' : `${total.pct.toFixed(1)}%`;
  const totalRow = withBefore
    ? `| **changed lines total** | ${total.executableChangedLines} | ${total.before.pct === null ? 'n/a' : `${total.before.pct.toFixed(1)}%`} | ${totalNow} | | |`
    : `| **changed lines total** | ${total.executableChangedLines} | ${totalNow} | | |`;
  return [...head, ...rows, totalRow].join('\n');
}

function fmtPct(entry) {
  if (entry.executableChangedLines === 0) return 'no executable lines';
  return `${entry.pct.toFixed(1)}% (${entry.coveredChangedLines}/${entry.executableChangedLines})`;
}

function pct(covered, total) {
  return total === 0 ? null : Math.round((covered / total) * 1000) / 10;
}

function ranges(numbers) {
  const out = [];
  for (let i = 0; i < numbers.length; i++) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    out.push(i === j ? `${numbers[i]}` : `${numbers[i]}-${numbers[j]}`);
    i = j;
  }
  return out;
}

// --- diff ------------------------------------------------------------------

function readDiff({ diff, base, head = 'HEAD' }) {
  if (diff) return readFileSync(diff, 'utf8');
  if (!base) {
    console.error('Provide --base <ref> or --diff <file>');
    process.exit(2);
  }
  return execFileSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', '-M', `${base}...${head}`, '--', 'backend/src', 'frontend/src'], {
    encoding: 'utf8', cwd: root, maxBuffer: 64 * 1024 * 1024,
  });
}

// Returns Map<repo-relative file, Set<line numbers added or modified in the new version>>.
function parseDiff(text) {
  const map = new Map();
  let current = null;
  let line = 0;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const target = raw.slice(4).trim();
      current = target === '/dev/null' ? null : target.replace(/^"?b\//, '').replace(/"$/, '').replaceAll('\\', '/');
      if (current && !map.has(current)) map.set(current, new Set());
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('+')) map.get(current).add(line++);
    else if (raw.startsWith(' ')) line++;
    // '-' lines don't exist in the new file; '\ No newline' is ignored
  }
  return map;
}

// --- lcov ------------------------------------------------------------------

function loadLcovs(specs) {
  const records = [];
  for (const spec of specs) {
    const [pkg, file] = spec.includes('=') ? spec.split(/=(.*)/s) : [null, spec];
    if (!existsSync(file)) continue; // missing report => files show as "not measured"
    for (const record of parseLcov(readFileSync(file, 'utf8'))) records.push({ ...record, pkg });
  }
  return records;
}

function parseLcov(text) {
  const records = [];
  let record = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('SF:')) record = { source: raw.slice(3).replaceAll('\\', '/'), lines: new Map(), branches: [] };
    else if (!record) continue;
    else if (raw.startsWith('DA:')) {
      const [lineNo, hits] = raw.slice(3).split(',');
      record.lines.set(Number(lineNo), Number(hits));
    } else if (raw.startsWith('BRDA:')) {
      const [lineNo, , , taken] = raw.slice(5).split(',');
      record.branches.push({ line: Number(lineNo), taken: taken !== '-' && Number(taken) > 0 });
    } else if (raw === 'end_of_record') {
      records.push(record);
      record = null;
    }
  }
  return records;
}

// lcov SF paths are absolute or relative to the package; match on the path inside the package.
function find(records, file) {
  const pkg = file.split('/')[0];
  const inner = file.slice(pkg.length + 1); // e.g. src/core/config.ts
  return records.find((record) => (record.pkg === null || record.pkg === pkg)
    && (record.source === inner || record.source.endsWith(`/${pkg}/${inner}`) || (record.pkg === pkg && record.source.endsWith(`/${inner}`))));
}

function parseArgs(argv) {
  const out = { lcov: [], 'baseline-lcov': [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[++i];
    if (key === 'lcov' || key === 'baseline-lcov') out[key].push(value);
    else out[key] = value;
  }
  return out;
}
