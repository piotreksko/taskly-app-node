#!/usr/bin/env node
// Decide how much of a PR the unit-test agent has to analyse on this push. Zero dependencies
// (TypeScript is loaded from the repo's own node_modules for the syntax comparison, if present).
//
// Usage:
//   node incremental-scope.mjs --base <sha> --head <sha> --changes changes.json \
//     [--candidates "<sha> <sha> …"] [--failing failing-tests.json] [--previous-report <url>] \
//     [--typescript <path to the typescript package>] [--out scope.json]
//
// --candidates: head SHAs of earlier *successful* runs on this PR, newest first (from the Actions API).
//   The first one that is still in the branch history is the checkpoint. None → full analysis.
//
// Output: { mode: full | incremental | skip, since, reason, previousReport, scope[], cosmetic[],
//           unchanged[], astCheck }
//   scope[]     – { file, why } the agent must analyse
//   cosmetic[]  – testable files changed since the checkpoint, but equivalent by syntax tree
//   unchanged[] – testable files of the PR the agent already analysed and that didn't change since
//
// "Changed since the checkpoint" compares the PR's own change to each file then and now, so commits
// merged in from the base branch don't count as the PR's changes.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
let typescript; // loaded lazily by loadTypeScript()
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8', cwd: root, maxBuffer: 64 * 1024 * 1024 });
const gitOk = (...gitArgs) => {
  try {
    git(...gitArgs);
    return true;
  } catch {
    return false;
  }
};

for (const name of ['base', 'head', 'changes']) {
  if (!args[name]) {
    console.error(`Missing --${name}`);
    process.exit(2);
  }
}

const changes = JSON.parse(readFileSync(args.changes, 'utf8'));
const testable = changes.testable ?? [];
const candidates = (args.candidates ?? '').split(/\s+/).filter(Boolean);
const since = candidates.find((sha) => gitOk('merge-base', '--is-ancestor', sha, args.head)) ?? null;

const result = {
  mode: 'full', since, reason: '', previousReport: args['previous-report'] || null,
  scope: [], cosmetic: [], unchanged: [], astCheck: 'not needed',
};

if (!testable.length) {
  result.mode = 'skip';
  result.reason = 'no testable source files in this PR';
} else if (!since) {
  result.reason = candidates.length
    ? 'earlier runs are no longer in the branch history (rebase or force-push)'
    : 'first analysis of this PR';
  result.scope = testable.map((entry) => ({ file: entry.file, why: 'full analysis' }));
} else {
  incremental();
}

// Existing tests that fail on the head always bring their source file into scope.
if (args.failing && testable.length && existsSync(args.failing)) {
  const failingFiles = Object.values(JSON.parse(readFileSync(args.failing, 'utf8')))
    .flatMap((pkg) => pkg.failing ?? []).map((suite) => suite.file);
  for (const entry of testable) {
    if (!failingFiles.includes(entry.testFile) || result.scope.some((item) => item.file === entry.file)) continue;
    result.scope.push({ file: entry.file, why: `existing test fails: ${entry.testFile}` });
    result.unchanged = result.unchanged.filter((file) => file !== entry.file);
    result.cosmetic = result.cosmetic.filter((file) => file !== entry.file);
  }
  if (result.mode === 'skip' && result.scope.length) result.mode = 'incremental';
}

const json = JSON.stringify(result, null, 2);
if (args.out) writeFileSync(args.out, `${json}\n`);
process.stdout.write(`${json}\n`);

// ---------------------------------------------------------------------------

