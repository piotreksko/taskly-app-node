---
name: analyze-pr-changes
description: Classify the files changed in a pull request (or a local branch) of the Taskly repo, map each source file to its test file, and decide per file whether to write new tests, update existing ones, or skip – with a reason. Use at the start of any test-generation task.
---

# Analyze PR changes

Goal: a small, explicit **test plan** – which files need tests, which cases, and why others are skipped.

## 1. Get the classified change list

In CI it already exists: `cat /tmp/gh-aw/context/changes.json`.

Locally, generate it (from repo root):

```sh
node .github/skills/analyze-pr-changes/scripts/classify-changes.mjs --base origin/main
# or, for the whole codebase (backfill), see "Backfill mode" below
```

The script is deterministic and mirrors the coverage excludes of both packages. Output fields:

- `testable[]` – `{ file, status (A/M/R/C), package, testFile, testFileExists }`
- `skipped[]` – `{ file, status, reason }` (types, barrels, stories, design-system, configs, docs, deleted files…)
- `testsChanged[]` – test files the PR author already touched
- `summary.decision` – `noop` when nothing is testable

Do **not** override a `skipped` classification unless the file clearly contains runtime logic (explain why in the report).

## 2. Understand each change

For every `testable` entry:

1. Read the diff hunk for that file (`/tmp/gh-aw/context/diff.patch`, or `git diff <base>...HEAD -- <file>`).
2. Read the **whole** source file and its direct imports – tests must reflect real behaviour, not the diff alone.
3. If `testFileExists`, read the existing test file and note which behaviours are already covered.
4. If the PR changed tests (`testsChanged`), read them – do not duplicate cases the author already wrote.
5. Check baseline coverage of the file (`/tmp/gh-aw/context/baseline/<package>.json`, key = absolute path ending with the file) to find uncovered lines/branches.

## 3. Decide

| Decision | When |
| --- | --- |
| `create` | No test file exists and the file has logic (branches, transforms, error paths, UI states, user interactions). |
| `update` | A test file exists; new/changed behaviour is not yet asserted, or an assertion contradicts an *intentional* change visible in the diff. |
| `skip` | Already fully covered (verify via coverage), trivial pass-through, rename/format-only change. |

## 4. Write the test plan (keep it in your working notes)

For each `create`/`update` file list concrete cases, e.g.

```
backend/src/features/todos/router.ts  -> update backend/tests/router.test.ts
  - GET /api/todos?status=overdue passes the filter to repository.list
  - 422 for unknown status value
frontend/src/features/todos/utils/todos.ts -> update utils/todos.test.ts
  - isOverdue: past date & not completed -> true; completed -> false; null -> false (fake system time)
```

Prioritise: behaviour changes > error/edge paths > happy path already implied by other tests. Aim for meaningful branch coverage of the **changed lines**, not 100% of the file at any cost.

## Backfill mode (no PR, whole codebase)

Use coverage instead of a diff:

```sh
(cd backend && npm run test:coverage) ; (cd frontend && npm run test:coverage)
```

Rank files in `coverage/coverage-summary.json` by uncovered lines, ignoring the skip rules above, then plan cases per file exactly as in steps 2–4.
