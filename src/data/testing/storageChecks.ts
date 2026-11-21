import { createLocalStore, type LocalDataStore, type LocalStoreOptions } from '../adapters/local';
import { createSyncStore } from '../sync/adapter';
import {
  DEFAULT_LOAN_DAYS,
  HOUSEHOLD_ID,
  MAX_COVER_BYTES,
  READ_TAP_GUARD_MS,
  type DataChange,
  type ReadEvent,
} from '../DataStore';
import { BACKUP_FORMAT, summariseBackup } from '../backup';
import { hashPin, verifyPin } from '../pin';
import { equal, ok, rejectsWithCode } from './assert';
import {
  ISBN_A,
  ISBN_B,
  ISBN_C,
  ISBN_D,
  T,
  blobAt,
  createV1Database,
  createV2Database,
  createV3Database,
  jpeg,
  rawAll,
  rawDelete,
  rawGet,
  rawIndexNames,
  rawStoreNames,
  sameBytes,
  sha256Hex,
} from './fixtures';

/**
 * Storage checks for the local adapter, shared by two runners:
 *   - src/data/selftest.ts, the in-app self-test page (real browsers and phones);
 *   - src/data/__tests__/storage.test.ts, Vitest on Node with fake-indexeddb.
 * Each check gets its own throwaway database, so checks are independent.
 * A check passes by returning and fails by throwing (see ./assert).
 */

export interface CheckContext {
  /** A fresh store on its own new, empty throwaway database. */
  open(options?: LocalStoreOptions): Promise<{ store: LocalDataStore; dbName: string }>;
  /** Another store on an existing database: a "second tab", or a reopen. */
  attach(dbName: string, options?: LocalStoreOptions): Promise<LocalDataStore>;
  /** A new throwaway database name, for raw fixtures. */
  name(): string;
}

export interface StorageCheck {
  group: string;
  name: string;
  run(ctx: CheckContext): Promise<void>;
}

let counter = 0;

/** Which adapter the checks run against. Both must behave the same. */
export type CheckAdapter = 'local' | 'sync';
export const CHECK_ADAPTERS: readonly CheckAdapter[] = ['local', 'sync'];

