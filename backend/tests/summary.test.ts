import { it, expect } from 'vitest';
import { summarize } from '../src/features/todos/summary.ts';
import { todo } from './fixture.ts';

const today = '2026-10-15';
const make = (due_date: string | null, completed = false) => ({ ...todo, due_date, completed });

it('returns zero counts for an empty list', () => {
  expect(summarize([], today)).toEqual({ total: 0, open: 0, completed: 0, overdue: 0, dueSoon: 0 });
});
it('counts completed tasks separately and ignores their due dates', () => {
  expect(summarize([make('2026-10-01', true), make(null, true)], today))
    .toEqual({ total: 2, open: 0, completed: 2, overdue: 0, dueSoon: 0 });
});
it('counts open tasks without a due date as open only', () => {
  expect(summarize([make(null)], today)).toEqual({ total: 1, open: 1, completed: 0, overdue: 0, dueSoon: 0 });
});
it('treats open tasks due before today as overdue', () => {
  expect(summarize([make('2026-10-14')], today)).toEqual({ total: 1, open: 1, completed: 0, overdue: 1, dueSoon: 0 });
});
it('treats a task due today as due soon, not overdue', () => {
  expect(summarize([make('2026-10-15')], today)).toEqual({ total: 1, open: 1, completed: 0, overdue: 0, dueSoon: 1 });
});
it('uses a default window of 3 days (inclusive)', () => {
  const result = summarize([make('2026-10-18'), make('2026-10-19')], today);
  expect(result.dueSoon).toBe(1);
  expect(result.open).toBe(2);
  expect(result.overdue).toBe(0);
});
it('honours a custom window', () => {
  expect(summarize([make('2026-10-16'), make('2026-10-17')], today, 1).dueSoon).toBe(1);
  expect(summarize([make('2026-10-15'), make('2026-10-16')], today, 0).dueSoon).toBe(1);
});
it('combines all states in one list', () => {
  const todos = [make('2026-10-10'), make('2026-10-16'), make('2027-01-01'), make(null), make('2026-10-10', true)];
  expect(summarize(todos, today)).toEqual({ total: 5, open: 4, completed: 1, overdue: 1, dueSoon: 1 });
});
