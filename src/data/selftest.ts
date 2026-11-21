/**
 * Storage self-test for the local adapter. Runs against throwaway IndexedDB
 * databases (never the app's real one) and deletes them afterwards.
 * Started from the developer page; also handy from the console:
 *
 *   (await import('/src/data/selftest.ts')).runLocalSelfTest()
 */
import { openDB } from 'idb';
import { startOfLocalDay } from '../lib/dates';
import { createLocalStore, type LocalDataStore } from './adapters/local';
import { isDataStoreError, type DataChange } from './DataStore';
import { hashPin, verifyPin } from './pin';

export interface SelfTestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const ISBN_A = '9780000000002';
const ISBN_B = '9780000000019';
const ISBN_C = '9780000000026';

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
  const migrateName = `lc-selftest-migrate-${stamp}`;
  const opened: LocalDataStore[] = [];

  try {
    const s = await createLocalStore(dbName);
    const s2 = await createLocalStore(dbName); // a "second tab"
    opened.push(s, s2);

    // --- Current household -----------------------------------------------
    const [c1, c2] = await Promise.all([s.getCurrentHousehold(), s.getCurrentHousehold()]);
    check('getCurrentHousehold creates exactly one household', c1.id === c2.id && (await s.listHouseholds()).length === 1);
    check('getCurrentHousehold is stable', (await s.getCurrentHousehold()).id === c1.id);
    const h = c1;
    const other = await s.createHousehold({ name: 'Other' });

    // --- subscribe ---------------------------------------------------------
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

    // --- Readers and card tokens --------------------------------------------
    const a = await s.createReader({ household_id: h.id, display_name: 'A', avatar: '🦊' });
    const b = await s.createReader({ household_id: h.id, display_name: 'B', avatar: '🐢' });
    const c = await s.createReader({ household_id: other.id, display_name: 'C', avatar: '🐙' });
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

    // --- Reads ----------------------------------------------------------------
    await s.markRead(a.id, ISBN_A, '2026-01-01T00:00:00Z');
    await s.markRead(a.id, ISBN_B, '2026-06-01T00:00:00Z');
    const again = await s.markRead(a.id, ISBN_B);
    check('markRead is idempotent and keeps read_at', again.read_at === '2026-06-01T00:00:00.000Z');
    check('markRead stores household_id', again.household_id === h.id);
    await s.markRead(b.id, ISBN_A, '2026-03-01T00:00:00Z');
    await s.markRead(c.id, ISBN_A);
    await s.markRead(b.id, ISBN_C); // now
    check('countReadsSince (instant)', (await s.countReadsSince(a.id, '2026-03-01T00:00:00Z')) === 1);
    check('countReadsSince start of local today', (await s.countReadsSince(b.id, startOfLocalDay())) === 1);
    check('countHouseholdReads (indexed)', (await s.countHouseholdReads(h.id)) === 4, await s.countHouseholdReads(h.id));
    check('countHouseholdReads other household', (await s.countHouseholdReads(other.id)) === 1);
    await s.unmarkRead(b.id, ISBN_C);
    check('unmarkRead removes the read', (await s.getRead(b.id, ISBN_C)) === null && (await s.countHouseholdReads(h.id)) === 3);
    check('markRead unknown reader -> not_found', (await rejectsWith(s.markRead('missing', ISBN_A))) === 'not_found');

    // --- Journeys (Phase 1) -------------------------------------------------
    const j = await s.startJourney(a.id, 'ocean_deep');
    check('second active journey -> conflict', (await rejectsWith(s.startJourney(a.id, 'skyscraper'))) === 'conflict');
    await s.completeJourney(j.id);
    check('completed journey is no longer active', (await s.getActiveJourney(a.id)) === null);

    // --- Home items -----------------------------------------------------------
    const hi1 = await s.addHomeItem(h.id, ISBN_A);
    const hi2 = await s.addHomeItem(h.id, ISBN_A);
    check('home_items: one row per household + ISBN', hi1.id === hi2.id && (await s.listHomeItems(h.id)).length === 1);

    // --- Libraries and loans ------------------------------------------------
    const lib = await s.createLibrary({ household_id: h.id, name: 'Branch', search_url_template: 'https://example.org/?q={isbn}' });
    check('createLibrary defaults', lib.default_loan_days === 21 && lib.sticker_prefix === null);
    const lib2 = await s.updateLibrary(lib.id, { default_loan_days: 14, sticker_prefix: '3100' });
    check('updateLibrary', lib2.default_loan_days === 14 && lib2.sticker_prefix === '3100');
    check('updateLibrary rejects bad loan days', (await rejectsWith(s.updateLibrary(lib.id, { default_loan_days: 0 }))) === 'invalid');
    check('listLibraries', (await s.listLibraries(h.id)).length === 1 && (await s.listLibraries(other.id)).length === 0);
    const loan = await s.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_C, library_id: lib.id, due_date: '2026-12-01', sticker_barcode: '31000123' });
    check('new loan defaults', loan.renew_count === 0 && loan.returned_at === null && loan.library_id === lib.id);
    check('createLoan rejects a bad due_date', (await rejectsWith(s.createLoan({ household_id: h.id, reader_id: b.id, isbn: ISBN_C, due_date: '1/12/2026' }))) === 'invalid');
    const renewed = await s.updateLoan(loan.id, { renew_count: 1, due_date: '2026-12-22' });
    check('updateLoan renew', renewed.renew_count === 1 && renewed.due_date === '2026-12-22');
    await s.deleteLibrary(lib.id);
    const orphaned = await s.getLoan(loan.id);
    check('deleteLibrary keeps the loan, clears library_id, keeps the name', orphaned?.library_id === null && orphaned?.library_name === 'Branch');
    await s.returnLoan(loan.id);
    check('returnLoan', (await s.listLoans(h.id, { active: true })).length === 0);

    // --- Cover photos -----------------------------------------------------------
    const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });
    const coverUrl = await s.saveCoverImage(ISBN_A, image);
    check('saveCoverImage returns a blob: URL', coverUrl.startsWith('blob:'), coverUrl.slice(0, 10));
    await s.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: coverUrl, source: 'manual' });
    const raw = await openDB(dbName);
    const storedBook = (await raw.get('books', ISBN_A)) as { cover_url: string };
    raw.close();
    check('no blob: URL is persisted', !storedBook.cover_url.startsWith('blob:'), storedBook.cover_url);
    const readBack = await s.getBook(ISBN_A);
    const fetched = readBack?.cover_url ? await (await fetch(readBack.cover_url)).blob() : null;
    check('getBook resolves the photo to a working URL', fetched?.size === image.size);
    const fromOtherTab = await s2.getBook(ISBN_A);
    check('another tab resolves its own URL', !!fromOtherTab?.cover_url?.startsWith('blob:') && fromOtherTab.cover_url !== readBack?.cover_url);
    check('a stale blob: URL is rejected', (await rejectsWith(s.putBook({ isbn: ISBN_B, title: 'B', authors: [], cover_url: 'blob:https://x/y', source: 'manual' }))) === 'invalid');
    await s.putBook({ isbn: ISBN_A, title: 'A', authors: [], cover_url: 'https://example.org/a.jpg', source: 'manual' });
    const raw2 = await openDB(dbName);
    const photoGone = (await raw2.getKey('covers', ISBN_A)) === undefined;
    raw2.close();
    check('replacing a photo cover removes the stored photo', photoGone);

    // --- PIN --------------------------------------------------------------------
    const pinHash = await hashPin('2468');
    check('hashPin format', /^pbkdf2-sha256\$\d+\$[\w-]+\$[\w-]+$/.test(pinHash), pinHash.split('$').slice(0, 2));
    check('verifyPin accepts the right PIN', await verifyPin('2468', pinHash));
    check('verifyPin rejects a wrong PIN', !(await verifyPin('2469', pinHash)));
    check('verifyPin rejects garbage', !(await verifyPin('2468', 'not-a-hash')));
    check('hashPin is salted', pinHash !== (await hashPin('2468')));

    // --- Cascade delete -----------------------------------------------------------
    unsubLocal();
    await s.deleteHousehold(h.id);
    check(
      'deleteHousehold cascades',
      (await s.listReaders(h.id)).length === 0 &&
        (await s.listReads(a.id)).length === 0 &&
        (await s.listLoans(h.id)).length === 0 &&
        (await s.countHouseholdReads(h.id)) === 0 &&
        (await s.countHouseholdReads(other.id)) === 1,
    );
    check('a new current household is chosen after delete', (await s.getCurrentHousehold()).id === other.id);

    // --- v1 -> v2 migration ---------------------------------------------------
    await createV1Database(migrateName);
    const m = await createLocalStore(migrateName);
    opened.push(m);
    check('migration: reads get household_id', (await m.countHouseholdReads('h1')) === 1);
    check('migration: orphan reads dropped', (await m.listReads('ghost')).length === 0);
    const mLoan = await m.getLoan('l1');
    check('migration: loans get renew_count, library_id, sticker_barcode', mLoan?.renew_count === 0 && mLoan.library_id === null && mLoan.sticker_barcode === null);
    check('migration: lowercase titles fixed', (await m.getBook(ISBN_A))?.title === "Charlotte's Web", (await m.getBook(ISBN_A))?.title);
    check('migration: existing household becomes current', (await m.getCurrentHousehold()).id === 'h1');
  } catch (error) {
    check('self-test crashed', false, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  } finally {
    for (const st of opened) await st.close();
    indexedDB.deleteDatabase(dbName);
    indexedDB.deleteDatabase(migrateName);
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
      db.createObjectStore('books', { keyPath: 'isbn' }).add({ isbn: ISBN_A, title: "charlotte's web", authors: [], cover_url: null, source: 'openlibrary' });
      const home = db.createObjectStore('home_items', { keyPath: 'id' });
      home.createIndex('by_household_isbn', ['household_id', 'isbn'], { unique: true });
      home.createIndex('by_household_added', ['household_id', 'added_at']);
      const loans = db.createObjectStore('loans', { keyPath: 'id' });
      loans.createIndex('by_household_borrowed', ['household_id', 'borrowed_at']);
      loans.createIndex('by_reader', 'reader_id');
      loans.add({ id: 'l1', household_id: 'h1', reader_id: 'r1', isbn: ISBN_B, library_name: null, borrowed_at: '2026-01-01T00:00:00.000Z', due_date: null, returned_at: null });
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
