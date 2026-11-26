import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useTodoSummaryQuery } from '../hooks/useTodoSummaryQuery'
import type { TodoSummary } from '../types'
import { TodoSummaryBar } from './TodoSummaryBar'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useTodoSummaryQuery', () => ({
  useTodoSummaryQuery: vi.fn(),
}))

function mockQuery(query: Record<string, unknown>) {
  vi.mocked(useTodoSummaryQuery).mockReturnValue({
    isPending: false,
    isError: false,
    data: undefined,
    ...query,
  } as unknown as ReturnType<typeof useTodoSummaryQuery>)
}

function mockSummary(overrides: Partial<TodoSummary>) {
  mockQuery({
    data: {
      total: 4,
      open: 3,
      completed: 1,
      overdue: 0,
      dueSoon: 0,
      ...overrides,
    },
  })
}

it('shows a loading status while the summary is pending', () => {
  mockQuery({ isPending: true })
  render(<TodoSummaryBar />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading summary…')
})

it('renders nothing when the summary failed to load', () => {
  mockQuery({ isError: true })
  const { container } = render(<TodoSummaryBar />)
  expect(container).toBeEmptyDOMElement()
})

it('renders nothing when there are no tasks', () => {
  mockSummary({ total: 0, open: 0, completed: 0 })
  const { container } = render(<TodoSummaryBar />)
  expect(container).toBeEmptyDOMElement()
})

it('shows the open count without badges when nothing is urgent', () => {
  mockSummary({})
  render(<TodoSummaryBar />)
  const region = screen.getByRole('region', { name: 'Task summary' })
  expect(region).toHaveTextContent('3 open of 4')
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  expect(screen.queryByText(/due in the next/)).not.toBeInTheDocument()
  expect(screen.queryByText(/done/)).not.toBeInTheDocument()
})

it('shows overdue and due-soon badges', () => {
  mockSummary({ overdue: 2, dueSoon: 1 })
  render(<TodoSummaryBar />)
  expect(screen.getByText('2 overdue')).toBeVisible()
  expect(screen.getByText('1 due in the next 3 days')).toBeVisible()
})

it('celebrates when every task is completed', () => {
  mockSummary({ total: 2, open: 0, completed: 2 })
  render(<TodoSummaryBar />)
  expect(screen.getByText('0 open of 2')).toBeVisible()
  expect(screen.getByText('All 2 done')).toBeVisible()
})
