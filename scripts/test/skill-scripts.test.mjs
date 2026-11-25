// Tests for the deterministic skill scripts whose output the agent reports as fact.
// They run the real CLIs on small fixtures (fake diffs, lcov and coverage summaries).
//
//   node --test scripts/test/
//
// Built-in node:test – no dependencies.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLASSIFY = path.join(root, '.github/skills/analyze-pr-changes/scripts/classify-changes.mjs');
const CHANGED_LINES = path.join(root, '.github/skills/analyze-pr-changes/scripts/uncovered-changed-lines.mjs');
const SCOPE = path.join(root, '.github/skills/analyze-pr-changes/scripts/incremental-scope.mjs');
const FAILING = path.join(root, '.github/skills/analyze-pr-changes/scripts/failing-tests.mjs');
const DELTA = path.join(root, '.github/skills/run-tests-and-coverage/scripts/coverage-delta.mjs');

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'skill-scripts-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const write = (name, content) => {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
};
const run = (script, args, input) => execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', input });

// --- classify-changes.mjs ----------------------------------------------------

describe('classify-changes.mjs', () => {
  const classify = (nameStatus) => JSON.parse(run(CLASSIFY, ['--stdin'], nameStatus));

  test('maps source files to their test files using the repo conventions', () => {
    const out = classify([
      'M\tfrontend/src/features/todos/utils/todos.ts',
      'M\tbackend/src/features/todos/router.ts',
      'A\tbackend/src/features/todos/brandNew.ts',
    ].join('\n'));

    assert.deepEqual(out.testable, [
      { file: 'frontend/src/features/todos/utils/todos.ts', status: 'M', package: 'frontend', testFile: 'frontend/src/features/todos/utils/todos.test.ts', testFileExists: true },
      { file: 'backend/src/features/todos/router.ts', status: 'M', package: 'backend', testFile: 'backend/tests/router.test.ts', testFileExists: true },
      { file: 'backend/src/features/todos/brandNew.ts', status: 'A', package: 'backend', testFile: 'backend/tests/brandNew.test.ts', testFileExists: false },
    ]);
    assert.deepEqual(out.summary, { testable: 3, skipped: 0, testsChanged: 0, packages: ['frontend', 'backend'], decision: 'analyze' });
  });

  test('skips files with no unit-testable logic, with a reason each', () => {
    const out = classify([
      'M\tfrontend/src/features/todos/types.ts',
      'M\tfrontend/src/features/todos/index.ts',
      'M\tfrontend/src/features/todos/constants.ts',
      'M\tfrontend/src/design-system/Button/Button.tsx',
      'M\tfrontend/src/test/setup.ts',
      'M\tfrontend/src/main.tsx',
      'M\tbackend/src/main.ts',
      'M\tbackend/src/generated/prisma/client.ts',
      'M\tfrontend/package.json',
    ].join('\n'));

    assert.equal(out.testable.length, 0);
    assert.deepEqual(out.skipped.map((entry) => entry.reason), [
      'type declarations only',
      'barrel re-export',
      'constants',
      'design system (covered by Storybook, excluded from coverage)',
      'test infrastructure',
      'application bootstrap',
      'process entry point',
      'generated Prisma client',
      'not application source (config, docs, lockfile, schema, CI)',
    ]);
    assert.equal(out.summary.decision, 'noop');
  });

  test('reports test files the PR author touched separately', () => {
    const out = classify('M\tbackend/tests/router.test.ts\nA\tfrontend/src/App.test.tsx\n');
    assert.deepEqual(out.testsChanged, [
      { file: 'backend/tests/router.test.ts', status: 'M' },
      { file: 'frontend/src/App.test.tsx', status: 'A' },
    ]);
    assert.equal(out.summary.decision, 'noop');
  });

  test('handles NUL-separated renames and copies by keeping the new path', () => {
    const out = classify('R087\0frontend/src/lib/old.ts\0frontend/src/lib/http.ts\0C100\0backend/src/a.ts\0backend/src/b.ts\0');
    assert.deepEqual(out.testable.map(({ file, status }) => ({ file, status })), [
      { file: 'frontend/src/lib/http.ts', status: 'R' },
      { file: 'backend/src/b.ts', status: 'C' },
    ]);
  });

  describe('in a fixture repository', () => {
    let repo;
    const file = (relative, content = 'export {}\n') => {
      const full = path.join(repo, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    };
    const classifyIn = (nameStatus) => JSON.parse(execFileSync(process.execPath, [CLASSIFY, '--stdin'], { cwd: repo, encoding: 'utf8', input: nameStatus }));

    before(() => {
      repo = mkdtempSync(path.join(tmpdir(), 'classify-repo-'));
      execFileSync('git', ['init', '-q'], { cwd: repo });
      file('frontend/src/hooks/useThing.ts');
      file('frontend/src/hooks/useThing.test.tsx'); // hook test renders a JSX wrapper
      file('frontend/src/utils/plain.ts');
      file('frontend/src/old/Widget.tsx');
      file('frontend/src/old/Widget.test.tsx');
      file('frontend/src/new/Widget.tsx');
      file('frontend/src/features/todos/constants.ts', 'export const LIMIT = 5\n');
      file('frontend/src/features/todos/limit.ts', "import { LIMIT } from './constants'\nexport const ok = (n: number) => n <= LIMIT\n");
      file('frontend/src/features/todos/Form.tsx', "import { LIMIT } from \"../todos/constants\"\nexport const F = () => LIMIT\n");
      file('frontend/src/features/todos/types.ts', "import { LIMIT } from './constants'\nexport type T = typeof LIMIT\n");
      file('frontend/src/features/todos/unrelated.ts', "import { x } from './constantsHelper'\n");
      file('frontend/src/features/todos/limit.test.ts', "import { LIMIT } from './constants'\n");
      file('backend/src/core/constants.ts', 'export const PORT = 1\n');
      file('backend/src/core/server.ts', "import { PORT } from './constants.ts'\n");
    });
    after(() => rmSync(repo, { recursive: true, force: true }));

    test('finds an existing .test.tsx for a .ts hook instead of proposing a duplicate .test.ts', () => {
      const out = classifyIn('M\tfrontend/src/hooks/useThing.ts\nM\tfrontend/src/utils/plain.ts\n');
      assert.deepEqual(out.testable.map(({ testFile, testFileExists }) => ({ testFile, testFileExists })), [
        { testFile: 'frontend/src/hooks/useThing.test.tsx', testFileExists: true },
        { testFile: 'frontend/src/utils/plain.test.ts', testFileExists: false },
      ]);
    });

    test('a pure rename is skipped and points to the test left at the old path', () => {
      const out = classifyIn('R100\0frontend/src/old/Widget.tsx\0frontend/src/new/Widget.tsx\0');
      assert.deepEqual(out.testable, []);
      assert.deepEqual(out.skipped, [{
        file: 'frontend/src/new/Widget.tsx', status: 'R', oldFile: 'frontend/src/old/Widget.tsx', similarity: 100,
        reason: 'renamed without content changes', followUp: 'test file still at the old path: frontend/src/old/Widget.test.tsx',
      }]);
    });

    test('a rename with edits is testable and keeps the link to the old test file', () => {
      const out = classifyIn('R082\0frontend/src/old/Widget.tsx\0frontend/src/new/Widget.tsx\0');
      assert.deepEqual(out.testable, [{
        file: 'frontend/src/new/Widget.tsx', status: 'R', oldFile: 'frontend/src/old/Widget.tsx', similarity: 82,
        package: 'frontend', testFile: 'frontend/src/new/Widget.test.tsx', testFileExists: false,
        oldTestFile: 'frontend/src/old/Widget.test.tsx',
      }]);
    });

    test('a changed constants module makes its importers candidates (not tests, types or look-alikes)', () => {
      const out = classifyIn('M\tfrontend/src/features/todos/constants.ts\nM\tbackend/src/core/constants.ts\n');
      assert.deepEqual(out.skipped.map((entry) => entry.reason), ['constants', 'constants']);
      assert.deepEqual(out.testable.map(({ file, status, via }) => ({ file, status, via })), [
        { file: 'frontend/src/features/todos/Form.tsx', status: 'dependent', via: ['frontend/src/features/todos/constants.ts'] },
        { file: 'frontend/src/features/todos/limit.ts', status: 'dependent', via: ['frontend/src/features/todos/constants.ts'] },
        { file: 'backend/src/core/server.ts', status: 'dependent', via: ['backend/src/core/constants.ts'] },
      ]);
      assert.equal(out.summary.decision, 'analyze');
    });

    test('an importer changed in the same PR keeps its own status and records the constant', () => {
      const out = classifyIn('M\tfrontend/src/features/todos/limit.ts\nM\tfrontend/src/features/todos/constants.ts\n');
      const limit = out.testable.find((entry) => entry.file === 'frontend/src/features/todos/limit.ts');
      assert.equal(limit.status, 'M');
      assert.deepEqual(limit.via, ['frontend/src/features/todos/constants.ts']);
      assert.equal(out.testable.filter((entry) => entry.file === 'frontend/src/features/todos/limit.ts').length, 1);
    });
  });

  test('every file excluded from coverage in the package configs is skipped', () => {
    // Turn each exclude glob into a concrete sample path, then expect the classifier to skip it.
    const samples = [];
    for (const [pkg, config] of [['frontend', 'frontend/vite.config.ts'], ['backend', 'backend/vitest.config.ts']]) {
      const text = readFileSync(path.join(root, config), 'utf8');
      const block = /exclude:\s*\[([\s\S]*?)\]/.exec(text)[1];
      for (const [, glob] of block.matchAll(/'([^']+)'/g)) {
        const expanded = glob.includes('{ts,tsx}') ? [glob.replace('{ts,tsx}', 'ts'), glob.replace('{ts,tsx}', 'tsx')] : [glob];
        for (const pattern of expanded) {
          samples.push(`${pkg}/${pattern.replace('**/', 'deep/dir/').replace('/**', '/deep/file.ts').replace('*', 'sample')}`);
        }
      }
    }
    assert.ok(samples.length >= 12, `parsed ${samples.length} excludes`);
    const out = classify(samples.map((sample) => `M\t${sample}`).join('\n'));
    assert.deepEqual(out.testable.map((entry) => entry.file), [], 'excluded from coverage but classified as testable');
  });

  test('a deleted source file is skipped, with a follow-up when its test file remains', () => {
    const out = classify('D\tbackend/src/features/todos/router.ts\nD\tfrontend/src/gone.ts\n');
    assert.deepEqual(out.skipped, [
      { file: 'backend/src/features/todos/router.ts', status: 'D', reason: 'source deleted', followUp: 'remove or update backend/tests/router.test.ts' },
      { file: 'frontend/src/gone.ts', status: 'D', reason: 'source deleted', followUp: null },
    ]);
  });
});

