import { searchBooks, type Searchable } from '../lib/search';

/** My Bookshelf's All / Read / Not read chips. */
export type ShelfFilter = 'all' | 'read' | 'unread';

/**
 * The shelf's books for a search and a chip (pure, unit-tested): the search narrows the books
 * first, and the chips count (and filter) what it found.
 */
export function filterShelf<T>(
  items: readonly T[],
  search: string,
  filter: ShelfFilter,
  book: (item: T) => Searchable,
  isRead: (item: T) => boolean,
): { found: T[]; readCount: number; visible: T[] } {
  const found = searchBooks(items, search, book);
  const readCount = found.filter(isRead).length;
  const visible = filter === 'all' ? found : found.filter((item) => isRead(item) === (filter === 'read'));
  return { found, readCount, visible };
}
