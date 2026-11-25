import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { DUE_SOON_DAYS } from '../constants'
import { useTodoSummaryQuery } from './useTodoSummaryQuery'

vi.mock('../api/todos', () => ({ todosApi: { summary: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const summary = { total: 4, open: 3, completed: 1, overdue: 1, dueSoon: 2 }

it('loads the summary for the default due-soon window', async () => {
  const { client, wrapper } = createQueryWrapper()
  vi.mocked(todosApi.summary).mockResolvedValue(summary)
  const { result } = renderHook(() => useTodoSummaryQuery(), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual(summary)
  expect(todosApi.summary).toHaveBeenCalledWith(
    DUE_SOON_DAYS,
    expect.any(AbortSignal),
  )
  expect(client.getQueryData(todoKeys.summary(DUE_SOON_DAYS))).toEqual(summary)
})

it('uses a custom window as both request argument and cache key', async () => {
  const { client, wrapper } = createQueryWrapper()
  vi.mocked(todosApi.summary).mockResolvedValue(summary)
  const { result } = renderHook(() => useTodoSummaryQuery(7), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(todosApi.summary).toHaveBeenCalledWith(7, expect.any(AbortSignal))
  expect(client.getQueryData(todoKeys.summary(7))).toEqual(summary)
})

it('exposes the error when loading fails', async () => {
  const { wrapper } = createQueryWrapper()
  vi.mocked(todosApi.summary).mockRejectedValue(new Error('Server down'))
  const { result } = renderHook(() => useTodoSummaryQuery(), { wrapper })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('Server down')
})
