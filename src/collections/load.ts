import type { Book, Collection, DataStore, HomeItem, Id } from '../data';
import { buildSlots, collectionProgress, type Progress, type Slot } from './progress';

/** A collection with its books, in slots (the primary edition first in each). */
export interface CollectionView {
  collection: Collection;
  members: Book[];
  slots: Slot<Book>[];
}

/**
 * Every collection in the household with its books and slots. The first-added edition of a
 * number is the one that came Home first (a book not at home: last).
 */
export async function loadCollections(store: DataStore, householdId: Id, home?: readonly HomeItem[]): Promise<CollectionView[]> {
  const [collections, items] = await Promise.all([store.listCollections(householdId), home ? Promise.resolve(home) : store.listHomeItems(householdId)]);
  const addedAt = new Map(items.map((i) => [i.isbn, i.added_at]));
  return Promise.all(
    collections.map(async (collection) => {
      const members = await store.listCollectionBooks(collection.id);
      return { collection, members, slots: buildSlots(members, collection.expected_count, (b) => addedAt.get(b.isbn) ?? null) };
    }),
  );
}

/** A reader's progress through each collection, by collection id. `readIsbns`: the books they have read (confirmed). */
export function progressOf(views: readonly CollectionView[], readIsbns: ReadonlySet<string>): Map<Id, Progress> {
  return new Map(views.map((v) => [v.collection.id, collectionProgress(v.slots, readIsbns, v.collection.expected_count)]));
}
