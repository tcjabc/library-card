import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import { addDays, isCalendarDate, toCalendarDate } from '../../lib/dates';
import { fixLowercaseTitle } from '../../lib/text';
import { strings } from '../../strings';
import {
  DEFAULT_LOAN_DAYS,
  DataStoreError,
  HOUSEHOLD_ID,
  MAX_COVER_BYTES,
  type Book,
  type BookKey,
  type DataChangeListener,
  type DataStore,
  type DataTable,
  type HomeItem,
  type Household,
  type Id,
  type Library,
  type Loan,
  type ReadEvent,
  type ReadSummary,
  type Reader,
  type ReaderJourney,
} from '../DataStore';
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  base64ToBytes,
  bytesToBase64,
  sniffImageType,
  summariseBackup,
  validateBackup,
  type Backup,
  type BackupTables,
} from '../backup';
import { newCardToken, newId, toIso } from '../ids';
import { addToSummary, isRepeatTap, latestEvent, summarize } from '../readRules';

/**
 * Local-only adapter backed by IndexedDB. Data never leaves the device.
 *
 * Schema history:
 *   v1  Phase 1 tables.
 *   v2  reads.household_id (+ index), libraries, covers, meta;
 *       loans.library_id / sticker_barcode / renew_count.
 *   v3  One household per device, id "main". home_items keyed by book key.
 *       reads -> read_events (one per tap) + derived read_summaries.
 *       readers.active_journey_id. Cover photos keyed by SHA-256 in
 *       cover_images (moved from `covers` by a step after the upgrade).
 *   v4  Loan sticker lookups: [library_id, sticker_barcode] plus a
 *       household-wide sticker index replace [household_id, sticker_barcode].
 *       Indexes only; no data changes.
 *   v5  Sync: `records` (sync-core records keyed by wire id "<table>:<id>") and
 *       `outbox` (the latest pending op per [record, field]). Device id, clock,
 *       cursor, last-synced time and sync config are `meta` keys. New stores
 *       only; no data changes. Present for every adapter, used by "sync".
 */

const DB_NAME = 'library-card';
export const DB_VERSION = 5;

// Highest possible string suffix for compound-key range upper bounds.
const MAX_STRING = '￿';

/** books.cover_url for a photo in cover_images: "cover:<sha256 hex>". */
const COVER_PREFIX = 'cover:';
/** Pre-v3 books.cover_url for a photo in the legacy `covers` store, keyed by ISBN. */
const LEGACY_COVER_PREFIX = 'local-cover:';

const CURRENT_HOUSEHOLD_KEY = 'current_household_id';
const COVERS_REKEYED_KEY = 'covers_rekeyed';

interface CoverImageRecord {
  hash: string;
  blob: Blob;
  saved_at: string;
}

/** Legacy (v2) cover record. Only read by the re-key step. */
interface LegacyCoverRecord {
  isbn: BookKey;
  blob: Blob;
  saved_at: string;
}

/** Legacy (v1/v2) read row. Only exists inside the upgrade transaction. */
interface LegacyRead {
  reader_id: Id;
  household_id?: Id;
  isbn: BookKey;
  read_at: string;
}

interface MetaRecord {
  key: string;
  /** Plain JSON. */
  value: unknown;
}

/** A sync-core record ({ id, fields, ts }) as stored, with its table and parent for indexing. */
export interface StoredRecord {
  id: string;
  fields: Record<string, unknown>;
  ts: Record<string, string>;
  /** The table part of the wire id. */
  t: string;
  /** Wire id of the parent record (a reader's), when the table has one. */
  p?: string;
}

/** The latest op not yet sent for one field of one record. The op id is derived when it is sent. */
export interface OutboxEntry {
  rec: string;
  f: string;
  v: unknown;
  t: string;
  dev: string;
}

interface LibraryCardDB extends DBSchema {
  meta: { key: string; value: MetaRecord };
  households: { key: Id; value: Household };
  readers: {
    key: Id;
    value: Reader;
    indexes: { by_household: Id; by_card_token: string };
  };
  books: {
    key: BookKey;
    value: Book;
    indexes: { by_cover: string };
  };
  cover_images: { key: string; value: CoverImageRecord };
  /** Legacy, emptied by the cover re-key step. Deleted at the next schema version. */
  covers: { key: BookKey; value: LegacyCoverRecord };
  home_items: {
    key: BookKey;
    value: HomeItem;
    indexes: { by_household_isbn: [Id, BookKey]; by_household_added: [Id, string] };
  };
  libraries: { key: Id; value: Library; indexes: { by_household: Id } };
  loans: {
    key: Id;
    value: Loan;
    indexes: {
      by_household_borrowed: [Id, string];
      by_reader: Id;
      by_library: Id;
      /** A sticker within one library. Loans without a library or sticker aren't indexed. */
      by_library_sticker: [Id, string];
      /** Any loan with this sticker; callers filter by household and activity. */
      by_sticker: string;
    };
  };
  /** Legacy, deleted by the v3 upgrade. Typed so the v1/v2 steps can still run. */
  reads: {
    key: [Id, BookKey];
    value: LegacyRead;
    indexes: { by_reader_read_at: [Id, string]; by_household: Id };
  };
  read_events: {
    key: Id;
    value: ReadEvent;
    indexes: {
      by_reader_isbn_read_at: [Id, BookKey, string];
      by_reader_read_at: [Id, string];
      by_household: Id;
    };
  };
  read_summaries: {
    key: [Id, BookKey];
    value: ReadSummary;
    indexes: {
      by_reader_first: [Id, string];
      by_reader_last: [Id, string];
      by_household: Id;
    };
  };
  reader_journeys: {
    key: Id;
    value: ReaderJourney;
    indexes: { by_reader_started: [Id, string] };
  };
  records: {
    key: string;
    value: StoredRecord;
    indexes: { by_parent: string };
  };
  outbox: {
    key: [string, string];
    value: OutboxEntry;
    indexes: { by_t: string };
  };
}

export type DB = IDBPDatabase<LibraryCardDB>;
export type { LibraryCardDB };
type AnyTx<Mode extends IDBTransactionMode> = IDBPTransaction<
  LibraryCardDB,
  ArrayLike<StoreNames<LibraryCardDB>>,
  Mode
>;

