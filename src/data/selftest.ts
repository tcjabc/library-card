/**
 * Storage self-test for the local adapter. Runs against throwaway IndexedDB
 * databases (never the app's real one) and deletes them afterwards.
 * Started from the developer page; also handy from the console:
 *
 *   (await import('/src/data/selftest.ts')).runLocalSelfTest()
 */
import { openDB } from 'idb';
import { createLocalStore, type LocalDataStore } from './adapters/local';
import {
  HOUSEHOLD_ID,
  MAX_COVER_BYTES,
  READ_TAP_GUARD_MS,
  isDataStoreError,
  type DataChange,
  type ReadEvent,
} from './DataStore';
import { hashPin, verifyPin } from './pin';

export interface SelfTestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const ISBN_A = '9780000000002';
const ISBN_B = '9780000000019';
const ISBN_C = '9780000000026';
const ISBN_D = '9780000000033';

const T = (iso: string) => new Date(iso).toISOString();

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sameBytes(a: Blob | null | undefined, b: Blob | null | undefined): Promise<boolean> {
  if (!a || !b || a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  return u.every((byte, i) => byte === v[i]);
}

/** Every row of one store, read without the adapter. */
async function rawAll<T = Record<string, unknown>>(dbName: string, storeName: string): Promise<T[]> {
  const raw = await openDB(dbName);
  try {
    if (!raw.objectStoreNames.contains(storeName)) return [];
    return (await raw.getAll(storeName)) as T[];
  } finally {
    raw.close();
  }
}

async function rawGet<T = Record<string, unknown>>(dbName: string, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const raw = await openDB(dbName);
  try {
    return (await raw.get(storeName, key)) as T | undefined;
  } finally {
    raw.close();
  }
}

async function rawStoreExists(dbName: string, storeName: string): Promise<boolean> {
  const raw = await openDB(dbName);
  const exists = raw.objectStoreNames.contains(storeName);
  raw.close();
  return exists;
}

export async function runLocalSelfTest(): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  const check = (name: string, pass: boolean, detail?: unknown) =>
    results.push({ name, pass, detail: detail === undefined ? undefined : JSON.stringify(detail) });
  const rejectsWith = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return 'resolved';
    } catch (error) {
      return isDataStoreError(error) ? error.code : String(error);
    }
  };

  const stamp = Date.now();
  const dbName = `lc-selftest-${stamp}`;
  const v1Name = `lc-selftest-v1-${stamp}`;
  const v2Name = `lc-selftest-v2-${stamp}`;
  const opened: LocalDataStore[] = [];

  try {
    // A controllable clock, for the double-tap guard.
    let clock = Date.parse('2026-05-01T10:00:00Z');
    const s = await createLocalStore(dbName, { now: () => clock });
    const s2 = await createLocalStore(dbName); // a "second tab"
    opened.push(s, s2);

    // --- Household -----------------------------------------------------------
    const [c1, c2] = await Promise.all([s.getCurrentHousehold(), s.getCurrentHousehold()]);
    check(
      'getCurrentHousehold is "main", created once',
      c1.id === HOUSEHOLD_ID && c2.id === HOUSEHOLD_ID && (await rawAll(dbName, 'households')).length === 1,
    );
    const h = c1;
    const other = await s.testOnlyAddHousehold('other', 'Other');

    // --- subscribe -------------------------------------------------------------
    const local: DataChange[] = [];
    const remote: DataChange[] = [];
    const unsubLocal = s.subscribe((c) => local.push(c));
    const remoteArrived = new Promise<void>((resolve) => {
      const unsub = s2.subscribe((c) => {
        remote.push(c);
        unsub();
        resolve();
      });
    });

    // --- Readers and card tokens ----------------------------------------------
    const a = await s.createReader({ household_id: h.id, display_name: 'A', avatar: '🦊' });
    const b = await s.createReader({ household_id: h.id, display_name: 'B', avatar: '🐢' });
    const c = await s.createReader({ household_id: other.id, display_name: 'C', avatar: '🐙' });
    check('new reader has no active journey', a.active_journey_id === null);
    check('subscribe fires locally after a write', local.some((x) => x.tables.includes('readers') && !x.remote));
    await Promise.race([remoteArrived, new Promise((r) => setTimeout(r, 1500))]);
    check('subscribe fires in another tab (BroadcastChannel)', remote.length > 0 && remote[0].remote);

    const tokenOk = (t: string) => /^[A-Za-z0-9_-]{22,}$/.test(t);
    check('card token is base64url and >= 128 bits', tokenOk(a.card_token), a.card_token.length);
    check('getReaderByCardToken finds the reader', (await s.getReaderByCardToken(a.card_token))?.id === a.id);
    check('getReaderByCardToken unknown -> null', (await s.getReaderByCardToken('nope')) === null);
    const rotated = await s.rotateCardToken(a.id);
    check(
      'rotateCardToken issues a new token and retires the old one',
      rotated.card_token !== a.card_token &&
        tokenOk(rotated.card_token) &&
        (await s.getReaderByCardToken(a.card_token)) === null &&
        (await s.getReaderByCardToken(rotated.card_token))?.id === a.id,
    );

    // --- Read events ----------------------------------------------------------
    const e1 = await s.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    const sum1 = await s.getReadSummary(a.id, ISBN_A);
    check('markRead adds an event with household_id', !!e1 && e1.household_id === h.id && sum1?.count === 1);
    const e2 = await s.markRead(a.id, ISBN_A, '2026-02-01T00:00:00Z');
    const sum2 = await s.getReadSummary(a.id, ISBN_A);
    check(
      're-read increments count; first and last read tracked',
      !!e2 &&
        e2.id !== e1?.id &&
        sum2?.count === 2 &&
        sum2.first_read_at === T('2026-01-01T00:00:00Z') &&
        sum2.last_read_at === T('2026-02-01T00:00:00Z'),
      sum2,
    );
    const eventsA = await s.listReadEvents(a.id, ISBN_A);
    check('listReadEvents: newest first', eventsA.length === 2 && eventsA[0].id === e2?.id);

    // Double-tap guard (taps without readAt use the clock).
    const tap1 = await s.markRead(a.id, ISBN_B);
    clock += 3_000;
    const tap2 = await s.markRead(a.id, ISBN_B);
    check(
      'a second tap within 10 seconds is ignored',
      !!tap1 && tap2 === null && (await s.getReadSummary(a.id, ISBN_B))?.count === 1,
    );
    clock += READ_TAP_GUARD_MS;
    const tap3 = await s.markRead(a.id, ISBN_B);
    check('a tap after the guard window counts again', !!tap3 && (await s.getReadSummary(a.id, ISBN_B))?.count === 2);
    const explicit = await s.markRead(a.id, ISBN_B, new Date(clock).toISOString());
    check('a read with an explicit read_at is never blocked by the guard', !!explicit);
    await s.undoLatestRead(a.id, ISBN_B); // drop that extra one again

    // Undo removes only the latest; undoing the last makes the book unread.
    const undone = await s.undoLatestRead(a.id, ISBN_B);
    const afterUndo = await s.getReadSummary(a.id, ISBN_B);
    check('undo removes only the latest event', undone?.id === tap3?.id && afterUndo?.count === 1, {
      undone: undone?.id === tap3?.id,
      count: afterUndo?.count,
    });
    const undoneLast = await s.undoLatestRead(a.id, ISBN_B);
    check(
      'undoing the last event makes the book unread',
      undoneLast?.id === tap1?.id &&
        (await s.getReadSummary(a.id, ISBN_B)) === null &&
        (await s.listReadEvents(a.id, ISBN_B)).length === 0,
    );
    check('undo with nothing to undo -> null', (await s.undoLatestRead(a.id, ISBN_B)) === null);
    const restored = await s.restoreReadEvent(undoneLast as ReadEvent);
    check(
      'restoreReadEvent keeps the id and read_at',
      restored.id === tap1?.id && restored.read_at === tap1?.read_at && (await s.getReadSummary(a.id, ISBN_B))?.count === 1,
    );

    // The summary is rebuilt from whatever events remain.
    await s.markRead(a.id, ISBN_D, '2026-03-10T00:00:00Z');
    await s.markRead(a.id, ISBN_D, '2026-01-10T00:00:00Z'); // an earlier read, recorded later
    await s.markRead(a.id, ISBN_D, '2026-04-10T00:00:00Z');
    const dBefore = await s.getReadSummary(a.id, ISBN_D);
    await s.undoLatestRead(a.id, ISBN_D); // removes 04-10, the latest read_at
    const dAfter = await s.getReadSummary(a.id, ISBN_D);
    check(
      'summary is recomputed from the remaining events after undo',
      dBefore?.first_read_at === T('2026-01-10T00:00:00Z') &&
        dAfter?.count === 2 &&
        dAfter.first_read_at === T('2026-01-10T00:00:00Z') &&
        dAfter.last_read_at === T('2026-03-10T00:00:00Z'),
      dAfter,
    );
    await s.undoLatestRead(a.id, ISBN_D);
    await s.undoLatestRead(a.id, ISBN_D);
    check('undoing every event of a book clears its summary', (await s.getReadSummary(a.id, ISBN_D)) === null);

    // countReadsSince counts books by FIRST read.
    await s.markRead(a.id, ISBN_A, '2026-04-01T00:00:00Z'); // a re-read of A after `since`
    const since = '2026-03-01T00:00:00Z';
    check(
      'countReadsSince ignores a re-read whose first read is before since',
      (await s.countReadsSince(a.id, since)) === 1, // only B (first read in May)
      await s.countReadsSince(a.id, since),
    );
    check(
      'countReadsSince from the start counts each book once',
      (await s.countReadsSince(a.id, '2000-01-01T00:00:00Z')) === 2,
    );

    // Household count: distinct (reader, book) pairs.
    await s.markRead(b.id, ISBN_A, '2026-03-05T00:00:00Z');
    await s.markRead(b.id, ISBN_A, '2026-03-06T00:00:00Z');
    await s.markRead(c.id, ISBN_A, '2026-03-07T00:00:00Z');
    check(
      'household count counts distinct reader+book pairs',
      (await s.countHouseholdReads(h.id)) === 3,
      await s.countHouseholdReads(h.id),
    );
    check('household count for another household', (await s.countHouseholdReads(other.id)) === 1);
    check(
      'listReadSummaries: one per book, most recent first',
      (await s.listReadSummaries(a.id)).map((x) => x.isbn).join() === [ISBN_B, ISBN_A].join(),
    );
    check('markRead unknown reader -> not_found', (await rejectsWith(s.markRead('missing', ISBN_A))) === 'not_found');

    // --- Journeys (active_journey_id) -------------------------------------------
    const j = await s.startJourney(a.id, 'ocean_deep');
    check(
      'startJourney sets readers.active_journey_id',
      (await s.getReader(a.id))?.active_journey_id === j.id && (await s.getActiveJourney(a.id))?.id === j.id,
    );
    check('second active journey -> conflict', (await rejectsWith(s.startJourney(a.id, 'skyscraper'))) === 'conflict');
    await s.completeJourney(j.id);
    check(
      'completeJourney clears the pointer',
      (await s.getActiveJourney(a.id)) === null && (await s.getReader(a.id))?.active_journey_id === null,
    );
    const j2 = await s.startJourney(a.id, 'skyscraper');
    await s.deleteReaderJourney(j2.id);
    check('deleteReaderJourney clears the pointer', (await s.getReader(a.id))?.active_journey_id === null);
    const j3 = await s.startJourney(a.id, 'hot_air_balloon');
    const raw = await openDB(dbName);
    await raw.delete('reader_journeys', j3.id); // leave the reader pointing at nothing
    raw.close();
    check('getActiveJourney with a pointer to a missing journey -> null', (await s.getActiveJourney(a.id)) === null);
    check('a dangling pointer does not block a new journey', !!(await s.startJourney(a.id, 'rocket_through_space')));

    // --- Home items -----------------------------------------------------------
    const hi1 = await s.addHomeItem(h.id, ISBN_A);
    const hi2 = await s.addHomeItem(h.id, ISBN_A);
    check(
      'home item id is the book key; one per household + book',
      hi1.id === ISBN_A && hi1.id === hi2.id && (await s.listHomeItems(h.id)).length === 1,
    );

    // --- Libraries and loans --------------------------------------------------
    const lib = await s.createLibrary({ household_id: h.id, name: 'Branch', search_url_template: 'https://example.org/?q={isbn}' });
    check('createLibrary defaults', lib.default_loan_days === 21 && lib.sticker_prefix === null);
    const lib2 = await s.updateLibrary(lib.id, { default_loan_days: 14, sticker_prefix: '3100' });
    check('updateLibrary', lib2.default_loan_days === 14 && lib2.sticker_prefix === '3100');
    check('updateLibrary rejects bad loan days', (await rejectsWith(s.updateLibrary(lib.id, { default_loan_days: 0 }))) === 'invalid');
    const loan = await s.createLoan({
      household_id: h.id,
      reader_id: b.id,
      isbn: ISBN_C,
      library_id: lib.id,
      due_date: '2026-12-01',
      sticker_barcode: '31000123',
    });
    check('new loan defaults', loan.renew_count === 0 && loan.returned_at === null && loan.library_id === lib.id);
    check(
      'createLoan rejects a bad due_date',
      (await rejectsWith(s.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_C, due_date: '1/12/2026' }))) === 'invalid',
    );
    await s.deleteLibrary(lib.id);
    const orphaned = await s.getLoan(loan.id);
    check(
      'deleteLibrary keeps the loan, clears library_id, keeps the name',
      orphaned?.library_id === null && orphaned?.library_name === 'Branch',
    );

    // --- Cover photos (content-addressed) -------------------------------------
    const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });
    const imageHash = await sha256Hex(image);
    const coverUrl = await s.saveCoverImage(image);
    check('saveCoverImage returns a blob: URL', coverUrl.startsWith('blob:'));
    await s.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: coverUrl, source: 'manual' });
    const storedA = await rawGet<{ cover_url: string }>(dbName, 'books', ISBN_A);
    check('a new photo is stored as cover:<sha256>', storedA?.cover_url === `cover:${imageHash}`, storedA?.cover_url);
    const again = await s.saveCoverImage(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' }));
    await s.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: again, source: 'manual' });
    check('the same image is stored once', (await rawAll(dbName, 'cover_images')).length === 1);
    const readBack = await s.getBook(ISBN_A);
    const fetched = readBack?.cover_url ? await (await fetch(readBack.cover_url)).blob() : null;
    check('getBook resolves the photo to a working URL', await sameBytes(fetched, image));
    const fromOtherTab = await s2.getBook(ISBN_A);
    check(
      'another tab resolves its own URL',
      !!fromOtherTab?.cover_url?.startsWith('blob:') && fromOtherTab.cover_url !== readBack?.cover_url,
    );
    check(
      'a stale blob: URL is rejected',
      (await rejectsWith(s.putBook({ isbn: ISBN_C, title: 'C', authors: [], cover_url: 'blob:https://x/y', source: 'manual' }))) === 'invalid',
    );
    check(
      'a photo over the size limit is rejected',
      (await rejectsWith(s.saveCoverImage(new Blob([new Uint8Array(MAX_COVER_BYTES + 1)], { type: 'image/jpeg' })))) === 'invalid',
    );
    await s.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: 'https://example.org/a.jpg', source: 'manual' });
    check('a photo another book still uses is kept', (await rawAll(dbName, 'cover_images')).length === 1);
    await s.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: null, source: 'manual' });
    check('a photo no book uses any more is removed', (await rawAll(dbName, 'cover_images')).length === 0);

    // --- PIN --------------------------------------------------------------------
    const pinHash = await hashPin('2468');
    check('hashPin format', /^pbkdf2-sha256\$\d+\$[\w-]+\$[\w-]+$/.test(pinHash));
    check('verifyPin accepts the right PIN', await verifyPin('2468', pinHash));
    check('verifyPin rejects a wrong PIN', !(await verifyPin('2469', pinHash)));
    check('verifyPin rejects garbage', !(await verifyPin('2468', 'not-a-hash')));
    check('hashPin is salted', pinHash !== (await hashPin('2468')));

    // --- deleteReader: one delete per child row ----------------------------------
    unsubLocal();
    await s.deleteReader(b.id);
    check(
      'deleteReader removes the reader, events, summaries and loans',
      (await s.getReader(b.id)) === null &&
        (await s.listReadEvents(b.id)).length === 0 &&
        (await s.listReadSummaries(b.id)).length === 0 &&
        (await s.getLoan(loan.id)) === null &&
        (await s.countHouseholdReads(h.id)) === 2,
    );

    // --- v1 -> v3 migration -------------------------------------------------------
    await createV1Database(v1Name);
    const m1 = await createLocalStore(v1Name);
    opened.push(m1);
    check(
      'v1 migration: the household becomes "main"',
      (await m1.getHousehold(HOUSEHOLD_ID))?.name === 'Test' && (await m1.getHousehold('h1')) === null,
    );
    check(
      'v1 migration: reads become events',
      (await m1.countHouseholdReads(HOUSEHOLD_ID)) === 1 && (await m1.listReadEvents('r1')).length === 1,
    );
    check('v1 migration: orphan reads dropped', (await m1.listReadEvents('ghost')).length === 0);
    const m1Loan = await m1.getLoan('l1');
    check(
      'v1 migration: loans get renew_count, library_id, sticker_barcode',
      m1Loan?.renew_count === 0 && m1Loan.library_id === null && m1Loan.sticker_barcode === null,
    );
    check('v1 migration: lowercase titles fixed', (await m1.getBook(ISBN_A))?.title === "Charlotte's Web");

    // --- v2 -> v3 migration, with the cover step interrupted ---------------------
    const fixture = await createV2Database(v2Name);
    const m2 = await createLocalStore(v2Name, { coverStepLimit: 1 });
    const firstStep = await m2.coverStep;
    check('cover step interrupted after one photo', firstStep.moved === 1 && firstStep.remaining === 1, firstStep);

    const events = await rawAll<ReadEvent>(v2Name, 'read_events');
    const eventKey = (e: { reader_id: string; isbn: string; read_at: string }) => `${e.reader_id}|${e.isbn}|${e.read_at}`;
    check(
      'v2 migration: one event per old read, original read_at kept',
      events.length === fixture.reads.length &&
        fixture.reads.every((r) => events.some((e) => eventKey(e) === eventKey(r))) &&
        new Set(events.map((e) => e.id)).size === events.length,
      events.length,
    );
    check('v2 migration: reads store deleted', !(await rawStoreExists(v2Name, 'reads')));
    const summaries = await rawAll<{ count: number; first_read_at: string; last_read_at: string }>(v2Name, 'read_summaries');
    check(
      'v2 migration: summaries match the reads',
      summaries.length === fixture.reads.length && summaries.every((x) => x.count === 1 && x.first_read_at === x.last_read_at),
    );
    const readersAfter = await rawAll<{ id: string; household_id: string; active_journey_id: string | null }>(v2Name, 'readers');
    const homeAfter = await rawAll<{ id: string; isbn: string; household_id: string }>(v2Name, 'home_items');
    const librariesAfter = await rawAll<{ household_id: string }>(v2Name, 'libraries');
    const loansAfter = await rawAll<{ household_id: string }>(v2Name, 'loans');
    const mainEverywhere =
      (await rawGet(v2Name, 'households', HOUSEHOLD_ID)) !== undefined &&
      (await rawGet(v2Name, 'households', fixture.oldHouseholdId)) === undefined &&
      (await rawGet<{ value: string }>(v2Name, 'meta', 'current_household_id'))?.value === HOUSEHOLD_ID &&
      readersAfter.filter((r) => r.id !== 'r3').every((r) => r.household_id === HOUSEHOLD_ID) &&
      homeAfter.every((x) => x.household_id === HOUSEHOLD_ID) &&
      librariesAfter.every((x) => x.household_id === HOUSEHOLD_ID) &&
      loansAfter.every((x) => x.household_id === HOUSEHOLD_ID) &&
      events.filter((e) => e.reader_id !== 'r3').every((e) => e.household_id === HOUSEHOLD_ID);
    check('v2 migration: "main" everywhere', mainEverywhere);
    check('v2 migration: other households untouched', readersAfter.find((r) => r.id === 'r3')?.household_id === 'hy');
    check('v2 migration: home ids are book keys', homeAfter.length === 3 && homeAfter.every((x) => x.id === x.isbn));
    check(
      'v2 migration: active_journey_id present',
      readersAfter.every((r) => 'active_journey_id' in r) &&
        readersAfter.find((r) => r.id === 'r1')?.active_journey_id === 'j1' &&
        readersAfter.find((r) => r.id === 'r2')?.active_journey_id === null,
    );
    check(
      'v2 migration: counts unchanged',
      (await m2.countHouseholdReads(HOUSEHOLD_ID)) === 3 && (await m2.countReadsSince('r1', '2026-02-01T00:00:00Z')) === 1,
    );

    const midBooks = await Promise.all([m2.getBook(ISBN_A), m2.getBook(ISBN_B)]);
    const midBlobs = await Promise.all(
      midBooks.map(async (book) => (book?.cover_url ? (await fetch(book.cover_url)).blob() : null)),
    );
    const midStored = await Promise.all([
      rawGet<{ cover_url: string }>(v2Name, 'books', ISBN_A),
      rawGet<{ cover_url: string }>(v2Name, 'books', ISBN_B),
    ]);
    check(
      'mid-step: both prefixes resolve to the right photo',
      midStored.some((x) => x?.cover_url.startsWith('cover:')) &&
        midStored.some((x) => x?.cover_url.startsWith('local-cover:')) &&
        (await sameBytes(midBlobs[0], fixture.coverA)) &&
        (await sameBytes(midBlobs[1], fixture.coverB)),
      midStored.map((x) => x?.cover_url.split(':')[0]),
    );
    await m2.close();

    const m3 = await createLocalStore(v2Name);
    opened.push(m3);
    const secondStep = await m3.coverStep;
    const [hashA, hashB] = await Promise.all([sha256Hex(fixture.coverA), sha256Hex(fixture.coverB)]);
    const finalStored = await Promise.all([
      rawGet<{ cover_url: string }>(v2Name, 'books', ISBN_A),
      rawGet<{ cover_url: string }>(v2Name, 'books', ISBN_B),
    ]);
    const images = await rawAll<{ hash: string; blob: Blob }>(v2Name, 'cover_images');
    check(
      're-run finishes the cover step',
      secondStep.moved === 1 && secondStep.remaining === 0 && (await rawAll(v2Name, 'covers')).length === 0,
      secondStep,
    );
    check(
      'covers re-keyed by SHA-256 with the blob unchanged',
      finalStored[0]?.cover_url === `cover:${hashA}` &&
        finalStored[1]?.cover_url === `cover:${hashB}` &&
        (await sameBytes(images.find((x) => x.hash === hashA)?.blob, fixture.coverA)) &&
        (await sameBytes(images.find((x) => x.hash === hashB)?.blob, fixture.coverB)),
    );
    const resolvedA = await m3.getBook(ISBN_A);
    check(
      'covers still show after the step',
      await sameBytes(resolvedA?.cover_url ? await (await fetch(resolvedA.cover_url)).blob() : null, fixture.coverA),
    );
    await m3.close();
    const m4 = await createLocalStore(v2Name);
    opened.push(m4);
    check('the cover step is a no-op once finished', (await m4.coverStep).moved === 0);
  } catch (error) {
    check('self-test crashed', false, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  } finally {
    for (const st of opened) await st.close().catch(() => undefined);
    indexedDB.deleteDatabase(dbName);
    indexedDB.deleteDatabase(v1Name);
    indexedDB.deleteDatabase(v2Name);
  }
  return results;
}

