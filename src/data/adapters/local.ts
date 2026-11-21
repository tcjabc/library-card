import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import {
  DataStoreError,
  type Book,
  type DataStore,
  type HomeItem,
  type Household,
  type Id,
  type Isbn,
  type Loan,
  type Read,
  type Reader,
  type ReaderJourney,
} from '../DataStore';
import { newCardToken, newId, nowIso, toIso } from '../ids';

/**
 * Local-only adapter backed by IndexedDB. Data never leaves the device.
 */

const DB_NAME = 'library-card';
const DB_VERSION = 1;

// Highest possible string suffix for compound-key range upper bounds.
const MAX_STRING = '￿';

interface LibraryCardDB extends DBSchema {
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
  home_items: {
    key: Id;
    value: HomeItem;
    indexes: {
      by_household_isbn: [Id, Isbn];
      by_household_added: [Id, string];
    };
  };
  loans: {
    key: Id;
    value: Loan;
    indexes: {
      by_household_borrowed: [Id, string];
      by_reader: Id;
    };
  };
  reads: {
    key: [Id, Isbn];
    value: Read;
    indexes: {
      by_reader_read_at: [Id, string];
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

function openLibraryDb(name: string): Promise<DB> {
  return openDB<LibraryCardDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
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
    },
    blocked() {
      console.warn('[data/local] Database upgrade blocked by another open tab.');
    },
  });
}

/** All keys [prefix, *] in a [string, string] compound index. */
function prefixRange(prefix: string, from = ''): IDBKeyRange {
  return IDBKeyRange.bound([prefix, from], [prefix, MAX_STRING]);
}

function notFound(kind: string, id: string): DataStoreError {
  return new DataStoreError('not_found', `${kind} not found: ${id}`);
}

