import type { Searchable } from '../lib/search';
import type { CollectionView } from './load';

/**
 * My Bookshelf with collections (pure, unit-tested): each set shows as ONE item, where its first
 * Home book would be; its books aren't listed loose. A book whose collection isn't there (deleted
 * on another device meanwhile) stays loose.
 */

export type ShelfItem<E> = { kind: 'book'; key: string; entry: E } | { kind: 'set'; key: string; view: CollectionView };

export function groupShelf<E>(
  entries: readonly E[],
  keyOf: (entry: E) => string,
  collectionOf: (entry: E) => string | null | undefined,
  views: readonly CollectionView[],
): ShelfItem<E>[] {
  const byId = new Map(views.map((v) => [v.collection.id, v]));
  const shown = new Set<string>();
  const items: ShelfItem<E>[] = [];
  for (const entry of entries) {
    const view = byId.get(collectionOf(entry) ?? '');
    if (!view) {
      items.push({ kind: 'book', key: keyOf(entry), entry });
    } else if (!shown.has(view.collection.id)) {
      shown.add(view.collection.id);
      items.push({ kind: 'set', key: `set:${view.collection.id}`, view });
    }
  }
  return items;
}

/** What a set answers to in "Find a book": its own title, or any of its books (each on its own). */
export function setSearchables(view: CollectionView): Searchable[] {
  return [{ title: view.collection.title, authors: [] }, ...view.members.map((m) => ({ title: m.title, authors: m.authors }))];
}
