import type { CalendarDate, Loan, ReadSummary, Timestamp } from '../data';
import { formatCalendarDate, toCalendarDate } from '../lib/dates';
import { dueStatus, type DueStatus } from '../library/due';

/** Small pure helpers for the grown-up area (unit-tested). */

export const GROWN_UP_TABS = ['books', 'readers', 'libraries', 'loans', 'cards', 'settings'] as const;
export type GrownUpTab = (typeof GROWN_UP_TABS)[number];

export const GROWN_UPS_ROOT = '/grownups';

/** "/grownups/loans" -> "loans". Null for the bare root or an unknown tab (both go to Books). */
export function parseGrownUpsPath(path: string): GrownUpTab | null {
  if (!path.startsWith(`${GROWN_UPS_ROOT}/`)) return null;
  const tab = path.slice(GROWN_UPS_ROOT.length + 1).replace(/\/+$/, '');
  return (GROWN_UP_TABS as readonly string[]).includes(tab) ? (tab as GrownUpTab) : null;
}

export function tabPath(tab: GrownUpTab, query?: Record<string, string>): string {
  const search = query ? new URLSearchParams(query).toString() : '';
  return `${GROWN_UPS_ROOT}/${tab}${search ? `?${search}` : ''}`;
}

/** Lower case, accents and punctuation removed, so "Pépé" matches "pepe". */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every word of the query appears in the title or an author's name. An empty query matches everything. */
export function matchesBookSearch(book: { title: string; authors: readonly string[] }, query: string): boolean {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold([book.title, ...book.authors].join(' '));
  return words.every((word) => haystack.includes(word));
}

const STATUS_ORDER: Record<DueStatus, number> = { overdue: 0, soon: 1, later: 2, none: 3 };

/** Overdue first, then due soon, then later, then no due date; earliest due first within each; then newest borrowed. */
export function sortActiveLoans<T extends Pick<Loan, 'due_date' | 'borrowed_at' | 'id'>>(loans: readonly T[], today: CalendarDate): T[] {
  return [...loans].sort((a, b) => {
    const byStatus = STATUS_ORDER[dueStatus(a.due_date, today)] - STATUS_ORDER[dueStatus(b.due_date, today)];
    if (byStatus) return byStatus;
    const byDue = (a.due_date ?? '').localeCompare(b.due_date ?? '');
    if (byDue) return byDue;
    return b.borrowed_at.localeCompare(a.borrowed_at) || a.id.localeCompare(b.id);
  });
}

/** Most recently returned first. */
export function sortReturnedLoans<T extends Pick<Loan, 'returned_at' | 'id'>>(loans: readonly T[]): T[] {
  return [...loans].sort((a, b) => (b.returned_at ?? '').localeCompare(a.returned_at ?? '') || a.id.localeCompare(b.id));
}

/** Different books read, and reads beyond the first of each. */
export function readStats(summaries: readonly Pick<ReadSummary, 'count'>[]): { booksRead: number; rereads: number } {
  const reads = summaries.reduce((sum, s) => sum + s.count, 0);
  return { booksRead: summaries.length, rereads: reads - summaries.length };
}

/** Splits items into pages of `size` (the last may be shorter). */
export function paginate<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('Page size must be at least 1.');
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/** A timestamp as a local calendar date for people, e.g. "3 Mar 2026". */
export function formatTimestampDate(value: Timestamp, locale?: string, now: Date = new Date()): string {
  return formatCalendarDate(toCalendarDate(new Date(value)), locale, now);
}

/** 1536 -> "1.5 KB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Keys this app keeps in localStorage / sessionStorage (cleared by "Reset this device"). */
export function isAppStorageKey(key: string): boolean {
  return key.startsWith('library-card:');
}
