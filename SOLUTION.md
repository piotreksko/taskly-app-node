# SOLUTION – Unit Test Agent and Agentic PR Workflow

**TL;DR.** A custom Claude agent (`unit-test-agent`) with five reusable skills runs as a GitHub Agentic Workflow on every non-draft pull request that touches `backend/src` or `frontend/src`. Scripts classify the changes and measure coverage the same way every time. The agent decides per file whether tests are needed, writes Vitest tests, runs them and posts a report in a fixed format. A separate job with write access pushes only test files back to the PR branch.

```
PR opened/updated ─▶ activation (same-repo, non-draft, paths filter)
                   ─▶ scope job (scripted, no model): full | incremental since last successful run | skip
                   ─▶ agent job (read-only; skipped when scope = skip)
                        steps (scripted): npm ci --ignore-scripts · classify · baseline coverage · failing tests · scope
                        agent (Claude, firewalled): analyze scope → write tests → run & verify → report
                   ─▶ threat detection on the agent's output
                   ─▶ safe-outputs job (write): push test files only (allowlist) · add PR comment
```

## 0. Precautions: supply-chain review before running anything

The base repository was third-party code, so I reviewed it **before** installing dependencies or running anything. No `node_modules` were installed and no scripts were executed until this review was finished.

| Check | Result |
| --- | --- |
| Package sources (`package-lock.json`) | All 377 (backend) and 348 (frontend) entries resolve to `https://registry.npmjs.org` and carry `integrity` hashes. There are no git, URL or tarball dependencies. |
| Suspicious or typosquatted names | None. Every package is a well-known dependency of Express, Prisma, Vite, Vitest, Storybook, React or Testing Library. Versions are pinned exactly (`save-exact=true`). |
| Install-time scripts | `esbuild` and `prisma`/`@prisma/engines` download native binaries, and `fsevents` is macOS-only. `@scarf/scarf` (pulled in by `swagger-ui-express`) sends an install-time telemetry ping. It is not malicious, but it is avoidable: install with `SCARF_ANALYTICS=false`, and in CI use `npm ci --ignore-scripts` followed by an explicit `prisma generate`. |
| Application and config source | No `eval`, `new Function`, `child_process`, encoded payloads or unexpected network calls. The only external URLs are Google Fonts in `frontend/index.html`. `prisma.config.ts`, `vite.config.ts`, `vitest.config.ts` and `.storybook/*` contain only plain configuration. |
| Known vulnerabilities (`npm audit --package-lock-only`) | 21 advisories. Backend: 7 high and 5 moderate (Prisma transitive deps, `zod`, `body-parser`, `qs`, `fast-uri`, `vitest`). Frontend: 1 critical (Storybook dev server), 1 high (Vite dev server) and 7 moderate. These are published CVEs in legitimate packages, mostly in dev servers or DoS-class, and none of them is malware. I left them **unchanged** because dependency upgrades are out of scope for this task (see *Limitations*). |

**Verdict:** I found no indicators of malicious code, and the known CVEs are listed above. On that basis I installed and ran the project locally, with `SCARF_ANALYTICS=false`.

## 1. Technical decisions and rationale

