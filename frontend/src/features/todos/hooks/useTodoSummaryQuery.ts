import { useQuery } from '@tanstack/react-query'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { DUE_SOON_DAYS } from '../constants'

export function useTodoSummaryQuery(days = DUE_SOON_DAYS) {
  return useQuery({
    queryKey: todoKeys.summary(days),
    queryFn: ({ signal }) => todosApi.summary(days, signal),
  })
}
