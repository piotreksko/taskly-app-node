import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useTodoSummaryQuery } from '../hooks/useTodoSummaryQuery'
import type { TodoSummary } from '../types'
import { TodoSummaryBar } from './TodoSummaryBar'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useTodoSummaryQuery', () => ({
  useTodoSummaryQuery: vi.fn(),
}))

function mockQuery(state: {
  isPending?: boolean
  isError?: boolean
  data?: TodoSummary
}) {
  vi.mocked(useTodoSummaryQuery).mockReturnValue({
    isPending: false,
    isError: false,
    ...state,
  } as unknown as ReturnType<typeof useTodoSummaryQuery>)
}

const summary: TodoSummary = {
  total: 5,
  open: 4,
  completed: 1,
  overdue: 0,
  dueSoon: 0,
}

it('shows a loading status while the summary is pending', () => {
  mockQuery({ isPending: true })
  render(<TodoSummaryBar />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading summary…')
})

it('renders nothing when the summary fails to load', () => {
  mockQuery({ isError: true })
  const { container } = render(<TodoSummaryBar />)
  expect(container).toBeEmptyDOMElement()
})

it('renders nothing when there are no tasks', () => {
  mockQuery({ data: { ...summary, total: 0, open: 0, completed: 0 } })
  const { container } = render(<TodoSummaryBar />)
  expect(container).toBeEmptyDOMElement()
})

it('shows only the open count when nothing is overdue or due soon', () => {
  mockQuery({ data: summary })
  render(<TodoSummaryBar />)
  const region = screen.getByRole('region', { name: 'Task summary' })
  expect(region).toHaveTextContent('4 open of 5')
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  expect(screen.queryByText(/due in the next/)).not.toBeInTheDocument()
  expect(screen.queryByText(/done/)).not.toBeInTheDocument()
})

it('shows the overdue badge when tasks are overdue', () => {
  mockQuery({ data: { ...summary, overdue: 2 } })
  render(<TodoSummaryBar />)
  expect(screen.getByText('2 overdue')).toBeVisible()
  expect(screen.queryByText(/due in the next/)).not.toBeInTheDocument()
})

it('shows the due-soon badge with the window length', () => {
  mockQuery({ data: { ...summary, dueSoon: 3 } })
  render(<TodoSummaryBar />)
  expect(screen.getByText('3 due in the next 3 days')).toBeVisible()
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
})

it('celebrates when every task is done', () => {
  mockQuery({ data: { ...summary, open: 0, completed: 5 } })
  render(<TodoSummaryBar />)
  expect(screen.getByText('All 5 done')).toBeVisible()
  expect(
    screen.getByRole('region', { name: 'Task summary' }),
  ).toHaveTextContent('0 open of 5')
})
