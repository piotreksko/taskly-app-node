---
name: analyze-pr-changes
description: Classify the files changed in a pull request (or a local branch) of the Taskly repo, map each source file to its test file, and decide per file whether to write new tests, update existing ones, or skip – with a reason. Use at the start of any test-generation task.
---

# Analyze PR changes

Goal: a small, explicit **test plan** – which files need tests, which cases, and why others are skipped.

## 1. Get the context (and the coverage baseline)

The skills write `<ctx>` for the context folder; the files in it are listed in the agent's operating procedure.

- **CI:** `<ctx>` is `/tmp/gh-aw/context`. The workflow has already produced everything – don't regenerate it. Write the path literally in commands.
- **Locally:** produce the same files once, *before writing any test* – this is the only baseline step; `run-tests-and-coverage` reuses it. From the repo root, on the PR branch, with `CTX` set to a scratch folder outside the repo:

```sh
BASE=$(git merge-base origin/main HEAD); mkdir -p "$CTX/baseline"
node .github/skills/analyze-pr-changes/scripts/classify-changes.mjs --base "$BASE" --out "$CTX/changes.json" > /dev/null
git diff "$BASE...HEAD" -- backend/src frontend/src > "$CTX/diff.patch"
for pkg in backend frontend; do   # only the packages listed in summary.packages are needed
  (cd $pkg && npx vitest run --coverage --coverage.reportOnFailure --reporter=default --reporter=json \
    --outputFile.json="$CTX/baseline/$pkg.results.json")
  cp $pkg/coverage/coverage-summary.json "$CTX/baseline/$pkg.json"; cp $pkg/coverage/lcov.info "$CTX/baseline/$pkg.lcov.info"
done
node .github/skills/analyze-pr-changes/scripts/failing-tests.mjs --results backend="$CTX/baseline/backend.results.json" \
  --results frontend="$CTX/baseline/frontend.results.json" --json "$CTX/failing-tests.json" > "$CTX/failing-tests.md"
node .github/skills/analyze-pr-changes/scripts/uncovered-changed-lines.mjs --diff "$CTX/diff.patch" \
  --lcov backend="$CTX/baseline/backend.lcov.info" --lcov frontend="$CTX/baseline/frontend.lcov.info" \
  --changes "$CTX/changes.json" --json "$CTX/changed-lines.json" > "$CTX/changed-lines.md"
# Scope: full by default. To analyse only what changed since an earlier analysed commit, pass it in --candidates.
node .github/skills/analyze-pr-changes/scripts/incremental-scope.mjs --base "$BASE" --head HEAD \
  --changes "$CTX/changes.json" --failing "$CTX/failing-tests.json" --candidates "" --out "$CTX/scope.json"
```

**Scope first.** `scope.json` decides which files this run analyses – work only on `scope[]`:

- `full` – every testable file (`why: full analysis`).
- `incremental` – only files whose PR change differs from the last successful run at `since` (merges from the base branch don't count), files importing a changed constants module, and files whose existing test now fails. `unchanged[]` and `cosmetic[]` (equivalent syntax tree: formatting or comments only) were analysed before; leave them alone.

`changes.json` comes from a deterministic script that skips every coverage exclude of both packages (checked by a test). Output fields:

- `testable[]` – `{ file, status (A/M/R/C, or `dependent`), package, testFile, testFileExists }`; renames add `oldFile`, `similarity` and, if the old test file still exists, `oldTestFile` (read it – it is the existing test of this module). `dependent` entries are unchanged files that import a changed constants module (`via`): check whether the new value changes their behaviour; usually it doesn't, and the file is a `skip`.
- `skipped[]` – `{ file, status, reason, followUp? }` (types, barrels, stories, design-system, configs, docs, deleted files, pure renames…)
- `testsChanged[]` – test files the PR author already touched
- `summary.decision` – `noop` when nothing is testable

Do **not** override a `skipped` classification unless the file clearly contains runtime logic (explain why in the report).

## 2. Understand each change in scope

For every file in `scope.json` `scope[]` (its `testable` entry in `changes.json` has the test-file mapping):

1. Read the diff hunk for that file in `<ctx>/diff.patch`.
2. Read the **whole** source file and its direct imports – tests must reflect real behaviour, not the diff alone.
3. If `testFileExists`, read the existing test file and note which behaviours are already covered.
4. If the PR changed tests (`testsChanged`), read them – do not duplicate cases the author already wrote.
5. Check `<ctx>/failing-tests.md`: an existing test that fails on the PR head means the PR changed behaviour it asserts. If the diff makes that change intentional, the test is an `update` (change only that assertion and report it under "Changes to existing tests"); if not, it is a *suspected bug* – leave the test as it is and report it.
6. Check **changed-line coverage**: `<ctx>/changed-lines.json` (and `.md`) lists, per testable file, the changed executable lines and branches that the PR's tests leave uncovered (`uncoveredLines`, `uncoveredBranchLines`, `pct`). This is the primary signal; per-file percentages in `<ctx>/baseline/<package>.json` are only context.

## 3. Decide

| Decision | When |
| --- | --- |
| `create` | No test file exists and the file has logic (branches, transforms, error paths, UI states, user interactions). |
| `update` | A test file exists; new/changed behaviour is not yet asserted, or an assertion contradicts an *intentional* change visible in the diff. |
| `skip` | Changed lines and branches are already covered (`changed-lines.json` shows no `uncoveredLines`/`uncoveredBranchLines`) **and** existing assertions check the new behaviour; or trivial pass-through, rename/format-only change. |

Coverage tells you what *ran*, not what was *asserted*. Uncovered changed lines are a strong reason to add tests; covered changed lines still need a check that some test asserts the new behaviour (read the test, don't assume). Uncovered lines that are unreachable by design (e.g. a defensive guard behind a disabled button) are reported, not forced.

## 4. Write the test plan – before writing any test code

For each `create`/`update` file, list concrete scenarios with their **expected outcome**, and tag each with the changed lines or branches it targets. Think through, where they apply: the happy path, edge and boundary values (empty, null, min/max length, dates around "now"), error paths (validation 422, not found 404, network/server failure), loading/empty/error UI states, user interactions and callbacks, and async transitions. Give every case an ID so the report can trace it:

```
backend/src/features/todos/router.ts -> update backend/tests/router.test.ts
  R1  GET /api/todos?status=overdue -> repository.list({ status: 'overdue' }), 200 with list   [lines 41-44]
  R2  GET /api/todos?status=bogus -> 422 { detail }, repository not called                   [branch 46]
frontend/src/features/todos/utils/todos.ts -> update utils/todos.test.ts
  T1  isOverdue: past date & not completed -> true (fake system time)                         [line 60]
  T2  isOverdue: completed / null due date -> false                                           [branch 61]
```

Prioritise: behaviour changes > error/edge paths > happy path already implied by other tests. Aim for meaningful coverage of the **changed lines and branches**, not 100% of the file at any cost. Plan no case whose only purpose is to execute a line; if a changed line can't be reached by any meaningful behaviour, note it as "unreachable by design" instead.

The plan is part of the deliverable: `report-test-results` shows each planned case as implemented, dropped (with the error) or not done (with the reason).

## Backfill mode (no PR, whole codebase)

Use coverage instead of a diff:

```sh
(cd backend && npm run test:coverage) ; (cd frontend && npm run test:coverage)
```

Rank the files in `coverage/coverage-summary.json` by uncovered lines, then plan cases per file exactly as in steps 2–4. The report only contains files the coverage config includes, so the skip rules are already applied; there is no diff, so skip the changed-lines step.
