import { createLocalStore, type LocalDataStore, type LocalStoreOptions } from '../adapters/local';
import { createSyncStore } from '../sync/adapter';
import {
  DEFAULT_LOAN_DAYS,
  HOUSEHOLD_ID,
  MAX_COVER_BYTES,
  noteViewId,
  READ_TAP_GUARD_MS,
  type DataChange,
  type ReadEvent,
} from '../DataStore';
import { BACKUP_FORMAT, summariseBackup } from '../backup';
import { PIN_ITERATIONS, hashPin, isPinHash, isValidPin, pinHashIterations, verifyPin } from '../pin';
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
  rawPut,
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

/** A clock that moves on a second at each reading, so things made in a row have different times. */
function tick(start = Date.parse('2026-01-01T00:00:00Z')): () => number {
  let t = start;
  return () => (t += 1000);
}

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
    const updated = await store.updateHousehold(HOUSEHOLD_ID, { name: 'Renamed' });
    equal([updated.id, updated.name, updated.parent_pin_hash], [HOUSEHOLD_ID, 'Renamed', null], 'patch applied, id kept');
    await rejectsWithCode(
      store.updateHousehold(HOUSEHOLD_ID, { parent_pin_hash: 'x' } as never),
      'invalid',
      'the PIN is not patched',
    );
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
      { readEvents: 3, booksRead: 2, journeys: 1, returnedLoans: 1, activeLoans: 0, libraryCards: 0, notes: 0 },
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

  check('readers', 'kind: a child unless asked, a grown-up when chosen, changeable; older rows read as children', async (ctx) => {
    const { store, dbName, h, a } = await withReaders(ctx);
    equal(a.kind, 'child', 'a new reader is a child');
    const g = await store.createReader({ household_id: h.id, display_name: 'Grown', avatar: '🦉', kind: 'grown_up' });
    equal([g.kind, (await store.getReader(g.id))?.kind, (await store.getReaderByCardToken(g.card_token))?.kind], ['grown_up', 'grown_up', 'grown_up'], 'grown-up saved');
    equal((await store.updateReader(a.id, { kind: 'grown_up' })).kind, 'grown_up', 'changed to a grown-up');
    equal((await store.updateReader(a.id, { display_name: 'A2' })).kind, 'grown_up', 'other edits keep it');
    equal((await store.rotateCardToken(a.id)).kind, 'grown_up', 'a new card keeps it');
    equal((await store.updateReader(a.id, { kind: 'child' })).kind, 'child', 'and back');
    await rejectsWithCode(store.createReader({ household_id: h.id, display_name: 'X', avatar: '🦊', kind: 'teacher' as 'child' }), 'invalid', 'unknown kind on create');
    await rejectsWithCode(store.updateReader(a.id, { kind: 'teacher' as 'child' }), 'invalid', 'unknown kind on update');
    // A reader saved before kinds existed.
    const old = { id: 'old-reader', household_id: h.id, display_name: 'Old', avatar: '🐢', card_token: 'old-token-0123456789', active_journey_id: null };
    await rawPut(dbName, 'readers', old);
    equal((await store.getReader(old.id))?.kind, 'child', 'an old row is a child');
    equal((await store.listReaders(h.id)).find((r) => r.id === old.id)?.kind, 'child', 'in the list too');
    equal((await store.updateReader(old.id, { avatar: '🐙' })).kind, 'child', 'and stays one when edited');
  }),
  check('readers', 'backups keep reader kinds; readers in an older backup restore as children', async (ctx) => {
    const { store, h } = await withReaders(ctx);
    const g = await store.createReader({ household_id: h.id, display_name: 'Grown', avatar: '🦉', kind: 'grown_up' });
    const backup = JSON.parse(JSON.stringify(await store.exportBackup()));
    const { store: target } = await ctx.open();
    await target.importBackup(backup);
    equal((await target.getReader(g.id))?.kind, 'grown_up', 'kept');
    for (const reader of backup.tables.readers) delete reader.kind;
    await target.importBackup(backup);
    equal((await target.listReaders(HOUSEHOLD_ID)).map((r) => r.kind), ['child', 'child', 'child'], 'no kind: children');
  }),

  check('checked reads', 'a pending read never counts; confirming it counts from when the child read it', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    const mum = await store.createReader({ household_id: h.id, display_name: 'Mum', avatar: '🦉', kind: 'grown_up' });
    const pending = await store.markRead(a.id, ISBN_A, '2026-01-05T10:00:00Z', { how: 'help', status: 'pending' });
    equal([pending?.status, pending?.how, pending?.confirmed_at, pending?.confirmed_by], ['pending', 'help', null, null], 'saved as pending');
    equal(await store.getReadSummary(a.id, ISBN_A), null, 'not read yet');
    equal(await store.countReadsSince(a.id, '2026-01-01T00:00:00Z'), 0, 'no journey step');
    equal([await store.countHouseholdReads(h.id), (await store.listHouseholdReadSummaries(h.id)).length], [0, 0], 'no household total');
    equal((await store.listPendingReads(h.id)).map((e) => e.id), [pending?.id], 'waiting for a grown-up');
    equal((await store.listPendingReads(h.id, mum.id)).length, 0, "another reader's list is empty");
    equal((await store.listReadEvents(a.id, ISBN_A)).map((e) => e.status), ['pending'], 'the event is there');

    const confirmed = await store.confirmRead(pending!.id, mum.id);
    equal([confirmed.status, confirmed.confirmed_by, confirmed.read_at], ['confirmed', mum.id, '2026-01-05T10:00:00.000Z'], 'confirmed by the grown-up');
    ok(confirmed.confirmed_at !== null && confirmed.confirmed_at > confirmed.read_at, 'confirmed later', confirmed);
    const summary = await store.getReadSummary(a.id, ISBN_A);
    equal([summary?.count, summary?.first_read_at], [1, '2026-01-05T10:00:00.000Z'], 'counts from read_at, not the confirmation');
    equal(await store.countReadsSince(a.id, '2026-01-05T00:00:00Z'), 1, 'a journey step since that day');
    equal(await store.countReadsSince(a.id, '2026-01-06T00:00:00Z'), 0, 'but not since the confirmation day');
    equal(await store.countHouseholdReads(h.id), 1, 'household total');
    equal(await store.listPendingReads(h.id), [], 'nothing left to check');
    equal((await store.confirmRead(pending!.id, 'pin')).confirmed_by, mum.id, 'confirming again changes nothing');
  }),
  check('checked reads', 'who can confirm, "Not yet", and the other read actions with pending reads', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx, { now: tick() });
    const mum = await store.createReader({ household_id: h.id, display_name: 'Mum', avatar: '🦉', kind: 'grown_up' });
    const p1 = await store.markRead(a.id, ISBN_A, undefined, { how: 'self', status: 'pending' });
    await rejectsWithCode(store.confirmRead(p1!.id, b.id), 'invalid', 'a child cannot confirm');
    await rejectsWithCode(store.confirmRead(p1!.id, 'nobody'), 'not_found', 'an unknown grown-up');
    await rejectsWithCode(store.confirmRead('nope', 'pin'), 'not_found', 'an unknown read');
    equal(await store.markRead(a.id, ISBN_A), null, 'the 10-second guard counts a pending read');
    equal((await store.rejectRead(p1!.id)).id, p1!.id, '"Not yet" deletes it');
    equal(await store.listReadEvents(a.id, ISBN_A), [], 'gone');
    await rejectsWithCode(store.rejectRead(p1!.id), 'not_found', 'already gone');
    const c1 = await store.markRead(a.id, ISBN_B, '2026-01-02T00:00:00Z', { how: 'self', confirmedBy: 'pin' });
    equal([c1?.status, c1?.confirmed_by], ['confirmed', 'pin'], 'confirmed now with the PIN');
    await rejectsWithCode(store.rejectRead(c1!.id), 'blocked', 'a confirmed read is not sent back');
    const self = await store.markRead(a.id, ISBN_C, '2026-01-03T00:00:00Z', { how: 'self' });
    equal([self?.status, self?.confirmed_by, self?.confirmed_at], ['confirmed', null, '2026-01-03T00:00:00.000Z'], 'no check needed');
    await rejectsWithCode(store.markRead(a.id, ISBN_C, undefined, { how: 'alone' as 'self' }), 'invalid', 'unknown how');
    await rejectsWithCode(store.markRead(a.id, ISBN_C, undefined, { status: 'maybe' as 'pending' }), 'invalid', 'unknown status');
    // Undo takes back the latest read, pending or not; restoring keeps its fields.
    const p2 = await store.markRead(a.id, ISBN_D, '2026-01-04T00:00:00Z', { how: 'help', status: 'pending' });
    const undone = await store.undoLatestRead(a.id, ISBN_D);
    equal([undone?.id, undone?.status], [p2?.id, 'pending'], 'undo a pending read');
    const restored = await store.restoreReadEvent(undone!);
    equal([restored.status, restored.how], ['pending', 'help'], 'restored as it was');
    equal(await store.getReadSummary(a.id, ISBN_D), null, 'still not counted');
    await store.confirmRead(restored.id, mum.id);
    equal((await store.getReadSummary(a.id, ISBN_D))?.count, 1, 'counted once confirmed');
    // Clearing a book and deleting a reader take pending reads with them.
    await store.markRead(a.id, ISBN_D, '2026-01-06T00:00:00Z', { status: 'pending' });
    equal(await store.clearReads(a.id, ISBN_D), 2, 'clear: the confirmed and the pending read');
    await store.markRead(b.id, ISBN_A, '2026-01-07T00:00:00Z', { status: 'pending' });
    await store.deleteReader(b.id);
    equal(await store.listPendingReads(h.id), [], "a deleted reader's pending read is gone");
  }),
  check('checked reads', 'needs_check: on for a child unless turned off, never for a grown-up; older rows are on', async (ctx) => {
    const { store, dbName, h, a } = await withReaders(ctx);
    equal(a.needs_check, true, 'a new child needs the check');
    const free = await store.createReader({ household_id: h.id, display_name: 'Free', avatar: '🐸', needs_check: false });
    equal(free.needs_check, false, 'unless set off');
    const mum = await store.createReader({ household_id: h.id, display_name: 'Mum', avatar: '🦉', kind: 'grown_up', needs_check: true });
    equal(mum.needs_check, false, 'never for a grown-up');
    equal((await store.updateReader(a.id, { needs_check: false })).needs_check, false, 'turned off');
    equal((await store.getReader(a.id))?.needs_check, false, 'saved');
    equal((await store.updateReader(a.id, { kind: 'grown_up' })).needs_check, false, 'a grown-up now');
    equal((await store.updateReader(a.id, { kind: 'child', needs_check: true })).needs_check, true, 'a child again, checked');
    await rejectsWithCode(store.updateReader(a.id, { needs_check: 'yes' as unknown as boolean }), 'invalid', 'not true or false');
    await rawPut(dbName, 'readers', { id: 'old', household_id: h.id, display_name: 'Old', avatar: '🐢', card_token: 'old-token-0123456789', active_journey_id: null });
    equal((await store.getReader('old'))?.needs_check, true, 'an older child gets the check');
  }),
  check('checked reads', 'backups keep pending reads and needs_check; older reads restore as confirmed and count', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    await store.updateReader(a.id, { needs_check: false });
    const pending = await store.markRead(a.id, ISBN_A, '2026-01-02T00:00:00Z', { how: 'help', status: 'pending' });
    await store.markRead(a.id, ISBN_B, '2026-01-03T00:00:00Z', { how: 'self', confirmedBy: 'pin' });
    const backup = JSON.parse(JSON.stringify(await store.exportBackup()));
    const { store: target } = await ctx.open();
    await target.importBackup(backup);
    equal((await target.listPendingReads(h.id)).map((e) => [e.id, e.how]), [[pending!.id, 'help']], 'pending kept, and not counted');
    equal(await target.getReadSummary(a.id, ISBN_A), null, 'still waiting');
    equal((await target.getReadSummary(a.id, ISBN_B))?.count, 1, 'confirmed counts');
    equal((await target.getReader(a.id))?.needs_check, false, 'needs_check kept');
    for (const event of backup.tables.read_events) for (const f of ['how', 'status', 'confirmed_at', 'confirmed_by']) delete event[f];
    for (const reader of backup.tables.readers) delete reader.needs_check;
    await target.importBackup(backup);
    equal([await target.listPendingReads(h.id), (await target.getReadSummary(a.id, ISBN_A))?.count], [[], 1], 'an older backup: every read counts');
    equal((await target.getReader(a.id))?.needs_check, true, 'and children get the check');
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
  check('books', 'isCoverPhotoMissing: only a photo whose bytes are not on this device', async (ctx) => {
    const { store, dbName } = await ctx.open();
    const url = await store.saveCoverImage(jpeg(7, 7));
    await store.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: url, source: 'manual' });
    await store.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: 'https://example.org/b.jpg', source: 'google' });
    await store.putBook({ isbn: ISBN_C, title: 'C', authors: [], cover_url: null, source: 'manual' });
    equal(
      [await store.isCoverPhotoMissing(ISBN_A), await store.isCoverPhotoMissing(ISBN_B), await store.isCoverPhotoMissing(ISBN_C), await store.isCoverPhotoMissing('9780000000999')],
      [false, false, false, false],
      'a photo here, a catalogue cover, no cover, no book',
    );
    // A synced book whose photo hasn't arrived: the reference is there, the bytes aren't.
    await rawPut(dbName, 'books', { isbn: ISBN_C, title: 'C', authors: [], cover_url: `cover:${'ab'.repeat(32)}`, source: 'manual' });
    equal(await store.isCoverPhotoMissing(ISBN_C), true, 'photo on its way');
    equal((await store.getBook(ISBN_C))?.cover_url, null, 'and it shows no cover meanwhile');
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

  // Collections -------------------------------------------------------------------
  check('collections', 'create, read, list and update: checked fields, a box ISBN gives the same id everywhere', async (ctx) => {
    const { store } = await ctx.open();
    const h = await store.getCurrentHousehold();
    const box = await store.createCollection({ household_id: h.id, title: '  The Box  ', isbn: '9780000000026', expected_count: 6 });
    equal([box.id, box.title, box.isbn, box.expected_count, box.cover_url], ['box-9780000000026', 'The Box', '9780000000026', 6, null], 'from a box ISBN');
    const series = await store.createCollection({ household_id: h.id, title: 'A series' });
    ok(series.id !== box.id && !series.id.startsWith('box-'), 'without one: a random id', series.id);
    equal([series.isbn, series.expected_count], [null, null], 'no ISBN, no count');
    await rejectsWithCode(store.createCollection({ household_id: h.id, title: 'Again', isbn: '9780000000026' }), 'conflict', 'same box twice');
    await rejectsWithCode(store.createCollection({ household_id: h.id, title: '   ' }), 'invalid', 'empty title');
    await rejectsWithCode(store.createCollection({ household_id: h.id, title: 'x'.repeat(201) }), 'invalid', 'title too long');
    await rejectsWithCode(store.createCollection({ household_id: h.id, title: 'X', isbn: '978-0' }), 'invalid', 'bad ISBN');
    await rejectsWithCode(store.createCollection({ household_id: h.id, title: 'X', expected_count: 0 }), 'invalid', 'count 0');
    await rejectsWithCode(store.createCollection({ household_id: h.id, title: 'X', expected_count: 501 }), 'invalid', 'count 501');
    equal((await store.listCollections(h.id)).map((c) => c.title), ['A series', 'The Box'], 'listed by title');
    const updated = await store.updateCollection(box.id, { title: 'Box set', expected_count: null, isbn: '9780000000033' });
    equal([updated.id, updated.title, updated.expected_count, updated.isbn], [box.id, 'Box set', null, '9780000000033'], 'updated, id kept');
    equal((await store.getCollection(box.id))?.title, 'Box set', 'get');
    equal(await store.getCollection('nope'), null, 'unknown');
    await rejectsWithCode(store.updateCollection('nope', { title: 'x' }), 'not_found', 'update unknown');
    await rejectsWithCode(store.updateCollection(box.id, { expected_count: 1.5 }), 'invalid', 'bad count');
  }),
  check('collections', 'members: numbers, editions sharing one, moving, taking out; putBook keeps membership', async (ctx) => {
    const { store } = await ctx.open();
    const h = await store.getCurrentHousehold();
    const set = await store.createCollection({ household_id: h.id, title: 'Set', expected_count: 3 });
    const other = await store.createCollection({ household_id: h.id, title: 'Other' });
    for (const [isbn, title] of [[ISBN_A, 'One'], [ISBN_B, 'Two'], [ISBN_C, 'Two again'], [ISBN_D, 'Loose']]) {
      await store.putBook({ isbn, title, authors: [], cover_url: null, source: 'manual' });
    }
    equal([(await store.getBook(ISBN_D))?.collection_id, (await store.getBook(ISBN_D))?.volume], [null, null], 'a new book is in none');
    await store.setBookCollection(ISBN_B, set.id, 2);
    await store.setBookCollection(ISBN_C, set.id, 2); // another edition of number 2
    const one = await store.setBookCollection(ISBN_A, set.id, 1);
    equal([one.collection_id, one.volume], [set.id, 1], 'returned');
    equal((await store.listCollectionBooks(set.id)).map((b) => [b.isbn, b.volume]), [[ISBN_A, 1], [ISBN_B, 2], [ISBN_C, 2]], 'by number');
    // Fixing a book (title, cover) never takes it out of its set.
    await store.putBook({ isbn: ISBN_B, title: 'Two (fixed)', authors: ['Z'], cover_url: null, source: 'manual' });
    equal([(await store.getBook(ISBN_B))?.collection_id, (await store.getBook(ISBN_B))?.volume], [set.id, 2], 'putBook keeps it');
    await store.setBookCollection(ISBN_C, other.id, null);
    equal((await store.listCollectionBooks(other.id)).map((b) => [b.isbn, b.volume]), [[ISBN_C, null]], 'moved, unnumbered');
    equal((await store.listCollectionBooks(set.id)).length, 2, 'one book in one collection at most');
    const out = await store.clearBookCollection(ISBN_A);
    equal([out.collection_id, out.volume], [null, null], 'taken out');
    ok((await store.getBook(ISBN_A)) !== null, 'and kept');
    await rejectsWithCode(store.setBookCollection(ISBN_A, set.id, 0), 'invalid', 'number 0');
    await rejectsWithCode(store.setBookCollection(ISBN_A, set.id, 10_000), 'invalid', 'number 10000');
    await rejectsWithCode(store.setBookCollection(ISBN_A, 'nope', 1), 'not_found', 'unknown collection');
    await rejectsWithCode(store.setBookCollection('9780000000999', set.id, 1), 'not_found', 'unknown book');
    await rejectsWithCode(store.clearBookCollection('9780000000999'), 'not_found', 'clear unknown book');
  }),
  check('collections', 'deleting one keeps its books and unlinks them; its cover photo stays while anything uses it', async (ctx) => {
    const { store, dbName } = await ctx.open();
    const h = await store.getCurrentHousehold();
    const photo = await store.saveCoverImage(jpeg(5, 5, 5));
    const set = await store.createCollection({ household_id: h.id, title: 'Box', cover_url: photo });
    ok(!!set.cover_url?.startsWith('blob:'), 'shown as a blob: URL', set.cover_url?.slice(0, 5));
    equal((await rawGet<{ cover_url: string }>(dbName, 'collections', set.id))?.cover_url, `cover:${await sha256Hex(jpeg(5, 5, 5))}`, 'stored as cover:<hash>');
    // A book that used the same photo stops using it: the box still does, so it stays.
    await store.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: photo, source: 'manual' });
    await store.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: null, source: 'manual' });
    equal((await rawAll(dbName, 'cover_images')).length, 1, 'kept for the box');
    await store.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: null, source: 'manual' });
    await store.setBookCollection(ISBN_A, set.id, 1);
    await store.setBookCollection(ISBN_B, set.id, 2);
    await store.addHomeItem(h.id, ISBN_A);
    await store.deleteCollection(set.id);
    equal(await store.getCollection(set.id), null, 'gone');
    equal(
      [await store.getBook(ISBN_A), await store.getBook(ISBN_B)].map((b) => [b?.title, b?.collection_id, b?.volume]),
      [['A', null, null], ['B', null, null]],
      'books kept, unlinked',
    );
    ok((await store.getHomeItem(h.id, ISBN_A)) !== null, 'still at home');
    equal((await rawAll(dbName, 'cover_images')).length, 0, 'its photo went with it (nothing else used it)');
    // A new cover for a box drops the old photo when nothing else uses it.
    const p1 = await store.saveCoverImage(jpeg(6));
    const box = await store.createCollection({ household_id: h.id, title: 'Box 2', cover_url: p1 });
    await store.updateCollection(box.id, { cover_url: 'https://example.org/box.jpg' });
    equal((await rawAll(dbName, 'cover_images')).length, 0, 'old box photo dropped');
    equal((await store.getCollection(box.id))?.cover_url, 'https://example.org/box.jpg', 'catalogue cover');
    await store.deleteCollection('never-there'); // nothing to do, no error
  }),
  check('collections', 'a backup keeps collections, members and the box photo', async (ctx) => {
    const { store } = await ctx.open();
    const h = await store.getCurrentHousehold();
    const photo = await store.saveCoverImage(jpeg(7, 7));
    const set = await store.createCollection({ household_id: h.id, title: 'Box', isbn: '9780000000026', expected_count: 4, cover_url: photo });
    await store.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: null, source: 'manual' });
    await store.setBookCollection(ISBN_A, set.id, 3);
    const backup = await store.exportBackup();
    equal(backup.tables.collections.map((c) => [c.id, c.expected_count, c.cover_url?.startsWith('cover:')]), [[set.id, 4, true]], 'exported');
    equal(Object.keys(backup.covers).length, 1, 'the box photo is in the file');
    await store.resetDevice();
    equal(await store.listCollections(HOUSEHOLD_ID), [], 'reset');
    const summary = await store.importBackup(JSON.parse(JSON.stringify(backup)));
    equal(summary.collections, 1, 'counted');
    const back = await store.getCollection(set.id);
    equal([back?.title, back?.isbn, back?.expected_count], ['Box', '9780000000026', 4], 'restored');
    ok(await sameBytes(await blobAt(back?.cover_url), jpeg(7, 7)), 'with its photo');
    equal([(await store.getBook(ISBN_A))?.collection_id, (await store.getBook(ISBN_A))?.volume], [set.id, 3], 'member restored');
  }),

  // Parent notes ------------------------------------------------------------------
  check('notes', 'write, edit, order and delete notes: checked fields, positions after the last', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const mum = await store.createReader({ household_id: h.id, display_name: 'Mum', avatar: '🦉', kind: 'grown_up' });
    const n1 = await store.createNote({ household_id: h.id, target: 'everyone', trigger: 'after_book', text: '  Well done!  ', sticker: '🦊' });
    const n2 = await store.createNote({ household_id: h.id, target: a.id, trigger: 'journey_done', text: 'You did it', author_id: mum.id });
    const n3 = await store.createNote({ household_id: h.id, target: b.id, trigger: 'after_book', text: 'Keep going' });
    equal([n1.text, n1.sticker, n1.author_id, n1.position], ['Well done!', '🦊', null, 1], 'trimmed, from the grown-ups, first');
    equal([n2.author_id, n2.position, n3.position], [mum.id, 2, 3], 'author, then after the last');
    ok(n1.created_at <= n2.created_at, 'created_at', [n1.created_at, n2.created_at]);
    await rejectsWithCode(store.createNote({ household_id: h.id, target: 'everyone', trigger: 'after_book', text: '   ' }), 'invalid', 'empty text');
    await rejectsWithCode(store.createNote({ household_id: h.id, target: 'everyone', trigger: 'after_book', text: 'x'.repeat(501) }), 'invalid', 'text too long');
    await rejectsWithCode(store.createNote({ household_id: h.id, target: 'everyone', trigger: 'sometimes' as 'after_book', text: 'x' }), 'invalid', 'trigger');
    await rejectsWithCode(store.createNote({ household_id: h.id, target: 'everyone', trigger: 'after_book', text: 'x', sticker: 'two words' }), 'invalid', 'sticker');
    await rejectsWithCode(store.createNote({ household_id: h.id, target: 'nobody', trigger: 'after_book', text: 'x' }), 'not_found', 'unknown target');
    await rejectsWithCode(store.createNote({ household_id: h.id, target: mum.id, trigger: 'after_book', text: 'x' }), 'invalid', 'a grown-up as target');
    await rejectsWithCode(store.createNote({ household_id: h.id, target: 'everyone', trigger: 'after_book', text: 'x', author_id: a.id }), 'invalid', 'a child as author');
    const edited = await store.updateNote(n3.id, { text: 'Keep reading', target: 'everyone', sticker: null });
    equal([edited.text, edited.target, edited.sticker, edited.position], ['Keep reading', 'everyone', null, 3], 'edited, place kept');
    await rejectsWithCode(store.updateNote('nope', { text: 'x' }), 'not_found', 'edit unknown');
    const order = await store.reorderNotes(h.id, [n3.id, n1.id]);
    equal(order.map((n) => [n.id, n.position]), [[n3.id, 1], [n1.id, 2], [n2.id, 3]], 'reordered');
    equal((await store.listNotes(h.id)).map((n) => n.id), [n3.id, n1.id, n2.id], 'listed in order');
    await store.markNoteSeen(n1.id, a.id);
    await store.deleteNote(n1.id);
    equal((await store.listNotes(h.id)).map((n) => n.id), [n3.id, n2.id], 'deleted');
    equal(await store.listNoteViews(h.id), [], 'with its seen records');
  }),
  check('notes', 'seen once per reader ("<note>:<reader>"), the first time kept; show again forgets it', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const all = await store.createNote({ household_id: h.id, target: 'everyone', trigger: 'after_book', text: 'For all' });
    const mine = await store.createNote({ household_id: h.id, target: a.id, trigger: 'journey_done', text: 'For A' });
    const view = await store.markNoteSeen(all.id, a.id, '2026-03-01T10:00:00Z');
    equal([view.id, view.seen_at], [noteViewId(all.id, a.id), '2026-03-01T10:00:00.000Z'], 'the id, the time');
    ok(`note_views:${view.id}`.length <= 64, 'fits a sync record id', view.id);
    equal((await store.markNoteSeen(all.id, a.id, '2026-03-05T10:00:00Z')).seen_at, '2026-03-01T10:00:00.000Z', 'seen again: the first time stays');
    equal(
      (await store.listNotesForReader(a.id)).map((x) => [x.note.id, x.seen_at]),
      [[all.id, '2026-03-01T10:00:00.000Z'], [mine.id, null]],
      'A: for everyone and for A',
    );
    equal((await store.listNotesForReader(b.id)).map((x) => [x.note.id, x.seen_at]), [[all.id, null]], 'B: only the one for everyone');
    await store.showAgain(all.id, a.id);
    equal((await store.listNotesForReader(a.id))[0].seen_at, null, 'shown again');
    await store.showAgain(all.id, a.id); // nothing to forget: no error
    await rejectsWithCode(store.markNoteSeen('nope', a.id), 'not_found', 'unknown note');
    await rejectsWithCode(store.markNoteSeen(all.id, 'nobody'), 'not_found', 'unknown reader');
    equal(await store.listNotesForReader('nobody'), [], 'unknown reader: none');
  }),
  check('notes', 'deleting a reader deletes the notes only for them, their seen records, and others\' records of those notes', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const all = await store.createNote({ household_id: h.id, target: 'everyone', trigger: 'after_book', text: 'For all' });
    const forB = await store.createNote({ household_id: h.id, target: b.id, trigger: 'after_book', text: 'For B' });
    const forA = await store.createNote({ household_id: h.id, target: a.id, trigger: 'after_book', text: 'For A' });
    await store.markNoteSeen(all.id, a.id);
    await store.markNoteSeen(all.id, b.id);
    await store.markNoteSeen(forB.id, b.id);
    equal((await store.previewDeleteReader(b.id)).notes, 1, 'counted in the preview');
    await store.deleteReader(b.id);
    equal((await store.listNotes(h.id)).map((n) => n.id).sort(), [all.id, forA.id].sort(), 'the note for B went; for everyone and for A stayed');
    equal((await store.listNoteViews(h.id)).map((v) => v.id), [noteViewId(all.id, a.id)], 'only A’s record stays');
  }),
  check('notes', 'a backup keeps notes and who saw them', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    const note = await store.createNote({ household_id: h.id, target: a.id, trigger: 'journey_done', text: 'Proud of you', sticker: '🐼' });
    await store.markNoteSeen(note.id, a.id, '2026-04-01T08:00:00Z');
    const backup = await store.exportBackup();
    equal([backup.tables.parent_notes.length, backup.tables.note_views.length], [1, 1], 'exported');
    await store.resetDevice();
    const summary = await store.importBackup(JSON.parse(JSON.stringify(backup)));
    equal(summary.notes, 1, 'counted');
    equal((await store.listNotesForReader(a.id)).map((x) => [x.note.text, x.note.sticker, x.seen_at]), [['Proud of you', '🐼', '2026-04-01T08:00:00.000Z']], 'restored');
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
  check('library cards', 'addLibraryCard tidies and checks the number, copies the library name, lists newest first', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx, { now: tick() });
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const first = await store.addLibraryCard({ household_id: h.id, reader_id: a.id, value: ' 21234000123456 ', format: 'codabar', library_id: lib.id });
    equal([first.value, first.format, first.library_id, first.library_name, first.label], ['21234000123456', 'codabar', lib.id, 'Branch', null], 'saved');
    const second = await store.addLibraryCard({ household_id: h.id, reader_id: a.id, value: '*abc-12*', format: 'code_39', label: '  Pool  ' });
    equal([second.value, second.library_id, second.library_name, second.label], ['ABC-12', null, null, 'Pool'], 'Code 39 tidied; label trimmed');
    await store.addLibraryCard({ household_id: h.id, reader_id: b.id, value: '4006381333931', format: 'ean_13' });
    equal((await store.listLibraryCards(a.id)).map((c) => c.id), [second.id, first.id], 'newest first');
    equal((await store.listHouseholdLibraryCards(h.id)).length, 3, 'household list');
    equal(await store.getLibraryCard(first.id), first, 'get');
    equal(await store.getLibraryCard('nope'), null, 'get unknown');
    const add = (value: string, format: string, extra = {}) =>
      store.addLibraryCard({ household_id: h.id, reader_id: a.id, value, format: format as 'code_128', ...extra });
    await rejectsWithCode(add('', 'code_128'), 'invalid', 'empty');
    await rejectsWithCode(add('x'.repeat(201), 'code_128'), 'invalid', 'too long');
    await rejectsWithCode(add('12345', 'itf'), 'invalid', 'odd ITF');
    await rejectsWithCode(add('9780000000002', 'ean_13'), 'invalid', 'an ISBN');
    await rejectsWithCode(add('4006381333932', 'ean_13'), 'invalid', 'bad check digit');
    await rejectsWithCode(add('abc', 'qr_code'), 'invalid', 'unknown format');
    await rejectsWithCode(add('123', 'code_128', { label: 'x'.repeat(101) }), 'invalid', 'label too long');
    await rejectsWithCode(add('123', 'code_128', { library_id: 'nope' }), 'not_found', 'unknown library');
    await rejectsWithCode(store.addLibraryCard({ household_id: h.id, reader_id: 'nope', value: '1', format: 'code_128' }), 'not_found', 'unknown reader');
    equal((await store.listLibraryCards(a.id)).length, 2, 'nothing saved by the refused adds');
  }),
  check('library cards', 'updateLibraryCard changes number, type, label and library; deleteLibraryCard removes one', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const other = await store.createLibrary({ household_id: h.id, name: 'Other' });
    const card = await store.addLibraryCard({ household_id: h.id, reader_id: a.id, value: 'A1', format: 'code_128', library_id: lib.id });
    const moved = await store.updateLibraryCard(card.id, { library_id: other.id, label: 'Main' });
    equal([moved.library_id, moved.library_name, moved.label, moved.value], [other.id, 'Other', 'Main', 'A1'], 'new library name copied');
    const retyped = await store.updateLibraryCard(card.id, { value: '0012', format: 'itf', label: '' });
    equal([retyped.value, retyped.format, retyped.label, retyped.library_id], ['0012', 'itf', null, other.id], 'number and type; empty label cleared');
    const none = await store.updateLibraryCard(card.id, { library_id: null });
    equal([none.library_id, none.library_name], [null, null], 'no library');
    await rejectsWithCode(store.updateLibraryCard(card.id, { format: 'ean_13' }), 'invalid', 'number no longer fits the new type');
    await rejectsWithCode(store.updateLibraryCard(card.id, { library_id: 'nope' }), 'not_found', 'unknown library');
    await rejectsWithCode(store.updateLibraryCard('nope', { label: 'x' }), 'not_found', 'unknown card');
    equal((await store.getLibraryCard(card.id))?.format, 'itf', 'refused updates changed nothing');
    await store.deleteLibraryCard(card.id);
    equal(await store.getLibraryCard(card.id), null, 'deleted');
    equal((await store.listLibraryCards(a.id)).length, 0, 'list empty');
  }),
  check('library cards', 'copyLibraryCardToReaders gives each reader their own copy, skipping duplicates', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const c = await store.createReader({ household_id: h.id, display_name: 'C', avatar: '🐙' });
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const card = await store.addLibraryCard({ household_id: h.id, reader_id: a.id, value: '31000999', format: 'code_128', library_id: lib.id, label: 'Family' });
    await store.addLibraryCard({ household_id: h.id, reader_id: c.id, value: '31000999', format: 'code_128' });
    const created = await store.copyLibraryCardToReaders(card.id, [a.id, b.id, c.id, b.id]);
    equal(created.map((x) => x.reader_id), [b.id], 'only B: A owns it, C already has it, B once');
    const copy = created[0];
    ok(copy.id !== card.id, 'a new record');
    equal([copy.value, copy.format, copy.library_id, copy.library_name, copy.label], ['31000999', 'code_128', lib.id, 'Branch', 'Family'], 'same details');
    await store.updateLibraryCard(copy.id, { label: 'Mine' });
    equal((await store.getLibraryCard(card.id))?.label, 'Family', 'the copy changes on its own');
    equal(await store.copyLibraryCardToReaders(card.id, [b.id]), [], 'copying again adds nothing');
    await rejectsWithCode(store.copyLibraryCardToReaders(card.id, ['nope']), 'not_found', 'unknown reader');
    await rejectsWithCode(store.copyLibraryCardToReaders('nope', [b.id]), 'not_found', 'unknown card');
    equal((await store.listHouseholdLibraryCards(h.id)).length, 3, 'nothing else added');
  }),
  check('library cards', 'deleteLibrary keeps the cards with the library name; deleteReader removes their cards', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const aCard = await store.addLibraryCard({ household_id: h.id, reader_id: a.id, value: '111', format: 'code_128', library_id: lib.id });
    const bCard = await store.addLibraryCard({ household_id: h.id, reader_id: b.id, value: '222', format: 'code_128', library_id: lib.id });
    await store.deleteLibrary(lib.id);
    const kept = await store.getLibraryCard(aCard.id);
    equal([kept?.library_id, kept?.library_name, kept?.value], [null, 'Branch', '111'], 'number kept, name copied');
    equal((await store.previewDeleteReader(b.id)).libraryCards, 1, 'the delete preview counts them');
    await store.deleteReader(b.id);
    equal(await store.getLibraryCard(bCard.id), null, "the deleted reader's card is gone");
    ok(await store.getLibraryCard(aCard.id), "the other reader's card stays");
  }),
  check('library cards', 'a backup round trip keeps library cards; an older backup without them still restores', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const card = await store.addLibraryCard({ household_id: h.id, reader_id: a.id, value: 'A123B', format: 'codabar', library_id: lib.id, label: 'Town' });
    const backup = JSON.parse(JSON.stringify(await store.exportBackup()));
    equal(backup.tables.library_cards.length, 1, 'exported');
    const { store: target } = await ctx.open();
    await target.importBackup(backup);
    equal(await target.getLibraryCard(card.id), card, 'restored exactly');

    const old = JSON.parse(JSON.stringify(backup));
    delete old.tables.library_cards;
    old.schema = 5;
    const { store: third } = await ctx.open();
    await third.getCurrentHousehold();
    await third.addLibraryCard({ household_id: HOUSEHOLD_ID, reader_id: (await third.createReader({ household_id: HOUSEHOLD_ID, display_name: 'X', avatar: '🦊' })).id, value: '9', format: 'code_128' });
    await third.importBackup(old);
    equal(await third.listHouseholdLibraryCards(HOUSEHOLD_ID), [], 'restored with no library cards (and replaced this device\'s)');
    equal((await third.listReaders(HOUSEHOLD_ID)).length, 2, 'the rest restored');

    const broken = JSON.parse(JSON.stringify(backup));
    broken.tables.library_cards[0].reader_id = 'nobody';
    await rejectsWithCode(target.importBackup(broken), 'invalid', 'a card for a reader not in the file');
    const badNumber = JSON.parse(JSON.stringify(backup));
    badNumber.tables.library_cards[0].format = 'ean_13';
    await rejectsWithCode(target.importBackup(badNumber), 'invalid', 'a number that does not fit its type');
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
  check('loans', 'updateLoan changes the book (a saved book key) and never touches reads', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    await store.putBook({ isbn: ISBN_A, title: 'Scanned by mistake', authors: [], cover_url: null, source: 'manual' });
    await store.putBook({ isbn: ISBN_B, title: 'The right book', authors: [], cover_url: null, source: 'manual' });
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A });
    await store.markRead(a.id, ISBN_A, '2026-05-01T10:00:00.000Z');
    const fixed = await store.updateLoan(loan.id, { isbn: ISBN_B });
    equal(fixed.isbn, ISBN_B, 'the loan points at the other book');
    equal((await store.listReadEvents(a.id)).map((e) => e.isbn), [ISBN_A], 'the read of the first book is untouched');
    await rejectsWithCode(store.updateLoan(loan.id, { isbn: ISBN_C }), 'not_found', 'a book that is not saved');
    await rejectsWithCode(store.updateLoan(loan.id, { isbn: '' }), 'invalid', 'an empty book key');
    const noIsbn = 'noisbn-0f3a';
    await store.putBook({ isbn: noIsbn, title: 'No barcode', authors: [], cover_url: null, source: 'manual' });
    equal((await store.updateLoan(loan.id, { isbn: noIsbn })).isbn, noIsbn, 'a book without a barcode');
  }),
  check('loans', 'updateLoan sets the borrowed date and the returned date (null un-returns), validated', async (ctx) => {
    const { store, h, a } = await withReaders(ctx, { now: () => Date.parse('2026-05-10T12:00:00Z') });
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A });
    const dated = await store.updateLoan(loan.id, { borrowed_at: '2026-05-01T09:30:00+02:00' });
    equal(dated.borrowed_at, '2026-05-01T07:30:00.000Z', 'borrowed_at stored as UTC ISO');
    const returned = await store.updateLoan(loan.id, { returned_at: '2026-05-08T16:00:00Z' });
    equal(returned.returned_at, '2026-05-08T16:00:00.000Z', 'returned on a chosen date');
    equal((await store.listActiveLoans(a.id)).length, 0, 'no longer active');
    equal((await store.updateLoan(loan.id, { returned_at: null })).returned_at, null, 'returned_at null: active again');
    equal((await store.listActiveLoans(a.id)).map((l) => l.id), [loan.id], 'back in the active list');
    await rejectsWithCode(store.updateLoan(loan.id, { borrowed_at: 'last week' }), 'invalid', 'bad borrowed date');
    await rejectsWithCode(store.updateLoan(loan.id, { returned_at: 'soon' }), 'invalid', 'bad returned date');
    equal((await store.getLoan(loan.id))?.borrowed_at, '2026-05-01T07:30:00.000Z', 'a refused patch changes nothing');
  }),
  check('loans', 'updateLoan sets, trims and clears the sticker, and finds it by sticker afterwards', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, library_id: lib.id });
    equal((await store.updateLoan(loan.id, { sticker_barcode: '  31000999  ' })).sticker_barcode, '31000999', 'trimmed');
    equal((await store.findActiveLoansBySticker(h.id, '31000999')).map((l) => l.id), [loan.id], 'found by the new sticker');
    equal((await store.updateLoan(loan.id, { sticker_barcode: '   ' })).sticker_barcode, null, 'blank clears it');
    equal((await store.updateLoan(loan.id, { sticker_barcode: '31000123' })).sticker_barcode, '31000123', 'set again');
    equal((await store.updateLoan(loan.id, { sticker_barcode: null })).sticker_barcode, null, 'null clears it');
    equal((await store.findActiveLoansBySticker(h.id, '31000123')).length, 0, 'the old sticker no longer finds it');
    await rejectsWithCode(store.updateLoan(loan.id, { sticker_barcode: 'x'.repeat(201) }), 'invalid', 'too long');
  }),
  check('loans', 'updateLoan sets the renew count (a whole number of 0 or more) and the library name', async (ctx) => {
    const { store, h, a } = await withReaders(ctx);
    const lib = await store.createLibrary({ household_id: h.id, name: 'Branch' });
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A, library_name: 'Old note' });
    equal((await store.updateLoan(loan.id, { renew_count: 3 })).renew_count, 3, 'set');
    equal((await store.updateLoan(loan.id, { renew_count: 0 })).renew_count, 0, 'back to 0');
    await rejectsWithCode(store.updateLoan(loan.id, { renew_count: -1 }), 'invalid', 'negative');
    await rejectsWithCode(store.updateLoan(loan.id, { renew_count: 1.5 }), 'invalid', 'fractional');
    const linked = await store.updateLoan(loan.id, { library_id: lib.id, library_name: null });
    equal([linked.library_id, linked.library_name], [lib.id, null], 'a library chosen, the leftover name cleared');
  }),
  check('loans', 'moving a loan to another reader keeps every read where it was', async (ctx) => {
    const { store, h, a, b } = await withReaders(ctx);
    const loan = await store.createLoan({ household_id: h.id, reader_id: a.id, isbn: ISBN_A });
    await store.markRead(a.id, ISBN_A, '2026-05-01T10:00:00.000Z');
    await store.updateLoan(loan.id, { reader_id: b.id });
    equal([(await store.listReadEvents(a.id)).length, (await store.listReadEvents(b.id)).length], [1, 0], 'reads stay with A');
    await store.deleteLoan(loan.id);
    equal((await store.listReadEvents(a.id)).length, 1, 'deleting the loan keeps the read');
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
    const format = new RegExp('^pbkdf2-sha256[$]' + PIN_ITERATIONS + '[$][A-Za-z0-9_-]{22}[$][A-Za-z0-9_-]{43}$');
    ok(format.test(hash), 'format', hash.split('$').slice(0, 2));
    equal(pinHashIterations(hash), PIN_ITERATIONS, 'the cost is recorded in the hash');
    ok(await verifyPin('2468', hash), 'right PIN');
    ok(!(await verifyPin('2469', hash)), 'wrong PIN');
    ok(!(await verifyPin('2468', 'not-a-hash')), 'garbage');
    ok(!(await verifyPin('2468', 'pbkdf2-sha256$0$aa$bb')), 'zero iterations');
    ok(hash !== (await hashPin('2468')), 'salted');
    // Another cost still verifies, with the count in the hash.
    const cheaper = await hashPin('2468', 2000);
    ok(await verifyPin('2468', cheaper), 'a hash with another cost verifies');
    ok(!isPinHash('pbkdf2-sha256$99999999$' + 'a'.repeat(22) + '$' + 'b'.repeat(43)), 'an absurd cost is refused');
    ok(isValidPin('1234') && isValidPin('123456') && !isValidPin('123') && !isValidPin('1234567') && !isValidPin('12a4'), '4 to 6 digits');
  }),
  check('pin', 'setHouseholdPin / verifyHouseholdPin / clearHouseholdPin', async (ctx) => {
    const { store, dbName } = await ctx.open();
    const seen: DataChange[] = [];
    store.subscribe((c) => seen.push(c));
    equal(await store.verifyHouseholdPin('1234'), false, 'no PIN yet: nothing verifies');
    await store.setHouseholdPin('1234');
    const [row] = await rawAll<{ parent_pin_hash: string | null }>(dbName, 'households');
    ok(isPinHash(row.parent_pin_hash), 'only a hash is stored', row.parent_pin_hash);
    equal((await store.getCurrentHousehold()).parent_pin_hash, row.parent_pin_hash, 'the household shows the hash');
    ok(seen.some((c) => c.tables.includes('households')), 'households changed');
    equal(await store.verifyHouseholdPin('1234'), true, 'right PIN');
    equal(await store.verifyHouseholdPin('4321'), false, 'wrong PIN');
    equal(await store.verifyHouseholdPin('12'), false, 'not a PIN');
    await store.setHouseholdPin('987654');
    equal([await store.verifyHouseholdPin('987654'), await store.verifyHouseholdPin('1234')], [true, false], 'changed');
    for (const bad of ['123', '1234567', 'abcd', '12 34', '']) {
      await rejectsWithCode(store.setHouseholdPin(bad), 'invalid', `refuses "${bad}"`);
    }
    equal(await store.verifyHouseholdPin('987654'), true, 'a refused PIN changes nothing');
    await store.clearHouseholdPin();
    equal((await store.getCurrentHousehold()).parent_pin_hash, null, 'cleared');
    equal(await store.verifyHouseholdPin('987654'), false, 'nothing verifies after clearing');
    await store.clearHouseholdPin(); // clearing twice is fine
  }),
  check('pin', 'a PIN set before the household exists creates it', async (ctx) => {
    const { store } = await ctx.open();
    await store.setHouseholdPin('2468');
    equal((await store.getCurrentHousehold()).id, HOUSEHOLD_ID, 'household created');
    equal(await store.verifyHouseholdPin('2468'), true, 'and it has the PIN');
  }),
  check('pin', 'the PIN is in backups and comes back on restore', async (ctx) => {
    const { store } = await ctx.open();
    await store.setHouseholdPin('2468');
    const backup = await store.exportBackup();
    ok(isPinHash(backup.tables.households[0].parent_pin_hash), 'backed up as its hash');
    await store.clearHouseholdPin();
    await store.importBackup(JSON.parse(JSON.stringify(backup)));
    equal(await store.verifyHouseholdPin('2468'), true, 'restored');
  }),

  // Migrations ------------------------------------------------------------------------
  check('migration', 'a fresh database is created at v9 with no legacy reads store', async (ctx) => {
    const { store, dbName } = await ctx.open();
    await store.coverStep;
    const { version, stores } = await rawStoreNames(dbName);
    equal(version, 9, 'version');
    equal((await rawIndexNames(dbName, 'collections')).sort(), ['by_cover', 'by_household'], 'collection indexes');
    equal((await rawIndexNames(dbName, 'parent_notes')).sort(), ['by_household', 'by_target'], 'note indexes');
    equal((await rawIndexNames(dbName, 'note_views')).sort(), ['by_household', 'by_note', 'by_reader'], 'note view indexes');
    equal((await rawIndexNames(dbName, 'books')).sort(), ['by_collection', 'by_cover'], 'book indexes');
    equal((await rawIndexNames(dbName, 'library_cards')).sort(), ['by_household_created', 'by_library', 'by_reader'], 'library card indexes');
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
  check('migration', 'v4 -> v9: records, outbox, library_cards, collections and note stores and the read status index added, every row kept, nothing recorded', async (ctx) => {
    const name = ctx.name();
    const fixture = await createV3Database(name); // upgrades through v4 … v8 to v9
    const store = await ctx.attach(name);
    const { version, stores } = await rawStoreNames(name);
    equal(version, 9, 'version');
    ok(stores.includes('parent_notes') && stores.includes('note_views'), 'note stores', stores);
    equal(await store.listNotes(HOUSEHOLD_ID), [], 'no notes yet');
    ok(stores.includes('records') && stores.includes('outbox') && stores.includes('library_cards') && stores.includes('collections'), 'new stores', stores);
    equal(await store.listHouseholdLibraryCards(HOUSEHOLD_ID), [], 'no library cards yet');
    equal(await store.listCollections(HOUSEHOLD_ID), [], 'no collections yet');
    const oldBook = (await rawAll<{ isbn: string }>(name, 'books'))[0];
    if (oldBook) {
      const book = await store.getBook(oldBook.isbn);
      equal([book?.collection_id, book?.volume], [null, null], 'an older book is in no collection');
    }
    equal((await rawAll(name, 'records')).length, 0, 'migrated rows have no records until sync is turned on');
    equal((await rawAll(name, 'outbox')).length, 0, 'and nothing is queued');
    equal((await rawAll(name, 'loans')).length, fixture.loans.length, 'loans kept');
    ok((await store.getHousehold(HOUSEHOLD_ID)) !== null, 'household kept');
  }),
  check('migration', 'v3 -> v4: loan sticker indexes replaced, every loan kept', async (ctx) => {
    const name = ctx.name();
    const fixture = await createV3Database(name);
    const store = await ctx.attach(name);
    equal((await rawStoreNames(name)).version, 9, 'version');
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
    equal([backup.format, backup.version, backup.schema], [BACKUP_FORMAT, 1, 9], 'format, version, schema');
    ok(!('records' in backup.tables) && !('outbox' in backup.tables), 'sync bookkeeping is never exported');
    ok(!('read_summaries' in backup.tables), 'summaries are not exported');
    equal(Object.keys(backup.covers), [photoRef], 'the one photo, under its cover: key');
    equal((backup.tables.books.find((x) => x.isbn === ISBN_A))?.cover_url, photoRef, 'books keep the cover: reference, not a blob: URL');
    const before = summariseBackup(backup);
    equal(before, { readers: 2, books: 2, homeBooks: 2, collections: 0, notes: 0, loans: 2, reads: 3, covers: 1 }, 'summary counts');

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
