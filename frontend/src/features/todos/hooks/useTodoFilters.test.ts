import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { useTodoFilters } from './useTodoFilters'

const active: Todo = { ...todoFixture, id: 1, title: 'Write report' }
const done: Todo = {
  ...todoFixture,
  id: 2,
  title: 'Book flights',
  completed: true,
  priority: 'high',
}

it('starts with all tasks, no search and newest first', () => {
  const { result } = renderHook(() => useTodoFilters([active, done]))
  expect(result.current).toMatchObject({
    filter: 'all',
    search: '',
    sort: 'newest',
  })
  expect(result.current.visible).toEqual([done, active])
})

it('derives the visible tasks from filter, search and sort', () => {
  const { result } = renderHook(() => useTodoFilters([active, done]))
  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([done])
  act(() => {
    result.current.setFilter('all')
    result.current.setSearch('REPORT')
  })
  expect(result.current.visible).toEqual([active])
  act(() => {
    result.current.setSearch('')
    result.current.setSort('priority')
  })
  expect(result.current.sort).toBe('priority')
  expect(result.current.visible).toEqual([done, active])
})

it('recomputes when the task list changes', () => {
  const { result, rerender } = renderHook(
    ({ todos }) => useTodoFilters(todos),
    { initialProps: { todos: [active] } },
  )
  expect(result.current.visible).toEqual([active])
  rerender({ todos: [] })
  expect(result.current.visible).toEqual([])
})
