import { describe, expect, it } from 'vitest';
import { filterShelf } from '../../books/shelfFilter';
import { collectionIdForIsbn, type Book, type Collection } from '../../data';
import { summarize } from '../../data/readRules';
import type { CollectionView } from '../load';
import { buildSlots, collectionProgress, nextFreeVolume, quickAddPlan, stillToAdd } from '../progress';
import { groupShelf, setSearchables } from '../shelfItems';

// Collections (box sets and series): slots, progress, the lock and the trophy; quick-add; the shelf.

const book = (isbn: string, volume: number | null, title = `Book ${isbn}`): Book => ({
  isbn,
  title,
  authors: [],
  cover_url: null,
  source: 'manual',
  collection_id: 'set',
  volume,
});

/** The books a reader has read, from read events as the store keeps them (confirmed only). */
function readFrom(events: { isbn: string; status: 'pending' | 'confirmed' }[]): Set<string> {
  const isbns = new Set<string>();
  for (const isbn of new Set(events.map((e) => e.isbn))) {
    const summary = summarize(
      events
        .filter((e) => e.isbn === isbn)
        .map((e, i) => ({ id: `${isbn}-${i}`, household_id: 'main', reader_id: 'ada', isbn, read_at: `2026-01-0${i + 1}T00:00:00Z`, how: 'self', status: e.status, confirmed_at: null, confirmed_by: null })),
    );
    if (summary) isbns.add(isbn);
  }
  return isbns;
}

describe('slots', () => {
  it('numbered books by number, empty numbers up to the expected count, editions together (first added first), unnumbered last', () => {
    const members = [book('b', 2), book('c', 2), book('a', 1), book('x', null), book('e', 5)];
    const added: Record<string, string> = { b: '2026-02-01', c: '2026-01-01' };
    const slots = buildSlots(members, 4, (m) => added[m.isbn] ?? null);
    expect(slots.map((s) => [s.volume, s.books.map((b) => b.isbn)])).toEqual([
      [1, ['a']],
      [2, ['c', 'b']], // c came home first: the main edition
      [3, []],
      [4, []],
      [5, ['e']], // past the expected count: shown, not counted
      [null, ['x']],
    ]);
    expect(stillToAdd(slots, 4)).toBe(2);
    expect(stillToAdd(slots, null)).toBe(0);
  });
});

describe('progress, the lock and the trophy', () => {
  const members = [book('a', 1), book('b', 2), book('b2', 2), book('c', 3)];
  const slots = buildSlots(members, 3);

  it('a slot is read when ANY edition in it has a confirmed read; pending reads never count', () => {
    expect(collectionProgress(slots, readFrom([{ isbn: 'a', status: 'confirmed' }, { isbn: 'b2', status: 'confirmed' }]), 3)).toEqual({
      read: 2,
      total: 3,
      locked: true,
      trophy: false,
      complete: false,
    });
    // c read but still waiting for a grown-up: locked.
    const waiting = readFrom([{ isbn: 'a', status: 'confirmed' }, { isbn: 'b', status: 'confirmed' }, { isbn: 'c', status: 'pending' }]);
    expect(collectionProgress(slots, waiting, 3)).toMatchObject({ read: 2, locked: true, trophy: false });
    // Confirmed: the trophy.
    const all = readFrom([{ isbn: 'a', status: 'confirmed' }, { isbn: 'b', status: 'confirmed' }, { isbn: 'c', status: 'pending' }, { isbn: 'c', status: 'confirmed' }]);
    expect(collectionProgress(slots, all, 3)).toEqual({ read: 3, total: 3, locked: false, trophy: true, complete: true });
  });

  it('undoing (or "Not yet" on) a read locks it again: it is worked out from the reads, never stored', () => {
    const read = new Set(['a', 'b', 'c']);
    expect(collectionProgress(slots, read, 3).trophy).toBe(true);
    read.delete('c');
    expect(collectionProgress(slots, read, 3)).toMatchObject({ read: 2, locked: true, trophy: false });
  });

  it('an empty number keeps it locked; an extra number past the count does not help', () => {
    const gappy = buildSlots([book('a', 1), book('z', 9)], 2);
    expect(collectionProgress(gappy, new Set(['a', 'z']), 2)).toMatchObject({ read: 1, total: 2, locked: true, trophy: false });
  });

  it('without an expected count: progress over the books there are, no trophy, "complete" when every one is read', () => {
    const series = buildSlots([book('a', 1), book('b', 2), book('b2', 2), book('x', null)], null);
    expect(collectionProgress(series, new Set(['a']), null)).toEqual({ read: 1, total: 3, locked: false, trophy: false, complete: false });
    expect(collectionProgress(series, new Set(['a', 'b2', 'x']), null)).toEqual({ read: 3, total: 3, locked: false, trophy: false, complete: true });
    expect(collectionProgress(buildSlots([], null), new Set(), null).complete).toBe(false);
  });
});

