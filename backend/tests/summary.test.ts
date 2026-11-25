import { it, expect } from 'vitest';
import { summarize } from '../src/features/todos/summary.ts';
import { todo } from './fixture.ts';

const today = '2026-10-14';

it('returns zero counts for an empty list', () => {
  expect(summarize([], today)).toEqual({ total: 0, open: 0, completed: 0, overdue: 0, dueSoon: 0 });
});
it('counts completed tasks separately and never as overdue or due soon', () => {
  const todos = [{ ...todo, completed: true, due_date: '2026-10-01' }, { ...todo, completed: true, due_date: '2026-10-15' }];
  expect(summarize(todos, today)).toEqual({ total: 2, open: 0, completed: 2, overdue: 0, dueSoon: 0 });
});
it('counts open tasks without a due date as open only', () => {
  expect(summarize([{ ...todo, due_date: null }], today)).toEqual({ total: 1, open: 1, completed: 0, overdue: 0, dueSoon: 0 });
});
it.each([
  ['yesterday', '2026-10-13', { overdue: 1, dueSoon: 0 }],
  ['a long time ago', '2025-01-01', { overdue: 1, dueSoon: 0 }],
  ['today', '2026-10-14', { overdue: 0, dueSoon: 1 }],
  ['the last day of the default window', '2026-10-17', { overdue: 0, dueSoon: 1 }],
  ['the first day after the default window', '2026-10-18', { overdue: 0, dueSoon: 0 }],
])('classifies an open task due %s (%s)', (_label, due_date, expected) => {
  expect(summarize([{ ...todo, due_date }], today)).toMatchObject({ open: 1, ...expected });
});
it('honours a custom days window, including 0', () => {
  const todos = [{ ...todo, due_date: '2026-10-14' }, { ...todo, due_date: '2026-10-15' }];
  expect(summarize(todos, today, 0)).toMatchObject({ overdue: 0, dueSoon: 1 });
  expect(summarize(todos, today, 1)).toMatchObject({ overdue: 0, dueSoon: 2 });
});
it('mixes all states in one summary', () => {
  const todos = [
    { ...todo, id: 1, due_date: '2026-10-10' },
    { ...todo, id: 2, due_date: '2026-10-15' },
    { ...todo, id: 3, due_date: '2026-12-01' },
    { ...todo, id: 4, due_date: null },
    { ...todo, id: 5, completed: true },
  ];
  expect(summarize(todos, today)).toEqual({ total: 5, open: 4, completed: 1, overdue: 1, dueSoon: 1 });
});
