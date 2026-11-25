import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('forwards toggle and delete requests', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={vi.fn()}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  await user.click(
    screen.getByRole('checkbox', { name: `Complete: ${todoFixture.title}` }),
  )
  expect(onToggle).toHaveBeenCalledTimes(1)
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  )
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('disables every action while busy', () => {
  render(
    <TodoItem
      todo={todoFixture}
      busy
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  ).toBeDisabled()
})

it('hides the description and due date when they are empty', () => {
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.queryByText(/2026/)).not.toBeInTheDocument()
  expect(screen.getByRole('listitem')).toHaveTextContent(
    `${todoFixture.title}#7To doMedium`,
  )
})

describe('with a fixed current date', () => {
  afterEach(() => vi.useRealTimers())

  function renderAt(todo: typeof todoFixture) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0))
    render(
      <TodoItem
        todo={todo}
        busy={false}
        onEdit={vi.fn()}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
  }

  it('marks an active task with a past due date as overdue', () => {
    renderAt({ ...todoFixture, due_date: '2026-10-01' })
    expect(screen.getByText('1 Oct 2026 · overdue')).toBeVisible()
  })

  it('shows a future due date without the overdue marker', () => {
    renderAt({ ...todoFixture, due_date: '2026-10-20' })
    expect(screen.getByText('20 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  })

  it.each([
    ['2026-10-10', '10 Oct 2026 · due today'],
    ['2026-10-11', '11 Oct 2026 · due tomorrow'],
    ['2026-10-13', '13 Oct 2026 · due in 3 days'],
  ])('labels an upcoming due date %s as due soon', (due_date, text) => {
    renderAt({ ...todoFixture, due_date })
    expect(screen.getByText(text)).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  })

  it('shows a due date beyond the due-soon window without a label', () => {
    renderAt({ ...todoFixture, due_date: '2026-10-14' })
    expect(screen.getByText('14 Oct 2026')).toBeVisible()
    expect(
      screen.queryByText(/due (today|tomorrow|in)/),
    ).not.toBeInTheDocument()
  })

  it('shows a completed task with its description and no overdue marker', () => {
    renderAt({
      ...todoFixture,
      completed: true,
      priority: 'high',
      description: 'Slides and\nnotes',
      due_date: '2026-10-01',
    })
    expect(screen.getByText('Completed')).toBeVisible()
    expect(screen.getByText('High')).toBeVisible()
    expect(screen.getByText(/Slides and/)).toBeVisible()
    expect(screen.getByText('1 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', {
        name: `Mark as active: ${todoFixture.title}`,
      }),
    ).toBeChecked()
  })
})
