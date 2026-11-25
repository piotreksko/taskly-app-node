import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: ({
    hasTodos,
    disabled,
    onCreate,
  }: {
    hasTodos: boolean
    disabled: boolean
    onCreate: () => void
  }) => (
    <button disabled={disabled} onClick={onCreate}>
      {hasTodos ? 'No matching tasks' : 'Empty task list'}
    </button>
  ),
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    todo,
    busy,
    onToggle,
    onEdit,
    onDelete,
  }: {
    todo: Todo
    busy: boolean
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      {todo.title}
      <button disabled={busy} onClick={onToggle}>
        Toggle {todo.title}
      </button>
      <button disabled={busy} onClick={onEdit}>
        Edit {todo.title}
      </button>
      <button disabled={busy} onClick={onDelete}>
        Delete {todo.title}
      </button>
    </li>
  ),
}))

function baseProps() {
  return {
    todos: [] as Todo[],
    hasTodos: false,
    loading: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
}

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('explains that the list is unavailable when loading failed with no tasks', () => {
  render(<TodoList {...baseProps()} failed />)
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(screen.getByText('Try again to load your tasks.')).toBeVisible()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('keeps showing previously loaded tasks when a refetch failed', () => {
  render(<TodoList {...baseProps()} todos={[todoFixture]} hasTodos failed />)
  expect(screen.getByRole('listitem')).toHaveTextContent(todoFixture.title)
  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
})

it('renders one item per task and forwards actions with that task', async () => {
  const user = userEvent.setup()
  const second: Todo = { ...todoFixture, id: 8, title: 'Review the plan' }
  const props = baseProps()
  render(<TodoList {...props} todos={[todoFixture, second]} hasTodos />)
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await user.click(
    screen.getByRole('button', { name: 'Toggle Review the plan' }),
  )
  await user.click(
    screen.getByRole('button', { name: `Edit ${todoFixture.title}` }),
  )
  await user.click(
    screen.getByRole('button', { name: 'Delete Review the plan' }),
  )
  expect(props.onToggle).toHaveBeenCalledWith(second)
  expect(props.onEdit).toHaveBeenCalledWith(todoFixture)
  expect(props.onDelete).toHaveBeenCalledWith(second)
})

it('passes the busy state down to items', () => {
  render(<TodoList {...baseProps()} todos={[todoFixture]} hasTodos busy />)
  expect(
    screen.getByRole('button', { name: `Toggle ${todoFixture.title}` }),
  ).toBeDisabled()
})

it('shows the filtered empty state with busy and create wiring', async () => {
  const user = userEvent.setup()
  const props = baseProps()
  const { rerender } = render(<TodoList {...props} hasTodos />)
  expect(
    screen.getByRole('button', { name: 'No matching tasks' }),
  ).toBeVisible()
  rerender(<TodoList {...props} busy />)
  expect(screen.getByRole('button', { name: 'Empty task list' })).toBeDisabled()
  rerender(<TodoList {...props} />)
  await user.click(screen.getByRole('button', { name: 'Empty task list' }))
  expect(props.onCreate).toHaveBeenCalledTimes(1)
})