/** A context whose databases are all closed and deleted by cleanup(). */
export function createCheckContext(adapter: CheckAdapter = 'local'): { ctx: CheckContext; cleanup(): Promise<void> } {
  const stores: LocalDataStore[] = [];
  const names = new Set<string>();
  const name = () => {
    const n = `lc-check-${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
    names.add(n);
    return n;
  };
  const attach = async (dbName: string, options?: LocalStoreOptions) => {
    names.add(dbName);
    const store = adapter === 'sync' ? await createSyncStore(dbName, options) : await createLocalStore(dbName, options);
    stores.push(store);
    return store;
  };
  return {
    ctx: {
      name,
      attach,
      async open(options) {
        const dbName = name();
        return { store: await attach(dbName, options), dbName };
      },
    },
    async cleanup() {
      for (const store of stores) await store.close().catch(() => undefined);
      await Promise.all(
        [...names].map(
          (n) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(n);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            }),
        ),
      );
    },
  };
}

// --- helpers -----------------------------------------------------------------

async function withReaders(ctx: CheckContext, options?: LocalStoreOptions) {
  const { store, dbName } = await ctx.open(options);
  const h = await store.getCurrentHousehold();
  const a = await store.createReader({ household_id: h.id, display_name: 'A', avatar: '🦊' });
  const b = await store.createReader({ household_id: h.id, display_name: 'B', avatar: '🐢' });
  return { store, dbName, h, a, b };
}

const check = (group: string, name: string, run: (ctx: CheckContext) => Promise<void>): StorageCheck => ({ group, name, run });

// --- checks ------------------------------------------------------------------

export const storageChecks: StorageCheck[] = [
  // Household -----------------------------------------------------------------
  check('household', 'getCurrentHousehold is "main" and created once, even when called concurrently', async (ctx) => {
    const { store, dbName } = await ctx.open();
    const [x, y] = await Promise.all([store.getCurrentHousehold(), store.getCurrentHousehold()]);
    equal([x.id, y.id], [HOUSEHOLD_ID, HOUSEHOLD_ID], 'both calls return "main"');
    equal((await rawAll(dbName, 'households')).length, 1, 'one household row');
    equal((await store.getCurrentHousehold()).id, HOUSEHOLD_ID, 'stable on a later call');
  }),
  check('household', 'getHousehold and updateHousehold', async (ctx) => {
    const { store } = await ctx.open();
    await store.getCurrentHousehold();
    equal(await store.getHousehold('nope'), null, 'unknown id -> null');
    const updated = await store.updateHousehold(HOUSEHOLD_ID, { name: 'Renamed', parent_pin_hash: 'x' });
    equal([updated.id, updated.name, updated.parent_pin_hash], [HOUSEHOLD_ID, 'Renamed', 'x'], 'patch applied, id kept');
    equal((await store.getHousehold(HOUSEHOLD_ID))?.name, 'Renamed', 'stored');
    await rejectsWithCode(store.updateHousehold('nope', { name: 'x' }), 'not_found', 'update unknown -> not_found');
  }),
  check('household', 'updateHousehold trims the name and refuses an empty one', async (ctx) => {
    const { store } = await ctx.open();
    await store.getCurrentHousehold();
    equal((await store.updateHousehold(HOUSEHOLD_ID, { name: '  The Readers  ' })).name, 'The Readers', 'trimmed');
    await rejectsWithCode(store.updateHousehold(HOUSEHOLD_ID, { name: '   ' }), 'invalid', 'blank name');
    equal((await store.getHousehold(HOUSEHOLD_ID))?.name, 'The Readers', 'unchanged after the refusal');
  }),

  // Readers -------------------------------------------------------------------
  check('readers', 'createReader: defaults, household required, unique card token', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    equal(a.active_journey_id, null, 'no active journey');
    ok(/^[A-Za-z0-9_-]{22,}$/.test(a.card_token), 'card token is base64url with >= 128 bits', a.card_token.length);
    await rejectsWithCode(store.createReader({ household_id: 'nope', display_name: 'X', avatar: '🦊' }), 'not_found', 'unknown household');
    await rejectsWithCode(
      store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'X', avatar: '🦊', card_token: a.card_token }),
      'conflict',
      'duplicate card token',
    );
  }),
  check('readers', 'getReader, listReaders (by name) and updateReader', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    equal((await store.getReader(a.id))?.display_name, 'A', 'getReader');
    equal(await store.getReader('nope'), null, 'unknown -> null');
    await store.updateReader(b.id, { display_name: 'Aaron' });
    equal((await store.listReaders(h.id)).map((r) => r.display_name), ['A', 'Aaron'], 'sorted by name');
    const updated = await store.updateReader(a.id, { avatar: '🐼' });
    equal([updated.avatar, updated.card_token, updated.active_journey_id], ['🐼', a.card_token, null], 'other fields kept');
    await rejectsWithCode(store.updateReader('nope', { avatar: '🐼' }), 'not_found', 'update unknown');
  }),
  check('readers', 'getReaderByCardToken and rotateCardToken', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    equal((await store.getReaderByCardToken(a.card_token))?.id, a.id, 'finds the reader');
    equal(await store.getReaderByCardToken('nope'), null, 'unknown token');
    equal(await store.getReaderByCardToken(''), null, 'empty token');
    const rotated = await store.rotateCardToken(a.id);
    ok(rotated.card_token !== a.card_token && /^[A-Za-z0-9_-]{22,}$/.test(rotated.card_token), 'new token');
    equal(await store.getReaderByCardToken(a.card_token), null, 'old token retired');
    equal((await store.getReaderByCardToken(rotated.card_token))?.id, a.id, 'new token works');
    await rejectsWithCode(store.rotateCardToken('nope'), 'not_found', 'rotate unknown');
  }),
  check('readers', 'deleteReader removes the reader with their events, summaries, journeys and returned loans', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    await store.markRead(b.id, ISBN_A, '2026-01-01T00:00:00Z');
    await store.markRead(b.id, ISBN_A, '2026-01-01T09:00:00Z');
    await store.markRead(b.id, ISBN_B, '2026-01-02T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-01-03T00:00:00Z');
    const returned = await store.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_C });
    await store.returnLoan(returned.id);
    const others = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_D });
    const journey = await store.startJourney(b.id, 'ocean_deep');
    equal(
      await store.previewDeleteReader(b.id),
      { readEvents: 3, booksRead: 2, journeys: 1, returnedLoans: 1, activeLoans: 0 },
      'dry run counts',
    );
    equal((await store.listReadEvents(b.id)).length, 3, 'the dry run deleted nothing');
    await store.deleteReader(b.id);
    equal(await store.getReader(b.id), null, 'reader gone');
    equal((await store.listReadEvents(b.id)).length, 0, 'events gone');
    equal((await store.listReadSummaries(b.id)).length, 0, 'summaries gone');
    equal(await store.getLoan(returned.id), null, 'returned loan gone');
    equal((await store.listJourneyHistory(b.id)).map((j) => j.id).includes(journey.id), false, 'journey gone');
    equal(await store.countHouseholdReads(h.id), 1, "the other reader's read stays");
    ok(await store.getLoan(others.id), "the other reader's loan stays");
    await rejectsWithCode(store.deleteReader(b.id), 'not_found', 'delete unknown');
    await rejectsWithCode(store.previewDeleteReader(b.id), 'not_found', 'preview unknown');
  }),
  check('readers', 'deleteReader is blocked while the reader has an active loan, then allowed once it is returned', async (ctx) => {
    const { store, h, b } = await withReaders(ctx);
    await store.markRead(b.id, ISBN_A, '2026-01-01T00:00:00Z');
    const loan = await store.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_C });
    equal((await store.previewDeleteReader(b.id)).activeLoans, 1, 'dry run shows the active loan');
    await rejectsWithCode(store.deleteReader(b.id), 'blocked', 'blocked by the active loan');
    ok(await store.getReader(b.id), 'reader kept');
    equal((await store.listReadEvents(b.id)).length, 1, 'reads kept');
    ok(await store.getLoan(loan.id), 'loan kept');
    await store.returnLoan(loan.id);
    await store.deleteReader(b.id);
    equal(await store.getReader(b.id), null, 'deleted after returning');
    equal(await store.getLoan(loan.id), null, 'the returned loan went with them');
  }),

  // Subscribe -------------------------------------------------------------------
  check('subscribe', 'listeners hear local writes; unsubscribe stops them', async (ctx) => {
    const { store } = await ctx.open();
    const seen: DataChange[] = [];
    const off = store.subscribe((c) => seen.push(c));
    await store.getCurrentHousehold();
    await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'A', avatar: '🦊' });
    ok(seen.some((c) => c.tables.includes('readers') && !c.remote), 'local change seen', seen);
    off();
    const before = seen.length;
    await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'B', avatar: '🐢' });
    equal(seen.length, before, 'nothing after unsubscribe');
  }),
  check('subscribe', 'another store on the same database hears changes as remote', async (ctx) => {
    const { store, dbName } = await ctx.open();
    const other = await ctx.attach(dbName);
    const arrived = new Promise<DataChange>((resolve) => {
      const off = other.subscribe((c) => {
        off();
        resolve(c);
      });
    });
    await store.getCurrentHousehold();
    await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'A', avatar: '🦊' });
    const change = await Promise.race([arrived, new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
    ok(change?.remote === true, 'remote change arrived through BroadcastChannel', change);
  }),

  // Books and covers ------------------------------------------------------------
  check('books', 'putBook, getBook and getBooks', async (ctx) => {
    const { store } = await ctx.open();
    const book = await store.putBook({ isbn: ISBN_A, title: 'A', authors: ['X', 'Y'], cover_url: 'https://example.org/a.jpg', source: 'google' });
    equal(book.authors, ['X', 'Y'], 'putBook returns the book');
    equal((await store.getBook(ISBN_A))?.title, 'A', 'getBook');
    equal(await store.getBook(ISBN_B), null, 'unknown -> null');
    await store.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: null, source: 'manual' });
    equal((await store.getBooks([ISBN_A, ISBN_C, ISBN_B])).map((b) => b.isbn), [ISBN_A, ISBN_B], 'missing ISBNs left out');
  }),
  check('books', 'saveCoverImage stores photos by content as cover:<sha256>, once', async (ctx) => {
    const { store, dbName } = await ctx.open();
    const image = jpeg(1, 2, 3);
    const url = await store.saveCoverImage(image);
    ok(url.startsWith('blob:'), 'returns a blob: URL', url.slice(0, 10));
    await store.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: url, source: 'manual' });
    equal((await rawGet<{ cover_url: string }>(dbName, 'books', ISBN_A))?.cover_url, `cover:${await sha256Hex(image)}`, 'stored reference');
    const again = await store.saveCoverImage(jpeg(1, 2, 3));
    await store.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: again, source: 'manual' });
    equal((await rawAll(dbName, 'cover_images')).length, 1, 'the same image is stored once');
    ok(await sameBytes(await blobAt((await store.getBook(ISBN_A))?.cover_url), image), 'getBook resolves to the photo');
  }),
  check('books', 'another store resolves its own blob: URL for the same photo', async (ctx) => {
    const { store, dbName } = await ctx.open();
    const url = await store.saveCoverImage(jpeg(4, 5));
    await store.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: url, source: 'manual' });
    const other = await ctx.attach(dbName);
    const theirs = (await other.getBook(ISBN_A))?.cover_url;
    ok(!!theirs?.startsWith('blob:') && theirs !== url, 'a different live URL', theirs?.slice(0, 10));
    ok(await sameBytes(await blobAt(theirs), jpeg(4, 5)), 'same bytes');
  }),
  check('books', 'cover photo limits: empty, oversize and stale blob: URLs are rejected', async (ctx) => {
    const { store } = await ctx.open();
    await rejectsWithCode(store.saveCoverImage(new Blob([])), 'invalid', 'empty photo');
    await rejectsWithCode(store.saveCoverImage(new Blob([new Uint8Array(MAX_COVER_BYTES + 1)], { type: 'image/jpeg' })), 'invalid', 'oversize photo');
    ok(!!(await store.saveCoverImage(new Blob([new Uint8Array(MAX_COVER_BYTES)], { type: 'image/jpeg' }))), 'exactly the limit is fine');
    await rejectsWithCode(
      store.putBook({ isbn: ISBN_C, title: 'C', authors: [], cover_url: 'blob:https://x/y', source: 'manual' }),
      'invalid',
      'stale blob: URL',
    );
  }),
  check('books', 'a photo is kept while any book uses it and removed when none does', async (ctx) => {
    const { store, dbName } = await ctx.open();
    const url = await store.saveCoverImage(jpeg(9));
    await store.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: url, source: 'manual' });
    await store.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: url, source: 'manual' });
    await store.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: 'https://example.org/a.jpg', source: 'manual' });
    equal((await rawAll(dbName, 'cover_images')).length, 1, 'still used by B');
    await store.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: null, source: 'manual' });
    equal((await rawAll(dbName, 'cover_images')).length, 0, 'removed once unused');
  }),

  // Home items --------------------------------------------------------------------
  check('home', 'home items: id is the book key, one per household + book, newest first, removable', async (ctx) => {
    const { store } = await ctx.open({ now: (() => { let t = Date.parse('2026-01-01T00:00:00Z'); return () => (t += 1000); })() });
    const h = await store.getCurrentHousehold();
    const first = await store.addHomeItem(h.id, ISBN_A);
    const again = await store.addHomeItem(h.id, ISBN_A);
    await store.addHomeItem(h.id, ISBN_B);
    equal([first.id, again.id], [ISBN_A, ISBN_A], 'id is the ISBN, re-adding returns the same item');
    equal((await store.getHomeItem(h.id, ISBN_A))?.id, ISBN_A, 'getHomeItem');
    equal(await store.getHomeItem(h.id, ISBN_C), null, 'getHomeItem missing');
    equal((await store.listHomeItems(h.id)).map((i) => i.isbn), [ISBN_B, ISBN_A], 'newest first');
    await store.removeHomeItem(ISBN_A);
    equal((await store.listHomeItems(h.id)).map((i) => i.isbn), [ISBN_B], 'removed');
  }),
  check('home', 'removeHomeItem keeps the book and every read of it', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    await store.putBook({ isbn: ISBN_A, title: 'Kept', authors: [], cover_url: null, source: 'manual' });
    await store.addHomeItem(h.id, ISBN_A);
    await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-01-02T00:00:00Z');
    await store.removeHomeItem(ISBN_A);
    equal(await store.getHomeItem(h.id, ISBN_A), null, 'not in Home');
    equal((await store.getBook(ISBN_A))?.title, 'Kept', 'book kept');
    equal((await store.listReadEvents(a.id, ISBN_A)).length, 2, 'events kept');
    equal((await store.getReadSummary(a.id, ISBN_A))?.count, 2, 'summary kept');
  }),

  // Libraries and loans ----------------------------------------------------------
  check('libraries', 'create, get, list by name, update (with validation)', async (ctx) => {
    const { store } = await ctx.open();
    const h = await store.getCurrentHousehold();
    const lib = await store.createLibrary({ household_id: h.id, name: 'West' });
    await store.createLibrary({ household_id: h.id, name: 'East', default_loan_days: 14 });
    equal([lib.default_loan_days, lib.sticker_prefix, lib.search_url_template, lib.homepage_url], [30, null, null, null], 'defaults');
    equal(DEFAULT_LOAN_DAYS, 30, 'default loan length');
    equal((await store.getLibrary(lib.id))?.name, 'West', 'getLibrary');
    equal((await store.listLibraries(h.id)).map((l) => l.name), ['East', 'West'], 'sorted by name');
    const updated = await store.updateLibrary(lib.id, { default_loan_days: 7, sticker_prefix: '3100' });
    equal([updated.default_loan_days, updated.sticker_prefix, updated.household_id], [7, '3100', h.id], 'updated');
    await rejectsWithCode(store.updateLibrary(lib.id, { default_loan_days: 0 }), 'invalid', 'zero loan days');
    await rejectsWithCode(store.createLibrary({ household_id: h.id, name: 'X', default_loan_days: 1.5 }), 'invalid', 'fractional days');
    await rejectsWithCode(store.updateLibrary('nope', { name: 'x' }), 'not_found', 'update unknown');
  }),
  check('libraries', 'deleteLibrary keeps every loan, clears library_id and copies the library name', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const other = await store.createLibrary({ household_id: h.id, name: 'Other' });
    const loan1 = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, library_id: lib.id });
    const loan2 = await store.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_B, library_id: lib.id, library_name: 'old note' });
    const untouched = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_C, library_id: other.id });
    await store.deleteLibrary(lib.id);
    equal(await store.getLibrary(lib.id), null, 'library gone');
    const kept = await Promise.all([store.getLoan(loan1.id), store.getLoan(loan2.id), store.getLoan(untouched.id)]);
    equal(kept.map((l) => [l?.library_id, l?.library_name]), [[null, 'Branch'], [null, 'Branch'], [other.id, null]], 'names copied; other loans untouched');
  }),
  check('loans', 'createLoan defaults and validation', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, due_date: '2026-12-01', sticker_barcode: '31000123' });
    equal([loan.renew_count, loan.returned_at, loan.library_id, loan.due_date], [0, null, null, '2026-12-01'], 'defaults');
    await rejectsWithCode(store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, due_date: '1/12/2026' }), 'invalid', 'bad due date');
    await rejectsWithCode(store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, due_date: '2026-02-30' }), 'invalid', 'impossible date');
    await rejectsWithCode(store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, library_id: 'nope' }), 'not_found', 'unknown library');
    await rejectsWithCode(store.createLoan({ household_id: h.id, reader_id: 'nope', isbn: ISBN_A }), 'not_found', 'unknown reader');
    const noIsbn = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: 'noisbn-abc' });
    equal(noIsbn.isbn, 'noisbn-abc', 'a book key without an ISBN');
  }),
  check('loans', 'updateLoan changes due date, library and reader, and checks they exist', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A });
    const moved = await store.updateLoan(loan.id, { reader_id: b.id, library_id: lib.id, due_date: '2026-09-01' });
    equal([moved.reader_id, moved.library_id, moved.due_date], [b.id, lib.id, '2026-09-01'], 'updated');
    await rejectsWithCode(store.updateLoan(loan.id, { reader_id: 'nope' }), 'not_found', 'unknown reader');
    await rejectsWithCode(store.updateLoan(loan.id, { library_id: 'nope' }), 'not_found', 'unknown library');
    equal((await store.updateLoan(loan.id, { library_id: null })).library_id, null, 'library cleared');
  }),
  check('loans', 'renewLoan adds the library loan length (30 without one); unrenewLoan undoes it', async (ctx) => {
    const { store, h, a } = await withReaders(ctx, { now: () => Date.parse('2026-05-10T12:00:00Z') });
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch', default_loan_days: 14 });
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, library_id: lib.id, due_date: '2026-06-01' });
    const renewed = await store.renewLoan(loan.id);
    equal([renewed.due_date, renewed.renew_count], ['2026-06-15', 1], 'due + 14 days');
    const twice = await store.renewLoan(loan.id);
    equal([twice.due_date, twice.renew_count], ['2026-06-29', 2], 'renewed again');
    const undone = await store.unrenewLoan(loan.id, renewed.due_date);
    equal([undone.due_date, undone.renew_count], ['2026-06-15', 1], 'unrenew puts the previous date back');

    const free = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_B, due_date: '2026-06-01' });
    equal((await store.renewLoan(free.id)).due_date, '2026-07-01', 'no library: + 30 days');
    const undated = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_C });
    equal((await store.renewLoan(undated.id)).due_date, '2026-06-09', 'no due date: today + 30');
    equal((await store.unrenewLoan(undated.id, null)).due_date, null, 'unrenew back to no due date');
    equal((await store.unrenewLoan(undated.id, null)).renew_count, 0, 'renew_count never below 0');

    await store.returnLoan(free.id);
    await rejectsWithCode(store.renewLoan(free.id), 'invalid', 'a returned loan cannot be renewed');
    await rejectsWithCode(store.renewLoan('nope'), 'not_found', 'renew unknown');
    await rejectsWithCode(store.unrenewLoan(loan.id, 'soon'), 'invalid', 'bad previous date');
  }),
  check('loans', 'returnLoan and unreturnLoan', async (ctx) => {
    const { store, h, a } = await withReaders(ctx, { now: () => Date.parse('2026-05-10T12:00:00Z') });
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A });
    equal((await store.returnLoan(loan.id)).returned_at, '2026-05-10T12:00:00.000Z', 'returned now');
    equal((await store.listActiveLoans(a.id)).length, 0, 'no longer active');
    equal((await store.unreturnLoan(loan.id)).returned_at, null, 'active again');
    equal((await store.listActiveLoans(a.id)).map((l) => l.id), [loan.id], 'back in the active list');
    await rejectsWithCode(store.unreturnLoan('nope'), 'not_found', 'unknown loan');
  }),
  check('loans', 'listActiveLoans by due date (none last) and listReturnedLoans newest first, per reader', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const late = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, due_date: '2026-08-01' });
    const undated = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_B });
    const soon = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_C, due_date: '2026-07-01' });
    await store.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_D, due_date: '2026-06-01' });
    const r1 = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_D, due_date: '2026-01-01' });
    const r2 = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_D, due_date: '2026-02-01' });
    await store.returnLoan(r1.id, '2026-01-10T00:00:00Z');
    await store.returnLoan(r2.id, '2026-02-10T00:00:00Z');
    equal((await store.listActiveLoans(a.id)).map((l) => l.id), [soon.id, late.id, undated.id], 'active, soonest due first');
    equal((await store.listReturnedLoans(a.id)).map((l) => l.id), [r2.id, r1.id], 'returned, newest first');
    equal((await store.listActiveLoans(b.id)).length, 1, "only this reader's loans");
  }),
  check('loans', 'findActiveLoansBySticker searches the whole household, active loans only', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const west = await store.createLibrary({ household_id: h.id, name: 'West' });
    const east = await store.createLibrary({ household_id: h.id, name: 'East' });
    const mine = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, library_id: west.id, sticker_barcode: '31000555' });
    const theirs = await store.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_B, library_id: east.id, sticker_barcode: '31000555' });
    const noLibrary = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_C, sticker_barcode: '777' });
    const returned = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_D, library_id: west.id, sticker_barcode: '888' });
    await store.returnLoan(returned.id);
    const other = await store.testOnlyAddHousehold('other', 'Other');
    const c = await store.createReader({ household_id: other.id, display_name: 'C', avatar: '🐙' });
    await store.createLoan({ household_id: other.id, reader_id: c.id, isbn: ISBN_A, sticker_barcode: '777' });

    equal((await store.findActiveLoansBySticker(h.id, '31000555')).map((l) => l.id).sort(), [mine.id, theirs.id].sort(), 'any reader, any library');
    equal((await store.findActiveLoansBySticker(h.id, ' 777 ')).map((l) => l.id), [noLibrary.id], 'trimmed; loans without a library; not other households');
    equal(await store.findActiveLoansBySticker(h.id, '888'), [], 'returned loans are not found');
    equal(await store.findActiveLoansBySticker(h.id, ''), [], 'empty sticker');
  }),
  check('loans', 'listLoans filters, updateLoan, returnLoan and deleteLoan', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const first = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, borrowed_at: '2026-01-01T00:00:00Z' });
    const second = await store.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_B, borrowed_at: '2026-01-02T00:00:00Z' });
    equal((await store.listLoans(h.id)).map((l) => l.id), [second.id, first.id], 'newest borrowed first');
    equal((await store.listLoans(h.id, { reader_id: a.id })).map((l) => l.id), [first.id], 'by reader');
    const renewed = await store.updateLoan(first.id, { renew_count: 1, due_date: '2026-02-01' });
    equal([renewed.renew_count, renewed.due_date], [1, '2026-02-01'], 'renewed');
    await rejectsWithCode(store.updateLoan(first.id, { renew_count: -1 }), 'invalid', 'negative renew count');
    await rejectsWithCode(store.updateLoan(first.id, { due_date: 'soon' }), 'invalid', 'bad due date');
    await rejectsWithCode(store.updateLoan('nope', { renew_count: 1 }), 'not_found', 'update unknown');
    const returned = await store.returnLoan(first.id, '2026-01-20T12:00:00Z');
    equal(returned.returned_at, T('2026-01-20T12:00:00Z'), 'returned_at set');
    equal((await store.listLoans(h.id, { active: true })).map((l) => l.id), [second.id], 'active only');
    equal((await store.listLoans(h.id, { active: false })).map((l) => l.id), [first.id], 'returned only');
    await store.deleteLoan(second.id);
    equal(await store.getLoan(second.id), null, 'deleted');
  }),

  // Read events -----------------------------------------------------------------
  check('reads', 'markRead adds an event with the household; unknown reader -> not_found', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    const event = await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    ok(!!event && event.household_id === h.id && event.reader_id === a.id && event.read_at === T('2026-01-01T00:00:00Z'), 'event', event);
    equal((await store.getReadSummary(a.id, ISBN_A))?.count, 1, 'summary created');
    equal(await store.getReadSummary(a.id, ISBN_B), null, 'unread -> null');
    await rejectsWithCode(store.markRead('nope', ISBN_A), 'not_found', 'unknown reader');
  }),
  check('reads', 're-read adds another event; the summary tracks first, last and count', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    const e1 = await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    const e2 = await store.markRead(a.id, ISBN_A, '2026-02-01T00:00:00Z');
    ok(!!e1 && !!e2 && e1.id !== e2.id, 'two distinct events');
    const summary = await store.getReadSummary(a.id, ISBN_A);
    equal(
      [summary?.count, summary?.first_read_at, summary?.last_read_at],
      [2, T('2026-01-01T00:00:00Z'), T('2026-02-01T00:00:00Z')],
      'summary',
    );
    equal((await store.listReadEvents(a.id, ISBN_A)).map((e) => e.id), [e2!.id, e1!.id], 'per-book events, newest first');
    await store.markRead(a.id, ISBN_B, '2026-01-15T00:00:00Z');
    equal((await store.listReadEvents(a.id)).length, 3, 'all events');
    equal((await store.listReadSummaries(a.id)).map((x) => x.isbn), [ISBN_A, ISBN_B], 'summaries, most recently read first');
  }),
  check('reads', 'double-tap guard: a repeat within 10 seconds is ignored; explicit read_at is not', async (ctx) => {
    let clock = Date.parse('2026-05-01T10:00:00Z');
    const { store, a } = await withReaders(ctx, { now: () => clock });
    const tap1 = await store.markRead(a.id, ISBN_A);
    clock += 3_000;
    equal(await store.markRead(a.id, ISBN_A), null, 'second tap ignored');
    equal((await store.getReadSummary(a.id, ISBN_A))?.count, 1, 'still one read');
    clock += READ_TAP_GUARD_MS;
    ok(!!(await store.markRead(a.id, ISBN_A)), 'a tap after the window counts');
    ok(!!(await store.markRead(a.id, ISBN_A, new Date(clock).toISOString())), 'explicit read_at never blocked');
    ok(!!(await store.markRead(a.id, ISBN_B)), 'another book is not blocked');
    ok(!!tap1, 'first tap counted');
  }),
  check('reads', 'undo removes only the latest event; undoing the last makes the book unread', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    const e1 = await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    const e2 = await store.markRead(a.id, ISBN_A, '2026-02-01T00:00:00Z');
    equal((await store.undoLatestRead(a.id, ISBN_A))?.id, e2!.id, 'latest removed');
    equal((await store.getReadSummary(a.id, ISBN_A))?.count, 1, 'one left');
    equal((await store.undoLatestRead(a.id, ISBN_A))?.id, e1!.id, 'then the last one');
    equal(await store.getReadSummary(a.id, ISBN_A), null, 'book unread');
    equal(await store.undoLatestRead(a.id, ISBN_A), null, 'nothing left to undo');
  }),
  check('reads', 'latest is by read_at, then by id (an earlier read recorded later is not "latest")', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    await store.markRead(a.id, ISBN_D, '2026-03-10T00:00:00Z');
    await store.markRead(a.id, ISBN_D, '2026-01-10T00:00:00Z');
    const latest = await store.markRead(a.id, ISBN_D, '2026-04-10T00:00:00Z');
    equal((await store.undoLatestRead(a.id, ISBN_D))?.id, latest!.id, 'removes 04-10');
    const s = await store.getReadSummary(a.id, ISBN_D);
    equal([s?.count, s?.first_read_at, s?.last_read_at], [2, T('2026-01-10T00:00:00Z'), T('2026-03-10T00:00:00Z')], 'recomputed summary');
  }),
  check('reads', 'restoreReadEvent puts an event back with the same id', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    const event = await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    const removed = await store.undoLatestRead(a.id, ISBN_A);
    const restored = await store.restoreReadEvent(removed as ReadEvent);
    equal([restored.id, restored.read_at], [event!.id, event!.read_at], 'same id and read_at');
    equal((await store.getReadSummary(a.id, ISBN_A))?.count, 1, 'summary back');
    await store.restoreReadEvent(restored);
    equal((await store.getReadSummary(a.id, ISBN_A))?.count, 1, 'restoring twice does not duplicate');
    await rejectsWithCode(store.restoreReadEvent({ ...restored, reader_id: 'nope' }), 'not_found', 'unknown reader');
    await rejectsWithCode(store.restoreReadEvent({ ...restored, id: '' }), 'invalid', 'not an event');
  }),
  check('reads', 'countReadsSince counts books by first read, ignoring later re-reads', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-04-01T00:00:00Z'); // re-read after `since`
    await store.markRead(a.id, ISBN_B, '2026-05-01T00:00:00Z');
    equal(await store.countReadsSince(a.id, '2026-03-01T00:00:00Z'), 1, 'only B was first read since March');
    equal(await store.countReadsSince(a.id, '2000-01-01T00:00:00Z'), 2, 'each book once');
    equal(await store.countReadsSince(a.id, '2026-05-01T00:00:00Z'), 1, 'since is inclusive');
  }),
  check('reads', 'countHouseholdReads counts distinct reader + book pairs per household', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const other = await store.testOnlyAddHousehold('other', 'Other');
    const c = await store.createReader({ household_id: other.id, display_name: 'C', avatar: '🐙' });
    await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-01-02T00:00:00Z');
    await store.markRead(a.id, ISBN_B, '2026-01-03T00:00:00Z');
    await store.markRead(b.id, ISBN_A, '2026-01-04T00:00:00Z');
    await store.markRead(c.id, ISBN_A, '2026-01-05T00:00:00Z');
    equal(await store.countHouseholdReads(h.id), 3, 'A×A, A×B, B×A');
    equal(await store.countHouseholdReads(other.id), 1, 'other household');
    const all = await store.listHouseholdReadSummaries(h.id);
    equal(all.map((x) => `${x.reader_id === a.id ? 'A' : 'B'}:${x.isbn}:${x.count}`).sort(), [`A:${ISBN_A}:2`, `A:${ISBN_B}:1`, `B:${ISBN_A}:1`].sort(), 'listHouseholdReadSummaries');
    equal((await store.listHouseholdReadSummaries(other.id)).length, 1, 'per household');
  }),

  // Journeys ----------------------------------------------------------------------
  check('journeys', 'startJourney sets active_journey_id; starting another abandons the active one', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    const j = await store.startJourney(a.id, 'ocean_deep', '2026-01-01T00:00:00Z');
    equal([j.completed_at, j.abandoned_at], [null, null], 'new journey is open');
    equal((await store.getReader(a.id))?.active_journey_id, j.id, 'pointer set');
    equal((await store.getActiveJourney(a.id))?.id, j.id, 'getActiveJourney');
    const next = await store.startJourney(a.id, 'skyscraper', '2026-01-05T00:00:00Z');
    equal((await store.getActiveJourney(a.id))?.id, next.id, 'the new one is active');
    const history = await store.listJourneyHistory(a.id);
    equal(history.map((x) => [x.journey_id, x.abandoned_at, x.completed_at]), [
      ['skyscraper', null, null],
      ['ocean_deep', T('2026-01-05T00:00:00Z'), null],
    ], 'old one abandoned at the switch, history newest first');
    await rejectsWithCode(store.startJourney('nope', 'skyscraper'), 'not_found', 'unknown reader');
  }),
  check('journeys', 'getActiveJourney ignores abandoned and completed journeys', async (ctx) => {
    const { store, dbName, a } = await withReaders(ctx);
    const j = await store.startJourney(a.id, 'ocean_deep');
    const raw = await rawGet<Record<string, unknown>>(dbName, 'reader_journeys', j.id);
    const { openDB } = await import('idb');
    const db = await openDB(dbName);
    await db.put('reader_journeys', { ...raw, abandoned_at: '2026-01-01T00:00:00.000Z' });
    db.close();
    equal(await store.getActiveJourney(a.id), null, 'abandoned is not active even if pointed at');
    const k = await store.startJourney(a.id, 'redwood_tree');
    await store.completeJourney(k.id);
    equal(await store.getActiveJourney(a.id), null, 'completed is not active');
  }),
  check('journeys', 'journeys stored before abandoned_at existed read as not abandoned', async (ctx) => {
    const { store, dbName, a } = await withReaders(ctx);
    const j = await store.startJourney(a.id, 'ocean_deep', '2026-01-01T00:00:00Z');
    const { openDB } = await import('idb');
    const db = await openDB(dbName);
    const row = (await db.get('reader_journeys', j.id)) as Record<string, unknown>;
    delete row.abandoned_at;
    await db.put('reader_journeys', row);
    db.close();
    equal((await store.getActiveJourney(a.id))?.abandoned_at, null, 'active, abandoned_at null');
    equal((await store.listJourneyHistory(a.id))[0].abandoned_at, null, 'history normalises it');
    const next = await store.startJourney(a.id, 'skyscraper', '2026-02-01T00:00:00Z');
    equal((await store.listJourneyHistory(a.id)).map((x) => x.abandoned_at), [null, T('2026-02-01T00:00:00Z')], 'and it can be abandoned');
    ok(!!next, 'new journey started');
  }),
  check('journeys', 'completion is permanent: undoing the reads keeps it completed', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    const j = await store.startJourney(a.id, 'ocean_deep', '2026-01-01T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-01-02T00:00:00Z');
    await store.completeJourney(j.id, '2026-01-03T00:00:00Z');
    await store.undoLatestRead(a.id, ISBN_A);
    equal((await store.listJourneyHistory(a.id))[0].completed_at, T('2026-01-03T00:00:00Z'), 'still completed');
    equal((await store.countCompletedJourneys(a.id)).ocean_deep, 1, 'still counted');
  }),
  check('journeys', 'countCompletedJourneys counts completions per journey', async (ctx) => {
    const { store, a, b } = await withReaders(ctx);
    for (const id of ['ocean_deep', 'ocean_deep', 'skyscraper']) {
      const j = await store.startJourney(a.id, id);
      await store.completeJourney(j.id);
    }
    await store.startJourney(a.id, 'redwood_tree'); // active, not counted
    await store.startJourney(a.id, 'ocean_cliff'); // abandons redwood_tree, not counted
    const other = await store.startJourney(b.id, 'ocean_deep');
    await store.completeJourney(other.id);
    equal(await store.countCompletedJourneys(a.id), { ocean_deep: 2, skyscraper: 1 }, 'per journey, this reader only');
    equal(await store.countCompletedJourneys('nobody'), {}, 'nobody');
  }),
  check('journeys', 'completeJourney and deleteReaderJourney clear the pointer', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    const j = await store.startJourney(a.id, 'ocean_deep', '2026-01-01T00:00:00Z');
    const done = await store.completeJourney(j.id, '2026-02-01T00:00:00Z');
    equal(done.completed_at, T('2026-02-01T00:00:00Z'), 'completed');
    equal((await store.completeJourney(j.id, '2026-03-01T00:00:00Z')).completed_at, T('2026-02-01T00:00:00Z'), 'first completion kept');
    equal([await store.getActiveJourney(a.id), (await store.getReader(a.id))?.active_journey_id], [null, null], 'cleared on complete');
    const j2 = await store.startJourney(a.id, 'skyscraper', '2026-03-01T00:00:00Z');
    await store.deleteReaderJourney(j2.id);
    equal((await store.getReader(a.id))?.active_journey_id, null, 'cleared on delete');
    equal((await store.listJourneyHistory(a.id)).map((x) => x.id), [j.id], 'history keeps the completed one');
    await rejectsWithCode(store.completeJourney('nope'), 'not_found', 'complete unknown');
  }),
  check('journeys', 'a pointer to a missing journey reads as none and does not block a new one', async (ctx) => {
    const { store, dbName, a } = await withReaders(ctx);
    const j = await store.startJourney(a.id, 'hot_air_balloon');
    await rawDelete(dbName, 'reader_journeys', j.id);
    equal(await store.getActiveJourney(a.id), null, 'dangling pointer -> null');
    const next = await store.startJourney(a.id, 'rocket_through_space');
    equal((await store.getActiveJourney(a.id))?.id, next.id, 'the new journey is the active one');
  }),

  // PIN -----------------------------------------------------------------------------
  check('pin', 'hashPin / verifyPin', async () => {
    const hash = await hashPin('2468');
    ok(/^pbkdf2-sha256\$600000\$[\w-]{22}\$[\w-]{43}$/.test(hash), 'format', hash.split('$').slice(0, 2));
    ok(await verifyPin('2468', hash), 'right PIN');
    ok(!(await verifyPin('2469', hash)), 'wrong PIN');
    ok(!(await verifyPin('2468', 'not-a-hash')), 'garbage');
    ok(!(await verifyPin('2468', 'pbkdf2-sha256$0$aa$bb')), 'zero iterations');
    ok(hash !== (await hashPin('2468')), 'salted');
  }),

  // Migrations ------------------------------------------------------------------------
  check('migration', 'a fresh database is created at v5 with no legacy reads store', async (ctx) => {
    const { store, dbName } = await ctx.open();
    await store.coverStep;
    const { version, stores } = await rawStoreNames(dbName);
    equal(version, 5, 'version');
    ok(stores.includes('records') && stores.includes('outbox'), 'sync stores', stores);
    equal(await rawIndexNames(dbName, 'records'), ['by_parent'], 'records index');
    equal(await rawIndexNames(dbName, 'outbox'), ['by_t'], 'outbox index');
    equal((await rawIndexNames(dbName, 'loans')).sort(), ['by_household_borrowed', 'by_library', 'by_library_sticker', 'by_reader', 'by_sticker'], 'loan indexes');
    ok(!stores.includes('reads') && stores.includes('read_events') && stores.includes('read_summaries'), 'stores', stores);
    equal((await rawGet<{ value: boolean }>(dbName, 'meta', 'covers_rekeyed'))?.value, true, 'nothing to re-key');
  }),
  check('migration', 'v1 -> v3: household, reads, orphans, loans and titles', async (ctx) => {
    const name = ctx.name();
    await createV1Database(name);
    const store = await ctx.attach(name);
    equal((await store.getHousehold(HOUSEHOLD_ID))?.name, 'Test', 'household is "main"');
    equal(await store.getHousehold('h1'), null, 'old id gone');
    equal((await store.listReadEvents('r1')).length, 1, 'read became an event');
    equal(await store.countHouseholdReads(HOUSEHOLD_ID), 1, 'household count');
    equal((await store.listReadEvents('ghost')).length, 0, 'orphan read dropped');
    const loan = await store.getLoan('l1');
    equal([loan?.renew_count, loan?.library_id, loan?.sticker_barcode, loan?.household_id], [0, null, null, HOUSEHOLD_ID], 'loan fields');
    equal((await store.getBook(ISBN_A))?.title, "Charlotte's Web", 'lowercase title fixed');
  }),
  check('migration', 'v2 -> v3: events, summaries, "main" everywhere, book-key home ids, active journeys', async (ctx) => {
    const name = ctx.name();
    const fixture = await createV2Database(name);
    const store = await ctx.attach(name);
    await store.coverStep;
    const events = await rawAll<ReadEvent>(name, 'read_events');
    const key = (e: { reader_id: string; isbn: string; read_at: string }) => `${e.reader_id}|${e.isbn}|${e.read_at}`;
    equal(events.map(key).sort(), fixture.reads.map(key).sort(), 'one event per old read, original read_at');
    equal(new Set(events.map((e) => e.id)).size, events.length, 'unique event ids');
    ok(!(await rawStoreNames(name)).stores.includes('reads'), 'reads store deleted');
    const summaries = await rawAll<{ count: number; first_read_at: string; last_read_at: string }>(name, 'read_summaries');
    ok(summaries.length === 4 && summaries.every((s) => s.count === 1 && s.first_read_at === s.last_read_at), 'summaries', summaries);

    const readers = await rawAll<{ id: string; household_id: string; active_journey_id: string | null }>(name, 'readers');
    const home = await rawAll<{ id: string; isbn: string; household_id: string }>(name, 'home_items');
    equal(await rawGet(name, 'households', fixture.oldHouseholdId), undefined, 'old household id gone');
    ok(!!(await rawGet(name, 'households', HOUSEHOLD_ID)), '"main" exists');
    equal((await rawGet<{ value: string }>(name, 'meta', 'current_household_id'))?.value, HOUSEHOLD_ID, 'meta points at "main"');
    ok(readers.filter((r) => r.id !== 'r3').every((r) => r.household_id === HOUSEHOLD_ID), 'readers moved');
    equal(readers.find((r) => r.id === 'r3')?.household_id, 'hy', 'other household untouched');
    ok(home.length === 3 && home.every((h) => h.id === h.isbn && h.household_id === HOUSEHOLD_ID), 'home ids are book keys', home);
    ok((await rawAll<{ household_id: string }>(name, 'libraries')).every((l) => l.household_id === HOUSEHOLD_ID), 'libraries moved');
    ok((await rawAll<{ household_id: string }>(name, 'loans')).every((l) => l.household_id === HOUSEHOLD_ID), 'loans moved');
    ok(events.filter((e) => e.reader_id !== 'r3').every((e) => e.household_id === HOUSEHOLD_ID), 'events moved');
    equal(
      ['r1', 'r2', 'r3'].map((id) => readers.find((r) => r.id === id)?.active_journey_id),
      ['j1', null, null],
      'active_journey_id from the uncompleted journey',
    );
    equal(await store.countHouseholdReads(HOUSEHOLD_ID), 3, 'household count unchanged');
    equal(await store.countReadsSince('r1', '2026-02-01T00:00:00Z'), 1, 'first-read count');
  }),
  check('migration', 'cover re-key: interrupted after one photo, both prefixes resolve meanwhile, a re-run finishes', async (ctx) => {
    const name = ctx.name();
    const fixture = await createV2Database(name);
    const first = await ctx.attach(name, { coverStepLimit: 1 });
    equal(await first.coverStep, { moved: 1, remaining: 1 }, 'stopped after one');
    const mid = await Promise.all([rawGet<{ cover_url: string }>(name, 'books', ISBN_A), rawGet<{ cover_url: string }>(name, 'books', ISBN_B)]);
    ok(
      mid.some((b) => b?.cover_url.startsWith('cover:')) && mid.some((b) => b?.cover_url.startsWith('local-cover:')),
      'one of each prefix',
      mid.map((b) => b?.cover_url.split(':')[0]),
    );
    ok(await sameBytes(await blobAt((await first.getBook(ISBN_A))?.cover_url), fixture.coverA), 'A resolves mid-step');
    ok(await sameBytes(await blobAt((await first.getBook(ISBN_B))?.cover_url), fixture.coverB), 'B resolves mid-step');
    await first.close();

    const second = await ctx.attach(name);
    equal(await second.coverStep, { moved: 1, remaining: 0 }, 'the re-run moves the rest');
    const [hashA, hashB] = await Promise.all([sha256Hex(fixture.coverA), sha256Hex(fixture.coverB)]);
    equal((await rawGet<{ cover_url: string }>(name, 'books', ISBN_A))?.cover_url, `cover:${hashA}`, 'A re-keyed');
    equal((await rawGet<{ cover_url: string }>(name, 'books', ISBN_B))?.cover_url, `cover:${hashB}`, 'B re-keyed');
    const images = await rawAll<{ hash: string; blob: Blob }>(name, 'cover_images');
    ok(await sameBytes(images.find((i) => i.hash === hashA)?.blob, fixture.coverA), 'A blob unchanged');
    ok(await sameBytes(images.find((i) => i.hash === hashB)?.blob, fixture.coverB), 'B blob unchanged');
    equal((await rawAll(name, 'covers')).length, 0, 'legacy store emptied');
    ok(await sameBytes(await blobAt((await second.getBook(ISBN_A))?.cover_url), fixture.coverA), 'covers still show');
    await second.close();

    const third = await ctx.attach(name);
    equal((await third.coverStep).moved, 0, 'a finished step is a no-op');
  }),
  check('migration', 'v4 -> v5: records and outbox stores added, every row kept, nothing recorded', async (ctx) => {
    const name = ctx.name();
    const fixture = await createV3Database(name); // upgrades through v4 to v5
    const store = await ctx.attach(name);
    const { version, stores } = await rawStoreNames(name);
    equal(version, 5, 'version');
    ok(stores.includes('records') && stores.includes('outbox'), 'new stores', stores);
    equal((await rawAll(name, 'records')).length, 0, 'migrated rows have no records until sync is turned on');
    equal((await rawAll(name, 'outbox')).length, 0, 'and nothing is queued');
    equal((await rawAll(name, 'loans')).length, fixture.loans.length, 'loans kept');
    ok((await store.getHousehold(HOUSEHOLD_ID)) !== null, 'household kept');
  }),
  check('migration', 'v3 -> v4: loan sticker indexes replaced, every loan kept', async (ctx) => {
    const name = ctx.name();
    const fixture = await createV3Database(name);
    const store = await ctx.attach(name);
    equal((await rawStoreNames(name)).version, 5, 'version');
    const indexes = await rawIndexNames(name, 'loans');
    ok(!indexes.includes('by_household_sticker') && indexes.includes('by_library_sticker') && indexes.includes('by_sticker'), 'indexes', indexes);
    const loans = await rawAll<Record<string, unknown>>(name, 'loans');
    const byId = (rows: Record<string, unknown>[]) => [...rows].sort((x, y) => String(x.id).localeCompare(String(y.id)));
    equal(byId(loans), byId(fixture.loans), 'loans unchanged');
    equal((await store.findActiveLoansBySticker(HOUSEHOLD_ID, 'S1')).map((l) => l.id), ['loanA'], 'sticker lookup on migrated data');
    equal((await store.findActiveLoansBySticker(HOUSEHOLD_ID, 'S2')).map((l) => l.id), ['loanB'], 'loans without a library too');
    equal((await store.listActiveLoans('r1')).map((l) => l.id), ['loanA', 'loanB'], 'active loans');
    equal((await store.getReadSummary('r1', ISBN_A))?.count, 1, 'other stores untouched');
    equal((await store.renewLoan('loanA')).due_date, '2026-01-29', 'renew uses the migrated library (14 days)');
  }),

  // Clear reads --------------------------------------------------------------------
  check('reads', 'clearReads removes one reader\'s events and summary for one book, in one go', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-01-02T00:00:00Z');
    await store.markRead(a.id, ISBN_B, '2026-01-03T00:00:00Z');
    await store.markRead(b.id, ISBN_A, '2026-01-04T00:00:00Z');
    const seen: DataChange[] = [];
    store.subscribe((c) => seen.push(c));
    equal(await store.clearReads(a.id, ISBN_A), 2, 'returns how many events went');
    equal((await store.listReadEvents(a.id, ISBN_A)).length, 0, 'events gone');
    equal(await store.getReadSummary(a.id, ISBN_A), null, 'summary gone');
    equal((await store.listReadEvents(a.id, ISBN_B)).length, 1, 'other book kept');
    equal((await store.listReadEvents(b.id, ISBN_A)).length, 1, 'other reader kept');
    equal(await store.countHouseholdReads(h.id), 2, 'household count follows');
    equal(seen.map((c) => c.tables), [['read_events']], 'one change notification');
    equal(await store.clearReads(a.id, ISBN_A), 0, 'nothing left to clear');
  }),
  check('reads', 'clearReads never un-completes a journey', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    const journey = await store.startJourney(a.id, 'ocean_deep', '2026-01-01T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-01-02T00:00:00Z');
    const done = await store.completeJourney(journey.id, '2026-01-03T00:00:00Z');
    await store.clearReads(a.id, ISBN_A);
    const [after] = await store.listJourneyHistory(a.id);
    equal(after.completed_at, done.completed_at, 'still completed');
    equal(await store.countCompletedJourneys(a.id), { ocean_deep: 1 }, 'still counted');
  }),

  // Backup and reset -----------------------------------------------------------------
  check('backup', 'exportBackup -> importBackup restores everything into an empty device, covers included', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    await store.updateHousehold(h.id, { name: 'Backup Test' });
    const photo = jpeg(0xe0, 1, 2, 3, 4, 5);
    const coverUrl = await store.saveCoverImage(photo);
    const photoRef = `cover:${await sha256Hex(photo)}`;
    await store.putBook({ isbn: ISBN_A, title: 'With photo', authors: ['X'], cover_url: coverUrl, source: 'manual' });
    await store.putBook({ isbn: ISBN_B, title: 'Online cover', authors: [], cover_url: 'https://example.org/b.jpg', source: 'openlibrary' });
    await store.addHomeItem(h.id, ISBN_A);
    await store.addHomeItem(h.id, ISBN_B);
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch', sticker_prefix: '310' });
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_C, library_id: lib.id, sticker_barcode: '310001', due_date: '2026-02-01' });
    const returned = await store.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_D });
    await store.returnLoan(returned.id, '2026-01-20T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    await store.markRead(a.id, ISBN_A, '2026-01-05T00:00:00Z');
    await store.markRead(b.id, ISBN_B, '2026-01-02T00:00:00Z');
    const journey = await store.startJourney(a.id, 'ocean_deep', '2026-01-01T00:00:00Z');

    const backup = await store.exportBackup();
    equal([backup.format, backup.version, backup.schema], [BACKUP_FORMAT, 1, 5], 'format, version, schema');
    ok(!('records' in backup.tables) && !('outbox' in backup.tables), 'sync bookkeeping is never exported');
    ok(!('read_summaries' in backup.tables), 'summaries are not exported');
    equal(Object.keys(backup.covers), [photoRef], 'the one photo, under its cover: key');
    equal((backup.tables.books.find((x) => x.isbn === ISBN_A))?.cover_url, photoRef, 'books keep the cover: reference, not a blob: URL');
    const before = summariseBackup(backup);
    equal(before, { readers: 2, books: 2, homeBooks: 2, loans: 2, reads: 3, covers: 1 }, 'summary counts');

    // As if downloaded and picked on another device.
    const file = JSON.parse(JSON.stringify(backup));
    const { store: target } = await ctx.open();
    equal(await target.importBackup(file), before, 'import returns the same counts');
    equal((await target.getCurrentHousehold()).name, 'Backup Test', 'household');
    equal((await target.listReaders(HOUSEHOLD_ID)).map((r) => [r.id, r.card_token]), [[a.id, a.card_token], [b.id, b.card_token]], 'readers and card tokens');
    equal((await target.getReader(a.id))?.active_journey_id, journey.id, 'active journey pointer');
    equal((await target.getActiveJourney(a.id))?.id, journey.id, 'journey');
    equal(await target.getReadSummary(a.id, ISBN_A), await store.getReadSummary(a.id, ISBN_A), 'summary rebuilt the same');
    equal(await target.countHouseholdReads(HOUSEHOLD_ID), 2, 'household reads');
    equal((await target.getLoan(loan.id))?.sticker_barcode, '310001', 'loan');
    equal((await target.findActiveLoansBySticker(HOUSEHOLD_ID, '310001')).length, 1, 'sticker index works after import');
    equal((await target.getLoan(returned.id))?.returned_at, '2026-01-20T00:00:00.000Z', 'returned loan');
    equal((await target.listLibraries(HOUSEHOLD_ID)).map((l) => l.name), ['Branch'], 'library');
    equal((await target.listHomeItems(HOUSEHOLD_ID)).length, 2, 'home items');
    const restored = await target.getBook(ISBN_A);
    ok(restored?.cover_url?.startsWith('blob:'), 'cover resolves to a fresh blob: URL', restored?.cover_url);
    ok(await sameBytes(await blobAt(restored?.cover_url), photo), 'photo bytes identical');
    equal((await target.getBook(ISBN_B))?.cover_url, 'https://example.org/b.jpg', 'online cover kept');
    equal(summariseBackup(await target.exportBackup()), before, 'exporting again gives the same counts');
  }),
  check('backup', 'importBackup replaces this device\'s data rather than merging', async (ctx) => {
    const { store: source } = await withReaders(ctx);
    const backup = JSON.parse(JSON.stringify(await source.exportBackup()));
    const { store, h } = await withReaders(ctx);
    const extra = await store.createReader({ household_id: h.id, display_name: 'Only here', avatar: '🐙' });
    await store.addHomeItem(h.id, ISBN_A);
    await store.markRead(extra.id, ISBN_A, '2026-01-01T00:00:00Z');
    const seen: DataChange[] = [];
    store.subscribe((c) => seen.push(c));
    await store.importBackup(backup);
    equal(await store.getReader(extra.id), null, 'reader only on this device is gone');
    equal((await store.listHomeItems(HOUSEHOLD_ID)).length, 0, 'home items replaced');
    equal(await store.countHouseholdReads(HOUSEHOLD_ID), 0, 'reads and summaries replaced');
    equal((await store.listReaders(HOUSEHOLD_ID)).length, 2, "the backup's readers");
    ok(seen.length === 1 && seen[0].tables.includes('readers') && seen[0].tables.includes('read_events'), 'one change for everything', seen);
  }),
  check('backup', 'importBackup refuses a broken or wrong file and leaves the data untouched', async (ctx) => {
    const { store, a } = await withReaders(ctx);
    await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    const good = JSON.parse(JSON.stringify(await store.exportBackup()));
    await rejectsWithCode(store.importBackup({ hello: 'world' }), 'invalid', 'not a backup');
    await rejectsWithCode(store.importBackup({ ...good, version: 2 }), 'invalid', 'newer version');
    await rejectsWithCode(store.importBackup({ ...good, schema: 99 }), 'invalid', 'newer schema');
    const noReaders = { ...good, tables: { ...good.tables, readers: undefined } };
    await rejectsWithCode(store.importBackup(noReaders), 'invalid', 'missing table');

    // A photo whose bytes don't match its hash.
    const photoUrl = await store.saveCoverImage(jpeg(0xe0, 9, 9));
    await store.putBook({ isbn: ISBN_B, title: 'P', authors: [], cover_url: photoUrl, source: 'manual' });
    const withPhoto = JSON.parse(JSON.stringify(await store.exportBackup()));
    const ref = Object.keys(withPhoto.covers)[0];
    withPhoto.covers[ref] = btoa('not the same photo');
    await rejectsWithCode(store.importBackup(withPhoto), 'invalid', 'damaged photo');

    equal((await store.listReadEvents(a.id)).length, 1, 'reads untouched');
    equal((await store.listReaders(HOUSEHOLD_ID)).length, 2, 'readers untouched');
    ok(await store.getBook(ISBN_B), 'books untouched');
  }),
  check('backup', 'exportBackup includes legacy photos not yet re-keyed, under their hash', async (ctx) => {
    const name = ctx.name();
    const fixture = await createV2Database(name);
    const store = await ctx.attach(name, { coverStepLimit: 1 });
    await store.coverStep;
    const backup = await store.exportBackup();
    equal(Object.keys(backup.covers).length, 2, 'both photos');
    const hashes = [await sha256Hex(fixture.coverA), await sha256Hex(fixture.coverB)].map((x) => `cover:${x}`).sort();
    equal(Object.keys(backup.covers).sort(), hashes, 'keyed by hash');
    ok(backup.tables.books.every((x) => !x.cover_url || x.cover_url.startsWith('cover:')), 'no legacy references in the file');
    const { store: target } = await ctx.open();
    await target.importBackup(JSON.parse(JSON.stringify(backup)));
    ok(await sameBytes(await blobAt((await target.getBook(ISBN_A))?.cover_url), fixture.coverA), 'A restored');
    ok(await sameBytes(await blobAt((await target.getBook(ISBN_B))?.cover_url), fixture.coverB), 'B restored');
  }),
  check('backup', 'resetDevice deletes everything, and the household starts afresh', async (ctx) => {
    const { store, dbName, h, a } = await withReaders(ctx);
    await store.updateHousehold(h.id, { name: 'Old name' });
    await store.addHomeItem(h.id, ISBN_A);
    await store.saveCoverImage(jpeg(0xe0, 7));
    await store.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_B });
    await store.startJourney(a.id, 'ocean_deep');
    await store.resetDevice();
    for (const table of ['households', 'readers', 'books', 'cover_images', 'home_items', 'loans', 'read_events', 'read_summaries', 'reader_journeys', 'records', 'outbox', 'meta']) {
      equal((await rawAll(dbName, table)).length, 0, `${table} empty`);
    }
    const fresh = await store.getCurrentHousehold();
    equal([fresh.id, fresh.name === 'Old name'], [HOUSEHOLD_ID, false], 'a new household');
    equal((await store.listReaders(HOUSEHOLD_ID)).length, 0, 'no readers');
  }),
];