// --- uncovered-changed-lines.mjs ---------------------------------------------

describe('uncovered-changed-lines.mjs', () => {
  // backend/src/service.ts: lines 10-14 added (12 is a blank line, not executable).
  // frontend/src/feature.ts: lines 3-4 added. Test files and a deleted file are in the diff too.
  const DIFF = [
    'diff --git a/backend/src/service.ts b/backend/src/service.ts',
    '--- a/backend/src/service.ts',
    '+++ b/backend/src/service.ts',
    '@@ -8,3 +8,8 @@ export function run() {',
    ' context line 8',
    ' context line 9',
    '+added 10',
    '+added 11',
    '+',
    '+added 13',
    '+added 14',
    '-removed old line',
    ' context line 15',
    'diff --git a/frontend/src/feature.ts b/frontend/src/feature.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/frontend/src/feature.ts',
    '@@ -0,0 +3,2 @@',
    '+added 3',
    '+added 4',
    'diff --git a/frontend/src/feature.test.ts b/frontend/src/feature.test.ts',
    '--- /dev/null',
    '+++ b/frontend/src/feature.test.ts',
    '@@ -0,0 +1 @@',
    '+test line',
    'diff --git a/frontend/src/test/setup.ts b/frontend/src/test/setup.ts',
    '--- a/frontend/src/test/setup.ts',
    '+++ b/frontend/src/test/setup.ts',
    '@@ -1 +1 @@',
    '+setup line',
    'diff --git a/backend/src/removed.ts b/backend/src/removed.ts',
    '--- a/backend/src/removed.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    '',
  ].join('\n');

  // Absolute, Windows-style SF path (backend) and package-relative SF path (frontend).
  const LCOV_AFTER = [
    'SF:C:\\work\\repo\\backend\\src\\service.ts',
    'DA:9,1', 'DA:10,3', 'DA:11,0', 'DA:13,0', 'DA:14,0', 'DA:15,1',
    'BRDA:10,0,0,2', 'BRDA:10,0,1,0', 'BRDA:14,1,0,-',
    'end_of_record',
  ].join('\n');
  const LCOV_FRONTEND = ['SF:src/feature.ts', 'DA:3,1', 'DA:4,1', 'BRDA:4,0,0,1', 'end_of_record'].join('\n');
  // Baseline from before the tests: service.ts had only line 10 covered; feature.ts not in the report.
  const LCOV_BEFORE = ['SF:/home/runner/work/repo/backend/src/service.ts', 'DA:10,1', 'DA:11,0', 'DA:13,0', 'DA:14,0', 'end_of_record'].join('\n');

  const analyze = (extra = []) => {
    const json = path.join(dir, `changed-lines-${Math.random().toString(36).slice(2)}.json`);
    const markdown = run(CHANGED_LINES, ['--diff', write('pr.diff', DIFF), '--json', json, ...extra]);
    return { data: JSON.parse(readFileSync(json, 'utf8')), markdown };
  };

  test('counts only changed executable lines and reports uncovered lines and branches as ranges', () => {
    const { data } = analyze(['--lcov', `backend=${write('after.lcov', LCOV_AFTER)}`, '--lcov', `frontend=${write('fe.lcov', LCOV_FRONTEND)}`]);

    assert.deepEqual(Object.keys(data.files), ['backend/src/service.ts', 'frontend/src/feature.ts']);
    assert.deepEqual(data.files['backend/src/service.ts'], {
      changedLines: 5,
      measured: true,
      executableChangedLines: 4, // 10, 11, 13, 14 (12 is blank, 9 and 15 are unchanged context)
      coveredChangedLines: 1,
      pct: 25,
      uncoveredLines: ['11', '13-14'],
      uncoveredBranchLines: ['10', '14'], // a never-taken branch and an unevaluated one ('-')
    });
    assert.equal(data.files['frontend/src/feature.ts'].pct, 100);
    assert.deepEqual(data.total, { executableChangedLines: 6, coveredChangedLines: 3, pct: 50 });
  });

  test('excludes test files, test infrastructure and deleted files', () => {
    const { data } = analyze(['--lcov', `backend=${write('after.lcov', LCOV_AFTER)}`]);
    for (const file of ['frontend/src/feature.test.ts', 'frontend/src/test/setup.ts', 'backend/src/removed.ts']) {
      assert.equal(file in data.files, false, file);
    }
  });

  test('a file missing from the lcov report is "not measured" and kept out of the total', () => {
    const { data, markdown } = analyze(['--lcov', `backend=${write('after.lcov', LCOV_AFTER)}`]);
    assert.deepEqual(data.files['frontend/src/feature.ts'], { changedLines: 2, measured: false });
    assert.equal(data.total.executableChangedLines, 4);
    assert.match(markdown, /\| `frontend\/src\/feature\.ts` \| 2 changed \| not measured \|/);
  });

  test('--changes limits the analysis to testable files', () => {
    const changes = write('changes.json', JSON.stringify({ testable: [{ file: 'frontend/src/feature.ts' }] }));
    const { data } = analyze(['--lcov', `frontend=${write('fe.lcov', LCOV_FRONTEND)}`, '--changes', changes]);
    assert.deepEqual(Object.keys(data.files), ['frontend/src/feature.ts']);
  });

  test('before/after: a file absent from an existing baseline report counts as 0% covered before', () => {
    const { data, markdown } = analyze([
      '--baseline-lcov', `backend=${write('before.lcov', LCOV_BEFORE)}`,
      '--lcov', `backend=${write('after.lcov', LCOV_AFTER)}`,
      '--lcov', `frontend=${write('fe.lcov', LCOV_FRONTEND)}`,
    ]);
    assert.deepEqual(data.files['backend/src/service.ts'].before, { measured: true, coveredChangedLines: 1, pct: 25 });
    assert.deepEqual(data.files['frontend/src/feature.ts'].before, { measured: true, coveredChangedLines: 0, pct: 0 });
    assert.deepEqual(data.total.before, { coveredChangedLines: 1, pct: 16.7 });
    assert.match(markdown, /\| \*\*changed lines total\*\* \| 6 \| 16\.7% \| 50\.0% \|/);
  });

  test('before/after: with no readable baseline report the before values are n/a, not 0%', () => {
    const { data, markdown } = analyze([
      '--baseline-lcov', `backend=${path.join(dir, 'does-not-exist.lcov')}`,
      '--lcov', `backend=${write('after.lcov', LCOV_AFTER)}`,
    ]);
    assert.deepEqual(data.files['backend/src/service.ts'].before, { measured: false });
    assert.deepEqual(data.total.before, { coveredChangedLines: null, pct: null });
    assert.match(markdown, /\| `backend\/src\/service\.ts` \| 4 \| n\/a \| 25\.0% \(1\/4\) \|/);
  });

  test('an empty diff prints a clear message', () => {
    const json = path.join(dir, 'empty.json');
    const out = run(CHANGED_LINES, ['--diff', write('empty.diff', ''), '--json', json]);
    assert.equal(out.trim(), '_No changed source files to analyze._');
    assert.deepEqual(JSON.parse(readFileSync(json, 'utf8')).total, { executableChangedLines: 0, coveredChangedLines: 0, pct: null });
  });
});