| Decision | Why |
| --- | --- |
| **GitHub Agentic Workflows (gh-aw)** with the **Claude engine** | It runs natively on GitHub and compiles a Markdown spec into a hardened Actions workflow (network firewall, read-only agent job, threat detection, safe outputs). Claude Code understands custom agents and `SKILL.md` skills natively, so the same assets run locally and in CI. |
| **Scripts for exact facts** (`classify-changes.mjs`, `incremental-scope.mjs`, `uncovered-changed-lines.mjs`, `failing-tests.mjs`, `coverage-delta.mjs`) | Which files changed, which are testable, **which changed lines and branches the PR's tests leave uncovered** (git diff intersected with Vitest's lcov), which existing tests the PR breaks and how coverage moved must not depend on the model. Numbers in the PR comment come from scripts, never from the LLM. The scripts have their own fixture-based tests (`scripts/test/`, built-in `node:test`), run in `ci.yml`. |
| **The agent decides, rules constrain it** | The agent may decide that no tests are needed, which is a valid outcome, but it must give a reason for each file. Hard rules forbid weakening tests (`.skip`, `expect(true)`, snapshot-only tests, deleting assertions). |
| **Plan before code** | The agent writes a test plan first: scenarios with expected outcomes (happy path, edge and boundary values, error paths, UI states, async transitions), each tied to the changed lines it targets. The report traces every planned case to *added*, *already covered* or *dropped*. |
| **Verify before delivering** | Typecheck, a targeted run, a **quality review** of each new test (assertions that can fail, would catch a regression, not redundant, behaviour rather than implementation, boundary-only mocks, deterministic), the full suite with coverage thresholds and a re-run to catch flaky tests. A test that still fails after two fix attempts is dropped and reported. A test that exposes a real bug is removed and the bug is reported. Source code is never changed. |
| **Existing tests are human-owned** | The agent only adds cases, and changes an existing assertion only where the diff intentionally changes that behaviour. A scripted check lists every removed or changed line in pre-existing test files, and each one must be justified in the report. This protects manual edits, including edits to earlier bot-generated tests. |
| **Incremental runs after the first** | A deterministic `scope` job (no model) runs before the agent. It takes the checkpoint from GitHub's run history: the commit of the last *successful* run on this PR, not anything the model wrote. It compares the PR's own change per file then and now, so merges from `main` don't count, and it compares syntax trees (TypeScript compiler, no new dependency), so formatting and comment edits don't count. Nothing left → the agent job is skipped and costs no tokens. Otherwise the agent works only on the changed files, plus importers of a changed constant and files whose existing test now fails. A rebase or force-push, or a first run, means a full analysis. The full suite and the PR-wide coverage checks run every time. |
| **Tests pushed to the PR branch** via `push-to-pull-request-branch` | Results stay in the PR: a commit with the tests plus one report comment (older reports are hidden). |
| **Skills written for this repo**, not generic ones | They encode the real conventions (flat backend tests with `.ts` imports, co-located frontend tests, design-system mocks, `createQueryWrapper`, Prettier style), so generated tests look like the existing ones. |
| **One source of truth** for agent assets | `.github/agents` and `.github/skills` are canonical. `scripts/sync-agent-assets.mjs` mirrors them to `.claude/` for local use, and `--check` detects drift. |

**Security posture**

- The agent job only has `contents: read` and `pull-requests: read`. All writes happen in the separate safe-outputs job.
- gh-aw enforces the push allowlist (`allowed-files`: test files and fixtures only; `protected-files: blocked`). The agent can't change application code, configs, workflows or the agent and skill files, even if it tries.
- Network: the agent sandbox reaches only the Anthropic API, through gh-aw's API proxy. Package registries are blocked. Dependencies are installed beforehand with `npm ci --ignore-scripts`, plus an explicit `prisma generate`.
- Bash is restricted to an allowlist: read tools, `npm run`, `npx vitest/prettier/tsc` and read-only git.
- Fork PRs are blocked (gh-aw default), and `pull_request_target` is not used.
- PR title, body, commits, comments and diff are treated as untrusted data, and injection attempts are reported.
- Pushes use `GITHUB_TOKEN`, which can't trigger workflows, so the agent can't loop on its own commit.
- A separate plain `ci.yml` (no AI, `contents: read`, actions pinned by SHA) runs typecheck, tests and coverage thresholds on every PR push and on `main`, plus the skill-script tests and a check that the `.claude/` mirror matches `.github/`.
- The agent writes its report before the push happens, so a separate `finalize-report` job rewrites the report's *Commit* line afterwards with the real outcome from the publishing job: a link to the commit, "push failed – tests not applied" (and a failed status), or "none". It is the only extra job with write access (`pull-requests: write`), runs after threat detection, and runs only a script from the **base branch** (sparse checkout), never code from the PR.
- The `scope` job has `actions: read` and `pull-requests: read` to read run history and the link to the previous report (only its URL, never a comment body).
- Cost and time limits: a `paths:` filter, draft PRs skipped, the agent job skipped when the scope job finds nothing to analyse, `max-turns: 80`, `timeout-minutes: 30`, and `concurrency` cancelling superseded runs.

