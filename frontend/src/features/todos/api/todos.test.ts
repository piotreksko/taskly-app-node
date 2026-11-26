import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('passes the abort signal when fetching tasks', async () => {
  const signal = new AbortController().signal
  vi.mocked(request).mockResolvedValue([todoFixture])
  await expect(todosApi.list(signal)).resolves.toEqual([todoFixture])
  expect(request).toHaveBeenCalledWith('/todos', { signal })
})

it('fetches the task summary for a window and passes the abort signal', async () => {
  const signal = new AbortController().signal
  const summary = { total: 3, open: 2, completed: 1, overdue: 1, dueSoon: 1 }
  vi.mocked(request).mockResolvedValue(summary)
  await expect(todosApi.summary(5, signal)).resolves.toEqual(summary)
  expect(request).toHaveBeenCalledWith('/todos/summary?days=5', { signal })
})

it('sends only writable task fields on creation', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.create(todoFixture)).resolves.toEqual(todoFixture)
  expect(request).toHaveBeenCalledWith('/todos', {
    method: 'POST',
    body: JSON.stringify({
      title: todoFixture.title,
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    }),
  })
})

it('sends only the provided writable fields on update', async () => {
  const saved = { ...todoFixture, completed: true }
  vi.mocked(request).mockResolvedValue(saved)
  await expect(todosApi.update(7, { completed: true })).resolves.toEqual(saved)
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  })
})

it('strips read-only fields when updating from a full task', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await todosApi.update(todoFixture.id, todoFixture)
  const body = JSON.parse(
    vi.mocked(request).mock.calls[0][1]?.body as string,
  ) as Record<string, unknown>
  expect(body).toEqual({
    title: todoFixture.title,
    description: '',
    priority: 'medium',
    due_date: null,
    completed: false,
  })
})

it('deletes a task by id', async () => {
  vi.mocked(request).mockResolvedValue(undefined)
  await expect(todosApi.remove(7)).resolves.toBeUndefined()
  expect(request).toHaveBeenCalledWith('/todos/7', { method: 'DELETE' })
})