/** Builds a database exactly as the Phase 1 (v1) adapter left it. */
function createV1Database(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('households', { keyPath: 'id' }).add({ id: 'h1', name: 'Test', parent_pin_hash: null });
      const readers = db.createObjectStore('readers', { keyPath: 'id' });
      readers.createIndex('by_household', 'household_id');
      readers.createIndex('by_card_token', 'card_token', { unique: true });
      readers.add({ id: 'r1', household_id: 'h1', display_name: 'A', avatar: '🦊', card_token: 'tok1' });
      db.createObjectStore('books', { keyPath: 'isbn' }).add({
        isbn: ISBN_A,
        title: "charlotte's web",
        authors: [],
        cover_url: null,
        source: 'openlibrary',
      });
      const home = db.createObjectStore('home_items', { keyPath: 'id' });
      home.createIndex('by_household_isbn', ['household_id', 'isbn'], { unique: true });
      home.createIndex('by_household_added', ['household_id', 'added_at']);
      const loans = db.createObjectStore('loans', { keyPath: 'id' });
      loans.createIndex('by_household_borrowed', ['household_id', 'borrowed_at']);
      loans.createIndex('by_reader', 'reader_id');
      loans.add({
        id: 'l1',
        household_id: 'h1',
        reader_id: 'r1',
        isbn: ISBN_B,
        library_name: null,
        borrowed_at: '2026-01-01T00:00:00.000Z',
        due_date: null,
        returned_at: null,
      });
      const reads = db.createObjectStore('reads', { keyPath: ['reader_id', 'isbn'] });
      reads.createIndex('by_reader_read_at', ['reader_id', 'read_at']);
      reads.add({ reader_id: 'r1', isbn: ISBN_A, read_at: '2026-01-01T00:00:00.000Z' });
      reads.add({ reader_id: 'ghost', isbn: ISBN_A, read_at: '2026-01-01T00:00:00.000Z' });
      db.createObjectStore('reader_journeys', { keyPath: 'id' }).createIndex('by_reader_started', ['reader_id', 'started_at']);
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

interface V2Fixture {
  oldHouseholdId: string;
  reads: { reader_id: string; isbn: string; read_at: string }[];
  coverA: Blob;
  coverB: Blob;
}

/** Builds a database exactly as the Phase 2 (v2) adapter left it, with photos and reads. */
function createV2Database(name: string): Promise<V2Fixture> {
  const oldHouseholdId = 'hx-0000-old-household';
  const coverA = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 10, 20, 30])], { type: 'image/jpeg' });
  const coverB = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 40, 50, 60, 70])], { type: 'image/jpeg' });
  const reads = [
    { reader_id: 'r1', household_id: oldHouseholdId, isbn: ISBN_A, read_at: '2026-01-05T00:00:00.000Z' },
    { reader_id: 'r1', household_id: oldHouseholdId, isbn: ISBN_B, read_at: '2026-02-05T00:00:00.000Z' },
    { reader_id: 'r2', household_id: oldHouseholdId, isbn: ISBN_A, read_at: '2026-03-05T00:00:00.000Z' },
    { reader_id: 'r3', household_id: 'hy', isbn: ISBN_A, read_at: '2026-03-06T00:00:00.000Z' },
  ];
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const households = db.createObjectStore('households', { keyPath: 'id' });
      households.add({ id: oldHouseholdId, name: 'Test', parent_pin_hash: null });
      households.add({ id: 'hy', name: 'Other', parent_pin_hash: null });
      db.createObjectStore('meta', { keyPath: 'key' }).add({ key: 'current_household_id', value: oldHouseholdId });

      const readers = db.createObjectStore('readers', { keyPath: 'id' });
      readers.createIndex('by_household', 'household_id');
      readers.createIndex('by_card_token', 'card_token', { unique: true });
      readers.add({ id: 'r1', household_id: oldHouseholdId, display_name: 'A', avatar: '🦊', card_token: 'tok-r1-aaaaaaaaaaaaaa' });
      readers.add({ id: 'r2', household_id: oldHouseholdId, display_name: 'B', avatar: '🐢', card_token: 'tok-r2-aaaaaaaaaaaaaa' });
      readers.add({ id: 'r3', household_id: 'hy', display_name: 'C', avatar: '🐙', card_token: 'tok-r3-aaaaaaaaaaaaaa' });

      const books = db.createObjectStore('books', { keyPath: 'isbn' });
      books.add({ isbn: ISBN_A, title: 'A', authors: [], cover_url: `local-cover:${ISBN_A}`, source: 'openlibrary' });
      books.add({ isbn: ISBN_B, title: 'B', authors: [], cover_url: `local-cover:${ISBN_B}`, source: 'manual' });
      books.add({ isbn: ISBN_C, title: 'C', authors: [], cover_url: null, source: 'google' });
      const covers = db.createObjectStore('covers', { keyPath: 'isbn' });
      covers.add({ isbn: ISBN_A, blob: coverA, saved_at: '2026-01-01T00:00:00.000Z' });
      covers.add({ isbn: ISBN_B, blob: coverB, saved_at: '2026-01-02T00:00:00.000Z' });

      const home = db.createObjectStore('home_items', { keyPath: 'id' });
      home.createIndex('by_household_isbn', ['household_id', 'isbn'], { unique: true });
      home.createIndex('by_household_added', ['household_id', 'added_at']);
      [ISBN_A, ISBN_B, ISBN_C].forEach((isbn, i) =>
        home.add({ id: `home-uuid-${i}`, household_id: oldHouseholdId, isbn, added_at: `2026-01-0${i + 1}T00:00:00.000Z` }),
      );

      const libraries = db.createObjectStore('libraries', { keyPath: 'id' });
      libraries.createIndex('by_household', 'household_id');
      libraries.add({
        id: 'lib1',
        household_id: oldHouseholdId,
        name: 'Branch',
        search_url_template: null,
        homepage_url: null,
        default_loan_days: 21,
        sticker_prefix: null,
      });

      const loans = db.createObjectStore('loans', { keyPath: 'id' });
      loans.createIndex('by_household_borrowed', ['household_id', 'borrowed_at']);
      loans.createIndex('by_reader', 'reader_id');
      loans.createIndex('by_library', 'library_id');
      loans.createIndex('by_household_sticker', ['household_id', 'sticker_barcode']);
      loans.add({
        id: 'loan1',
        household_id: oldHouseholdId,
        reader_id: 'r1',
        isbn: ISBN_C,
        library_id: 'lib1',
        library_name: null,
        sticker_barcode: '31000123',
        borrowed_at: '2026-01-01T00:00:00.000Z',
        due_date: '2026-01-22',
        returned_at: null,
        renew_count: 0,
      });

      const readsStore = db.createObjectStore('reads', { keyPath: ['reader_id', 'isbn'] });
      readsStore.createIndex('by_reader_read_at', ['reader_id', 'read_at']);
      readsStore.createIndex('by_household', 'household_id');
      for (const read of reads) readsStore.add(read);

      const journeys = db.createObjectStore('reader_journeys', { keyPath: 'id' });
      journeys.createIndex('by_reader_started', ['reader_id', 'started_at']);
      journeys.add({ id: 'j1', reader_id: 'r1', journey_id: 'ocean_deep', started_at: '2026-01-01T00:00:00.000Z', completed_at: null });
      journeys.add({
        id: 'j2',
        reader_id: 'r2',
        journey_id: 'skyscraper',
        started_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-02-01T00:00:00.000Z',
      });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve({ oldHouseholdId, reads, coverA, coverB });
    };
    request.onerror = () => reject(request.error);
  });
}