function openLibraryDb(name: string): Promise<DB> {
  return openDB<LibraryCardDB>(name, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('households', { keyPath: 'id' });

        const readers = db.createObjectStore('readers', { keyPath: 'id' });
        readers.createIndex('by_household', 'household_id');
        readers.createIndex('by_card_token', 'card_token', { unique: true });

        db.createObjectStore('books', { keyPath: 'isbn' });

        const home = db.createObjectStore('home_items', { keyPath: 'id' });
        home.createIndex('by_household_isbn', ['household_id', 'isbn'], { unique: true });
        home.createIndex('by_household_added', ['household_id', 'added_at']);

        const loans = db.createObjectStore('loans', { keyPath: 'id' });
        loans.createIndex('by_household_borrowed', ['household_id', 'borrowed_at']);
        loans.createIndex('by_reader', 'reader_id');

        const reads = db.createObjectStore('reads', { keyPath: ['reader_id', 'isbn'] });
        reads.createIndex('by_reader_read_at', ['reader_id', 'read_at']);

        const journeys = db.createObjectStore('reader_journeys', { keyPath: 'id' });
        journeys.createIndex('by_reader_started', ['reader_id', 'started_at']);
      }

      if (oldVersion < 2) {
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('covers', { keyPath: 'isbn' });
        const libraries = db.createObjectStore('libraries', { keyPath: 'id' });
        libraries.createIndex('by_household', 'household_id');

        const loans = tx.objectStore('loans');
        loans.createIndex('by_library', 'library_id');
        // Replaced in v4; typed by string because the v4 schema no longer names it.
        loans.createIndex('by_household_sticker' as never, ['household_id', 'sticker_barcode']);
        tx.objectStore('reads').createIndex('by_household', 'household_id');

        if (oldVersion >= 1) await migrateV1Data(tx);
      }

      if (oldVersion < 3) {
        db.createObjectStore('cover_images', { keyPath: 'hash' });
        tx.objectStore('books').createIndex('by_cover', 'cover_url');

        const events = db.createObjectStore('read_events', { keyPath: 'id' });
        events.createIndex('by_reader_isbn_read_at', ['reader_id', 'isbn', 'read_at']);
        events.createIndex('by_reader_read_at', ['reader_id', 'read_at']);
        events.createIndex('by_household', 'household_id');

        const summaries = db.createObjectStore('read_summaries', { keyPath: ['reader_id', 'isbn'] });
        summaries.createIndex('by_reader_first', ['reader_id', 'first_read_at']);
        summaries.createIndex('by_reader_last', ['reader_id', 'last_read_at']);
        summaries.createIndex('by_household', 'household_id');

        if (oldVersion >= 1) await migrateV2Data(tx);
        db.deleteObjectStore('reads');
      }

      if (oldVersion < 4) {
        const loans = tx.objectStore('loans');
        // Typed v4 schema no longer names the old index, so ask by string.
        if (loans.indexNames.contains('by_household_sticker' as never)) loans.deleteIndex('by_household_sticker' as never);
        loans.createIndex('by_library_sticker', ['library_id', 'sticker_barcode']);
        loans.createIndex('by_sticker', 'sticker_barcode');
      }

      if (oldVersion < 5) {
        const records = db.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('by_parent', 'p');
        const outbox = db.createObjectStore('outbox', { keyPath: ['rec', 'f'] });
        outbox.createIndex('by_t', 't');
      }
    },
    blocking(_currentVersion, blockedVersion, event) {
      const conn = event.target as IDBDatabase;
      conn.close();
      // blockedVersion is null when the database is being deleted. Otherwise a
      // newer version of the app opened it in another tab: reload into that version.
      if (blockedVersion !== null) window.location.reload();
    },
    blocked() {
      console.warn('[data/local] Database upgrade waiting for another tab to close.');
    },
  });
}

/** v1 -> v2 data changes. Runs inside the upgrade transaction. */
async function migrateV1Data(tx: AnyTx<'versionchange'>): Promise<void> {
  // reads.household_id, taken from the reader. Reads whose reader is gone are dropped.
  const readers = tx.objectStore('readers');
  const householdOf = new Map<Id, Id | null>();
  let readCursor = await tx.objectStore('reads').openCursor();
  while (readCursor) {
    const read = readCursor.value;
    if (!read.household_id) {
      let householdId = householdOf.get(read.reader_id);
      if (householdId === undefined) {
        householdId = (await readers.get(read.reader_id))?.household_id ?? null;
        householdOf.set(read.reader_id, householdId);
      }
      if (householdId) await readCursor.update({ ...read, household_id: householdId });
      else await readCursor.delete();
    }
    readCursor = await readCursor.continue();
  }

  let loanCursor = await tx.objectStore('loans').openCursor();
  while (loanCursor) {
    const loan = loanCursor.value as Partial<Loan> & Loan;
    await loanCursor.update({
      ...loan,
      library_id: loan.library_id ?? null,
      sticker_barcode: loan.sticker_barcode ?? null,
      renew_count: loan.renew_count ?? 0,
    });
    loanCursor = await loanCursor.continue();
  }

  // Phase 1 cached Open Library titles as they came, sometimes all lowercase.
  let bookCursor = await tx.objectStore('books').openCursor();
  while (bookCursor) {
    const fixed = fixLowercaseTitle(bookCursor.value.title);
    if (fixed !== bookCursor.value.title) await bookCursor.update({ ...bookCursor.value, title: fixed });
    bookCursor = await bookCursor.continue();
  }
}

/**
 * v2 -> v3 data changes. Runs inside the upgrade transaction (IndexedDB work
 * only; cover hashing needs crypto.subtle and runs after the upgrade).
 */
async function migrateV2Data(tx: AnyTx<'versionchange'>): Promise<void> {
  const meta = tx.objectStore('meta');
  const households = tx.objectStore('households');

  // 1. The current household becomes "main"; references to it follow.
  const storedCurrent = (await meta.get(CURRENT_HOUSEHOLD_KEY))?.value;
  const currentId =
    typeof storedCurrent === 'string' && (await households.getKey(storedCurrent))
      ? storedCurrent
      : (await households.getAllKeys())[0];
  if (currentId && currentId !== HOUSEHOLD_ID) {
    const household = await households.get(currentId);
    if (household) {
      await households.put({ ...household, id: HOUSEHOLD_ID });
      await households.delete(currentId);
    }
  }
  if (currentId) await meta.put({ key: CURRENT_HOUSEHOLD_KEY, value: HOUSEHOLD_ID });
  const remap = (id: Id) => (currentId && id === currentId ? HOUSEHOLD_ID : id);

  // 5. readers.active_journey_id: the latest started, uncompleted journey.
  const active = new Map<Id, ReaderJourney>();
  for (const journey of await tx.objectStore('reader_journeys').getAll()) {
    if (journey.completed_at !== null) continue;
    const current = active.get(journey.reader_id);
    if (!current || journey.started_at > current.started_at) active.set(journey.reader_id, journey);
  }
  const readers = tx.objectStore('readers');
  for (const reader of await readers.getAll()) {
    const legacy = reader as Reader & { active_journey_id?: Id | null };
    await readers.put({
      ...legacy,
      household_id: remap(legacy.household_id),
      active_journey_id: active.get(legacy.id)?.id ?? null,
    });
  }

  // 2. home_items of the household are keyed by their book key.
  const home = tx.objectStore('home_items');
  for (const item of await home.getAll()) {
    const householdId = remap(item.household_id);
    const id = householdId === HOUSEHOLD_ID ? item.isbn : item.id;
    if (id !== item.id) await home.delete(item.id);
    await home.put({ ...item, id, household_id: householdId });
  }

  for (const library of await tx.objectStore('libraries').getAll()) {
    await tx.objectStore('libraries').put({ ...library, household_id: remap(library.household_id) });
  }
  for (const loan of await tx.objectStore('loans').getAll()) {
    await tx.objectStore('loans').put({ ...loan, household_id: remap(loan.household_id) });
  }

  // 3 + 4. Each read becomes one event (original read_at); summaries are built from them.
  const summaries = new Map<string, ReadSummary>();
  const events = tx.objectStore('read_events');
  for (const read of await tx.objectStore('reads').getAll()) {
    if (!read.household_id) continue; // orphaned (reader gone), as dropped in v2
    const event: ReadEvent = {
      id: newId(),
      household_id: remap(read.household_id),
      reader_id: read.reader_id,
      isbn: read.isbn,
      read_at: read.read_at,
    };
    await events.put(event);
    const key = `${event.reader_id}\u0000${event.isbn}`;
    summaries.set(key, addToSummary(summaries.get(key) ?? null, event));
  }
  for (const summary of summaries.values()) await tx.objectStore('read_summaries').put(summary);
}