// --- incremental-scope.mjs ---------------------------------------------------

describe('incremental-scope.mjs', () => {
  const TYPESCRIPT = path.join(root, 'frontend/node_modules/typescript');
  let repo;
  const sh = (...gitArgs) => execFileSync('git', gitArgs, { cwd: repo, encoding: 'utf8' }).trim();
  const put = (relative, content) => {
    const full = path.join(repo, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const commit = (message, files) => {
    for (const [relative, content] of Object.entries(files)) put(relative, content);
    sh('add', '-A');
    sh('commit', '-q', '-m', message);
    return sh('rev-parse', 'HEAD');
  };
  // Classify the PR as the workflow does, then compute the scope against the given checkpoint candidates.
  const scope = ({ candidates = [], failing, typescript = TYPESCRIPT } = {}) => {
    const head = sh('rev-parse', 'HEAD');
    const base = sh('rev-parse', 'main');
    const changes = path.join(dir, 'scope-changes.json');
    execFileSync(process.execPath, [CLASSIFY, '--base', base, '--head', head, '--out', changes], { cwd: repo });
    const extra = failing ? ['--failing', failing] : [];
    return JSON.parse(execFileSync(process.execPath, [
      SCOPE, '--base', base, '--head', head, '--changes', changes,
      '--candidates', candidates.join(' '), '--typescript', typescript, ...extra,
    ], { cwd: repo, encoding: 'utf8' }));
  };

  const A = "export function price(p: number) {\n  // 20% off\n  return p * 0.8\n}\n";
  const B = "export function label(done: boolean) {\n  if (done) return 'done'\n  return 'open'\n}\n";
  const CONSTANTS = 'export const LIMIT = 5\n';
  const USES = "import { LIMIT } from './constants'\nexport const ok = (n: number) => n <= LIMIT\n";
  let checkpoint;

  before(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'scope-repo-'));
    sh('init', '-q', '-b', 'main');
    sh('config', 'user.email', 'test@example.com');
    sh('config', 'user.name', 'test');
    sh('config', 'commit.gpgsign', 'false');
    commit('base', {
      'frontend/src/a.ts': A, 'frontend/src/b.ts': B, 'frontend/src/constants.ts': CONSTANTS,
      'frontend/src/uses.ts': USES, 'backend/src/c.ts': 'export const c = 1\n', 'README.md': 'x\n',
    });
    sh('checkout', '-q', '-b', 'pr');
    // The PR's first analysed state: real changes to a.ts and b.ts.
    checkpoint = commit('pr: change a and b', {
      'frontend/src/a.ts': A.replace('0.8', '0.75'),
      'frontend/src/b.ts': B.replace("'open'", "'todo'"),
    });
  });
  after(() => rmSync(repo, { recursive: true, force: true }));

  test('without an earlier successful run the whole PR is analysed', () => {
    const out = scope();
    assert.equal(out.mode, 'full');
    assert.equal(out.reason, 'first analysis of this PR');
    assert.deepEqual(out.scope.map((item) => item.file), ['frontend/src/a.ts', 'frontend/src/b.ts']);
  });

  test('the checkpoint itself is skipped as already analysed', () => {
    const out = scope({ candidates: [checkpoint] });
    assert.equal(out.mode, 'skip');
    assert.equal(out.reason, 'this commit was already analysed');
  });

  test('formatting and comment changes skip the agent', () => {
    sh('checkout', '-q', '-B', 'cosmetic', checkpoint);
    commit('reformat a', { 'frontend/src/a.ts': 'export function price(p:number){return p*0.75;} /* reformatted */\n' });
    const out = scope({ candidates: [checkpoint] });
    assert.equal(out.mode, 'skip');
    assert.equal(out.reason, 'only formatting or comment changes since the last analysis');
    assert.deepEqual(out.cosmetic, ['frontend/src/a.ts']);
    assert.equal(out.astCheck, 'used');
  });

  test('without TypeScript the same change is treated as real (conservative)', () => {
    const out = scope({ candidates: [checkpoint], typescript: path.join(repo, 'no-typescript-here') });
    assert.equal(out.mode, 'incremental');
    assert.deepEqual(out.scope, [{ file: 'frontend/src/a.ts', why: 'changed since the last analysis' }]);
    assert.match(out.astCheck, /^unavailable/);
  });

  test('a real change narrows the analysis to that file', () => {
    sh('checkout', '-q', '-B', 'real', checkpoint);
    commit('change b', { 'frontend/src/b.ts': B.replace("'open'", "'pending'") });
    const out = scope({ candidates: [checkpoint] });
    assert.equal(out.mode, 'incremental');
    assert.deepEqual(out.scope, [{ file: 'frontend/src/b.ts', why: 'changed since the last analysis' }]);
    assert.deepEqual(out.unchanged, ['frontend/src/a.ts']);
  });

  test('a change that only deletes lines is detected', () => {
    sh('checkout', '-q', '-B', 'deletion', checkpoint);
    commit('drop the guard in b', { 'frontend/src/b.ts': B.replace("'open'", "'todo'").replace("  if (done) return 'done'\n", '') });
    assert.deepEqual(scope({ candidates: [checkpoint] }).scope.map((item) => item.file), ['frontend/src/b.ts']);
  });

  test("merging main into the PR doesn't count main's changes, even in files the PR also changes", () => {
    sh('checkout', '-q', 'main');
    commit('main: unrelated edits', {
      'frontend/src/a.ts': `export const banner = 'sale'\n${A}`, // shifts the PR's lines in a.ts
      'backend/src/c.ts': 'export const c = 2\n',
    });
    sh('checkout', '-q', '-B', 'merged', checkpoint);
    sh('merge', '-q', '--no-edit', 'main');
    const out = scope({ candidates: [checkpoint] });
    assert.equal(out.mode, 'skip');
    assert.equal(out.reason, 'no testable source changes since the last analysis');
    assert.deepEqual(out.unchanged, ['frontend/src/a.ts', 'frontend/src/b.ts']);
  });

  test('after a rebase the old checkpoint is ignored and the next candidate or a full run is used', () => {
    sh('checkout', '-q', '-B', 'rebased', 'main');
    const rewritten = commit('pr rewritten', { 'frontend/src/b.ts': B.replace("'open'", "'todo'") });
    const full = scope({ candidates: [checkpoint] });
    assert.equal(full.mode, 'full');
    assert.equal(full.reason, 'earlier runs are no longer in the branch history (rebase or force-push)');
    // Candidates are newest first; the first one still in the history wins.
    assert.equal(scope({ candidates: [checkpoint, rewritten] }).since, rewritten);
  });

  test('a changed constant brings the files that import it into scope', () => {
    sh('checkout', '-q', '-B', 'constants', checkpoint);
    commit('raise the limit', { 'frontend/src/constants.ts': 'export const LIMIT = 10\n' });
    const out = scope({ candidates: [checkpoint] });
    assert.equal(out.mode, 'incremental');
    assert.deepEqual(out.scope, [{ file: 'frontend/src/uses.ts', why: 'imports frontend/src/constants.ts, which changed since the last analysis' }]);
  });

  test('an existing test failing on the head brings its source file into scope', () => {
    sh('checkout', '-q', '-B', 'failing', checkpoint);
    commit('docs only', { 'README.md': 'y\n' });
    const failing = path.join(dir, 'scope-failing.json');
    writeFileSync(failing, JSON.stringify({ frontend: { available: true, failing: [{ file: 'frontend/src/a.test.ts', tests: [] }] } }));
    const out = scope({ candidates: [checkpoint], failing });
    assert.equal(out.mode, 'incremental');
    assert.deepEqual(out.scope, [{ file: 'frontend/src/a.ts', why: 'existing test fails: frontend/src/a.test.ts' }]);
    assert.deepEqual(out.unchanged, ['frontend/src/b.ts']);
  });

  test('the syntax comparison ignores layout but not meaning', () => {
    // Commit one version of a .tsx file, then another; the first commit is the checkpoint.
    const isCosmetic = (before, after) => {
      sh('checkout', '-q', '-B', `syntax-${Math.random().toString(36).slice(2)}`, checkpoint);
      const first = commit('before', { 'frontend/src/View.tsx': before });
      commit('after', { 'frontend/src/View.tsx': after });
      return scope({ candidates: [first] }).cosmetic.includes('frontend/src/View.tsx');
    };
    const base = [
      'export const View = () => <p className="x">Hi there</p>',
      'export const f = (a: number, b: number) => a * b',
      'export const g = (a: number, b: number) => (a + b) * 2',
      "export const s = 'q'",
      '',
    ].join('\n');
    // Comments, semicolons, quote style, trailing commas, parentheses around JSX, line breaks in JSX text.
    const relaidOut = [
      '// a comment',
      "export const View = () => (\n  <p className='x'>\n    Hi there\n  </p>\n);",
      'export const f = (a: number, b: number,) => (a * b);',
      'export const g = (a: number, b: number) => ((a + b) * 2);',
      'export const s = "q"; /* another */',
      '',
    ].join('\n');
    assert.equal(isCosmetic(base, relaidOut), true, 'layout-only change');
    for (const [from, to] of [
      ['a * b', 'a / b'], ['(a + b) * 2', 'a + b * 2'], ["'q'", "'q '"], ['Hi there', 'Hi there!'],
      ['a: number, b: number) => a', 'a: string, b: number) => a'], ['const s', 'const t'], ['className="x"', 'className="y"'],
    ]) {
      assert.equal(isCosmetic(base, base.replace(from, to)), false, `${from} -> ${to}`);
    }
  });
});

