import type { CalendarDate } from '../data';
import { addDays, daysUntil, parseCalendarDate } from '../lib/dates';

/** Due within this many days, counting today (today, tomorrow, the day after), is "due soon". */
export const DUE_SOON_DAYS = 3;

export type DueStatus = 'overdue' | 'soon' | 'later' | 'none';

/** today + days, as YYYY-MM-DD on the local calendar. */
export function dueDateIn(days: number, today: CalendarDate): CalendarDate {
  return addDays(today, days);
}

/** Overdue (before today), due soon (today or within DUE_SOON_DAYS incl. today), later, or none. */
export function dueStatus(due: CalendarDate | null, today: CalendarDate): DueStatus {
  if (!due) return 'none';
  const days = daysUntil(due, parseCalendarDate(today));
  if (days < 0) return 'overdue';
  if (days < DUE_SOON_DAYS) return 'soon';
  return 'later';
}

/** True for statuses the hub badge counts. */
export const needsAttention = (status: DueStatus) => status === 'overdue' || status === 'soon';