/** All keys [prefix, *] in a [string, string] compound index. */
function prefixRange(prefix: string, from = ''): IDBKeyRange {
  return IDBKeyRange.bound([prefix, from], [prefix, MAX_STRING]);
}

/** All events of one reader for one book, in read_at order. */
function bookRange(readerId: Id, isbn: BookKey): IDBKeyRange {
  return IDBKeyRange.bound([readerId, isbn, ''], [readerId, isbn, MAX_STRING]);
}

/** Journeys stored before Phase 4 have no abandoned_at. */
function normaliseJourney(journey: ReaderJourney): ReaderJourney {
  return { ...journey, abandoned_at: journey.abandoned_at ?? null };
}

const isActiveJourney = (journey: ReaderJourney | undefined): journey is ReaderJourney =>
  !!journey && journey.completed_at === null && (journey.abandoned_at ?? null) === null;

function notFound(kind: string, id: string): DataStoreError {
  return new DataStoreError('not_found', `${kind} not found: ${id}`);
}

function isConstraintError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'ConstraintError';
}

function checkCalendarDate(value: string | null | undefined, field: string): void {
  if (value != null && !isCalendarDate(value)) {
    throw new DataStoreError('invalid', `${field} must be YYYY-MM-DD, got "${value}".`);
  }
}