**When the PR changes after a run**

Every run works on the PR's latest head commit. Its checkpoint is the commit of the last successful run on this PR.

| Situation | Behaviour |
| --- | --- |
| Developer changes production code | `synchronize` triggers a new run on the new head. The agent analyses only the files whose PR change differs from the last successful run; the report links the previous report for the rest. |
| Developer reformats code or edits comments | Same syntax tree, so the scope job skips the agent. No tokens and no new comment; the previous report stays visible. |
| Developer merges `main` into the PR | `main`'s changes aren't the PR's, so they don't count. Without other changes the agent is skipped. |
| Developer rebases or force-pushes | The old checkpoint is no longer in the branch history, so a full analysis runs. |
| A later push breaks a test written earlier | The full suite runs on every analysed push, and the failing test's source file is added to the scope. |
| Developer pushes while a run is in progress | `concurrency` with `cancel-in-progress` cancels the older run, including its publishing job if it hasn't started, so results for an outdated commit aren't published. A cancelled run is not a checkpoint, so the next run also covers its changes. |
| Developer adds tests manually | They show up as `testsChanged` and in the coverage data. The agent reads them and doesn't duplicate them. |
| Developer edits tests the agent wrote earlier | Treated like any other existing test: preserved, never rewritten (see *Existing tests are human-owned*). |
| Only docs, config or other non-source files change | The `paths:` filter doesn't start the agent. `ci.yml` still runs. |
| Developer fixes a failing test | `ci.yml` validates it. The agent starts only if source files changed too. |
| The agent pushes its tests | Not a new trigger: `GITHUB_TOKEN` pushes don't start workflows, so there's no loop. The tests were verified inside the agent run (see Limitations). |
| Developer pushes again after the agent's commit | The agent's commit only adds tests, so it never counts as a source change. A new run analyses the developer's changes and sees the agent's earlier tests as existing tests. |

## 2. Prerequisites and how to run the PR workflow

**Prerequisites**