// --- failing-tests.mjs -------------------------------------------------------

describe('failing-tests.mjs', () => {
  // Shape of Vitest's JSON reporter (Jest-compatible), trimmed to the fields the script reads.
  const RESULTS = {
    success: false,
    testResults: [
      { name: path.join(root, 'backend/tests/ok.test.ts'), status: 'passed', message: '', assertionResults: [{ fullName: 'fine', status: 'passed', failureMessages: [] }] },
      {
        name: path.join(root, 'backend/tests/router.test.ts'), status: 'failed', message: '',
        assertionResults: [
          { fullName: 'todos router › lists todos', status: 'passed', failureMessages: [] },
          { fullName: 'todos router › rejects a long title', status: 'failed', failureMessages: ['\nAssertionError: expected 201 to be 422\n    at router.test.ts:40:5'] },
        ],
      },
      { name: path.join(root, 'backend/tests/broken.test.ts'), status: 'failed', message: "Failed to load url ../src/missing.ts\nstack", assertionResults: [] },
    ],
  };
  const PASSING = { success: true, testResults: [RESULTS.testResults[0]] };

  test('lists failing tests per package with the first line of the error, and suites that failed to load', () => {
    const json = path.join(dir, 'failing.json');
    const out = run(FAILING, [
      '--results', `backend=${write('backend.results.json', JSON.stringify(RESULTS))}`,
      '--results', `frontend=${write('frontend.results.json', JSON.stringify(PASSING))}`,
      '--json', json,
    ]);
    assert.equal(out, [
      '- **backend** `backend/tests/router.test.ts` › todos router › rejects a long title: AssertionError: expected 201 to be 422',
      '- **backend** `backend/tests/broken.test.ts`: suite failed – Failed to load url ../src/missing.ts',
      '- **frontend**: no failing tests',
      '',
    ].join('\n'));
    const data = JSON.parse(readFileSync(json, 'utf8'));
    assert.deepEqual(data.backend.failing[0], {
      file: 'backend/tests/router.test.ts',
      tests: [{ name: 'todos router › rejects a long title', message: 'AssertionError: expected 201 to be 422' }],
    });
    assert.deepEqual(data.frontend, { available: true, failing: [] });
  });

  test('a missing results file is reported as unavailable, not as "no failing tests"', () => {
    const out = run(FAILING, ['--results', `frontend=${path.join(dir, 'missing.results.json')}`]);
    assert.equal(out.trim(), '- **frontend**: no test results (the run did not finish – see the log)');
  });
});

