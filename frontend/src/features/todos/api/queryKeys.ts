export const todoKeys = {
  all: ['todos'] as const,
  list: ['todos', 'list'] as const,
  create: ['todos', 'create'] as const,
  update: ['todos', 'update'] as const,
  delete: ['todos', 'delete'] as const,
  summaries: ['todos', 'summary'] as const,
  summary: (days: number) => ['todos', 'summary', days] as const,
}
