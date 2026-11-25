import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo, TodoInput } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('keeps only completed tasks and matches the title', () => {
    const done: Todo = {
      ...base,
      id: 2,
      title: 'Ship release',
      completed: true,
    }
    const todos = [base, done, { ...done, id: 3, title: 'Other' }]
    expect(selectTodos(todos, 'completed', 'SHIP', 'newest')).toEqual([done])
  })

  it('breaks equal priorities by newest id first and puts low last', () => {
    const low: Todo = { ...base, id: 5, priority: 'low' }
    const older: Todo = { ...base, id: 2 }
    const newer: Todo = { ...base, id: 3 }
    expect(
      selectTodos([low, older, newer], 'all', '', 'priority').map((t) => t.id),
    ).toEqual([3, 2, 5])
  })

  it('sorts by due date with undated tasks last, ties by newest id', () => {
    const undated: Todo = { ...base, id: 9 }
    const late: Todo = { ...base, id: 2, due_date: '2026-12-01' }
    const early: Todo = { ...base, id: 3, due_date: '2026-10-05' }
    const earlyNewer: Todo = { ...base, id: 4, due_date: '2026-10-05' }
    expect(
      selectTodos([undated, late, early, earlyNewer], 'all', '', 'due').map(
        (t) => t.id,
      ),
    ).toEqual([4, 3, 2, 9])
  })

  it('keeps undated tasks after dated ones whichever side they compare on', () => {
    const undatedOld: Todo = { ...base, id: 2 }
    const undatedNew: Todo = { ...base, id: 6 }
    const dated: Todo = { ...base, id: 1, due_date: '2026-10-05' }
    expect(
      selectTodos([undatedOld, dated, undatedNew], 'all', '', 'due').map(
        (t) => t.id,
      ),
    ).toEqual([1, 6, 2])
  })

  it('sorts by creation time descending, ties by newest id', () => {
    const old: Todo = { ...base, id: 8, created_at: '2026-09-01T00:00:00Z' }
    const recent: Todo = { ...base, id: 2, created_at: '2026-10-05T00:00:00Z' }
    const sameTime: Todo = { ...base, id: 3, created_at: recent.created_at }
    expect(
      selectTodos([old, recent, sameTime], 'all', '', 'newest').map(
        (t) => t.id,
      ),
    ).toEqual([3, 2, 8])
  })
})

describe('validateTodo', () => {
  const valid: TodoInput = {
    title: 'Write tests',
    description: '',
    priority: 'medium',
    due_date: null,
    completed: false,
  }

  it('accepts a valid task with and without a due date', () => {
    expect(validateTodo(valid)).toEqual({})
    expect(validateTodo({ ...valid, due_date: '2028-02-29' })).toEqual({})
  })

  it.each([
    ['', 'Enter a task title.'],
    ['   ', 'Enter a task title.'],
    ['x'.repeat(121), 'The title must be at most 120 characters.'],
  ])('rejects the title %j', (title, message) => {
    expect(validateTodo({ ...valid, title })).toEqual({ title: message })
  })

  it('measures title and description length after trimming', () => {
    expect(
      validateTodo({
        ...valid,
        title: ` ${'x'.repeat(120)} `,
        description: ` ${'d'.repeat(2000)} `,
      }),
    ).toEqual({})
  })

  it('rejects a description longer than 2000 characters', () => {
    expect(validateTodo({ ...valid, description: 'd'.repeat(2001) })).toEqual({
      description: 'The description must be at most 2000 characters.',
    })
  })

  it.each(['2026-02-30', '2026-13-01', '2026/10/10', '10-10-2026', 'soon'])(
    'rejects the invalid due date %j',
    (due_date) => {
      expect(validateTodo({ ...valid, due_date })).toEqual({
        due_date: 'Enter a valid date.',
      })
    },
  )

  it('reports several field errors at once', () => {
    expect(
      Object.keys(
        validateTodo({
          ...valid,
          title: '',
          description: 'd'.repeat(2001),
          due_date: 'bad',
        }),
      ),
    ).toEqual(['title', 'description', 'due_date'])
  })
})

describe('isOverdue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it.each([
    ['an active task due yesterday', { due_date: '2026-10-09' }, true],
    ['an active task due today', { due_date: '2026-10-10' }, false],
    ['an active task due tomorrow', { due_date: '2026-10-11' }, false],
    [
      'a completed task due yesterday',
      { due_date: '2026-10-09', completed: true },
      false,
    ],
    ['a task without a due date', { due_date: null }, false],
  ])('treats %s as overdue: %s', (_, overrides, expected) => {
    expect(isOverdue({ ...base, ...overrides })).toBe(expected)
  })
})

describe('formatDate', () => {
  it('formats an ISO date as a British short date', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})
