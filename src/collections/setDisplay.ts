import type { Book, Collection } from '../data';
import { fmt, strings } from '../strings';
import type { Progress, Slot } from './progress';

const t = strings.collections;

/** "🔒 4 / 10", "🏆 Whole set read!", or (a series without a count) "4 / 6". */
export function progressText(p: Progress): string {
  if (p.trophy) return `🏆 ${t.trophy}`;
  const count = fmt(t.progress, { read: p.read, total: p.total });
  return p.locked ? `🔒 ${count}` : count;
}

/** The cover a set shows: its own, else its first book's. */
export function setCover(collection: Collection, slots: readonly Slot<Book>[]): string | null {
  return collection.cover_url ?? slots.find((s) => s.books[0]?.cover_url)?.books[0]?.cover_url ?? null;
}
