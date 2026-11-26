import type { Todo } from './types.js';

export interface TodoSummary {
  total: number;
  open: number;
  completed: number;
  overdue: number;
  dueSoon: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Counts tasks by state. A task is "due soon" when it is open and due today or within the next
 * `days` days; "overdue" when it is open and its due date is before `today` (all dates are UTC days).
 */
export function summarize(todos: Todo[], today: string, days = 3): TodoSummary {
  const start = Date.parse(`${today}T00:00:00Z`);
  const summary: TodoSummary = {
    total: todos.length,
    open: 0,
    completed: 0,
    overdue: 0,
    dueSoon: 0,
  };
  for (const todo of todos) {
    if (todo.completed) {
      summary.completed++;
      continue;
    }
    summary.open++;
    if (!todo.due_date) continue;
    const diff = (Date.parse(`${todo.due_date}T00:00:00Z`) - start) / DAY_MS;
    if (diff < 0) summary.overdue++;
    else if (diff <= days) summary.dueSoon++;
  }
  return summary;
}
