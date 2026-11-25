---
name: run-tests-and-coverage
description: Verify generated or updated Taskly unit tests – type-check, run the targeted tests, review their quality, run the full package suite with coverage, compute the coverage delta deterministically, and apply a bounded fix-or-drop loop. Use after writing any test and before reporting.
---

# Run tests and coverage

Never report a test as delivered unless it passed in **this** procedure.

## 1. Targeted run (fast feedback)

```sh
cd backend  && npx vitest run tests/<module>.test.ts
cd frontend && npx vitest run src/path/Component.test.tsx
```

## 2. Fix-or-drop loop (max 2 attempts per failing test)

For each failure decide which side is wrong:

- **Test is wrong** (bad selector, wrong mock, async timing, wrong expectation of *unchanged* behaviour) → fix the test. Prefer `findBy*`/`waitFor` over sleeps.
- **Source looks wrong** (test asserts the behaviour the PR/diff clearly intends, the code does otherwise) → do **not** change the source and do **not** bend the assertion. Remove that test and record a *suspected bug* with: file, line, input, expected vs actual.
- Still failing after 2 attempts → remove the test, record it as *dropped* with the error message.

Never get to green by weakening a test (agent hard rule – no `.skip`/`.only`, no deleted or widened assertions).

## 3. Quality review of your own tests (before the full run)

Passing is not enough. Re-read every test you added or changed and fix or remove it if it fails any of these:

| Check | Failing example |
| --- | --- |
| **Has a behavioural purpose** – the title names an observable behaviour, and it maps to a case in your test plan | `it('works')`, `it('renders')` with no assertion about what |
| **Assertions can fail** – each test asserts concrete outcomes (status *and* body, visible text/role, callback arguments, returned value) | only `toBeDefined()` / `toBeTruthy()` / `toHaveBeenCalled()` where the arguments are known |
| **Would catch a regression** – if the changed line were reverted or broken, at least one assertion would fail | a test that passes on the base branch *and* on the PR for the changed behaviour |
| **Not redundant** – it covers a case no other test (existing or new) already covers | two tests differing only in an irrelevant input value |
| **Tests behaviour, not implementation** – no asserting internal state, private helpers, call order of internals, CSS/styled-components output | `expect(setState).toHaveBeenCalledTimes(2)` |
| **Mocks only boundaries** – the API layer, `fetch`, Prisma delegates, timers, design-system components; never the unit under test | mocking the hook that the component under test *is* |
| **Deterministic and independent** – fake time for dates, no shared mutable state, no order dependence, no sleeps | `new Date()` compared to a fixed string |
| **Expected values are derived, not copied** from running the code | an expected value pasted from the actual output without reasoning |

Then check that existing tests were preserved (agent rule "existing tests are human-owned"):

```sh
# Lines removed or changed in test files that existed before this run – must be empty or each one justified in the report.
# Import lines are ignored: extending an existing import (`import { a, b } from …`) is normal and allowed.
git diff -U0 -- backend/tests frontend/src | grep -E '^-[^-]' | grep -vE '^-\s*import ' || echo "no existing test lines removed or changed"
```

## 4. Full verification per touched package

Run both for every package you touched (and only those):

```sh
cd backend  && npm run typecheck && npm run test:coverage -- --coverage.reportOnFailure
cd frontend && npm run typecheck && npm run test:coverage -- --coverage.reportOnFailure
# Prettier on the frontend test files you touched – modified *and* new (untracked) ones:
cd frontend && git ls-files -m -o --exclude-standard -- 'src/**/*.test.ts' 'src/**/*.test.tsx' 'src/test/**' | xargs -r npx prettier --check
```

- Don't use `npm run format:check` as the gate: upstream files are already unformatted (e.g. `ApplicationHeader.test.tsx`), so it fails regardless of your work. Fix your own files with `npx prettier --write <file>`; never edit `.prettierignore`. On Windows with `core.autocrlf=true`, add `--end-of-line auto`.
- `--coverage.reportOnFailure` keeps the coverage report even when a test fails (for example a pre-existing failure you left alone as a suspected bug); without it, section 5 has nothing to read.
- `test:coverage` enforces the thresholds in `backend/vitest.config.ts` (100% per file for validators and mappers) and `frontend/vite.config.ts` (package-wide floor); a threshold failure is a failure. They guard against regressions only – new code is judged by the changed-lines table in section 5.
- Tests listed in `<ctx>/failing-tests.json` already failed before you started. Those you left alone as *suspected bugs* still fail – report them as pre-existing (status ⚠️), not as your failures. Any other failure is yours to fix or drop.
- Flakiness check: re-run the new test files once more (`npx vitest run <files>`); if a result differs, treat as failing.
- Record the **real** summary line, e.g. `Test Files 6 passed (6) | Tests 71 passed (71)`.

## 5. Coverage delta (deterministic – never estimate)

The baseline is the one captured in `analyze-pr-changes` step 1 (`<ctx>/baseline/`; `/tmp/gh-aw/context` in CI). In backfill mode, use the `coverage-summary.json` you ranked files from as `--before`.

```sh
node .github/skills/run-tests-and-coverage/scripts/coverage-delta.mjs \
  --label backend \
  --before <ctx>/baseline/backend.json \
  --after backend/coverage/coverage-summary.json \
  --files backend/src/features/todos/router.ts,backend/src/core/config.ts \
  --json <ctx>/coverage-delta-backend.json
```

Pass the changed source files in `--files`. Paste the Markdown table it prints into the report unchanged.

Then the **changed-lines** table – coverage of exactly the lines the PR changed, before vs after your tests (PR runs only; skip in backfill mode where there is no diff):

```sh
node .github/skills/analyze-pr-changes/scripts/uncovered-changed-lines.mjs \
  --diff <ctx>/diff.patch --changes <ctx>/changes.json \
  --baseline-lcov backend=<ctx>/baseline/backend.lcov.info \
  --lcov backend=backend/coverage/lcov.info \
  --json <ctx>/changed-lines-after.json
```

Pass a `--baseline-lcov`/`--lcov` pair per touched package. Any changed line still listed under *Uncovered lines* needs a reason in the report (unreachable by design, dropped test, out of scope).

## 6. Final checklist

- [ ] Only files the agent may write were changed (`git status --porcelain`; agent hard rule "Write only test files").
- [ ] Typecheck green for touched packages.
- [ ] Full suites green, thresholds met.
- [ ] Coverage tables generated by the scripts (`coverage-delta.mjs`, and `uncovered-changed-lines.mjs` for PR runs).
- [ ] Every changed line still uncovered has a stated reason.
- [ ] Quality review (section 3) done; no removed or changed lines in pre-existing tests, or each one justified.
- [ ] Dropped tests / suspected bugs recorded.