describe('quick-add and numbers', () => {
  it('names books "<set title> <number>" on the next free numbers, or by the titles given', () => {
    expect(quickAddPlan('Narnia', 3, '', [])).toEqual([
      { volume: 1, title: 'Narnia 1' },
      { volume: 2, title: 'Narnia 2' },
      { volume: 3, title: 'Narnia 3' },
    ]);
    expect(quickAddPlan(' Narnia ', 3, 'The Magician’s Nephew\n\n  The Lion  ', [1, 3])).toEqual([
      { volume: 2, title: 'The Magician’s Nephew' },
      { volume: 4, title: 'The Lion' },
      { volume: 5, title: 'Narnia 5' },
    ]);
    // No count: one per title.
    expect(quickAddPlan('Set', 0, 'One\nTwo', [])).toHaveLength(2);
    expect(quickAddPlan('Set', 0, '   ', [])).toEqual([]);
    expect(quickAddPlan('Set', 9999, '', []).length).toBe(500);
  });

  it('the next free number skips the ones taken', () => {
    expect(nextFreeVolume([])).toBe(1);
    expect(nextFreeVolume([1, 2, 4, null])).toBe(3);
  });

  it('a set from a box ISBN has the same id on every device', () => {
    expect(collectionIdForIsbn('9780000000026')).toBe('box-9780000000026');
    expect(collectionIdForIsbn('9780000000026')).toBe(collectionIdForIsbn('9780000000026'));
    expect(collectionIdForIsbn('9780000000026').length).toBeLessThanOrEqual(40); // a valid sync id
  });
});

describe('the shelf with sets: one card, filters and search', () => {
  const collection = (id: string, title: string, expected: number | null): Collection => ({ id, household_id: 'main', title, cover_url: null, isbn: null, expected_count: expected });
  const narnia: CollectionView = (() => {
    const members = [book('n1', 1, 'The Magician’s Nephew'), book('n2', 2, 'The Lion, the Witch and the Wardrobe')].map((b) => ({ ...b, collection_id: 'narnia' }));
    return { collection: collection('narnia', 'Narnia', 2), members, slots: buildSlots(members, 2) };
  })();
  const entries = [
    { key: 'loose1', isbn: 'loose1', title: 'The Gruffalo', authors: ['Julia Donaldson'], collection: null },
    { key: 'n2', isbn: 'n2', title: 'The Lion, the Witch and the Wardrobe', authors: [], collection: 'narnia' },
    { key: 'gone', isbn: 'gone', title: 'Orphan', authors: [], collection: 'deleted-set' },
    { key: 'n1', isbn: 'n1', title: 'The Magician’s Nephew', authors: [], collection: 'narnia' },
  ];
  const items = groupShelf(entries, (e) => e.key, (e) => e.collection, [narnia]);

  it('a set is one item where its first book would be; a book of a missing set stays loose', () => {
    expect(items.map((i) => i.key)).toEqual(['loose1', 'set:narnia', 'gone']);
  });

  const run = (search: string, filter: 'all' | 'read' | 'unread', read: Set<string>) =>
    filterShelf(
      items,
      search,
      filter,
      (it) => (it.kind === 'set' ? setSearchables(it.view) : { title: it.entry.title, authors: it.entry.authors }),
      (it) => (it.kind === 'set' ? collectionProgress(it.view.slots, read, it.view.collection.expected_count).complete : read.has(it.entry.isbn)),
    ).visible.map((i) => i.key);

  it('the set counts as Read only with its trophy', () => {
    expect(run('', 'read', new Set(['n1']))).toEqual([]);
    expect(run('', 'unread', new Set(['n1']))).toEqual(['loose1', 'set:narnia', 'gone']);
    expect(run('', 'read', new Set(['n1', 'n2', 'loose1']))).toEqual(['loose1', 'set:narnia']);
  });

  it('search finds the set by its title or any of its books', () => {
    expect(run('narnia', 'all', new Set())).toEqual(['set:narnia']);
    expect(run('wardrobe', 'all', new Set())).toEqual(['set:narnia']);
    expect(run('nephew', 'unread', new Set())).toEqual(['set:narnia']);
    expect(run('donaldson', 'all', new Set())).toEqual(['loose1']);
    // Words from two different books of the set don't make a match together.
    expect(run('nephew wardrobe', 'all', new Set())).toEqual([]);
  });
});
