import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import { isCalendarDate } from '../../lib/dates';
import { fixLowercaseTitle } from '../../lib/text';
import { strings } from '../../strings';
import {
  DEFAULT_LOAN_DAYS,
  DataStoreError,
  type Book,
  type DataChangeListener,
  type DataStore,
  type DataTable,
  type HomeItem,
  type Household,
  type Id,
  type Isbn,
  type Library,
  type Loan,
  type Read,
  type Reader,
  type ReaderJourney,
} from '../DataStore';
import { newCardToken, newId, nowIso, toIso } from '../ids';

/**
 * Local-only adapter backed by IndexedDB. Data never leaves the device.
 *
 * Schema history:
 *   v1  Phase 1 tables.
 *   v2  reads.household_id (+ index), libraries, covers, meta;
 *       loans.library_id / sticker_barcode / renew_count.
 */

const DB_NAME = 'library-card';
const DB_VERSION = 2;

// Highest possible string suffix for compound-key range upper bounds.
const MAX_STRING = '￿';

/** Stored in books.cover_url for photos kept in the covers store. Resolved to a blob: URL on read. */
const LOCAL_COVER_PREFIX = 'local-cover:';

const CURRENT_HOUSEHOLD_KEY = 'current_household_id';

interface CoverRecord {
  isbn: Isbn;
  blob: Blob;
  saved_at: string;
}

interface MetaRecord {
  key: string;
  value: string;
}

interface LibraryCardDB extends DBSchema {
  meta: {
    key: string;
    value: MetaRecord;
  };
  households: {
    key: Id;
    value: Household;
  };
  readers: {
    key: Id;
    value: Reader;
    indexes: {
      by_household: Id;
      by_card_token: string;
    };
  };
  books: {
    key: Isbn;
    value: Book;
  };
  covers: {
    key: Isbn;
    value: CoverRecord;
  };
  home_items: {
    key: Id;
    value: HomeItem;
    indexes: {
      by_household_isbn: [Id, Isbn];
      by_household_added: [Id, string];
    };
  };
  libraries: {
    key: Id;
    value: Library;
    indexes: {
      by_household: Id;
    };
  };
  loans: {
    key: Id;
    value: Loan;
    indexes: {
      by_household_borrowed: [Id, string];
      by_reader: Id;
      by_library: Id;
      /** For Phase 3: find a loan from a scanned library sticker. Null stickers aren't indexed. */
      by_household_sticker: [Id, string];
    };
  };
  reads: {
    key: [Id, Isbn];
    value: Read;
    indexes: {
      by_reader_read_at: [Id, string];
      by_household: Id;
    };
  };
  reader_journeys: {
    key: Id;
    value: ReaderJourney;
    indexes: {
      by_reader_started: [Id, string];
    };
  };
}

type DB = IDBPDatabase<LibraryCardDB>;
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

        // Compound primary key enforces one read per reader+isbn.
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
        loans.createIndex('by_household_sticker', ['household_id', 'sticker_barcode']);
        tx.objectStore('reads').createIndex('by_household', 'household_id');

        if (oldVersion >= 1) await migrateV1Data(tx);
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
    const read = readCursor.value as Partial<Read> & Pick<Read, 'reader_id' | 'isbn' | 'read_at'>;
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

/** All keys [prefix, *] in a [string, string] compound index. */
function prefixRange(prefix: string, from = ''): IDBKeyRange {
  return IDBKeyRange.bound([prefix, from], [prefix, MAX_STRING]);
}

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

/** The local adapter adds close(), used by tests to delete throwaway databases. */
export interface LocalDataStore extends DataStore {
  close(): Promise<void>;
}