// --- finalize-report.mjs -----------------------------------------------------

describe('finalize-report.mjs', () => {
  const FINALIZE = path.join(root, 'scripts/finalize-report.mjs');
  const REPORT = [
    '## 🧪 Unit Test Agent report',
    '',
    '**Status:** ✅ Tests added and passing',
    '**Scope:** Full analysis',
    '**Commit:** tests pushed to this branch by the workflow (only if files changed)',
    '',
    '### Decisions',
    '| a | b |',
  ].join('\n');
  const finalize = (body, facts) => execFileSync(process.execPath, [FINALIZE, '--body-file', write('report.md', body)], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PUSH_SHA: '', PUSH_URL: '', PUSH_FAILURES: '', PUSH_ERRORS: '', ...facts },
  });
  const line = (body, prefix) => body.split('\n').find((text) => text.startsWith(prefix));

  test('a successful push replaces the model-written line with the real commit link', () => {
    const out = finalize(REPORT, { PUSH_SHA: '0123456789abcdef', PUSH_URL: 'https://github.com/o/r/commit/0123456' });
    assert.equal(line(out, '**Commit:**'), '**Commit:** [`0123456`](https://github.com/o/r/commit/0123456) – tests pushed to this branch');
    assert.equal(line(out, '**Status:**'), '**Status:** ✅ Tests added and passing');
    assert.equal(out.split('\n').length, REPORT.split('\n').length);
  });

  test('a failed push says the tests were not applied and overrides the status', () => {
    const out = finalize(REPORT, { PUSH_FAILURES: '1', PUSH_ERRORS: '\n  Updates were rejected because the `tip` <b>is</b> behind\nmore' });
    assert.equal(line(out, '**Commit:**'), "**Commit:** ❌ push to this branch failed – the tests above were **not** applied: Updates were rejected because the 'tip' 'b'is'/b' behind");
    assert.equal(line(out, '**Status:**'), '**Status:** ❌ Tests not delivered – the push failed (see Commit)');
  });

  test('no push means no commit', () => {
    assert.equal(line(finalize(REPORT, {}), '**Commit:**'), '**Commit:** none – no test files changed');
  });

  test('a missing Commit line is added under the heading instead of being lost', () => {
    const out = finalize(REPORT.replace(/\*\*Commit:\*\*.*\n/, ''), { PUSH_FAILURES: '2' });
    assert.equal(out.split('\n').filter((text) => text.startsWith('**Status:**')).length, 1, 'exactly one status line');
    assert.equal(line(out, '**Status:**'), '**Status:** ❌ Tests not delivered – the push failed (see Commit)');
    // Neither line present: both are added under the heading, status first.
    const bare = finalize('## 🧪 Unit Test Agent report\n\n### Decisions\n', { PUSH_FAILURES: '2' });
    assert.deepEqual(bare.split('\n').slice(0, 5), [
      '## 🧪 Unit Test Agent report', '', '**Status:** ❌ Tests not delivered – the push failed (see Commit)', '',
      '**Commit:** ❌ push to this branch failed – the tests above were **not** applied: see the workflow run',
    ]);
  });
});

