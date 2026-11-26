import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useTodoSummaryQuery } from './useTodoSummaryQuery'

vi.mock('../api/todos', () => ({ todosApi: { summary: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const summary = { total: 3, open: 2, completed: 1, overdue: 1, dueSoon: 1 }

it('loads the summary for the default window and caches it', async () => {
  vi.mocked(todosApi.summary).mockResolvedValue(summary)
  const { client, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodoSummaryQuery(), { wrapper })
  await waitFor(() => expect(result.current.data).toEqual(summary))
  expect(todosApi.summary).toHaveBeenCalledWith(3, expect.any(AbortSignal))
  expect(client.getQueryData(todoKeys.summary(3))).toEqual(summary)
})

it('uses the requested window', async () => {
  vi.mocked(todosApi.summary).mockResolvedValue(summary)
  const { client, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodoSummaryQuery(7), { wrapper })
  await waitFor(() => expect(result.current.data).toEqual(summary))
  expect(todosApi.summary).toHaveBeenCalledWith(7, expect.any(AbortSignal))
  expect(client.getQueryData(todoKeys.summary(7))).toEqual(summary)
})

it('exposes a failure', async () => {
  vi.mocked(todosApi.summary).mockRejectedValue(new Error('Unavailable'))
  const { wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodoSummaryQuery(), { wrapper })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('Unavailable')
})
