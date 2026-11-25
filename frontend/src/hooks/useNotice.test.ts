import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

it('starts without a notice and exposes a notification callback', () => {
  const { result } = renderHook(() => useNotice())
  expect(result.current.message).toBe('')
  expect(result.current.notify).toEqual(expect.any(Function))
})

describe('with fake timers', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a notice and clears it after four seconds', () => {
    const { result } = renderHook(() => useNotice())
    act(() => result.current.notify('Task deleted.'))
    expect(result.current.message).toBe('Task deleted.')
    act(() => vi.advanceTimersByTime(3999))
    expect(result.current.message).toBe('Task deleted.')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.message).toBe('')
  })

  it('restarts the timeout when a new notice replaces the current one', () => {
    const { result } = renderHook(() => useNotice())
    act(() => result.current.notify('First'))
    act(() => vi.advanceTimersByTime(3000))
    act(() => result.current.notify('Second'))
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.message).toBe('Second')
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.message).toBe('')
  })

  it('keeps a stable notify callback and cancels the timeout on unmount', () => {
    const { result, rerender, unmount } = renderHook(() => useNotice())
    const notify = result.current.notify
    act(() => result.current.notify('Saved'))
    rerender()
    expect(result.current.notify).toBe(notify)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
