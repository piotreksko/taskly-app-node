import { AlertTriangle, CalendarClock, CheckCircle2 } from 'lucide-react'
import { Badge, Text } from '../../../design-system'
import { DUE_SOON_DAYS } from '../constants'
import { useTodoSummaryQuery } from '../hooks/useTodoSummaryQuery'

export function TodoSummaryBar() {
  const summary = useTodoSummaryQuery()

  if (summary.isPending) {
    return (
      <Text muted size="small" role="status">
        Loading summary…
      </Text>
    )
  }
  // The summary is secondary information: hide it instead of showing a second error next to the list.
  if (summary.isError) return null

  const { total, open, completed, overdue, dueSoon } = summary.data
  if (total === 0) return null

  return (
    <section className="row compact" aria-label="Task summary">
      <Text as="span" size="small">
        {open} open of {total}
      </Text>
      {overdue > 0 && (
        <Badge variant="warning">
          <span className="row compact">
            <AlertTriangle size={14} aria-hidden="true" />
            {overdue} overdue
          </span>
        </Badge>
      )}
      {dueSoon > 0 && (
        <Badge variant="info">
          <span className="row compact">
            <CalendarClock size={14} aria-hidden="true" />
            {dueSoon} due in the next {DUE_SOON_DAYS} days
          </span>
        </Badge>
      )}
      {open === 0 && (
        <Badge variant="success">
          <span className="row compact">
            <CheckCircle2 size={14} aria-hidden="true" />
            All {completed} done
          </span>
        </Badge>
      )}
    </section>
  )
}
