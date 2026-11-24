import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStore, type LocalDataStore } from '../adapters/local';
import { familyPart } from '../../staircase/bookFamily';
import { stackItems } from '../../staircase/stackItems';

// The Family Staircase's book sheet (src/staircase/bookFamily.ts) on what a real local store
// returns: pending reads never count, returned loans don't show. It lives here because only
// src/data may open the adapter directly.

const ISBN = '9780000000002';

let store: LocalDataStore;
let dbName: string;
let kid: string;
let grown: string;

beforeEach(async () => {
  dbName = `sheet-family-test-${crypto.randomUUID()}`;
  store = await createLocalStore(dbName);
  const household = await store.getCurrentHousehold();
  kid = (await store.createReader({ household_id: household.id, display_name: 'Kid', avatar: '🦊' })).id;
  grown = (await store.createReader({ household_id: household.id, display_name: 'Grown-up', avatar: '🦉', kind: 'grown_up' })).id;
  await store.putBook({ isbn: ISBN, title: 'Moon Soup', authors: [], cover_url: null, source: 'manual' });
});

afterEach(async () => {
  await store.close();
  indexedDB.deleteDatabase(dbName);
});

async function family() {
  const household = await store.getCurrentHousehold();
  const [summaries, readers, loans, libraries] = await Promise.all([
    store.listHouseholdReadSummaries(household.id),
    store.listReaders(household.id),
    store.listLoans(household.id, { active: true }),
    store.listLibraries(household.id),
  ]);
  const items = stackItems(summaries, readers, () => 'Moon Soup', { title: 'A book', avatar: '📖' });
  const partOf = (item: (typeof items)[number]) =>
    familyPart({ item, summaries, readers, loans, libraries, homeIsbns: new Set(), book: null, collections: [], someone: { name: 'Someone', avatar: '📖' } });
  const item = items.find((i) => i.isbn === ISBN);
  return { items, partOf, part: item ? partOf(item) : null };
}

describe('the book sheet’s family part on a real store', () => {
  it('ignores pending reads: the first reader, the counts and the number are confirmed reads only', async () => {
    // The kid read it first, but that read still waits for a grown-up.
    await store.markRead(kid, ISBN, '2026-03-01T10:00:00.000Z', { status: 'pending' });
    await store.markRead(grown, ISBN, '2026-03-04T10:00:00.000Z');
    await store.markRead(grown, ISBN, '2026-03-06T10:00:00.000Z');
    let { items, part } = await family();
    expect(items).toHaveLength(1);
    expect(part).toMatchObject({ first: { readerId: grown, at: '2026-03-04T10:00:00.000Z' }, step: 1, total: 2 });
    expect(part?.reads.map((r) => [r.readerId, r.count])).toEqual([[grown, 2]]);

    // Once confirmed, the kid's read counts from when they read it.
    const [pending] = await store.listPendingReads((await store.getCurrentHousehold()).id, kid);
    await store.confirmRead(pending.id, 'pin');
    const after = await family();
    ({ items, part } = after);
    expect(items).toHaveLength(2);
    expect(part).toMatchObject({ first: { readerId: kid, at: '2026-03-01T10:00:00.000Z' }, step: 1, total: 3 });
    // The grown-up's own pile book still names the grown-up, with every reader's counts.
    const grownBook = after.partOf(items.find((i) => i.readerId === grown)!);
    expect(grownBook).toMatchObject({ first: { readerId: grown, at: '2026-03-04T10:00:00.000Z' }, step: 2, total: 3 });
    expect(grownBook.reads.map((r) => [r.readerId, r.count])).toEqual([
      [kid, 1],
      [grown, 2],
    ]);
  });

  it('shows a loan until it is returned', async () => {
    await store.markRead(kid, ISBN, '2026-03-01T10:00:00.000Z');
    const household = await store.getCurrentHousehold();
    const library = await store.createLibrary({ household_id: household.id, name: 'Pretend Library' });
    const loan = await store.createLoan({ household_id: household.id, reader_id: kid, isbn: ISBN, library_id: library.id, due_date: '2026-03-20' });
    expect((await family()).part?.loans).toEqual([{ library: 'Pretend Library', borrower: { readerId: kid, name: 'Kid', avatar: '🦊' }, due: '2026-03-20' }]);
    await store.returnLoan(loan.id);
    expect((await family()).part?.loans).toEqual([]);
  });
});
