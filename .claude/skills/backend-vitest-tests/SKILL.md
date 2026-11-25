---
name: backend-vitest-tests
description: Conventions and ready patterns for writing unit tests for the Taskly backend (Express 5 routers, Zod validators, mappers, Prisma repository, config/bootstrap) with Vitest and Supertest, without a real database. Use when creating or updating files in backend/tests.
---

# Backend unit tests (Vitest + Supertest)

## Conventions (follow exactly)

- Location: **flat** `backend/tests/<module>.test.ts` (e.g. `src/core/config.ts` → `tests/config.test.ts`). Vitest only collects `tests/**/*.test.ts`.
- Imports from source use the **`.ts` extension**: `import { createApp } from '../src/factory.ts';` (ESM, `allowImportingTsExtensions`).
- Import test APIs explicitly: `import { it, expect, vi, afterEach } from 'vitest';` (no globals in backend).
- Style: top-level `it(...)` blocks, `it.each` for tables, a local `setup()` helper returning what the test needs. Short, behaviour-named titles (`'rejects invalid create input without calling the repository: %j'`).
- Shared data: `tests/fixture.ts` exports `record` (Prisma row, `Date` fields) and `todo` (API JSON). Extend it rather than inventing new fixtures inline when the shape is reused.
- Formatting: single quotes, semicolons, 2-space indent (match existing backend tests).
- Restore spies: `afterEach(() => vi.restoreAllMocks());` when using `vi.spyOn`.

## Patterns

### Router (HTTP layer) – fake the `TodoStore`

The router depends on the `TodoStore` interface, so pass a plain object of `vi.fn()`s – no DB, no Prisma:

```ts
import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
```

Assert status **and** body **and** repository calls (`toHaveBeenCalledWith`, `not.toHaveBeenCalled()` on 422 paths).

### Whole app (`createApp`) – fake the `Database`

`createApp(database)` needs only `database.todo` for routers/health. Cast a minimal fake:

```ts
import type { Database } from '../src/features/todos/types.ts';
const database = { todo: { findFirst: vi.fn().mockResolvedValue({ id: 1 }), findMany: vi.fn().mockResolvedValue([]) } } as unknown as Database;
const app = createApp(database);
```

Use this for 404 fallback, JSON parse errors (`.set('Content-Type', 'application/json').send('{bad')` → 422), body too large (> 100 kb → 413), unexpected errors → 500 (silence `console.error` with `vi.spyOn(console, 'error').mockImplementation(() => {})` and assert it was called), `/openapi.json`, health endpoint.

### Repository – real Prisma delegate, mocked IO

Follow `tests/repository.test.ts`: `createDatabase('postgresql://test:test@localhost:5432/test')` constructs a client without connecting; `vi.spyOn(database.todo, 'findMany').mockResolvedValue([record])`. Assert the exact Prisma query arguments.

### Validators / mappers – pure functions

Table-driven `it.each` over valid and invalid inputs; use `schema.safeParse(x).success`. Existing thresholds require **100%** for `validators.ts` and `mappers.ts` – any change there must keep it.

### Config / environment

`config.ts` reads `process.env` and calls `dotenv.config` at import. Use `vi.stubEnv(name, value)` + `afterEach(() => vi.unstubAllEnvs())`. Stub every variable the branch reads; use `vi.stubEnv('DATABASE_URL', '')` to force the fallback path. Never depend on a developer's real `.env`.

### Modules with side effects (database, lifespan)

Mock collaborators with `vi.mock` **before** importing the subject (calls are hoisted):

```ts
vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));
const { start } = await import('../src/core/lifespan.ts');
```

For `@prisma/adapter-pg` / generated client, mock the module and assert constructor arguments. For servers, listen on port `0` (`vi.stubEnv('API_PORT', '0')`) and always `server.close()` in the test. For `process.once('SIGTERM', …)` capture the handler via `vi.spyOn(process, 'once')` instead of sending real signals; stub `process.exit` with `vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)`.

## Don'ts

- No real PostgreSQL, no network, no `setTimeout` waits – use fake timers.
- Don't test `src/generated/**` or `types.ts` (excluded from coverage). `main.ts` is only a two-line entry point that calls `start()` – test `lifespan.ts` instead; `main.ts` is the one file allowed to stay uncovered.
- Don't loosen types with `any`; prefer `as unknown as T` for intentional partial fakes.

Run: `cd backend && npx vitest run tests/<file>.test.ts` then `npm run typecheck` (tests are type-checked too).
