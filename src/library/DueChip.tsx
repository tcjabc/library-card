import { formatCalendarDate } from '../lib/dates';
import { fmt, strings } from '../strings';
import { dueStatus } from './due';

/** "Overdue" / "Due soon" / "Due <date>" for a loan's due date. */
export function DueChip({ due, today }: { due: string | null; today: string }) {
  const t = strings.library;
  const status = dueStatus(due, today);
  if (status === 'none' || !due) return <span className="due-chip due-chip--none">{t.noDueDate}</span>;
  const label = status === 'overdue' ? t.overdue : status === 'soon' ? t.dueSoon : fmt(t.dueOn, { date: formatCalendarDate(due) });
  return (
    <span className={`due-chip due-chip--${status}`} title={fmt(t.dueOn, { date: formatCalendarDate(due) })}>
      {status === 'overdue' && <span aria-hidden="true">⏰ </span>}
      {label}
    </span>
  );
}
