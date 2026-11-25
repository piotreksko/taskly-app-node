---
name: react-component-tests
description: Conventions and ready patterns for unit-testing the Taskly frontend – React 19 components, TanStack Query hooks, utilities and the fetch wrapper – with Vitest, jsdom, React Testing Library and user-event. Use when creating or updating frontend/src/**/*.test.ts(x).
---

# Frontend unit tests (Vitest + React Testing Library)

## Conventions (follow exactly)

- Location: **co-located** next to the subject: `TodoItem.tsx` → `TodoItem.test.tsx`, `todos.ts` → `todos.test.ts`.
- Imports without extensions: `import { TodoItem } from './TodoItem'`.
- Import test APIs explicitly: `import { expect, it, vi, beforeEach } from 'vitest'`.
- Setup already loaded (`src/test/setup.ts`): jest-dom matchers + `cleanup` after each test.
- Fixture: `todoFixture` from `src/test/todoFixture.ts` – spread to vary it (`{ ...todoFixture, completed: true }`).
- Formatting: Prettier config of the repo – **no semicolons**, single quotes, trailing commas, 80 cols. Run `npx prettier --write <file>` on files you create/modify.
- Query priority: `getByRole` (with `name`) > `getByLabelText` > `getByText` > `getByTestId`. Interactions via `const user = userEvent.setup()` and `await user.click(...)` – not `fireEvent`.
- Assert visible behaviour (`toBeVisible`, `toHaveTextContent`, `toBeDisabled`, callbacks `toHaveBeenCalledWith`) – not implementation details or snapshots.

## Patterns

### Components – mock the design system

Design-system components are styled-components; tests replace them with lightweight native-element mocks:

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
```

(`mocks.tsx` strips design props, renders `Alert` with `data-testid="alert"`, `Drawer` as `role="dialog"`, etc.). Adjust the relative path to the test location. Icons from `lucide-react` render fine as-is.

When a component composes heavy children, mock them like `TodosPage.test.tsx` does (`vi.mock('./components/TodoList', () => ({ TodoList: () => <p>Task list</p> }))`) and assert the props/branches of the unit under test.

### Hooks using TanStack Query – real QueryClient, mocked API

Use the shared helper `src/test/queryWrapper.tsx` – it returns a fresh, retry-free client per call:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { todosApi } from '../api/todos'
import { todoKeys } from '../api/queryKeys'
import { createQueryWrapper } from '../../../test/queryWrapper'

vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }))

const { client, wrapper } = createQueryWrapper() // call inside each test
const { result } = renderHook(() => useTodosQuery(), { wrapper })
```

Seed cache with `client.setQueryData(todoKeys.list, [todoFixture])`, run `await result.current.mutateAsync(...)` inside `act` or wait with `waitFor`, then assert `client.getQueryData(todoKeys.list)`. Use a fresh client per test (no shared cache). Hook test files that contain JSX must be `.test.tsx`.

### Plain hooks / utils

`renderHook(() => useTodoFilters(todos))` + `act(() => result.current.setFilter('completed'))`. Utilities are pure – use `it.each` tables. For date logic use `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))` and `vi.useRealTimers()` in `afterEach`.

### `lib/http.ts` – stub `fetch`

```ts
const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => vi.unstubAllGlobals())
fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }))
```

Cover: success JSON, 204 → `undefined`, 422 message, `detail` string from body, non-JSON error body fallback, network failure message, aborted signal rethrow.

### Mocking a module's own export

`vi.mock` is hoisted; reference mocked functions through the imported binding with `vi.mocked(fn).mockReturnValue(...)` (see `TodosPage.test.tsx`). Cast partial query results `as unknown as ReturnType<typeof useTodosQuery>`.

## Don'ts

- No tests for `src/design-system/**`, `*.stories.tsx`, `types.ts`, `index.ts`, `main.tsx`, `queryKeys.ts`, `queryClient.ts` (excluded from coverage).
- No real network, no `setTimeout` sleeps, no reliance on CSS or styled-components output.
- Don't `getByTestId` when an accessible role/name exists.

Run: `cd frontend && npx vitest run src/path/to/File.test.tsx`, then `npm run typecheck`.
