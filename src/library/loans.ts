import type { BookKey, CalendarDate, Id, Loan } from '../data';
import { calendarDateIn, currentTimeZone, noonIn } from '../lib/timezone';

/**
 * Pure helpers for library loans (public-library books only; Home Library
 * books are never borrowed): the kids' "Mine" / "My house" lists, the
 * "already borrowed" check when borrowing, and the date rules of the
 * grown-ups' loan editor.
 */

/** The kids' Library Books filter: the active reader's loans, or everyone's in the household. */
export type LibraryView = 'mine' | 'house';

const NO_DATE = '￿';

/** Due date first (no due date last), then the earliest borrowed, then id. */
export function byDueDate(a: Loan, b: Loan): number {
  return (
    (a.due_date ?? NO_DATE).localeCompare(b.due_date ?? NO_DATE) ||
    a.borrowed_at.localeCompare(b.borrowed_at) ||
    a.id.localeCompare(b.id)
  );
}

/** Most recently returned first. */
export function byReturned(a: Loan, b: Loan): number {
  return (b.returned_at ?? '').localeCompare(a.returned_at ?? '') || b.id.localeCompare(a.id);
}

/**
 * The loans a list shows: Mine is the reader's own, My house everyone's. Current loans (not
 * returned) sorted by due date; returned ones newest first.
 */
export function loansInView(loans: readonly Loan[], view: LibraryView, readerId: Id): { active: Loan[]; returned: Loan[] } {
  const shown = view === 'mine' ? loans.filter((loan) => loan.reader_id === readerId) : [...loans];
  return {
    active: shown.filter((loan) => loan.returned_at === null).sort(byDueDate),
    returned: shown.filter((loan) => loan.returned_at !== null).sort(byReturned),
  };
}

/**
 * Current loans (not returned) of this book anywhere in the household, the reader's own first.
 * A book borrowed and returned before isn't "already borrowed": it just starts a new loan.
 */
export function currentLoansOf(loans: readonly Loan[], isbn: BookKey, readerId: Id): Loan[] {
  return loans
    .filter((loan) => loan.isbn === isbn && loan.returned_at === null)
    .sort((a, b) => Number(b.reader_id === readerId) - Number(a.reader_id === readerId) || byDueDate(a, b));
}

/* --------------------------------------------------------------------------
   Grown-ups' loan editor: dates
   -------------------------------------------------------------------------- */

export interface LoanDates {
  /** The borrowed date as a calendar date (required). */
  borrowed: CalendarDate;
  due: CalendarDate | null;
  /** Null while the loan is out. */
  returned: CalendarDate | null;
}

export interface LoanDateProblems {
  borrowed?: 'future';
  due?: 'beforeBorrowed';
  returned?: 'future' | 'beforeBorrowed';
}

/**
 * The editor's date rules: nothing borrowed or returned in the future, and neither the due date
 * nor the returned date before the borrowed date. Empty when the dates are fine.
 */
export function checkLoanDates({ borrowed, due, returned }: LoanDates, today: CalendarDate): LoanDateProblems {
  const problems: LoanDateProblems = {};
  if (borrowed > today) problems.borrowed = 'future';
  if (due !== null && due < borrowed) problems.due = 'beforeBorrowed';
  if (returned !== null) {
    if (returned > today) problems.returned = 'future';
    else if (returned < borrowed) problems.returned = 'beforeBorrowed';
  }
  return problems;
}

/** A stored timestamp as the calendar date the editor shows, in the household's time zone. */
export function timestampToDate(timestamp: string, zone: string = currentTimeZone()): CalendarDate {
  return calendarDateIn(new Date(timestamp), zone);
}

/**
 * A calendar date from the editor back to a timestamp. The original is kept when its date didn't
 * change (no time is lost); a new date is stored at noon in the household's time zone, so it shows
 * as that date there.
 */
export function dateToTimestamp(date: CalendarDate, original: string | null = null, zone: string = currentTimeZone()): string {
  if (original && timestampToDate(original, zone) === date) return original;
  return noonIn(date, zone);
}
