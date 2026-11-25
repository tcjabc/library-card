import { afterEach, describe, expect, it } from 'vitest';
import { HOUSEHOLD_ID, noteViewId } from '../../DataStore';
import { rawAll } from '../../testing/fixtures';
import { createSyncStore } from '../adapter';
import type { SyncDataStore } from '../types';
import { generateKey } from '../../../sync/vendor/crypto.js';
import { formatStamp, type Op } from '../../../sync/vendor/sync-core.js';

/**
 * Two (or three) devices, each with its own fake-indexeddb database and the sync adapter. They
 * exchange ops directly (pendingOps → applyRemote), in different orders and with duplicates,
 * and must end up with the same views.
 */

const ISBN_A = '9780000000002';
const ISBN_B = '9780000000019';
const T0 = Date.parse('2026-06-01T00:00:00.000Z');
const VIEWS = ['households', 'readers', 'books', 'home_items', 'libraries', 'library_cards', 'collections', 'parent_notes', 'note_views', 'loans', 'read_events', 'reader_journeys', 'read_summaries'];

interface Device {
  store: SyncDataStore;
  dbName: string;
  at: number;
  cursor: number;
}

const open: Device[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    await d.store.close();
    indexedDB.deleteDatabase(d.dbName);
  }
});

async function device(at = T0): Promise<Device> {
  const dbName = `conv-${crypto.randomUUID()}`;
  const d: Device = { dbName, at, cursor: 0, store: undefined as unknown as SyncDataStore };
  d.store = await createSyncStore(dbName, { now: () => d.at });
  open.push(d);
  return d;
}

/** Two devices in one household, sync on; the first has a household and a reader the second has received. */
async function household() {
  const key = generateKey();
  const a = await device(T0);
  const b = await device(T0 + 1);
  await a.store.getCurrentHousehold();
  const reader = await a.store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Ada', avatar: '🦊' });
  await a.store.enableSync(key);
  await b.store.enableSync(key);
  await send(a, b);
  return { key, a, b, reader };
}

const ops = (from: Device) => from.store.pendingOps(100_000);

/** Everything `from` has queued, applied on `to`. */
async function send(from: Device, to: Device, list?: readonly unknown[]) {
  return to.store.applyRemote(list ?? (await ops(from)), ++to.cursor);
}

/** Every view row, sorted, as JSON: equal text means equal data. */
async function views(d: Device): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const name of VIEWS) {
    const rows = await rawAll<Record<string, unknown>>(d.dbName, name);
    out[name] = rows
      .map((r) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]])))
      .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  }
  return JSON.stringify(out);
}

/** A few orders of a list, with every op twice in the last one. */
function orders<T>(list: T[]): T[][] {
  const shuffled = [...list].sort((x, y) => JSON.stringify(y).localeCompare(JSON.stringify(x)));
  return [list, [...list].reverse(), shuffled, [...list, ...list.slice().reverse()]];
}

