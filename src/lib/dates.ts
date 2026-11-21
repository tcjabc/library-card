/**
 * Date helpers. Two kinds of value are used in the app:
 * - Timestamp: an instant, ISO 8601 in UTC ("2026-01-31T09:15:00.000Z").
 * - CalendarDate: a day on the device's local calendar ("2026-01-31").
 *
 * "Since" boundaries (today, this week) are local midnights converted to
 * timestamps, so a read at 11pm counts for the day the child saw it.
 */

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date of an instant (default: now). */
export function toCalendarDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayCalendarDate(): string {
  return toCalendarDate(new Date());
}

export function isCalendarDate(value: string): boolean {
  const m = CALENDAR_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** Local midnight at the start of a calendar date, as a Date. */
export function parseCalendarDate(value: string): Date {
  const m = CALENDAR_DATE.exec(value);
  if (!m || !isCalendarDate(value)) throw new RangeError(`Invalid calendar date: ${value}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Adds whole days on the local calendar (DST-safe). */
export function addDays(value: string, days: number): string {
  const d = parseCalendarDate(value);
  d.setDate(d.getDate() + days);
  return toCalendarDate(d);
}

/** Whole local days from today to the date: 0 = today, negative = past. */
export function daysUntil(value: string, now: Date = new Date()): number {
  const target = parseCalendarDate(value);
  const today = parseCalendarDate(toCalendarDate(now));
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Timestamp of local midnight today (or of the given instant's day). */
export function startOfLocalDay(date: Date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

/**
 * Timestamp of local midnight at the start of the week containing the date.
 * weekStartsOn: 0 = Sunday, 1 = Monday (default).
 */
export function startOfLocalWeek(date: Date = new Date(), weekStartsOn: 0 | 1 = 1): string {
  const offset = (date.getDay() - weekStartsOn + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset).toISOString();
}

export function startOfLocalMonth(date: Date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
}

/**
 * A calendar date for people, in the browser's language: "Fri 13 Mar" style
 * (weekday, day, short month; the year only when it isn't this year).
 */
export function formatCalendarDate(value: string, locale?: string, now: Date = new Date()): string {
  const date = parseCalendarDate(value);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}
