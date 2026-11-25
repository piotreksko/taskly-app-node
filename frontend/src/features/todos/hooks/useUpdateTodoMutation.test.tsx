import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

it('sends the partial input and replaces only the saved task in the cache', async () => {
  const { client, wrapper } = createQueryWrapper()
  const other: Todo = { ...todoFixture, id: 1, title: 'Other' }
  const saved: Todo = { ...todoFixture, completed: true }
  client.setQueryData(todoKeys.list, [todoFixture, other])
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    result.current.mutateAsync({
      id: todoFixture.id,
      input: { completed: true },
    }),
  )
  expect(todosApi.update).toHaveBeenCalledWith(todoFixture.id, {
    completed: true,
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, other])
})

it('does not create a list when nothing is cached yet', async () => {
  const { client, wrapper } = createQueryWrapper()
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    result.current.mutateAsync({ id: todoFixture.id, input: { title: 'x' } }),
  )
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('invalidates every cached summary after a successful update', async () => {
  const { client, wrapper } = createQueryWrapper()
  client.setQueryData(todoKeys.summary(3), { total: 1 })
  client.setQueryData(todoKeys.summary(7), { total: 1 })
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    result.current.mutateAsync({ id: todoFixture.id, input: { title: 'x' } }),
  )
  expect(client.getQueryState(todoKeys.summary(3))?.isInvalidated).toBe(true)
  expect(client.getQueryState(todoKeys.summary(7))?.isInvalidated).toBe(true)
})

it('keeps summaries valid when the update fails', async () => {
  const { client, wrapper } = createQueryWrapper()
  client.setQueryData(todoKeys.summary(3), { total: 1 })
  vi.mocked(todosApi.update).mockRejectedValue(new Error('Task not found.'))
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    expect(
      result.current.mutateAsync({ id: 7, input: { completed: true } }),
    ).rejects.toThrow('Task not found.'),
  )
  expect(client.getQueryState(todoKeys.summary(3))?.isInvalidated).toBe(false)
})

it('keeps the cached task when the update fails', async () => {
  const { client, wrapper } = createQueryWrapper()
  client.setQueryData(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.update).mockRejectedValue(new Error('Task not found.'))
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    expect(
      result.current.mutateAsync({ id: 7, input: { completed: true } }),
    ).rejects.toThrow('Task not found.'),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
