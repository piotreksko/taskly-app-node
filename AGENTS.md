# AGENTS.md

Guidance for AI coding agents working in this repository.

## Layout

- `backend/` – Node 22, Express 5, Prisma 7 (PostgreSQL), Zod. Tests: `backend/tests/*.test.ts` (Vitest + Supertest), flat folder, imports with `.ts` extension.
- `frontend/` – React 19, Vite, TanStack Query, styled-components. Tests co-located: `src/**/*.test.ts(x)` (Vitest + jsdom + React Testing Library).
- `.github/agents/unit-test-agent.md` – the custom unit-test agent.
- `.github/skills/*/SKILL.md` – its reusable skills (mirrored to `.claude/` by `node scripts/sync-agent-assets.mjs`; edit only the `.github/` copy).
- `.github/workflows/unit-test-agent.md` – the GitHub Agentic Workflow (compile with `gh aw compile`).

## Commands

```sh
cd backend  && npm ci && npm run typecheck && npm run test:coverage
cd frontend && npm ci && npm run typecheck && npm run test:coverage && npm run format:check
node --test scripts/test/skill-scripts.test.mjs   # tests of the agent's skill scripts
```

Install with `SCARF_ANALYTICS=false` to skip the `@scarf/scarf` install-time telemetry ping. Unit tests need no database.

## Rules for test work

- Unit tests only; no real network or database; fake time with `vi.setSystemTime`.
- Don't modify application code when the task is writing tests; report suspected bugs instead.
- Never weaken or skip tests to make them pass. No new dependencies.
- Coverage thresholds live in `backend/vitest.config.ts` (100% for validators and mappers) and `frontend/vite.config.ts` (package-wide floor).
