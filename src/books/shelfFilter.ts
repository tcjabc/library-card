import { isSearching, matchesBookSearch, type Searchable } from '../lib/search';

/** My Bookshelf's All / Read / Not read chips. */
export type ShelfFilter = 'all' | 'read' | 'unread';

/**
 * The shelf's books for a search and a chip (pure, unit-tested): the search narrows the books
 * first, and the chips count (and filter) what it found. `book` may give several searchables for
 * one item (a set: its title and each of its books): any one matching is enough.
 */
export function filterShelf<T>(
  items: readonly T[],
  search: string,
  filter: ShelfFilter,
  book: (item: T) => Searchable | readonly Searchable[],
  isRead: (item: T) => boolean,
): { found: T[]; readCount: number; visible: T[] } {
  const matches = (item: T) => {
    const found = book(item);
    return (Array.isArray(found) ? found : [found as Searchable]).some((b) => matchesBookSearch(b, search));
  };
  const found = isSearching(search) ? items.filter(matches) : [...items];
  const readCount = found.filter(isRead).length;
  const visible = filter === 'all' ? found : found.filter((item) => isRead(item) === (filter === 'read'));
  return { found, readCount, visible };
}
