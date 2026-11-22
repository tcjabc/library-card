import type { ReadSummary, Reader } from '../data';

/**
 * Grown-ups → Books: sorting, quick filters and who has read each book (pure, unit-tested). The
 * search (matchesBookSearch) runs first, then the filter, then the sort.
 */

export type BookSort = 'recent' | 'title';
export type BookFilter = 'all' | 'unread' | 'nocover';

export const BOOK_SORTS: readonly BookSort[] = ['recent', 'title'];
export const BOOK_FILTERS: readonly BookFilter[] = ['all', 'unread', 'nocover'];

export interface SortableBook {
  title: string;
  /** When it was added to Home (ISO timestamp). */
  addedAt: string;
  /** Every read of it by anyone. */
  reads: number;
  coverUrl: string | null;
}

const byTitle = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true, ignorePunctuation: true });

/** Recently added: newest first. Title A–Z: by title as people read it (case, accents and punctuation aside; "Book 2" before "Book 10"). */
export function sortBooks<T extends SortableBook>(books: readonly T[], sort: BookSort): T[] {
  const sorted = [...books];
  if (sort === 'title') return sorted.sort((a, b) => byTitle.compare(a.title, b.title) || b.addedAt.localeCompare(a.addedAt));
  return sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || byTitle.compare(a.title, b.title));
}

/** All; Not read by anyone (no reads at all); No cover (no photo or catalogue cover showing). */
export function filterBooks<T extends SortableBook>(books: readonly T[], filter: BookFilter): T[] {
  if (filter === 'unread') return books.filter((b) => b.reads === 0);
  if (filter === 'nocover') return books.filter((b) => !b.coverUrl);
  return [...books];
}

/** Each book's readers (who has read it at least once), in the household's reader order. */
export function readersByBook(summaries: readonly ReadSummary[], readers: readonly Reader[]): Map<string, Reader[]> {
  const order = new Map(readers.map((r, i) => [r.id, i]));
  const byId = new Map(readers.map((r) => [r.id, r]));
  const out = new Map<string, Reader[]>();
  for (const s of summaries) {
    const reader = byId.get(s.reader_id);
    if (!reader || s.count < 1) continue;
    const list = out.get(s.isbn) ?? [];
    if (!list.includes(reader)) list.push(reader);
    out.set(s.isbn, list);
  }
  for (const list of out.values()) list.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return out;
}