1. GitHub Actions enabled on the repository.
2. A repository secret `ANTHROPIC_API_KEY` (`gh aw secrets set ANTHROPIC_API_KEY`, or *Settings → Secrets and variables → Actions*).
3. To change the workflow: the [`gh` CLI](https://cli.github.com/) with the gh-aw extension (`gh extension install github/gh-aw`). Then run `gh aw compile` and commit both `unit-test-agent.md` and `unit-test-agent.lock.yml`.

**Running it**

- Open a pull request (not a draft) that changes `backend/src/**` or `frontend/src/**`. The *Unit Test Agent* workflow starts automatically and runs again on every push.
- Result: a report comment on the PR and, if tests were added, a commit `test: … [unit-test-agent]` on the PR branch.

**Running locally (Claude Code)**

```sh
node scripts/sync-agent-assets.mjs            # mirror .github/{agents,skills} -> .claude/
(cd backend && SCARF_ANALYTICS=false npm ci) && (cd frontend && SCARF_ANALYTICS=false npm ci)
claude "Use the unit-test-agent on the changes in this branch against origin/main"
node --test scripts/test/skill-scripts.test.mjs   # tests of the skill scripts
```

Locally, the agent first produces the same context files as the CI steps (`analyze-pr-changes` step 1), so both runs follow one procedure.

## 3. Where the custom agent and skills live, and how they are used

| Path | Role |
| --- | --- |
| `.github/agents/unit-test-agent.md` | The custom agent: role, operating procedure, decision policy (create / update / skip) and hard rules for security and correctness. The workflow imports it (`imports:`). |
| `.github/skills/analyze-pr-changes/` | Step 1. Reads the `changes.json` produced by `scripts/classify-changes.mjs` the changed-line coverage produced by `scripts/uncovered-changed-lines.mjs` and the failing tests from `scripts/failing-tests.mjs`, maps source files to test files, decides per file and plans test cases. Also has a backfill mode driven by coverage. |
| `.github/skills/backend-vitest-tests/` | Step 2a. Backend conventions and patterns: the router with a fake `TodoStore`, `createApp` with a fake `Database`, spies on the Prisma delegate, `vi.stubEnv` for config, `vi.mock` for modules with side effects. |
| `.github/skills/frontend-vitest-tests/` | Step 2b. Frontend conventions: design-system mocks, RTL query priority, `user-event`, TanStack Query hooks with `createQueryWrapper`, stubbing `fetch`. |
| `.github/skills/run-tests-and-coverage/` | Step 3. Targeted run → fix-or-drop loop (max 2 attempts) → quality review and the check that existing tests were preserved → typecheck and full suite with thresholds → re-run for flaky tests → coverage tables from `coverage-delta.mjs` and `uncovered-changed-lines.mjs`. |
| `.github/skills/report-test-results/` | Step 4. The PR report in a fixed format: decisions per file, test plan → result, changes to existing tests, verification, changed-line coverage, dropped tests and suspected bugs. |
| `.github/workflows/unit-test-agent.md` | The agentic workflow source. `unit-test-agent.lock.yml` is the compiled Actions workflow. |
| `scripts/finalize-report.mjs` | Used by the `finalize-report` job: replaces the report's *Commit* line with the real push outcome. |
| `scripts/sync-agent-assets.mjs` | Mirrors the agent and skills to `.claude/` for local use in Claude Code. |
| `.github/skills/analyze-pr-changes/scripts/incremental-scope.mjs` | Decides full / incremental / skip for each push (used by the `scope` job and the agent job). |
| `scripts/test/skill-scripts.test.mjs` | Fixture-based tests of the five skill scripts and `finalize-report.mjs` (fake diffs, lcov, Vitest results, coverage summaries and throwaway git repositories with real commit histories). |
| `.github/workflows/ci.yml` | Plain CI with no AI: typecheck, tests, coverage thresholds, the skill-script tests and the mirror drift check. |

In CI, gh-aw installs the five skills listed under `skills:` into the Claude Code skill directory before the agent starts, and imports the agent file into the prompt. Scripted steps first check out the PR head (the default `pull_request` checkout is the merge commit, whose line numbers wouldn't match the diff), then write `/tmp/gh-aw/context/{changes.json,diff.patch,failing-tests.json,changed-lines.json,baseline/*}`, so the agent starts from facts.

**How the agent knows what needs tests:**

1. **Git diff → file list** (`classify-changes.mjs`): testable source files vs. skipped ones (types, barrels, styles, configs, pure renames…), mapped to their existing test files (`.test.ts` or `.test.tsx`, and the old test file after a rename). A changed constants module makes the files that import it candidates. A test checks that every coverage exclude is also skipped.
2. **Changed lines × coverage** (`uncovered-changed-lines.mjs`): the PR's own tests run with coverage on the PR head, and the changed lines and branches they don't execute (including an implicit `else` that is never taken) are listed per file. These are the primary candidates.
3. **Existing tests the PR breaks** (`failing-tests.mjs`): the strongest signal of all. The agent updates the assertion if the diff changes that behaviour on purpose, and otherwise reports a suspected bug. Coverage is still recorded when tests fail (`--coverage.reportOnFailure`).
4. **Agent judgment**: it reads the diff, the whole source and the existing tests. Covered lines still need an assertion on the new behaviour, and uncovered lines that are unreachable by design are reported rather than forced.

The report shows changed-line coverage before and after the agent's tests.

## 4. Example run
_TODO: link the demo PR and paste the agent's decisions, skills used, test results and coverage table._

## 5. Assumptions

- Unit tests only (Vitest): no database, no network, no E2E tests. Prisma is faked at the delegate level.
- Pull requests come from branches of this repository. Fork PRs are out of scope (see Limitations).
- The existing tests set the standard; generated tests should match their style.
- The agent never modifies application code. It reports suspected bugs for a human to fix.
- Coverage thresholds guard against regressions: `backend/vitest.config.ts` keeps 100% for validators and mappers, and `frontend/vite.config.ts` now has a package-wide floor (90% statements, functions and lines, 85% branches) set after the backfill, which had no thresholds before. Coverage of *new* code is judged per changed line by the agent, not by a global percentage.

## 6. Limitations

- The `npm audit` advisories listed in section 0 are not fixed, because dependency upgrades are out of scope.
- **Fork PRs are not processed.** gh-aw blocks them by default, and pushing to a fork needs extra credentials.
- **`ci.yml` doesn't run on the agent's own commit**, because pushes made with `GITHUB_TOKEN` don't trigger workflows (this is also what prevents a loop). Those tests were verified inside the agent run, and CI runs again on the developer's next push. A GitHub App token or PAT (`github-token-for-extra-empty-commit`) would fix this, but it needs a guard so the agent doesn't react to its own commit.
- The baseline coverage step runs PR code outside the firewall, as ordinary CI does. That is acceptable only because fork PRs are excluded.
- Backend tests follow the flat `backend/tests/<module>.test.ts` convention, so two modules with the same file name in different feature folders (for example two `router.ts`) would map to the same test file. With one feature today this can't happen; a second feature would need `tests/<feature>/` folders.
- Constants are followed one level only: the files that import a changed constants module directly become candidates, files further down the import chain don't. Imports are matched as relative paths, which is all this repo uses (no path aliases).
- Coverage measures which code ran, not how good the assertions are. The agent is told to assert behaviour, but a human still has to review whether the tests are worth keeping.
- After the agent pushes to the PR branch, the author's local branch is behind and needs `git pull --rebase` before the next push.
- The skip decision runs before the test suite, so a push the scope job skips (formatting, docs, only non-testable files) gets no agent check of failing tests. `ci.yml` still runs the full suite on it.
- Re-running a workflow for a commit that was already analysed successfully is skipped. Push a new commit, or delete the earlier run, to force a new analysis.
- In an incremental run, files outside the scope whose coverage drops without a test failing aren't re-examined. The PR-wide changed-lines table in the report still shows it.
- LLM output varies between runs. The fixed report format, the scripts and the verification loop reduce that variation but don't remove it.
- The frontend's `npm run format:check` already fails on upstream files (for example `ApplicationHeader.test.tsx`), so the agent checks only the files it touched.

## 7. What I would change for production

- **Fewer mocks in page-level tests.** The existing `TodosPage.test.tsx` mocks all 12 collaborators (child components and hooks). That isolates the page's orchestration logic, but the tests break when the component tree changes (adding one child in the demo PR failed 12 tests with no user-visible bug), and the hand-written child mocks redeclare props that TypeScript can't check against the real components. I'd test pages with their real children, a real QueryClient and only `todosApi` mocked (still no network). I didn't rewrite the upstream file; the frontend skill now asks for this style in *new* page-level tests and keeps the existing file's style when extending it.

- Dependabot or Renovate, plus patch upgrades for the advisories in section 0.
- A GitHub App token for the push, so regular CI runs on the agent's commit, with a guard that skips the bot's own commits.
- Make `CI` a required status check through branch protection.
- A **revert check**: run each new test against the base version of the changed source. A test that also passes before the change proves nothing about the change.
- Run tests in random order (`--sequence.shuffle`) in the flaky-test re-run.
- Mutation testing (for example Stryker) on changed files, for a stronger quality signal than coverage.
- A `/test` slash command for on-demand runs, instead of running on every push.
- Cost tracking per run (`gh aw logs` / `gh aw audit`).
- Support for fork PRs through a two-stage flow (analysis without credentials, then a trusted job that posts the comment), if external contributions matter.