function incremental() {
  // The PR's own change per file, at the checkpoint and now (each against its own merge base).
  const before = patches(`${args.base}...${since}`); // A...B diffs from the merge base of A and B
  const now = patches(`${args.base}...${args.head}`);
  const changedSince = (file) => (before.get(file) ?? '') !== (now.get(file) ?? '');

  for (const entry of testable) {
    if (entry.status === 'dependent') {
      const trigger = (entry.via ?? []).find(changedSince);
      if (trigger) result.scope.push({ file: entry.file, why: `imports ${trigger}, which changed since the last analysis` });
      else result.unchanged.push(entry.file);
      continue;
    }
    if (!changedSince(entry.file)) {
      result.unchanged.push(entry.file);
      continue;
    }
    if (sameSyntax(entry.file)) result.cosmetic.push(entry.file);
    else result.scope.push({ file: entry.file, why: 'changed since the last analysis' });
  }

  if (since === args.head) {
    result.mode = 'skip';
    result.reason = 'this commit was already analysed';
  } else if (!result.scope.length) {
    result.mode = 'skip';
    result.reason = result.cosmetic.length
      ? 'only formatting or comment changes since the last analysis'
      : 'no testable source changes since the last analysis';
  } else {
    result.mode = 'incremental';
    result.reason = `${result.scope.length} file(s) changed since the last analysis`;
  }
}

// Map<file, its +/- lines> for a diff range; line numbers are dropped so shifted hunks compare equal.
function patches(range) {
  const map = new Map();
  let current = null;
  const text = git('diff', '-U0', '--no-color', '--no-ext-diff', '-M', range, '--', 'backend/src', 'frontend/src');
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git')) {
      current = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      const old = line.slice(4).replace(/^"?a\//, '').replace(/"$/, '');
      current = old === '/dev/null' ? null : old; // a deletion keeps the old path
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/^"?b\//, '').replace(/"$/, '');
      if (target !== '/dev/null') current = target;
      if (current && !map.has(current)) map.set(current, '');
      continue;
    }
    if (current && (line.startsWith('+') || line.startsWith('-'))) map.set(current, `${map.get(current)}${line}\n`);
  }
  return map;
}

// --- syntax comparison -------------------------------------------------------

function sameSyntax(file) {
  const ts = loadTypeScript();
  if (!ts) {
    result.astCheck = 'unavailable (typescript not installed) – every change counted as real';
    return false;
  }
  result.astCheck = 'used';
  let old;
  try {
    old = git('show', `${since}:${file}`);
  } catch {
    return false; // the file didn't exist at the checkpoint
  }
  const current = git('show', `${args.head}:${file}`);
  return signature(ts, file, old) === signature(ts, file, current);
}

function loadTypeScript() {
  if (typescript !== undefined) return typescript;
  const places = args.typescript ? [args.typescript] : ['frontend', 'backend'].map((pkg) => path.join(root, pkg, 'node_modules', 'typescript'));
  typescript = null;
  for (const place of places) {
    try {
      typescript = createRequire(import.meta.url)(place);
      break;
    } catch {
      // try the next package
    }
  }
  return typescript;
}

// Structure of the syntax tree without positions, comments, semicolons, trailing commas, quote style
// or redundant parentheses. Precedence is part of the tree's shape, so dropping parentheses is safe.
// Anything else that differs – a value, an operator, a name, a type, JSX text – makes the files differ.
function signature(ts, file, code) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  // JSX whitespace rule: text with a line break is trimmed per line and joined with single spaces.
  const jsxText = (text) => (text.includes('\n') ? text.split('\n').map((line) => line.trim()).filter(Boolean).join(' ') : text);
  const visit = (node) => {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    if (ts.isJsxText(node)) {
      const text = jsxText(node.text);
      return text ? `(JsxText ${JSON.stringify(text)})` : null;
    }
    const parts = [ts.SyntaxKind[node.kind]];
    if (!ts.isSourceFile(node) && typeof node.text === 'string') parts.push(JSON.stringify(node.text));
    ts.forEachChild(node, (child) => {
      const part = visit(child);
      if (part !== null) parts.push(part);
    });
    return `(${parts.join(' ')})`;
  };
  return visit(source);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) out[argv[i].replace(/^--/, '')] = argv[++i];
  return out;
}
