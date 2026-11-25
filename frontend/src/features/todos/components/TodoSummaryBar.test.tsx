import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useTodoSummaryQuery } from '../hooks/useTodoSummaryQuery'
import type { TodoSummary } from '../types'
import { TodoSummaryBar } from './TodoSummaryBar'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useTodoSummaryQuery', () => ({
  useTodoSummaryQuery: vi.fn(),
}))
beforeEach(() => vi.clearAllMocks())

function mockSummary(state: Record<string, unknown>) {
  vi.mocked(useTodoSummaryQuery).mockReturnValue({
    isPending: false,
    isError: false,
    ...state,
  } as unknown as ReturnType<typeof useTodoSummaryQuery>)
}

function mockData(overrides: Partial<TodoSummary>) {
  mockSummary({
    data: {
      total: 5,
      open: 4,
      completed: 1,
      overdue: 0,
      dueSoon: 0,
      ...overrides,
    },
  })
}

it('shows a loading status while the summary is pending', () => {
  mockSummary({ isPending: true })
  render(<TodoSummaryBar />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading summary…')
})

it('renders nothing when loading the summary failed', () => {
  mockSummary({ isError: true, error: new Error('Server down') })
  const { container } = render(<TodoSummaryBar />)
  expect(container).toBeEmptyDOMElement()
})

it('renders nothing when there are no tasks', () => {
  mockData({ total: 0, open: 0, completed: 0 })
  const { container } = render(<TodoSummaryBar />)
  expect(container).toBeEmptyDOMElement()
})

it('shows only the open count when nothing is overdue or due soon', () => {
  mockData({})
  render(<TodoSummaryBar />)
  const bar = screen.getByRole('region', { name: 'Task summary' })
  expect(bar).toHaveTextContent('4 open of 5')
  expect(bar).not.toHaveTextContent(/overdue/)
  expect(bar).not.toHaveTextContent(/due in the next/)
  expect(bar).not.toHaveTextContent(/done/)
})

it('shows the overdue and due-soon counts', () => {
  mockData({ overdue: 2, dueSoon: 1 })
  render(<TodoSummaryBar />)
  const bar = screen.getByRole('region', { name: 'Task summary' })
  expect(bar).toHaveTextContent('2 overdue')
  expect(bar).toHaveTextContent('1 due in the next 3 days')
})

it('celebrates when every task is completed', () => {
  mockData({ total: 3, open: 0, completed: 3 })
  render(<TodoSummaryBar />)
  const bar = screen.getByRole('region', { name: 'Task summary' })
  expect(bar).toHaveTextContent('0 open of 3')
  expect(bar).toHaveTextContent('All 3 done')
})