describe('sync adapter: two devices converge', () => {
  it('concurrent edits to the same field: last writer wins, the same on both', async () => {
    const { a, b, reader } = await household();
    a.at = T0 + 10_000;
    await a.store.updateReader(reader.id, { display_name: 'From A' });
    b.at = T0 + 20_000; // later
    await b.store.updateReader(reader.id, { display_name: 'From B' });
    await send(a, b);
    await send(b, a);
    for (const d of [a, b]) expect((await d.store.getReader(reader.id))?.display_name).toBe('From B');
    expect(await views(a)).toBe(await views(b));
  });

  it('edits to different fields on two devices both survive', async () => {
    const { a, b, reader } = await household();
    a.at = T0 + 10_000;
    await a.store.updateReader(reader.id, { avatar: '🐢' });
    b.at = T0 + 10_500;
    await b.store.updateReader(reader.id, { display_name: 'Ada L.' });
    await send(b, a);
    await send(a, b);
    for (const d of [a, b]) expect(await d.store.getReader(reader.id)).toMatchObject({ avatar: '🐢', display_name: 'Ada L.' });
  });

  it('a loan edited on two devices: different fields both survive, the same field takes the later edit', async () => {
    const { a, b, reader } = await household();
    await a.store.putBook({ isbn: ISBN_A, title: 'First', authors: [], cover_url: null, source: 'manual' });
    await a.store.putBook({ isbn: ISBN_B, title: 'Second', authors: [], cover_url: null, source: 'manual' });
    const loan = await a.store.createLoan({ household_id: HOUSEHOLD_ID, reader_id: reader.id, isbn: ISBN_A, due_date: '2026-06-10' });
    await send(a, b);
    // A fixes the book and the sticker; B sets the renewals and returns it; both change the due date.
    a.at = T0 + 10_000;
    await a.store.updateLoan(loan.id, { isbn: ISBN_B, sticker_barcode: '31000777', due_date: '2026-06-20' });
    b.at = T0 + 20_000; // later
    await b.store.updateLoan(loan.id, { renew_count: 2, returned_at: '2026-06-05T09:00:00.000Z', due_date: '2026-06-30' });
    await send(a, b);
    await send(b, a);
    for (const d of [a, b]) {
      expect(await d.store.getLoan(loan.id)).toMatchObject({
        isbn: ISBN_B,
        sticker_barcode: '31000777',
        renew_count: 2,
        returned_at: '2026-06-05T09:00:00.000Z',
        due_date: '2026-06-30',
      });
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('the result is the same whatever order (and how often) ops arrive', async () => {
    const { a, b, reader } = await household();
    a.at = T0 + 10_000;
    await a.store.updateReader(reader.id, { display_name: 'A1' });
    await a.store.markRead(reader.id, ISBN_A, '2026-06-02T00:00:00.000Z');
    b.at = T0 + 12_000;
    await b.store.updateReader(reader.id, { avatar: '🐙' });
    await b.store.markRead(reader.id, ISBN_B, '2026-06-03T00:00:00.000Z');
    const all = [...(await ops(a)), ...(await ops(b))];
    const results = new Set<string>();
    for (const order of orders(all)) {
      const c = await device(T0 + 50_000);
      await c.store.applyRemote(order, 1);
      results.add(await views(c));
    }
    expect(results.size).toBe(1);
  });

  it('delete vs an earlier edit: the reader is gone on both, and its reads with it', async () => {
    const { a, b, reader } = await household();
    await a.store.markRead(reader.id, ISBN_A, '2026-06-02T00:00:00.000Z');
    await send(a, b);
    b.at = T0 + 10_000;
    await b.store.updateReader(reader.id, { display_name: 'Edited' });
    a.at = T0 + 20_000;
    await a.store.deleteReader(reader.id);
    await send(b, a);
    await send(a, b);
    for (const d of [a, b]) {
      expect(await d.store.getReader(reader.id)).toBeNull();
      expect(await d.store.listReadEvents(reader.id)).toEqual([]);
      expect(await d.store.countHouseholdReads(HOUSEHOLD_ID)).toBe(0);
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('checked reads: pending on A, confirmed on B, the counts agree; "Not yet" on B removes it on A', async () => {
    const { a, b, reader } = await household();
    a.at = T0 + 5_000;
    const grown = await a.store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Grown', avatar: '🦉', kind: 'grown_up' });
    const p1 = await a.store.markRead(reader.id, ISBN_A, '2026-06-01T10:00:00.000Z', { how: 'self', status: 'pending' });
    const p2 = await a.store.markRead(reader.id, ISBN_B, '2026-06-01T11:00:00.000Z', { how: 'help', status: 'pending' });
    await send(a, b);
    for (const d of [a, b]) {
      expect((await d.store.listPendingReads(HOUSEHOLD_ID)).map((e) => e.id).sort()).toEqual([p1!.id, p2!.id].sort());
      expect(await d.store.countHouseholdReads(HOUSEHOLD_ID)).toBe(0);
    }
    b.at = T0 + 20_000;
    await b.store.confirmRead(p1!.id, grown.id);
    await b.store.rejectRead(p2!.id);
    await send(b, a);
    for (const d of [a, b]) {
      expect(await d.store.listPendingReads(HOUSEHOLD_ID)).toEqual([]);
      expect((await d.store.getReadSummary(reader.id, ISBN_A))?.first_read_at).toBe('2026-06-01T10:00:00.000Z');
      expect(await d.store.countHouseholdReads(HOUSEHOLD_ID)).toBe(1);
      expect(await d.store.listReadEvents(reader.id, ISBN_B)).toEqual([]);
      expect((await d.store.listReadEvents(reader.id, ISBN_A))[0]?.confirmed_by).toBe(grown.id);
    }
    expect(await views(a)).toBe(await views(b));

    // needs_check syncs too; an older device's read (no status) counts.
    a.at = T0 + 30_000;
    await a.store.updateReader(reader.id, { needs_check: false });
    const older = await a.store.markRead(reader.id, ISBN_B, '2026-06-02T10:00:00.000Z');
    const withoutStatus = (await ops(a)).filter((o) => !(o.rec === `read_events:${older!.id}` && ['status', 'how', 'confirmed_at', 'confirmed_by'].includes(o.f)));
    await send(a, b, withoutStatus);
    expect((await b.store.getReader(reader.id))?.needs_check).toBe(false);
    expect((await b.store.getReadSummary(reader.id, ISBN_B))?.count).toBe(1);
  });

  it('reader kind: a grown-up made on A is one on B; a reader whose records have no kind is a child', async () => {
    const { a, b, reader } = await household();
    expect((await b.store.getReader(reader.id))?.kind).toBe('child');
    a.at = T0 + 5_000;
    const grown = await a.store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Grown', avatar: '🦉', kind: 'grown_up' });
    await send(a, b);
    expect((await b.store.getReader(grown.id))?.kind).toBe('grown_up');
    b.at = T0 + 10_000;
    await b.store.updateReader(grown.id, { kind: 'child' });
    await send(b, a);
    expect((await a.store.getReader(grown.id))?.kind).toBe('child');
    expect(await views(a)).toBe(await views(b));

    // An older device sends a reader without the kind field.
    a.at = T0 + 20_000;
    const older = await a.store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Older', avatar: '🐢', kind: 'grown_up' });
    const withoutKind = (await ops(a)).filter((o) => !(o.rec === `readers:${older.id}` && o.f === 'kind'));
    await send(a, b, withoutKind);
    expect((await b.store.getReader(older.id))?.kind).toBe('child');
  });

  it('library cards: one added on A shows on B; deleting the reader removes it on both', async () => {
    const { a, b, reader } = await household();
    const lib = await a.store.createLibrary({ household_id: HOUSEHOLD_ID, name: 'Branch' });
    a.at = T0 + 5_000;
    const card = await a.store.addLibraryCard({ household_id: HOUSEHOLD_ID, reader_id: reader.id, value: '21234000123456', format: 'codabar', library_id: lib.id, label: 'Town' });
    await send(a, b);
    expect(await b.store.getLibraryCard(card.id)).toEqual(card);
    expect(await b.store.listLibraryCards(reader.id)).toEqual([card]);
    expect(await views(a)).toBe(await views(b));

    b.at = T0 + 20_000;
    await b.store.deleteReader(reader.id);
    await send(b, a);
    for (const d of [a, b]) {
      expect(await d.store.getLibraryCard(card.id)).toBeNull();
      expect(await d.store.listHouseholdLibraryCards(HOUSEHOLD_ID)).toEqual([]);
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('library cards: a deleted library leaves its cards with the name, even when added meanwhile on the other device', async () => {
    const { a, b, reader } = await household();
    const lib = await a.store.createLibrary({ household_id: HOUSEHOLD_ID, name: 'Branch' });
    a.at = T0 + 5_000;
    const early = await a.store.addLibraryCard({ household_id: HOUSEHOLD_ID, reader_id: reader.id, value: 'A1', format: 'code_128', library_id: lib.id });
    await send(a, b);
    // B adds a card at the library while A deletes it, before they sync.
    b.at = T0 + 10_000;
    const late = await b.store.addLibraryCard({ household_id: HOUSEHOLD_ID, reader_id: reader.id, value: 'B2', format: 'code_128', library_id: lib.id });
    a.at = T0 + 12_000;
    await a.store.deleteLibrary(lib.id);
    await send(a, b);
    await send(b, a);
    for (const d of [a, b]) {
      expect(await d.store.getLibrary(lib.id)).toBeNull();
      const kept = await d.store.getLibraryCard(early.id);
      expect([kept?.library_id, kept?.library_name, kept?.value]).toEqual([null, 'Branch', 'A1']);
      // B's card still points at the library that is gone; it keeps the name it was saved with.
      const raced = await d.store.getLibraryCard(late.id);
      expect([raced?.library_name, raced?.value]).toEqual(['Branch', 'B2']);
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('delete vs a later edit: still deleted (the edit changes another field, not "del")', async () => {
    const { a, b, reader } = await household();
    a.at = T0 + 10_000;
    await a.store.deleteReader(reader.id);
    b.at = T0 + 20_000;
    await b.store.updateReader(reader.id, { display_name: 'Too late' });
    await send(a, b);
    await send(b, a);
    for (const d of [a, b]) expect(await d.store.getReader(reader.id)).toBeNull();
  });

  it('collections: made on A, members added on B, deleting on A unlinks them everywhere', async () => {
    const { a, b } = await household();
    a.at = T0 + 5_000;
    const set = await a.store.createCollection({ household_id: HOUSEHOLD_ID, title: 'Box', isbn: '9780000000026', expected_count: 2 });
    await send(a, b);
    expect((await b.store.getCollection(set.id))?.title).toBe('Box');

    b.at = T0 + 10_000;
    for (const [isbn, volume] of [[ISBN_A, 1], [ISBN_B, 2]] as const) {
      await b.store.putBook({ isbn, title: `Vol ${volume}`, authors: [], cover_url: null, source: 'manual' });
      await b.store.addHomeItem(HOUSEHOLD_ID, isbn);
      await b.store.setBookCollection(isbn, set.id, volume);
    }
    await send(b, a);
    for (const d of [a, b]) expect((await d.store.listCollectionBooks(set.id)).map((x) => [x.isbn, x.volume])).toEqual([[ISBN_A, 1], [ISBN_B, 2]]);
    expect(await views(a)).toBe(await views(b));

    a.at = T0 + 20_000;
    await a.store.deleteCollection(set.id);
    await send(a, b);
    for (const d of [a, b]) {
      expect(await d.store.getCollection(set.id)).toBeNull();
      expect((await d.store.getBooks([ISBN_A, ISBN_B])).map((x) => [x.title, x.collection_id, x.volume])).toEqual([
        ['Vol 1', null, null],
        ['Vol 2', null, null],
      ]);
      expect((await d.store.listHomeItems(HOUSEHOLD_ID)).length).toBe(2);
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('collections: the same box ISBN made on two devices is one collection; a book in a deleted one shows in none', async () => {
    const { a, b } = await household();
    for (const [d, at, title] of [[a, T0 + 10_000, 'From A'], [b, T0 + 11_000, 'From B']] as const) {
      d.at = at;
      await d.store.createCollection({ household_id: HOUSEHOLD_ID, title, isbn: '9780000000033', expected_count: 3 });
    }
    await send(a, b);
    await send(b, a);
    for (const d of [a, b]) {
      const list = await d.store.listCollections(HOUSEHOLD_ID);
      expect(list.map((c) => [c.id, c.title])).toEqual([['box-9780000000033', 'From B']]); // the later title wins
    }
    expect(await views(a)).toBe(await views(b));

    // A adds a member while B deletes the set: the book keeps a stale collection_id, which no
    // collection answers to (the screens show it loose); the views still match.
    a.at = T0 + 20_000;
    await a.store.putBook({ isbn: ISBN_A, title: 'Late member', authors: [], cover_url: null, source: 'manual' });
    await a.store.setBookCollection(ISBN_A, 'box-9780000000033', 1);
    b.at = T0 + 21_000;
    await b.store.deleteCollection('box-9780000000033');
    await send(a, b);
    await send(b, a);
    for (const d of [a, b]) {
      expect(await d.store.getCollection('box-9780000000033')).toBeNull();
      expect((await d.store.getBook(ISBN_A))?.title).toBe('Late member');
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('collections: a set made on A from picked books while B moves some of them: the later write wins per book, no orphans', async () => {
    const { a, b, reader } = await household();
    const ISBN_C = '9780000000026';
    a.at = T0 + 5_000;
    for (const [isbn, title] of [[ISBN_A, 'One'], [ISBN_B, 'Two'], [ISBN_C, 'Borrowed']] as const) {
      await a.store.putBook({ isbn, title, authors: [], cover_url: null, source: 'manual' });
    }
    await a.store.addHomeItem(HOUSEHOLD_ID, ISBN_A);
    await a.store.addHomeItem(HOUSEHOLD_ID, ISBN_B);
    await a.store.createLoan({ household_id: HOUSEHOLD_ID, reader_id: reader.id, isbn: ISBN_C });
    const other = await a.store.createCollection({ household_id: HOUSEHOLD_ID, title: 'Other', expected_count: 5 });
    await send(a, b);

    // Not synced meanwhile. B moves ISBN_A into Other before A's pick, and ISBN_B after it.
    b.at = T0 + 15_000;
    await b.store.setBookCollection(ISBN_A, other.id, 1);
    a.at = T0 + 20_000;
    const picked = await a.store.createCollection({ household_id: HOUSEHOLD_ID, title: 'Picked', expected_count: 3 });
    expect(
      await a.store.setBooksCollection(picked.id, [
        { isbn: ISBN_A, volume: 1 },
        { isbn: ISBN_B, volume: 2 },
        { isbn: ISBN_C, volume: 3 },
      ]),
    ).toBe(3);
    b.at = T0 + 25_000;
    await b.store.setBookCollection(ISBN_B, other.id, 2);

    const all = [...(await ops(a)), ...(await ops(b))];
    await send(a, b);
    await send(b, a);
    const expected = [
      [ISBN_A, picked.id, 1], // A's pick is later than B's move
      [ISBN_B, other.id, 2], // B's move is later than A's pick
      [ISBN_C, picked.id, 3],
    ];
    for (const d of [a, b]) {
      expect((await d.store.getBooks([ISBN_A, ISBN_B, ISBN_C])).map((x) => [x.isbn, x.collection_id, x.volume])).toEqual(expected);
      // The borrowed pick is at Home on both, and every book's set exists (no orphans).
      expect((await d.store.getHomeItem(HOUSEHOLD_ID, ISBN_C))?.isbn).toBe(ISBN_C);
      const ids = new Set((await d.store.listCollections(HOUSEHOLD_ID)).map((c) => c.id));
      for (const book of await d.store.getBooks([ISBN_A, ISBN_B, ISBN_C])) expect(ids.has(book.collection_id ?? '')).toBe(true);
    }
    expect(await views(a)).toBe(await views(b));

    // The same ops in any order (and twice) end the same on a third device.
    const results = new Set<string>();
    for (const order of orders(all)) {
      const c = await device(T0 + 50_000);
      await c.store.applyRemote(order, 1);
      results.add(await views(c));
    }
    expect(results.size).toBe(1);
  });

  it('parent notes: written on A shows on B; seen on B is seen on A (once, the same id); show again and deleting a reader reach both', async () => {
    const { a, b, reader } = await household();
    a.at = T0 + 5_000;
    const note = await a.store.createNote({ household_id: HOUSEHOLD_ID, target: 'everyone', trigger: 'after_book', text: 'Well done!', sticker: '🦊' });
    const forReader = await a.store.createNote({ household_id: HOUSEHOLD_ID, target: reader.id, trigger: 'journey_done', text: 'Just for you' });
    await send(a, b);
    expect((await b.store.listNotes(HOUSEHOLD_ID)).map((n) => n.text)).toEqual(['Well done!', 'Just for you']);

    b.at = T0 + 10_000;
    await b.store.markNoteSeen(note.id, reader.id);
    // Seen on both at once (before either heard): still one record, the same id.
    a.at = T0 + 11_000;
    await a.store.markNoteSeen(note.id, reader.id);
    await send(b, a);
    await send(a, b);
    for (const d of [a, b]) {
      expect((await d.store.listNoteViews(HOUSEHOLD_ID)).map((v) => v.id)).toEqual([noteViewId(note.id, reader.id)]);
      expect((await d.store.listNotesForReader(reader.id))[0].seen_at).not.toBeNull();
    }
    expect(await views(a)).toBe(await views(b));

    a.at = T0 + 20_000;
    await a.store.showAgain(note.id, reader.id);
    await send(a, b);
    expect((await b.store.listNotesForReader(reader.id))[0].seen_at).toBeNull();

    b.at = T0 + 30_000;
    await b.store.markNoteSeen(forReader.id, reader.id);
    await b.store.deleteReader(reader.id);
    await send(b, a);
    for (const d of [a, b]) {
      expect((await d.store.listNotes(HOUSEHOLD_ID)).map((n) => n.id)).toEqual([note.id]);
      expect(await d.store.listNoteViews(HOUSEHOLD_ID)).toEqual([]);
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('deterministic ids: the same home book added on both devices is one row', async () => {
    const { a, b } = await household();
    for (const [d, at] of [[a, T0 + 10_000], [b, T0 + 11_000]] as const) {
      d.at = at;
      await d.store.putBook({ isbn: ISBN_A, title: 'Same book', authors: ['X'], cover_url: null, source: 'manual' });
      await d.store.addHomeItem(HOUSEHOLD_ID, ISBN_A);
    }
    await send(a, b);
    await send(b, a);
    for (const d of [a, b]) {
      expect((await d.store.listHomeItems(HOUSEHOLD_ID)).map((h) => h.isbn)).toEqual([ISBN_A]);
      expect((await d.store.getBooks([ISBN_A])).length).toBe(1);
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('read events from both devices are all kept, and the summaries match', async () => {
    const { a, b, reader } = await household();
    await a.store.markRead(reader.id, ISBN_A, '2026-06-02T09:00:00.000Z');
    await b.store.markRead(reader.id, ISBN_A, '2026-06-03T09:00:00.000Z');
    await b.store.markRead(reader.id, ISBN_B, '2026-06-04T09:00:00.000Z');
    await send(a, b);
    await send(b, a);
    for (const d of [a, b]) {
      expect((await d.store.listReadEvents(reader.id)).length).toBe(3);
      expect(await d.store.getReadSummary(reader.id, ISBN_A)).toMatchObject({
        count: 2,
        first_read_at: '2026-06-02T09:00:00.000Z',
        last_read_at: '2026-06-03T09:00:00.000Z',
      });
      expect(await d.store.countHouseholdReads(HOUSEHOLD_ID)).toBe(2);
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('concurrent journey starts: one is active on both, the other shows as abandoned', async () => {
    const { a, b, reader } = await household();
    a.at = T0 + 10_000;
    const ja = await a.store.startJourney(reader.id, 'ocean_deep');
    b.at = T0 + 10_500;
    const jb = await b.store.startJourney(reader.id, 'skyscraper');
    await send(a, b);
    await send(b, a);
    const active = await Promise.all([a, b].map((d) => d.store.getActiveJourney(reader.id)));
    expect(active[0]?.id).toBe(active[1]?.id);
    expect([ja.id, jb.id]).toContain(active[0]?.id);
    for (const d of [a, b]) {
      const history = await d.store.listJourneyHistory(reader.id);
      expect(history.length).toBe(2);
      const loser = history.find((j) => j.id !== active[0]?.id)!;
      expect(loser.abandoned_at).not.toBeNull();
      expect(loser.completed_at).toBeNull();
    }
    expect(await views(a)).toBe(await views(b));
  });

  it('a completed journey stays completed, even when a stale or late op arrives', async () => {
    const { a, b, reader } = await household();
    const j = await a.store.startJourney(reader.id, 'ocean_deep', '2026-06-01T01:00:00.000Z');
    a.at = T0 + 30_000;
    await a.store.completeJourney(j.id, '2026-06-02T00:00:00.000Z');
    // Another device clearing completed_at with a later stamp (a stale copy, or a bug).
    const undo: Op = { id: 'x', rec: `reader_journeys:${j.id}`, f: 'completed_at', v: null, t: formatStamp(T0 + 90_000, 0, 'devZ'), dev: 'devZ' };
    const all = [...(await ops(a)), undo];
    const results = new Set<string>();
    for (const order of orders(all)) {
      const c = await device(T0 + 100_000);
      await c.store.applyRemote(order, 1);
      expect((await c.store.listJourneyHistory(reader.id))[0]?.completed_at).toBe('2026-06-02T00:00:00.000Z');
      expect(await c.store.countCompletedJourneys(reader.id)).toEqual({ ocean_deep: 1 });
      results.add(await views(c));
    }
    expect(results.size).toBe(1);
    void b;
  });

  it('an incomplete record stays hidden until the rest of its ops arrive', async () => {
    const key = generateKey();
    const a = await device();
    const b = await device();
    await a.store.enableSync(key);
    await b.store.enableSync(key);
    await a.store.getCurrentHousehold();
    const r = await a.store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Bea', avatar: '🐼' });
    const all = await ops(a);
    const withoutToken = all.filter((o) => o.f !== 'card_token');
    await b.store.applyRemote(withoutToken, 1);
    expect(await b.store.getReader(r.id)).toBeNull();
    await b.store.applyRemote(all.filter((o) => o.f === 'card_token'), 2);
    expect(await b.store.getReader(r.id)).toMatchObject({ display_name: 'Bea', card_token: r.card_token });
  });

  it('children of a missing reader are hidden, then appear with the reader', async () => {
    const key = generateKey();
    const a = await device();
    const b = await device();
    await a.store.enableSync(key);
    await b.store.enableSync(key);
    await a.store.getCurrentHousehold();
    const r = await a.store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Cy', avatar: '🐸' });
    await a.store.markRead(r.id, ISBN_A, '2026-06-02T00:00:00.000Z');
    await a.store.createLoan({ household_id: HOUSEHOLD_ID, reader_id: r.id, isbn: ISBN_B });
    await a.store.startJourney(r.id, 'ocean_deep');
    const all = await ops(a);
    const children = all.filter((o) => !o.rec.startsWith('readers:'));
    await b.store.applyRemote(children, 1);
    expect((await rawAll(b.dbName, 'read_events')).length).toBe(0);
    expect((await rawAll(b.dbName, 'loans')).length).toBe(0);
    expect((await rawAll(b.dbName, 'reader_journeys')).length).toBe(0);
    expect((await rawAll(b.dbName, 'read_summaries')).length).toBe(0);
    await b.store.applyRemote(all.filter((o) => o.rec.startsWith('readers:')), 2);
    expect((await b.store.listReadEvents(r.id)).length).toBe(1);
    expect((await b.store.listActiveLoans(r.id)).length).toBe(1);
    expect((await b.store.getActiveJourney(r.id))?.journey_id).toBe('ocean_deep');
    expect((await b.store.getReadSummary(r.id, ISBN_A))?.count).toBe(1);
    expect(await views(b)).toBe(await views(a));
  });

  it('invalid ops are skipped and counted; the valid ones still apply', async () => {
    const { a, b, reader } = await household();
    await a.store.updateReader(reader.id, { display_name: 'Valid' });
    const good = await ops(a);
    const t = formatStamp(T0 + 5_000, 0, 'devZ');
    const bad = [
      null,
      { id: 'x', rec: 'meta:x', f: 'v', v: 1, t, dev: 'devZ' },
      { id: 'x', rec: `readers:${reader.id}`, f: 'display_name', v: 42, t, dev: 'devZ' },
      { id: 'x', rec: `readers:${reader.id}`, f: 'household_id', v: 'other', t, dev: 'devZ' },
    ];
    const result = await b.store.applyRemote([...bad.slice(0, 2), ...good, ...bad.slice(2)], 9);
    expect(result.skipped).toBe(4);
    expect((await b.store.getReader(reader.id))?.display_name).toBe('Valid');
    expect(await b.store.getCursor()).toBe(9);
  });

  it('re-applying the same ops changes nothing and announces nothing', async () => {
    const { a, b } = await household();
    const list = await ops(a);
    const before = await views(b);
    const heard: unknown[] = [];
    const off = b.store.subscribe((c) => heard.push(c));
    const again = await b.store.applyRemote(list, 5);
    off();
    expect(again.changed).toBe(0);
    expect(heard).toEqual([]);
    expect(await views(b)).toBe(before);
  });

  it('enableSync on a populated device: its records rebuild identical views on an empty device', async () => {
    const a = await device();
    const h = await a.store.getCurrentHousehold();
    await a.store.updateHousehold(h.id, { name: 'The Readers' });
    const r1 = await a.store.createReader({ household_id: h.id, display_name: 'Ada', avatar: '🦊' });
    const r2 = await a.store.createReader({ household_id: h.id, display_name: 'Ben', avatar: '🐢' });
    await a.store.putBook({ isbn: ISBN_A, title: 'A book', authors: ['X'], cover_url: 'https://example.org/a.jpg', source: 'openlibrary' });
    await a.store.putBook({ isbn: ISBN_B, title: 'B book', authors: [], cover_url: null, source: 'manual' });
    await a.store.addHomeItem(h.id, ISBN_A);
    const lib = await a.store.createLibrary({ household_id: h.id, name: 'Branch', sticker_prefix: '31' });
    const loan = await a.store.createLoan({ household_id: h.id, reader_id: r1.id, isbn: ISBN_B, library_id: lib.id, sticker_barcode: '3100', due_date: '2026-07-01' });
    await a.store.returnLoan(loan.id, '2026-06-20T00:00:00.000Z');
    await a.store.createLoan({ household_id: h.id, reader_id: r2.id, isbn: ISBN_A });
    await a.store.markRead(r1.id, ISBN_A, '2026-06-02T00:00:00.000Z');
    await a.store.markRead(r1.id, ISBN_A, '2026-06-03T00:00:00.000Z');
    await a.store.markRead(r2.id, ISBN_B, '2026-06-04T00:00:00.000Z');
    const j1 = await a.store.startJourney(r1.id, 'ocean_deep', '2026-06-01T00:00:00.000Z');
    await a.store.completeJourney(j1.id, '2026-06-05T00:00:00.000Z');
    await a.store.startJourney(r2.id, 'redwood_tree', '2026-06-01T00:00:00.000Z');
    await a.store.startJourney(r2.id, 'skyscraper', '2026-06-06T00:00:00.000Z'); // abandons redwood

    const key = generateKey();
    const enabled = await a.store.enableSync(key);
    expect(enabled.skipped).toBe(0);
    expect(enabled.records).toBe(1 + 2 + 2 + 1 + 1 + 2 + 3 + 3);
    const empty = await device();
    await empty.store.enableSync(key);
    await empty.store.applyRemote(await ops(a), 1);
    expect(await views(empty)).toBe(await views(a));
  });

  it('three devices, offline edits and duplicates, all converge', async () => {
    const { key, a, b, reader } = await household();
    const c = await device(T0 + 2);
    await c.store.enableSync(key);
    await send(a, c);
    a.at = T0 + 40_000;
    await a.store.updateReader(reader.id, { display_name: 'A' });
    b.at = T0 + 41_000;
    await b.store.markRead(reader.id, ISBN_A, '2026-06-02T00:00:00.000Z');
    c.at = T0 + 42_000;
    await c.store.updateReader(reader.id, { avatar: '🐝' });
    for (const [from, to] of [[a, b], [b, c], [c, a], [a, b], [b, a], [a, c], [c, b]] as const) await send(from, to);
    expect(await views(a)).toBe(await views(b));
    expect(await views(b)).toBe(await views(c));
    expect(await a.store.getReader(reader.id)).toMatchObject({ display_name: 'A', avatar: '🐝' });
  });
});
