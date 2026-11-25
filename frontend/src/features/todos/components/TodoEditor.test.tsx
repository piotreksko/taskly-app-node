import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    initial,
    busy,
    error,
    onSubmit,
    onCancel,
  }: {
    initial?: TodoInput
    busy: boolean
    error: string | null
    onSubmit: (input: TodoInput) => Promise<void>
    onCancel: () => void
  }) => (
    <>
      <p>Initial: {initial ? initial.title : 'none'}</p>
      {busy && <p>Form busy</p>}
      {error && <p>Form error: {error}</p>}
      <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
      <button onClick={onCancel}>Cancel form</button>
    </>
  ),
}))

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

function mockMutations({
  create = {},
  update = {},
}: {
  create?: Record<string, unknown>
  update?: Record<string, unknown>
}) {
  const createTodo = { isPending: false, error: null, mutateAsync: vi.fn() }
  const updateTodo = { isPending: false, error: null, mutateAsync: vi.fn() }
  Object.assign(createTodo, create)
  Object.assign(updateTodo, update)
  vi.mocked(useCreateTodoMutation).mockReturnValue(
    createTodo as unknown as ReturnType<typeof useCreateTodoMutation>,
  )
  vi.mocked(useUpdateTodoMutation).mockReturnValue(
    updateTodo as unknown as ReturnType<typeof useUpdateTodoMutation>,
  )
  return { create: createTodo.mutateAsync, update: updateTodo.mutateAsync }
}

it('updates an existing task by id and reports saved changes', async () => {
  const user = userEvent.setup()
  const { create, update } = mockMutations({
    update: { mutateAsync: vi.fn().mockResolvedValue(todoFixture) },
  })
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  expect(screen.getByText(`Initial: ${todoFixture.title}`)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: todoFixture,
  })
  expect(create).not.toHaveBeenCalled()
})

it('starts a new task form without initial values', () => {
  mockMutations({})
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('Initial: none')).toBeVisible()
})

it('keeps the editor open and does not report success when saving fails', async () => {
  const user = userEvent.setup()
  const { update } = mockMutations({
    update: { mutateAsync: vi.fn().mockRejectedValue(new Error('Nope')) },
  })
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await expect(update.mock.results[0].value).rejects.toThrow('Nope')
  expect(onSaved).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('shows the error of the mutation that matches the editor mode', () => {
  mockMutations({
    create: { error: new Error('Could not create.') },
    update: { error: new Error('Could not update.') },
  })
  const { rerender } = render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  expect(screen.getByText('Form error: Could not update.')).toBeVisible()
  expect(screen.queryByText(/Could not create/)).not.toBeInTheDocument()
  rerender(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('Form error: Could not create.')).toBeVisible()
  expect(screen.queryByText(/Could not update/)).not.toBeInTheDocument()
})

it.each([
  ['the save is pending', false, true],
  ['another task operation is running', true, false],
])('ignores submissions while %s', async (_, busy, isPending) => {
  const user = userEvent.setup()
  const { create } = mockMutations({ create: { isPending } })
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={busy} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByText('Form busy')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('ignores the pending state of the other mutation', () => {
  mockMutations({ update: { isPending: true } })
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.queryByText('Form busy')).not.toBeInTheDocument()
})

it('closes from the form cancel button', async () => {
  const user = userEvent.setup()
  mockMutations({})
  const onClose = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={onClose} onSaved={vi.fn()} />,
  )
  await user.click(screen.getByRole('button', { name: 'Cancel form' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