export async function createLocalStore(dbName = DB_NAME): Promise<LocalDataStore> {
  if (typeof indexedDB === 'undefined') {
    throw new DataStoreError('unavailable', 'IndexedDB is not available in this browser.');
  }
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
  const getDb = () => conn;

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
    // Another tab may have replaced a cover photo; drop our blob: URLs so
    // the next read creates fresh ones from the stored blobs.
    if (tables.includes('covers')) revokeAllCoverUrls();
    emit(tables, true);
  });

  // --- Cover photos ---------------------------------------------------------
  // One live blob: URL per ISBN for this page. Never persisted.
  const coverUrls = new Map<Isbn, string>();
  const revokeCoverUrl = (isbn: Isbn) => {
    const url = coverUrls.get(isbn);
    if (url) URL.revokeObjectURL(url);
    coverUrls.delete(isbn);
  };
  const revokeAllCoverUrls = () => {
    for (const url of coverUrls.values()) URL.revokeObjectURL(url);
    coverUrls.clear();
  };

  /** books.cover_url as stored -> URL the UI can render. */
  const resolveCover = (book: Book, record: CoverRecord | undefined): Book => {
    if (!book.cover_url?.startsWith(LOCAL_COVER_PREFIX)) return book;
    const isbn = book.cover_url.slice(LOCAL_COVER_PREFIX.length);
    let url = coverUrls.get(isbn);
    if (!url && record) {
      url = URL.createObjectURL(record.blob);
      coverUrls.set(isbn, url);
    }
    return { ...book, cover_url: url ?? null };
  };

  const coverIsbnOf = (book: Book): Isbn | null =>
    book.cover_url?.startsWith(LOCAL_COVER_PREFIX) ? book.cover_url.slice(LOCAL_COVER_PREFIX.length) : null;

  /** UI cover URL -> value to store. blob: URLs must be ones this adapter issued. */
  const storableCover = (url: string | null): string | null => {
    if (!url) return null;
    if (url.startsWith('blob:')) {
      for (const [isbn, live] of coverUrls) if (live === url) return `${LOCAL_COVER_PREFIX}${isbn}`;
      throw new DataStoreError('invalid', 'This cover image is no longer available. Save the photo again.');
    }
    return url;
  };

  const store: LocalDataStore = {
    adapterName: 'local',

    async close() {
      listeners.clear();
      channel?.close();
      revokeAllCoverUrls();
      (await conn).close();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    // Households ------------------------------------------------------------
    async getCurrentHousehold() {
      // One readwrite transaction, so concurrent callers (StrictMode, other
      // tabs) can't each create a household.
      const tx = (await getDb()).transaction(['meta', 'households'], 'readwrite');
      const meta = tx.objectStore('meta');
      const households = tx.objectStore('households');
      const currentId = (await meta.get(CURRENT_HOUSEHOLD_KEY))?.value;
      let household = currentId ? await households.get(currentId) : undefined;
      let created = false;
      if (!household) {
        household = (await households.getAll())[0];
        if (!household) {
          household = { id: newId(), name: strings.data.defaultHouseholdName, parent_pin_hash: null };
          await households.add(household);
          created = true;
        }
        await meta.put({ key: CURRENT_HOUSEHOLD_KEY, value: household.id });
      }
      await tx.done;
      if (created) changed('households');
      return household;
    },

    async createHousehold(input) {
      const household: Household = {
        id: newId(),
        name: input.name,
        parent_pin_hash: input.parent_pin_hash ?? null,
      };
      await (await getDb()).add('households', household);
      changed('households');
      return household;
    },

    async getHousehold(id) {
      return (await (await getDb()).get('households', id)) ?? null;
    },

    async listHouseholds() {
      return (await getDb()).getAll('households');
    },

    async updateHousehold(id, patch) {
      const tx = (await getDb()).transaction('households', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Household', id);
      const next: Household = { ...existing, ...patch, id };
      await tx.store.put(next);
      await tx.done;
      changed('households');
      return next;
    },

    async deleteHousehold(id) {
      const tx = (await getDb()).transaction(
        ['meta', 'households', 'readers', 'home_items', 'libraries', 'loans', 'reads', 'reader_journeys'],
        'readwrite',
      );
      const readerIds = await tx.objectStore('readers').index('by_household').getAllKeys(id);
      for (const readerId of readerIds) {
        await deleteReaderData(tx, readerId);
        await tx.objectStore('readers').delete(readerId);
      }
      await deleteKeys(tx, 'home_items', await tx.objectStore('home_items').index('by_household_added').getAllKeys(prefixRange(id)));
      await deleteKeys(tx, 'loans', await tx.objectStore('loans').index('by_household_borrowed').getAllKeys(prefixRange(id)));
      await deleteKeys(tx, 'libraries', await tx.objectStore('libraries').index('by_household').getAllKeys(id));
      await deleteKeys(tx, 'reads', await tx.objectStore('reads').index('by_household').getAllKeys(id));
      if ((await tx.objectStore('meta').get(CURRENT_HOUSEHOLD_KEY))?.value === id) {
        await tx.objectStore('meta').delete(CURRENT_HOUSEHOLD_KEY);
      }
      await tx.objectStore('households').delete(id);
      await tx.done;
      changed('households', 'readers', 'home_items', 'libraries', 'loans', 'reads', 'reader_journeys');
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
      const tx = (await getDb()).transaction(['readers', 'loans', 'reads', 'reader_journeys'], 'readwrite');
      await deleteReaderData(tx, id);
      await tx.objectStore('readers').delete(id);
      await tx.done;
      changed('readers', 'loans', 'reads', 'reader_journeys');
    },

    // Books -----------------------------------------------------------------
    async getBook(isbn) {
      const tx = (await getDb()).transaction(['books', 'covers']);
      const book = await tx.objectStore('books').get(isbn);
      const coverIsbn = book && coverIsbnOf(book);
      const cover = coverIsbn ? await tx.objectStore('covers').get(coverIsbn) : undefined;
      await tx.done;
      return book ? resolveCover(book, cover) : null;
    },

    async getBooks(isbns) {
      const tx = (await getDb()).transaction(['books', 'covers']);
      const books = (await Promise.all(isbns.map((isbn) => tx.objectStore('books').get(isbn)))).filter(
        (book): book is Book => book !== undefined,
      );
      const covers = await Promise.all(
        books.map((book) => {
          const coverIsbn = coverIsbnOf(book);
          return coverIsbn && !coverUrls.has(coverIsbn) ? tx.objectStore('covers').get(coverIsbn) : undefined;
        }),
      );
      await tx.done;
      return books.map((book, i) => resolveCover(book, covers[i]));
    },

    async putBook(book) {
      const stored: Book = {
        isbn: book.isbn,
        title: book.title,
        authors: [...book.authors],
        cover_url: storableCover(book.cover_url ?? null),
        source: book.source,
      };
      const tx = (await getDb()).transaction(['books', 'covers'], 'readwrite');
      await tx.objectStore('books').put(stored);
      // Drop this ISBN's photo if the book no longer uses it.
      const ownPhoto = `${LOCAL_COVER_PREFIX}${book.isbn}`;
      let removedPhoto = false;
      if (stored.cover_url !== ownPhoto && (await tx.objectStore('covers').getKey(book.isbn))) {
        await tx.objectStore('covers').delete(book.isbn);
        removedPhoto = true;
      }
      const coverIsbn = coverIsbnOf(stored);
      const cover = coverIsbn ? await tx.objectStore('covers').get(coverIsbn) : undefined;
      await tx.done;
      if (removedPhoto) {
        revokeCoverUrl(book.isbn);
        changed('books', 'covers');
      } else {
        changed('books');
      }
      return resolveCover(stored, cover);
    },

    async saveCoverImage(isbn, image) {
      if (!(image instanceof Blob) || image.size === 0) {
        throw new DataStoreError('invalid', 'Cover image is empty.');
      }
      await (await getDb()).put('covers', { isbn, blob: image, saved_at: nowIso() });
      revokeCoverUrl(isbn);
      const url = URL.createObjectURL(image);
      coverUrls.set(isbn, url);
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
      const item: HomeItem = { id: newId(), household_id: householdId, isbn, added_at: nowIso() };
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
          library_name: loan.library_name ?? library?.name ?? null,
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

    async updateLoan(id, patch) {
      checkCalendarDate(patch.due_date, 'due_date');
      if (patch.renew_count !== undefined && (!Number.isInteger(patch.renew_count) || patch.renew_count < 0)) {
        throw new DataStoreError('invalid', 'renew_count must be a whole number >= 0.');
      }
      const tx = (await getDb()).transaction('loans', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Loan', id);
      const next: Loan = {
        ...existing,
        ...patch,
        id,
        returned_at:
          patch.returned_at === undefined ? existing.returned_at : patch.returned_at && toIso(patch.returned_at),
      };
      await tx.store.put(next);
      await tx.done;
      changed('loans');
      return next;
    },

    async returnLoan(id, returnedAt) {
      return store.updateLoan(id, { returned_at: returnedAt ?? nowIso() });
    },

    async deleteLoan(id) {
      await (await getDb()).delete('loans', id);
      changed('loans');
    },

    // Reads -----------------------------------------------------------------
    async markRead(readerId, isbn, readAt) {
      const tx = (await getDb()).transaction(['readers', 'reads'], 'readwrite');
      const reads = tx.objectStore('reads');
      const existing = await reads.get([readerId, isbn]);
      if (existing) {
        await tx.done;
        return existing;
      }
      const reader = await tx.objectStore('readers').get(readerId);
      if (!reader) throw notFound('Reader', readerId);
      const read: Read = {
        reader_id: readerId,
        household_id: reader.household_id,
        isbn,
        read_at: readAt ? toIso(readAt) : nowIso(),
      };
      await reads.add(read);
      await tx.done;
      changed('reads');
      return read;
    },

    async unmarkRead(readerId, isbn) {
      await (await getDb()).delete('reads', [readerId, isbn]);
      changed('reads');
    },

    async getRead(readerId, isbn) {
      return (await (await getDb()).get('reads', [readerId, isbn])) ?? null;
    },

    async listReads(readerId) {
      const reads = await (await getDb()).getAllFromIndex('reads', 'by_reader_read_at', prefixRange(readerId));
      return reads.reverse();
    },

    async countReadsSince(readerId, since) {
      return (await getDb()).countFromIndex('reads', 'by_reader_read_at', prefixRange(readerId, toIso(since)));
    },

    async countHouseholdReads(householdId) {
      return (await getDb()).countFromIndex('reads', 'by_household', householdId);
    },

    // Reading journeys ------------------------------------------------------
    async startJourney(readerId, journeyId, startedAt) {
      // The check and insert share one readwrite transaction, which IndexedDB
      // serialises, so two concurrent starts cannot both succeed.
      const tx = (await getDb()).transaction('reader_journeys', 'readwrite');
      const mine = await tx.store.index('by_reader_started').getAll(prefixRange(readerId));
      if (mine.some((j) => j.completed_at === null)) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new DataStoreError('conflict', 'Reader already has an active journey.');
      }
      const journey: ReaderJourney = {
        id: newId(),
        reader_id: readerId,
        journey_id: journeyId,
        started_at: startedAt ? toIso(startedAt) : nowIso(),
        completed_at: null,
      };
      await tx.store.add(journey);
      await tx.done;
      changed('reader_journeys');
      return journey;
    },

    async getActiveJourney(readerId) {
      const mine = await (await getDb()).getAllFromIndex('reader_journeys', 'by_reader_started', prefixRange(readerId));
      return mine.find((j) => j.completed_at === null) ?? null;
    },

    async listReaderJourneys(readerId) {
      const mine = await (await getDb()).getAllFromIndex('reader_journeys', 'by_reader_started', prefixRange(readerId));
      return mine.reverse();
    },

    async completeJourney(id, completedAt) {
      const tx = (await getDb()).transaction('reader_journeys', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Reader journey', id);
      const next: ReaderJourney = {
        ...existing,
        completed_at: existing.completed_at ?? (completedAt ? toIso(completedAt) : nowIso()),
      };
      await tx.store.put(next);
      await tx.done;
      changed('reader_journeys');
      return next;
    },

    async deleteReaderJourney(id) {
      await (await getDb()).delete('reader_journeys', id);
      changed('reader_journeys');
    },
  };

  return store;
}

async function deleteKeys<Name extends StoreNames<LibraryCardDB>>(
  tx: AnyTx<'readwrite'>,
  storeName: Name,
  keys: LibraryCardDB[Name]['key'][],
): Promise<void> {
  const objectStore = tx.objectStore(storeName);
  for (const key of keys) await objectStore.delete(key);
}

/** Deletes reads, loans and journeys for one reader inside an open transaction. */
async function deleteReaderData(tx: AnyTx<'readwrite'>, readerId: Id): Promise<void> {
  await deleteKeys(tx, 'reads', await tx.objectStore('reads').index('by_reader_read_at').getAllKeys(prefixRange(readerId)));
  await deleteKeys(tx, 'loans', await tx.objectStore('loans').index('by_reader').getAllKeys(readerId));
  await deleteKeys(
    tx,
    'reader_journeys',
    await tx.objectStore('reader_journeys').index('by_reader_started').getAllKeys(prefixRange(readerId)),
  );
}