export async function createLocalStore(dbName = DB_NAME): Promise<DataStore> {
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

  const store: DataStore = {
    adapterName: 'local',

    // Households ------------------------------------------------------------
    async createHousehold(input) {
      const household: Household = {
        id: newId(),
        name: input.name,
        parent_pin_hash: input.parent_pin_hash ?? null,
      };
      await (await getDb()).add('households', household);
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
      return next;
    },

    async deleteHousehold(id) {
      const tx = (await getDb()).transaction(
        ['households', 'readers', 'home_items', 'loans', 'reads', 'reader_journeys'],
        'readwrite',
      );
      const readerIds = await tx.objectStore('readers').index('by_household').getAllKeys(id);
      for (const readerId of readerIds) {
        await deleteReaderData(tx, readerId);
        await tx.objectStore('readers').delete(readerId);
      }
      const homeKeys = await tx
        .objectStore('home_items')
        .index('by_household_added')
        .getAllKeys(prefixRange(id));
      for (const key of homeKeys) await tx.objectStore('home_items').delete(key);
      const loanKeys = await tx
        .objectStore('loans')
        .index('by_household_borrowed')
        .getAllKeys(prefixRange(id));
      for (const key of loanKeys) await tx.objectStore('loans').delete(key);
      await tx.objectStore('households').delete(id);
      await tx.done;
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
        if (error instanceof DOMException && error.name === 'ConstraintError') {
          throw new DataStoreError('conflict', 'card_token is already in use.');
        }
        throw error;
      }
      return reader;
    },

    async getReader(id) {
      return (await (await getDb()).get('readers', id)) ?? null;
    },

    async getReaderByCardToken(token) {
      return (await (await getDb()).getFromIndex('readers', 'by_card_token', token)) ?? null;
    },

    async listReaders(householdId) {
      return (await getDb()).getAllFromIndex('readers', 'by_household', householdId);
    },

    async updateReader(id, patch) {
      const tx = (await getDb()).transaction('readers', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Reader', id);
      const next: Reader = { ...existing, ...patch, id, household_id: existing.household_id };
      try {
        await tx.store.put(next);
        await tx.done;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'ConstraintError') {
          throw new DataStoreError('conflict', 'card_token is already in use.');
        }
        throw error;
      }
      return next;
    },

    async deleteReader(id) {
      const tx = (await getDb()).transaction(
        ['readers', 'loans', 'reads', 'reader_journeys'],
        'readwrite',
      );
      await deleteReaderData(tx, id);
      await tx.objectStore('readers').delete(id);
      await tx.done;
    },

    // Books -----------------------------------------------------------------
    async getBook(isbn) {
      return (await (await getDb()).get('books', isbn)) ?? null;
    },

    async getBooks(isbns) {
      const tx = (await getDb()).transaction('books');
      const found = await Promise.all(isbns.map((isbn) => tx.store.get(isbn)));
      await tx.done;
      return found.filter((book): book is Book => book !== undefined);
    },

    async putBook(book) {
      const clean: Book = {
        isbn: book.isbn,
        title: book.title,
        authors: [...book.authors],
        cover_url: book.cover_url ?? null,
        source: book.source,
      };
      await (await getDb()).put('books', clean);
      return clean;
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
      return item;
    },

    async getHomeItem(householdId, isbn) {
      return (
        (await (await getDb()).getFromIndex('home_items', 'by_household_isbn', [householdId, isbn])) ??
        null
      );
    },

    async listHomeItems(householdId) {
      const items = await (await getDb()).getAllFromIndex(
        'home_items',
        'by_household_added',
        prefixRange(householdId),
      );
      return items.reverse();
    },

    async removeHomeItem(id) {
      await (await getDb()).delete('home_items', id);
    },

    // Borrowed library ------------------------------------------------------
    async createLoan(input) {
      const loan: Loan = {
        id: newId(),
        household_id: input.household_id,
        reader_id: input.reader_id,
        isbn: input.isbn,
        library_name: input.library_name ?? null,
        borrowed_at: input.borrowed_at ? toIso(input.borrowed_at) : nowIso(),
        due_date: input.due_date ?? null,
        returned_at: null,
      };
      await (await getDb()).add('loans', loan);
      return loan;
    },

    async getLoan(id) {
      return (await (await getDb()).get('loans', id)) ?? null;
    },

    async listLoans(householdId, options = {}) {
      const loans = await (await getDb()).getAllFromIndex(
        'loans',
        'by_household_borrowed',
        prefixRange(householdId),
      );
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
      const tx = (await getDb()).transaction('loans', 'readwrite');
      const existing = await tx.store.get(id);
      if (!existing) throw notFound('Loan', id);
      const next: Loan = {
        ...existing,
        ...patch,
        id,
        returned_at:
          patch.returned_at === undefined
            ? existing.returned_at
            : patch.returned_at && toIso(patch.returned_at),
      };
      await tx.store.put(next);
      await tx.done;
      return next;
    },

    async returnLoan(id, returnedAt) {
      return store.updateLoan(id, { returned_at: returnedAt ?? nowIso() });
    },

    async deleteLoan(id) {
      await (await getDb()).delete('loans', id);
    },

    // Reads -----------------------------------------------------------------
    async markRead(readerId, isbn, readAt) {
      const tx = (await getDb()).transaction('reads', 'readwrite');
      const existing = await tx.store.get([readerId, isbn]);
      if (existing) {
        await tx.done;
        return existing;
      }
      const read: Read = { reader_id: readerId, isbn, read_at: readAt ? toIso(readAt) : nowIso() };
      await tx.store.add(read);
      await tx.done;
      return read;
    },

    async unmarkRead(readerId, isbn) {
      await (await getDb()).delete('reads', [readerId, isbn]);
    },

    async getRead(readerId, isbn) {
      return (await (await getDb()).get('reads', [readerId, isbn])) ?? null;
    },

    async listReads(readerId) {
      const reads = await (await getDb()).getAllFromIndex(
        'reads',
        'by_reader_read_at',
        prefixRange(readerId),
      );
      return reads.reverse();
    },

    async countReadsSince(readerId, since) {
      return (await getDb()).countFromIndex(
        'reads',
        'by_reader_read_at',
        prefixRange(readerId, toIso(since)),
      );
    },

    async countHouseholdReads(householdId) {
      const tx = (await getDb()).transaction(['readers', 'reads']);
      const readerIds = await tx.objectStore('readers').index('by_household').getAllKeys(householdId);
      const readsIndex = tx.objectStore('reads').index('by_reader_read_at');
      const counts = await Promise.all(readerIds.map((id) => readsIndex.count(prefixRange(id))));
      await tx.done;
      return counts.reduce((sum, n) => sum + n, 0);
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
      return journey;
    },

    async getActiveJourney(readerId) {
      const mine = await (await getDb()).getAllFromIndex(
        'reader_journeys',
        'by_reader_started',
        prefixRange(readerId),
      );
      return mine.find((j) => j.completed_at === null) ?? null;
    },

    async listReaderJourneys(readerId) {
      const mine = await (await getDb()).getAllFromIndex(
        'reader_journeys',
        'by_reader_started',
        prefixRange(readerId),
      );
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
      return next;
    },

    async deleteReaderJourney(id) {
      await (await getDb()).delete('reader_journeys', id);
    },
  };

  return store;
}

type ReaderDataTx = IDBPTransaction<LibraryCardDB, ArrayLike<StoreNames<LibraryCardDB>>, 'readwrite'>;

/** Deletes reads, loans and journeys for one reader inside an open transaction. */
async function deleteReaderData(tx: ReaderDataTx, readerId: Id): Promise<void> {
  const readKeys = await tx
    .objectStore('reads')
    .index('by_reader_read_at')
    .getAllKeys(prefixRange(readerId));
  for (const key of readKeys) await tx.objectStore('reads').delete(key);

  const loanKeys = await tx.objectStore('loans').index('by_reader').getAllKeys(readerId);
  for (const key of loanKeys) await tx.objectStore('loans').delete(key);

  const journeyKeys = await tx
    .objectStore('reader_journeys')
    .index('by_reader_started')
    .getAllKeys(prefixRange(readerId));
  for (const key of journeyKeys) await tx.objectStore('reader_journeys').delete(key);
}
