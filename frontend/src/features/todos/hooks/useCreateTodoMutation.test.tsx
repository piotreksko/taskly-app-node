import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

it('invalidates the cached summaries after creating a task', async () => {
  const { client, wrapper } = createQueryWrapper()
  client.setQueryData(todoKeys.summary(3), { total: 0 })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.summaries })
  expect(client.getQueryState(todoKeys.summary(3))?.isInvalidated).toBe(true)
})

it('prepends the created task to the cached list', async () => {
  const { client, wrapper } = createQueryWrapper()
  const older: Todo = { ...todoFixture, id: 1 }
  const saved: Todo = { ...todoFixture, id: 8, title: 'New task' }
  client.setQueryData(todoKeys.list, [older])
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(saved))
  expect(todosApi.create).toHaveBeenCalledWith(saved)
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, older])
})

it('replaces a duplicate of the saved task instead of listing it twice', async () => {
  const { client, wrapper } = createQueryWrapper()
  const saved: Todo = { ...todoFixture, title: 'Renamed by server' }
  client.setQueryData(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  expect(client.getQueryData(todoKeys.list)).toEqual([saved])
})

it('seeds an empty cache with the created task', async () => {
  const { client, wrapper } = createQueryWrapper()
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('cancels an in-flight list refetch before writing the server response', async () => {
  const { client, wrapper } = createQueryWrapper()
  const cancel = vi.spyOn(client, 'cancelQueries')
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
})

it('leaves the cache untouched and exposes the error when creation fails', async () => {
  const { client, wrapper } = createQueryWrapper()
  client.setQueryData(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.create).mockRejectedValue(new Error('Server down'))
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() =>
    expect(result.current.mutateAsync(todoFixture)).rejects.toThrow(
      'Server down',
    ),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  expect(result.current.error?.message).toBe('Server down')
})