// --- coverage-delta.mjs ------------------------------------------------------

describe('coverage-delta.mjs', () => {
  const metrics = (statements, branches, functions, lines) => ({
    statements: { pct: statements }, branches: { pct: branches }, functions: { pct: functions }, lines: { pct: lines },
  });
  const BEFORE = {
    total: metrics(80.04, 70, 90, 80.04),
    '/home/runner/work/repo/backend/src/core/config.ts': metrics(50, 50, 100, 50),
  };
  const AFTER = {
    // statements: 80.04 -> 80.01 both display 80.0, so ±0. lines: 80.04 -> 80.06 display 80.0 -> 80.1, so +0.1 (the delta matches the shown values).
    total: metrics(80.01, 75, 85.5, 80.06),
    'C:\\work\\repo\\backend\\src\\core\\config.ts': metrics(100, 100, 100, 100),
    '/home/runner/work/repo/backend/src/new.ts': metrics(90, 80, 100, 90),
  };

  test('prints rounded deltas with direction, and marks new and unmeasured files', () => {
    const json = path.join(dir, 'delta.json');
    const out = run(DELTA, [
      '--label', 'backend',
      '--before', write('before.json', JSON.stringify(BEFORE)),
      '--after', write('after.json', JSON.stringify(AFTER)),
      '--files', 'backend/src/core/config.ts, backend/src/new.ts,backend/src/missing.ts',
      '--json', json,
    ]);
    assert.equal(out, [
      '| Scope | Statements | Branches | Functions | Lines |',
      '| --- | ---: | ---: | ---: | ---: |',
      '| **backend total** | 80.0% (±0) | 75.0% (+5.0 pp) ⬆ | 85.5% (-4.5 pp) ⬇ | 80.1% (+0.1 pp) ⬆ |',
      '| `backend/src/core/config.ts` | 100.0% (+50.0 pp) ⬆ | 100.0% (+50.0 pp) ⬆ | 100.0% (±0) | 100.0% (+50.0 pp) ⬆ |',
      '| `backend/src/new.ts` | 90.0% (new) | 80.0% (new) | 100.0% (new) | 90.0% (new) |',
      '| `backend/src/missing.ts` | not measured | not measured | not measured | not measured |',
      '',
    ].join('\n'));
    const data = JSON.parse(readFileSync(json, 'utf8'));
    assert.deepEqual(data.total.branches, { before: 70, after: 75 });
    assert.deepEqual(data.files['backend/src/new.ts'].lines, { before: null, after: 90 });
  });

  test('without a baseline every value says n/a instead of inventing a delta', () => {
    const out = run(DELTA, ['--before', path.join(dir, 'nope.json'), '--after', write('after.json', JSON.stringify(AFTER))]);
    assert.match(out, /\| \*\*coverage total\*\* \| 80\.0% \(n\/a, no baseline\) \| 75\.0% \(n\/a, no baseline\) \|/);
  });

  test('fails loudly when the after report is missing', () => {
    const result = spawnSync(process.execPath, [DELTA, '--after', path.join(dir, 'nope.json')], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Missing --after coverage summary/);
  });
});
