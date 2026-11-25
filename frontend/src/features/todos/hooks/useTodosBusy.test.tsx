import { useMutation } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createQueryWrapper } from '../../../test/queryWrapper'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

// Wrap keys in objects: it.each would spread bare arrays into arguments.
it.each([
  { mutationKey: todoKeys.create },
  { mutationKey: todoKeys.update },
  { mutationKey: todoKeys.delete },
])(
  'is busy while a $mutationKey mutation is running',
  async ({ mutationKey }) => {
    const { wrapper } = createQueryWrapper()
    const pending = deferred()
    const { result } = renderHook(
      () => ({
        busy: useTodosBusy(),
        mutation: useMutation({
          mutationKey,
          mutationFn: () => pending.promise,
        }),
      }),
      { wrapper },
    )
    expect(result.current.busy).toBe(false)
    act(() => result.current.mutation.mutate())
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => pending.resolve())
    await waitFor(() => expect(result.current.busy).toBe(false))
  },
)

it('ignores mutations outside the todos key space', async () => {
  const { wrapper } = createQueryWrapper()
  const pending = deferred()
  const { result } = renderHook(
    () => ({
      busy: useTodosBusy(),
      mutation: useMutation({
        mutationKey: ['profile', 'update'],
        mutationFn: () => pending.promise,
      }),
    }),
    { wrapper },
  )
  act(() => result.current.mutation.mutate())
  await waitFor(() => expect(result.current.mutation.isPending).toBe(true))
  expect(result.current.busy).toBe(false)
  await act(async () => pending.resolve())
})
