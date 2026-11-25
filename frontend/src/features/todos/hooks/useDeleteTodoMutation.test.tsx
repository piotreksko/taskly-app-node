import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

it('invalidates the cached summaries after deleting a task', async () => {
  const { client, wrapper } = createQueryWrapper()
  client.setQueryData(todoKeys.summary(3), { total: 0 })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture.id))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.summaries })
  expect(client.getQueryState(todoKeys.summary(3))?.isInvalidated).toBe(true)
})

it('removes the deleted task from the cached list', async () => {
  const { client, wrapper } = createQueryWrapper()
  const other: Todo = { ...todoFixture, id: 1 }
  client.setQueryData(todoKeys.list, [todoFixture, other])
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture.id))
  expect(todosApi.remove).toHaveBeenCalledWith(todoFixture.id)
  expect(client.getQueryData(todoKeys.list)).toEqual([other])
})

it('tolerates an empty cache', async () => {
  const { client, wrapper } = createQueryWrapper()
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(1))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('keeps the task cached when deletion fails', async () => {
  const { client, wrapper } = createQueryWrapper()
  client.setQueryData(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Could not delete.'))
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  await act(() =>
    expect(result.current.mutateAsync(todoFixture.id)).rejects.toThrow(
      'Could not delete.',
    ),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
