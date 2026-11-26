import { it, expect } from 'vitest';
import { summarize } from '../src/features/todos/summary.ts';
import { todo } from './fixture.ts';

const today = '2026-10-10';

it('returns zero counts for no tasks', () => {
  expect(summarize([], today)).toEqual({ total: 0, open: 0, completed: 0, overdue: 0, dueSoon: 0 });
});
it('counts completed tasks separately and ignores their due dates', () => {
  const todos = [{ ...todo, completed: true, due_date: '2026-10-01' }, { ...todo, completed: true, due_date: null }];
  expect(summarize(todos, today)).toEqual({ total: 2, open: 0, completed: 2, overdue: 0, dueSoon: 0 });
});
it('counts open tasks without a due date as open only', () => {
  expect(summarize([{ ...todo, due_date: null }], today)).toEqual({ total: 1, open: 1, completed: 0, overdue: 0, dueSoon: 0 });
});
it.each([
  ['the day before today', '2026-10-09', { overdue: 1, dueSoon: 0 }],
  ['today', '2026-10-10', { overdue: 0, dueSoon: 1 }],
  ['the last day of the default window', '2026-10-13', { overdue: 0, dueSoon: 1 }],
  ['the day after the default window', '2026-10-14', { overdue: 0, dueSoon: 0 }],
])('classifies an open task due %s (%s)', (_label, due_date, expected) => {
  expect(summarize([{ ...todo, due_date }], today)).toMatchObject({ open: 1, ...expected });
});
it('honours a custom window, including zero days', () => {
  const tomorrow = [{ ...todo, due_date: '2026-10-11' }];
  expect(summarize(tomorrow, today, 0).dueSoon).toBe(0);
  expect(summarize([{ ...todo, due_date: today }], today, 0).dueSoon).toBe(1);
  expect(summarize(tomorrow, today, 1).dueSoon).toBe(1);
});
it('measures windows across month boundaries', () => {
  expect(summarize([{ ...todo, due_date: '2026-11-02' }], '2026-10-30')).toMatchObject({ dueSoon: 1, overdue: 0 });
});