function checkLoanDays(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new DataStoreError('invalid', `default_loan_days must be a positive whole number, got ${value}.`);
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type ReadTx = AnyTx<'readwrite'>;

/** Rebuilds one reader+book summary from its events (deletes it when none are left). */
export async function recomputeSummary(tx: ReadTx, readerId: Id, isbn: BookKey): Promise<ReadSummary | null> {
  const events = await tx.objectStore('read_events').index('by_reader_isbn_read_at').getAll(bookRange(readerId, isbn));
  const summaries = tx.objectStore('read_summaries');
  if (events.length === 0) {
    await summaries.delete([readerId, isbn]);
    return null;
  }
  const summary = summarize(events)!;
  await summaries.put(summary);
  return summary;
}

/**
 * What the local adapter hands the sync layer (src/data/sync/adapter.ts) so it can add its methods.
 * The local adapter itself knows nothing about sync.
 */
export interface StoreInternals {
  /** The database without the sync recording wrapper. */
  rawDb(): Promise<DB>;
  /** Tell this tab's subscribers, and (unless `remote`) other tabs, that tables changed. */
  emit(tables: DataTable[], remote: boolean): void;
  /** Tell other tabs (they hear it as remote). */
  broadcast(tables: DataTable[]): void;
  now(): number;
  revokeAllCoverUrls(): void;
}

/** Sync hooks: wrap every database handle the adapter uses, then extend the finished store. */
export interface SyncHooks<Extra extends object> {
  wrap(db: DB): DB;
  extend(store: LocalDataStore, internals: StoreInternals): Extra;
}

export interface LocalStoreOptions {
  /** Clock for timestamps and the double-tap guard (tests). */
  now?: () => number;
  /** Tests: stop the cover re-key step after this many photos, as if interrupted. */
  coverStepLimit?: number;
}

/** The local adapter adds a few things for tests and maintenance. Feature code never sees them. */
export interface LocalDataStore extends DataStore {
  close(): Promise<void>;
  /** Resolves once the cover re-key step has run (it starts when the store opens). */
  coverStep: Promise<{ moved: number; remaining: number }>;
  /** Tests only: a second household, which the interface no longer offers. */
  testOnlyAddHousehold(id: Id, name: string): Promise<Household>;
}

export async function createLocalStore(dbName = DB_NAME, options: LocalStoreOptions = {}): Promise<LocalDataStore> {
  return createStoreWith(dbName, options, undefined);
}

/** The local adapter, optionally wrapped and extended by the sync layer. */
export async function createStoreWith<Extra extends object>(
  dbName: string,
  options: LocalStoreOptions,
  hooks: SyncHooks<Extra> | undefined,
): Promise<LocalDataStore & Extra> {
  if (typeof indexedDB === 'undefined') {
    throw new DataStoreError('unavailable', 'IndexedDB is not available in this browser.');
  }
  const now = options.now ?? (() => Date.now());
  const nowIso = () => new Date(now()).toISOString();
  const db = await openLibraryDb(dbName);

  // Some browsers (notably Safari) can close the connection under storage
  // pressure. Reopen lazily rather than failing every subsequent call.
  let conn: Promise<DB> = Promise.resolve(db);
  const watchClose = (d: DB) =>
    d.addEventListener('close', () => {
      conn = openLibraryDb(dbName).then((next) => {
        watchClose(next);
        return next;
      });
    });
  watchClose(db);
  // With sync hooks, every handle the methods below use records writes to synced tables.
  const wrapped = new WeakMap<DB, DB>();
  const getDb = async (): Promise<DB> => {
    const d = await conn;
    if (!hooks) return d;
    let w = wrapped.get(d);
    if (!w) {
      w = hooks.wrap(d);
      wrapped.set(d, w);
    }
    return w;
  };

  // --- Change notifications -------------------------------------------------
  const listeners = new Set<DataChangeListener>();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`${dbName}:changes`) : null;

  const emit = (tables: DataTable[], remote: boolean) => {
    for (const listener of [...listeners]) {
      try {
        listener({ tables, remote });
      } catch (error) {
        console.error('[data/local] subscriber failed', error);
      }
    }
  };
  const changed = (...tables: DataTable[]) => {
    emit(tables, false);
    channel?.postMessage({ tables });
  };
  channel?.addEventListener('message', (event: MessageEvent<{ tables?: DataTable[] }>) => {
    const tables = event.data?.tables ?? [];
    // Another tab may have replaced or moved a cover photo; drop our blob:
    // URLs so the next read creates fresh ones from the stored blobs.
    if (tables.includes('covers')) revokeAllCoverUrls();
    emit(tables, true);
  });

  // --- Cover photos ---------------------------------------------------------
  // One live blob: URL per stored reference ("cover:<hash>" or the legacy
  // "local-cover:<isbn>") for this page. Never persisted.
  const coverUrls = new Map<string, string>();
  const revokeCoverUrl = (ref: string) => {
    const url = coverUrls.get(ref);
    if (url) URL.revokeObjectURL(url);
    coverUrls.delete(ref);
  };
  const revokeAllCoverUrls = () => {
    for (const url of coverUrls.values()) URL.revokeObjectURL(url);
    coverUrls.clear();
  };

  const isLocalCoverRef = (ref: string | null | undefined): ref is string =>
    !!ref && (ref.startsWith(COVER_PREFIX) || ref.startsWith(LEGACY_COVER_PREFIX));

  type CoverStores = ('books' | 'cover_images' | 'covers')[];
  type CoverTx = IDBPTransaction<LibraryCardDB, CoverStores, IDBTransactionMode>;
  type CoverWriteTx = IDBPTransaction<LibraryCardDB, CoverStores, 'readwrite'>;

  /** The stored blob for a local cover reference, from either store. */
  const coverBlob = async (tx: CoverTx, ref: string): Promise<Blob | undefined> => {
    if (ref.startsWith(COVER_PREFIX)) return (await tx.objectStore('cover_images').get(ref.slice(COVER_PREFIX.length)))?.blob;
    return (await tx.objectStore('covers').get(ref.slice(LEGACY_COVER_PREFIX.length)))?.blob;
  };

  /** books.cover_url as stored -> URL the UI can render. Accepts both prefixes. */
  const resolveCover = async (tx: CoverTx, book: Book): Promise<Book> => {
    const ref = book.cover_url;
    if (!isLocalCoverRef(ref)) return book;
    let url = coverUrls.get(ref);
    if (!url) {
      const blob = await coverBlob(tx, ref);
      if (blob) {
        url = URL.createObjectURL(blob);
        coverUrls.set(ref, url);
      }
    }
    return { ...book, cover_url: url ?? null };
  };

  /** UI cover URL -> value to store. blob: URLs must be ones this adapter issued. */
  const storableCover = (url: string | null): string | null => {
    if (!url) return null;
    if (url.startsWith('blob:')) {
      for (const [ref, live] of coverUrls) if (live === url) return ref;
      throw new DataStoreError('invalid', 'This cover image is no longer available. Save the photo again.');
    }
    return url;
  };

  /** Deletes a local photo once no book uses it any more. Returns true if one was deleted. */
  const dropUnusedCover = async (tx: CoverWriteTx, ref: string): Promise<boolean> => {
    if ((await tx.objectStore('books').index('by_cover').count(ref)) > 0) return false;
    if (ref.startsWith(COVER_PREFIX)) await tx.objectStore('cover_images').delete(ref.slice(COVER_PREFIX.length));
    else await tx.objectStore('covers').delete(ref.slice(LEGACY_COVER_PREFIX.length));
    return true;
  };

  /**
   * Moves legacy photos (keyed by ISBN) to cover_images (keyed by SHA-256) and
   * points their books at "cover:<hash>". One transaction per photo, after
   * hashing outside it; a repeat run picks up wherever an interrupted one
   * stopped. The resolver reads both stores meanwhile.
   */
  const rekeyLegacyCovers = async (limit = Infinity): Promise<{ moved: number; remaining: number }> => {
    const d = await getDb();
    if ((await d.get('meta', COVERS_REKEYED_KEY))?.value === true) return { moved: 0, remaining: 0 };
    const legacy = await d.getAll('covers');
    let moved = 0;
    for (const record of legacy) {
      if (moved >= limit) break;
      const hash = await sha256Hex(record.blob);
      const tx = d.transaction(['covers', 'cover_images', 'books'], 'readwrite');
      const oldRef = `${LEGACY_COVER_PREFIX}${record.isbn}`;
      const newRef = `${COVER_PREFIX}${hash}`;
      if (!(await tx.objectStore('cover_images').getKey(hash))) {
        await tx.objectStore('cover_images').put({ hash, blob: record.blob, saved_at: record.saved_at });
      }
      for (const book of await tx.objectStore('books').index('by_cover').getAll(oldRef)) {
        await tx.objectStore('books').put({ ...book, cover_url: newRef });
      }
      await tx.objectStore('covers').delete(record.isbn);
      await tx.done;
      revokeCoverUrl(oldRef);
      moved++;
    }
    const remaining = await d.count('covers');
    if (remaining === 0) await d.put('meta', { key: COVERS_REKEYED_KEY, value: true });
    if (moved > 0) changed('books', 'covers');
    return { moved, remaining };
  };

  const coverStep = rekeyLegacyCovers(options.coverStepLimit).catch((error: unknown) => {
    // Not fatal: legacy covers still resolve, and the next open tries again.
    console.warn('[data/local] cover re-key step failed', error);
    return { moved: 0, remaining: -1 };
  });

  const store: LocalDataStore = {
    adapterName: 'local',
    coverStep,

    async close() {
      listeners.clear();
      channel?.close();
      revokeAllCoverUrls();
      await coverStep;
      (await conn).close();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    // Household --------------------------------------------------------------
    async getCurrentHousehold() {
      // One readwrite transaction, so concurrent callers (StrictMode, other
      // tabs) can't each create it.
      const tx = (await getDb()).transaction(['meta', 'households'], 'readwrite');
      let household = await tx.objectStore('households').get(HOUSEHOLD_ID);
      let created = false;
      if (!household) {
        household = { id: HOUSEHOLD_ID, name: strings.data.defaultHouseholdName, parent_pin_hash: null };
        await tx.objectStore('households').add(household);
        await tx.objectStore('meta').put({ key: CURRENT_HOUSEHOLD_KEY, value: HOUSEHOLD_ID });
        created = true;
      }
      await tx.done;
      if (created) changed('households');
      return household;
    },

    async getHousehold(id) {
      return (await (await getDb()).get('households', id)) ?? null;
    },

    async updateHousehold(id, patch) {
      const tx = (await getDb()).transaction('households', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Household', id);
      const next: Household = { ...existing, ...patch, id };
      if (patch.name !== undefined) {
        next.name = patch.name.trim();
        if (!next.name) throw new DataStoreError('invalid', 'The household name must not be empty.');
      }
      await tx.store.put(next);
      await tx.done;
      changed('households');
      return next;
    },

    async testOnlyAddHousehold(id, name) {
      const household: Household = { id, name, parent_pin_hash: null };
      await (await getDb()).put('households', household);
      changed('households');
      return household;
    },

    // Readers ---------------------------------------------------------------
    async createReader(input) {
      const d = await getDb();
      if (!(await d.getKey('households', input.household_id))) {
        throw notFound('Household', input.household_id);
      }
      const reader: Reader = {
        id: newId(),
        household_id: input.household_id,
        display_name: input.display_name,
        avatar: input.avatar,
        card_token: input.card_token ?? newCardToken(),
        active_journey_id: null,
      };
      try {
        await d.add('readers', reader);
      } catch (error) {
        if (isConstraintError(error)) throw new DataStoreError('conflict', 'card_token is already in use.');
        throw error;
      }
      changed('readers');
      return reader;
    },

    async getReader(id) {
      return (await (await getDb()).get('readers', id)) ?? null;
    },

    async getReaderByCardToken(token) {
      if (!token) return null;
      return (await (await getDb()).getFromIndex('readers', 'by_card_token', token)) ?? null;
    },

    async listReaders(householdId) {
      const readers = await (await getDb()).getAllFromIndex('readers', 'by_household', householdId);
      return readers.sort((a, b) => a.display_name.localeCompare(b.display_name));
    },

    async updateReader(id, patch) {
      const tx = (await getDb()).transaction('readers', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Reader', id);
      const next: Reader = {
        ...existing,
        display_name: patch.display_name ?? existing.display_name,
        avatar: patch.avatar ?? existing.avatar,
      };
      await tx.store.put(next);
      await tx.done;
      changed('readers');
      return next;
    },

    async rotateCardToken(readerId) {
      // A 128-bit collision is practically impossible, but retry rather than fail.
      for (let attempt = 0; attempt < 3; attempt++) {
        const tx = (await getDb()).transaction('readers', 'readwrite');
        const existing = await tx.store.get(readerId);
        if (!existing) throw notFound('Reader', readerId);
        const next: Reader = { ...existing, card_token: newCardToken() };
        try {
          await tx.store.put(next);
          await tx.done;
          changed('readers');
          return next;
        } catch (error) {
          if (!isConstraintError(error)) throw error;
        }
      }
      throw new DataStoreError('conflict', 'Could not issue a unique card token.');
    },

    async deleteReader(id) {
      const tx = (await getDb()).transaction(
        ['readers', 'loans', 'read_events', 'read_summaries', 'reader_journeys'],
        'readwrite',
      );
      if (!(await tx.objectStore('readers').get(id))) throw notFound('Reader', id);
      const loans = await tx.objectStore('loans').index('by_reader').getAll(id);
      if (loans.some((loan) => loan.returned_at === null)) {
        throw new DataStoreError('blocked', 'This reader still has library books out. Return or delete those loans first.');
      }
      // One delete per child row, so every delete can later be replayed as a
      // single-record change.
      for (const key of await tx.objectStore('read_events').index('by_reader_read_at').getAllKeys(prefixRange(id))) {
        await tx.objectStore('read_events').delete(key);
      }
      for (const key of await tx.objectStore('read_summaries').getAllKeys(prefixRange(id))) {
        await tx.objectStore('read_summaries').delete(key);
      }
      for (const loan of loans) await tx.objectStore('loans').delete(loan.id);
      for (const key of await tx.objectStore('reader_journeys').index('by_reader_started').getAllKeys(prefixRange(id))) {
        await tx.objectStore('reader_journeys').delete(key);
      }
      await tx.objectStore('readers').delete(id);
      await tx.done;
      changed('readers', 'loans', 'read_events', 'reader_journeys');
    },

    async previewDeleteReader(id) {
      const tx = (await getDb()).transaction(['readers', 'loans', 'read_events', 'read_summaries', 'reader_journeys']);
      if (!(await tx.objectStore('readers').getKey(id))) throw notFound('Reader', id);
      const loans = await tx.objectStore('loans').index('by_reader').getAll(id);
      const preview = {
        readEvents: await tx.objectStore('read_events').index('by_reader_read_at').count(prefixRange(id)),
        booksRead: await tx.objectStore('read_summaries').count(prefixRange(id)),
        journeys: await tx.objectStore('reader_journeys').index('by_reader_started').count(prefixRange(id)),
        returnedLoans: loans.filter((loan) => loan.returned_at !== null).length,
        activeLoans: loans.filter((loan) => loan.returned_at === null).length,
      };
      await tx.done;
      return preview;
    },

    // Books -----------------------------------------------------------------
    async getBook(isbn) {
      const tx = (await getDb()).transaction(['books', 'cover_images', 'covers']);
      const book = await tx.objectStore('books').get(isbn);
      const resolved = book ? await resolveCover(tx, book) : null;
      await tx.done;
      return resolved;
    },

    async getBooks(isbns) {
      const tx = (await getDb()).transaction(['books', 'cover_images', 'covers']);
      const books = (await Promise.all(isbns.map((isbn) => tx.objectStore('books').get(isbn)))).filter(
        (book): book is Book => book !== undefined,
      );
      const resolved: Book[] = [];
      for (const book of books) resolved.push(await resolveCover(tx, book));
      await tx.done;
      return resolved;
    },

    async putBook(book) {
      const stored: Book = {
        isbn: book.isbn,
        title: book.title,
        authors: [...book.authors],
        cover_url: storableCover(book.cover_url ?? null),
        source: book.source,
      };
      const tx = (await getDb()).transaction(['books', 'cover_images', 'covers'], 'readwrite');
      const previous = (await tx.objectStore('books').get(book.isbn))?.cover_url ?? null;
      await tx.objectStore('books').put(stored);
      // Drop the old photo if no book uses it any more.
      let droppedRef: string | null = null;
      if (isLocalCoverRef(previous) && previous !== stored.cover_url && (await dropUnusedCover(tx, previous))) {
        droppedRef = previous;
      }
      const resolved = await resolveCover(tx, stored);
      await tx.done;
      if (droppedRef) {
        revokeCoverUrl(droppedRef);
        changed('books', 'covers');
      } else {
        changed('books');
      }
      return resolved;
    },

    async saveCoverImage(image) {
      if (!(image instanceof Blob) || image.size === 0) {
        throw new DataStoreError('invalid', 'Cover image is empty.');
      }
      if (image.size > MAX_COVER_BYTES) {
        throw new DataStoreError('invalid', `Cover image is larger than ${MAX_COVER_BYTES} bytes.`);
      }
      const hash = await sha256Hex(image);
      const ref = `${COVER_PREFIX}${hash}`;
      const d = await getDb();
      if (!(await d.getKey('cover_images', hash))) {
        await d.put('cover_images', { hash, blob: image, saved_at: nowIso() });
      }
      let url = coverUrls.get(ref);
      if (!url) {
        url = URL.createObjectURL(image);
        coverUrls.set(ref, url);
      }
      changed('covers');
      return url;
    },

    // Home library ----------------------------------------------------------
    async addHomeItem(householdId, isbn) {
      const tx = (await getDb()).transaction('home_items', 'readwrite');
      const existing = await tx.store.index('by_household_isbn').get([householdId, isbn]);
      if (existing) {
        await tx.done;
        return existing;
      }
      const item: HomeItem = { id: isbn, household_id: householdId, isbn, added_at: nowIso() };
      await tx.store.add(item);
      await tx.done;
      changed('home_items');
      return item;
    },

    async getHomeItem(householdId, isbn) {
      return (await (await getDb()).getFromIndex('home_items', 'by_household_isbn', [householdId, isbn])) ?? null;
    },

    async listHomeItems(householdId) {
      const items = await (await getDb()).getAllFromIndex('home_items', 'by_household_added', prefixRange(householdId));
      return items.reverse();
    },

    async removeHomeItem(id) {
      await (await getDb()).delete('home_items', id);
      changed('home_items');
    },

    // Libraries -------------------------------------------------------------
    async createLibrary(input) {
      const library: Library = {
        id: newId(),
        household_id: input.household_id,
        name: input.name,
        search_url_template: input.search_url_template ?? null,
        homepage_url: input.homepage_url ?? null,
        default_loan_days: input.default_loan_days ?? DEFAULT_LOAN_DAYS,
        sticker_prefix: input.sticker_prefix ?? null,
      };
      checkLoanDays(library.default_loan_days);
      await (await getDb()).add('libraries', library);
      changed('libraries');
      return library;
    },

    async getLibrary(id) {
      return (await (await getDb()).get('libraries', id)) ?? null;
    },

    async listLibraries(householdId) {
      const libraries = await (await getDb()).getAllFromIndex('libraries', 'by_household', householdId);
      return libraries.sort((a, b) => a.name.localeCompare(b.name));
    },

    async updateLibrary(id, patch) {
      if (patch.default_loan_days !== undefined) checkLoanDays(patch.default_loan_days);
      const tx = (await getDb()).transaction('libraries', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Library', id);
      const next: Library = { ...existing, ...patch, id, household_id: existing.household_id };
      await tx.store.put(next);
      await tx.done;
      changed('libraries');
      return next;
    },

    async deleteLibrary(id) {
      const tx = (await getDb()).transaction(['libraries', 'loans'], 'readwrite');
      const library = await tx.objectStore('libraries').get(id);
      const loans = await tx.objectStore('loans').index('by_library').getAll(id);
      for (const loan of loans) {
        await tx.objectStore('loans').put({
          ...loan,
          library_id: null,
          library_name: library?.name ?? loan.library_name ?? null,
        });
      }
      await tx.objectStore('libraries').delete(id);
      await tx.done;
      changed('libraries', 'loans');
    },

    // Borrowed library ------------------------------------------------------
    async createLoan(input) {
      checkCalendarDate(input.due_date, 'due_date');
      const loan: Loan = {
        id: newId(),
        household_id: input.household_id,
        reader_id: input.reader_id,
        isbn: input.isbn,
        library_id: input.library_id ?? null,
        library_name: input.library_name ?? null,
        sticker_barcode: input.sticker_barcode ?? null,
        borrowed_at: input.borrowed_at ? toIso(input.borrowed_at) : nowIso(),
        due_date: input.due_date ?? null,
        returned_at: null,
        renew_count: 0,
      };
      const d = await getDb();
      if (!(await d.getKey('readers', loan.reader_id))) throw notFound('Reader', loan.reader_id);
      if (loan.library_id && !(await d.getKey('libraries', loan.library_id))) {
        throw notFound('Library', loan.library_id);
      }
      await d.add('loans', loan);
      changed('loans');
      return loan;
    },

    async getLoan(id) {
      return (await (await getDb()).get('loans', id)) ?? null;
    },

    async listLoans(householdId, options = {}) {
      const loans = await (await getDb()).getAllFromIndex('loans', 'by_household_borrowed', prefixRange(householdId));
      return loans
        .filter((loan) => {
          if (options.reader_id !== undefined && loan.reader_id !== options.reader_id) return false;
          if (options.active === true && loan.returned_at !== null) return false;
          if (options.active === false && loan.returned_at === null) return false;
          return true;
        })
        .reverse();
    },

    async listActiveLoans(readerId) {
      const loans = await (await getDb()).getAllFromIndex('loans', 'by_reader', readerId);
      return loans
        .filter((loan) => loan.returned_at === null)
        .sort(
          (a, b) =>
            (a.due_date ?? MAX_STRING).localeCompare(b.due_date ?? MAX_STRING) ||
            a.borrowed_at.localeCompare(b.borrowed_at) ||
            a.id.localeCompare(b.id),
        );
    },

    async listReturnedLoans(readerId) {
      const loans = await (await getDb()).getAllFromIndex('loans', 'by_reader', readerId);
      return loans
        .filter((loan) => loan.returned_at !== null)
        .sort((a, b) => b.returned_at!.localeCompare(a.returned_at!) || b.id.localeCompare(a.id));
    },

    async findActiveLoansBySticker(householdId, sticker) {
      const value = sticker.trim();
      if (!value) return [];
      const loans = await (await getDb()).getAllFromIndex('loans', 'by_sticker', value);
      return loans.filter((loan) => loan.household_id === householdId && loan.returned_at === null);
    },

    async updateLoan(id, patch) {
      checkCalendarDate(patch.due_date, 'due_date');
      if (patch.renew_count !== undefined && (!Number.isInteger(patch.renew_count) || patch.renew_count < 0)) {
        throw new DataStoreError('invalid', 'renew_count must be a whole number >= 0.');
      }
      const tx = (await getDb()).transaction(['loans', 'readers', 'libraries'], 'readwrite');
      const existing = await tx.objectStore('loans').get(id);
      if (!existing) throw notFound('Loan', id);
      if (patch.reader_id !== undefined && !(await tx.objectStore('readers').getKey(patch.reader_id))) {
        throw notFound('Reader', patch.reader_id);
      }
      if (patch.library_id && !(await tx.objectStore('libraries').getKey(patch.library_id))) {
        throw notFound('Library', patch.library_id);
      }
      const next: Loan = {
        ...existing,
        ...patch,
        id,
        returned_at:
          patch.returned_at === undefined ? existing.returned_at : patch.returned_at && toIso(patch.returned_at),
      };
      await tx.objectStore('loans').put(next);
      await tx.done;
      changed('loans');
      return next;
    },

    async renewLoan(id) {
      const tx = (await getDb()).transaction(['loans', 'libraries'], 'readwrite');
      const existing = await tx.objectStore('loans').get(id);
      if (!existing) throw notFound('Loan', id);
      if (existing.returned_at !== null) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new DataStoreError('invalid', 'A returned loan cannot be renewed.');
      }
      const library = existing.library_id ? await tx.objectStore('libraries').get(existing.library_id) : undefined;
      const days = library?.default_loan_days ?? DEFAULT_LOAN_DAYS;
      const next: Loan = {
        ...existing,
        due_date: addDays(existing.due_date ?? toCalendarDate(new Date(now())), days),
        renew_count: existing.renew_count + 1,
      };
      await tx.objectStore('loans').put(next);
      await tx.done;
      changed('loans');
      return next;
    },

    async unrenewLoan(id, previousDueDate) {
      checkCalendarDate(previousDueDate, 'due_date');
      const tx = (await getDb()).transaction('loans', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Loan', id);
      const next: Loan = { ...existing, due_date: previousDueDate, renew_count: Math.max(0, existing.renew_count - 1) };
      await tx.store.put(next);
      await tx.done;
      changed('loans');
      return next;
    },

    async returnLoan(id, returnedAt) {
      return store.updateLoan(id, { returned_at: returnedAt ?? nowIso() });
    },

    async unreturnLoan(id) {
      return store.updateLoan(id, { returned_at: null });
    },

    async deleteLoan(id) {
      await (await getDb()).delete('loans', id);
      changed('loans');
    },

    // Reads -----------------------------------------------------------------
    async markRead(readerId, isbn, readAt) {
      const tx = (await getDb()).transaction(['readers', 'read_events', 'read_summaries'], 'readwrite');
      const reader = await tx.objectStore('readers').get(readerId);
      if (!reader) throw notFound('Reader', readerId);

      const events = tx.objectStore('read_events');
      const summaries = tx.objectStore('read_summaries');
      if (readAt === undefined) {
        // Double-tap guard: ignore a repeat within READ_TAP_GUARD_MS of the latest read.
        const latest = latestEvent(await events.index('by_reader_isbn_read_at').getAll(bookRange(readerId, isbn)));
        if (isRepeatTap(latest?.read_at, now())) {
          await tx.done;
          return null;
        }
      }
      const event: ReadEvent = {
        id: newId(),
        household_id: reader.household_id,
        reader_id: readerId,
        isbn,
        read_at: readAt ? toIso(readAt) : nowIso(),
      };
      await events.add(event);
      await summaries.put(addToSummary((await summaries.get([readerId, isbn])) ?? null, event));
      await tx.done;
      changed('read_events');
      return event;
    },

    async undoLatestRead(readerId, isbn) {
      const tx = (await getDb()).transaction(['read_events', 'read_summaries'], 'readwrite');
      const latest = latestEvent(
        await tx.objectStore('read_events').index('by_reader_isbn_read_at').getAll(bookRange(readerId, isbn)),
      );
      if (!latest) {
        await tx.done;
        return null;
      }
      await tx.objectStore('read_events').delete(latest.id);
      await recomputeSummary(tx, readerId, isbn);
      await tx.done;
      changed('read_events');
      return latest;
    },

    async clearReads(readerId, isbn) {
      const tx = (await getDb()).transaction(['read_events', 'read_summaries'], 'readwrite');
      const keys = await tx.objectStore('read_events').index('by_reader_isbn_read_at').getAllKeys(bookRange(readerId, isbn));
      for (const key of keys) await tx.objectStore('read_events').delete(key);
      await tx.objectStore('read_summaries').delete([readerId, isbn]);
      await tx.done;
      if (keys.length > 0) changed('read_events');
      return keys.length;
    },

    async restoreReadEvent(event) {
      if (!event?.id || !event.reader_id || !event.isbn || !event.read_at) {
        throw new DataStoreError('invalid', 'Not a read event.');
      }
      const tx = (await getDb()).transaction(['readers', 'read_events', 'read_summaries'], 'readwrite');
      const reader = await tx.objectStore('readers').get(event.reader_id);
      if (!reader) throw notFound('Reader', event.reader_id);
      const restored: ReadEvent = {
        id: event.id,
        household_id: reader.household_id,
        reader_id: event.reader_id,
        isbn: event.isbn,
        read_at: toIso(event.read_at),
      };
      await tx.objectStore('read_events').put(restored);
      await recomputeSummary(tx, restored.reader_id, restored.isbn);
      await tx.done;
      changed('read_events');
      return restored;
    },

    async getReadSummary(readerId, isbn) {
      return (await (await getDb()).get('read_summaries', [readerId, isbn])) ?? null;
    },

    async listReadSummaries(readerId) {
      const summaries = await (await getDb()).getAllFromIndex('read_summaries', 'by_reader_last', prefixRange(readerId));
      return summaries.reverse();
    },

    async listReadEvents(readerId, isbn) {
      const d = await getDb();
      const events =
        isbn === undefined
          ? await d.getAllFromIndex('read_events', 'by_reader_read_at', prefixRange(readerId))
          : await d.getAllFromIndex('read_events', 'by_reader_isbn_read_at', bookRange(readerId, isbn));
      return events.reverse();
    },

    async countReadsSince(readerId, since) {
      return (await getDb()).countFromIndex('read_summaries', 'by_reader_first', prefixRange(readerId, toIso(since)));
    },

    async countHouseholdReads(householdId) {
      return (await getDb()).countFromIndex('read_summaries', 'by_household', householdId);
    },

    async listHouseholdReadSummaries(householdId) {
      return (await getDb()).getAllFromIndex('read_summaries', 'by_household', householdId);
    },

    // Reading journeys ------------------------------------------------------
    async startJourney(readerId, journeyId, startedAt) {
      // Stopping the old journey, creating the new one and moving the pointer
      // share one readwrite transaction, which IndexedDB serialises, so the
      // reader always ends up with exactly one active journey.
      const tx = (await getDb()).transaction(['readers', 'reader_journeys'], 'readwrite');
      const reader = await tx.objectStore('readers').get(readerId);
      if (!reader) throw notFound('Reader', readerId);
      const at = startedAt ? toIso(startedAt) : nowIso();
      const current = reader.active_journey_id ? await tx.objectStore('reader_journeys').get(reader.active_journey_id) : undefined;
      if (isActiveJourney(current)) {
        await tx.objectStore('reader_journeys').put({ ...normaliseJourney(current), abandoned_at: at });
      }
      const journey: ReaderJourney = {
        id: newId(),
        reader_id: readerId,
        journey_id: journeyId,
        started_at: at,
        completed_at: null,
        abandoned_at: null,
      };
      await tx.objectStore('reader_journeys').add(journey);
      await tx.objectStore('readers').put({ ...reader, active_journey_id: journey.id });
      await tx.done;
      changed('reader_journeys', 'readers');
      return journey;
    },

    async getActiveJourney(readerId) {
      const d = await getDb();
      const reader = await d.get('readers', readerId);
      if (!reader?.active_journey_id) return null;
      const journey = await d.get('reader_journeys', reader.active_journey_id);
      return isActiveJourney(journey) ? normaliseJourney(journey) : null;
    },

    async listJourneyHistory(readerId) {
      const mine = await (await getDb()).getAllFromIndex('reader_journeys', 'by_reader_started', prefixRange(readerId));
      return mine.reverse().map(normaliseJourney);
    },

    async countCompletedJourneys(readerId) {
      const mine = await (await getDb()).getAllFromIndex('reader_journeys', 'by_reader_started', prefixRange(readerId));
      const counts: Record<string, number> = {};
      for (const journey of mine) {
        if (journey.completed_at !== null) counts[journey.journey_id] = (counts[journey.journey_id] ?? 0) + 1;
      }
      // Keys in journey id order, so the result is the same whatever order the records come in.
      return Object.fromEntries(Object.entries(counts).sort(([x], [y]) => x.localeCompare(y)));
    },

    async completeJourney(id, completedAt) {
      const tx = (await getDb()).transaction(['readers', 'reader_journeys'], 'readwrite');
      const existing = await tx.objectStore('reader_journeys').get(id);
      if (!existing) throw notFound('Reader journey', id);
      const next: ReaderJourney = {
        ...normaliseJourney(existing),
        completed_at: existing.completed_at ?? (completedAt ? toIso(completedAt) : nowIso()),
      };
      await tx.objectStore('reader_journeys').put(next);
      const reader = await tx.objectStore('readers').get(existing.reader_id);
      if (reader?.active_journey_id === id) await tx.objectStore('readers').put({ ...reader, active_journey_id: null });
      await tx.done;
      changed('reader_journeys', 'readers');
      return next;
    },

    async deleteReaderJourney(id) {
      const tx = (await getDb()).transaction(['readers', 'reader_journeys'], 'readwrite');
      const existing = await tx.objectStore('reader_journeys').get(id);
      await tx.objectStore('reader_journeys').delete(id);
      const reader = existing ? await tx.objectStore('readers').get(existing.reader_id) : undefined;
      if (reader?.active_journey_id === id) await tx.objectStore('readers').put({ ...reader, active_journey_id: null });
      await tx.done;
      changed('reader_journeys', 'readers');
    },

    // Backup and reset ------------------------------------------------------
    async exportBackup() {
      // Let the legacy cover step finish, so photos are (mostly) in cover_images.
      await coverStep;
      const tx = (await getDb()).transaction([...BACKUP_TABLES, 'cover_images', 'covers']);
      const tables = {} as BackupTables;
      for (const table of BACKUP_TABLES) {
        (tables as unknown as Record<string, unknown[]>)[table] = await tx.objectStore(table).getAll();
      }
      // The photos books use, by reference. Read inside the transaction, encode after it.
      const blobs = new Map<string, Blob>();
      for (const book of tables.books) {
        const ref = book.cover_url;
        if (!isLocalCoverRef(ref) || blobs.has(ref)) continue;
        const blob = await coverBlob(tx as unknown as CoverTx, ref);
        if (blob) blobs.set(ref, blob);
      }
      await tx.done;

      // Legacy "local-cover:<isbn>" photos are exported under their hash, like the rest.
      const covers: Record<string, string> = {};
      const renamed = new Map<string, string>();
      for (const [ref, blob] of blobs) {
        const key = ref.startsWith(COVER_PREFIX) ? ref : `${COVER_PREFIX}${await sha256Hex(blob)}`;
        if (key !== ref) renamed.set(ref, key);
        covers[key] = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      }
      tables.books = tables.books.map((book) => {
        if (!isLocalCoverRef(book.cover_url)) return book;
        const ref = renamed.get(book.cover_url) ?? book.cover_url;
        return { ...book, cover_url: ref in covers ? ref : null };
      });
      tables.reader_journeys = tables.reader_journeys.map(normaliseJourney);

      const backup: Backup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        schema: DB_VERSION,
        exported_at: nowIso(),
        tables,
        covers,
      };
      return backup;
    },

    async importBackup(data) {
      const check = validateBackup(data, { maxSchema: DB_VERSION });
      if (!check.ok) {
        throw new DataStoreError('invalid', `Not a usable backup (${check.problem}${check.detail ? `: ${check.detail}` : ''}).`);
      }
      const { backup } = check;
      // Decode and verify every photo before touching the database.
      const images: CoverImageRecord[] = [];
      for (const [ref, text] of Object.entries(backup.covers)) {
        const bytes = base64ToBytes(text);
        const blob = new Blob([bytes as BlobPart], { type: sniffImageType(bytes) });
        const hash = ref.slice(COVER_PREFIX.length);
        if ((await sha256Hex(blob)) !== hash) throw new DataStoreError('invalid', `Cover photo ${ref} is damaged.`);
        images.push({ hash, blob, saved_at: backup.exported_at });
      }
      // Summaries are rebuilt from the events.
      const byBook = new Map<string, ReadEvent[]>();
      for (const event of backup.tables.read_events) {
        const key = `${event.reader_id}\u0000${event.isbn}`;
        byBook.set(key, [...(byBook.get(key) ?? []), event]);
      }

      const d = await getDb();
      const all = [...d.objectStoreNames];
      const tx = d.transaction(all, 'readwrite');
      for (const name of all) await tx.objectStore(name).clear();
      for (const table of BACKUP_TABLES) {
        const target = tx.objectStore(table) as unknown as { put(value: unknown): Promise<unknown> };
        for (const row of backup.tables[table] as unknown[]) await target.put(row);
      }
      for (const image of images) await tx.objectStore('cover_images').put(image);
      for (const events of byBook.values()) await tx.objectStore('read_summaries').put(summarize(events)!);
      await tx.objectStore('meta').put({ key: CURRENT_HOUSEHOLD_KEY, value: HOUSEHOLD_ID });
      await tx.objectStore('meta').put({ key: COVERS_REKEYED_KEY, value: true });
      await tx.done;
      revokeAllCoverUrls();
      changed(...ALL_TABLES);
      return summariseBackup(backup);
    },

    async resetDevice() {
      const d = await getDb();
      const all = [...d.objectStoreNames];
      const tx = d.transaction(all, 'readwrite');
      for (const name of all) await tx.objectStore(name).clear();
      await tx.done;
      revokeAllCoverUrls();
      changed(...ALL_TABLES);
    },
  };

  if (!hooks) return store as LocalDataStore & Extra;
  const extra = hooks.extend(store, {
    rawDb: () => conn,
    emit,
    broadcast: (tables) => channel?.postMessage({ tables }),
    now,
    revokeAllCoverUrls,
  });
  return Object.assign(store, extra);
}

export const ALL_TABLES: DataTable[] = [
  'households',
  'readers',
  'books',
  'covers',
  'home_items',
  'libraries',
  'loans',
  'read_events',
  'reader_journeys',
];
