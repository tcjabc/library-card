import { afterEach, describe, expect, it } from 'vitest';
import { HOUSEHOLD_ID } from '../../DataStore';
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
const VIEWS = ['households', 'readers', 'books', 'home_items', 'libraries', 'library_cards', 'loans', 'read_events', 'reader_journeys', 'read_summaries'];

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
