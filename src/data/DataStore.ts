/**
 * Storage contract for Library Card.
 *
 * Every backend (local IndexedDB, Supabase, Cloudflare D1, ...) implements
 * this interface. It deliberately uses only plain JSON-friendly types so that
 * no backend-specific types leak into feature code.
 *
 * Conventions:
 * - All ids are opaque strings (adapters use UUIDs).
 * - All timestamps are ISO 8601 strings in UTC, e.g. "2026-01-31T09:15:00.000Z",
 *   so they sort correctly as strings. Calendar dates without a time
 *   ("due_date") are "YYYY-MM-DD" in the household's local time.
 *   "Since" queries take an instant; build local-time boundaries such as
 *   "start of today" with src/lib/dates.ts.
 * - Books are keyed by a "book key": a normalised ISBN-13 (digits only), or
 *   "noisbn-<id>" for a book without one. Fields named `isbn` hold a book key.
 * - There is one household per device, with the id HOUSEHOLD_ID ("main"), so
 *   devices that later sync together share it without remapping.
 * - Optional fields are stored as `null` when absent.
 * - "get" methods resolve to `null` when nothing matches. Mutations on a
 *   missing record reject with a DataStoreError of code "not_found".
 * - Every successful write notifies subscribers (see subscribe()).
 */

import type { Backup, BackupSummary } from './backup';

export type Id = string;
/** ISO 8601 timestamp in UTC. */
export type Timestamp = string;
/** Calendar date, "YYYY-MM-DD". */
export type CalendarDate = string;
/** Normalised ISBN-13, digits only. */
export type Isbn = string;
/** ISBN-13, or "noisbn-<id>" for a book without an ISBN. */
export type BookKey = string;

/** The id of the one household on each device. */
export const HOUSEHOLD_ID = 'main';

export interface Household {
  id: Id;
  name: string;
  /** Output of hashPin() in src/data/pin.ts, or null if no PIN is set. Never the PIN itself. */
  parent_pin_hash: string | null;
  /**
   * IANA time zone "today" is counted in (due chips, renewals…), e.g. "Asia/Taipei". Missing or
   * null: the device's zone. Set when sync starts or a device joins, or in Settings.
   */
  time_zone?: string | null;
}

export interface Reader {
  id: Id;
  household_id: Id;
  display_name: string;
  /** Avatar key (an emoji). Not a photo. */
  avatar: string;
  /** Unguessable token (>= 128 random bits, base64url) encoded in the reader's QR card. Unique. */
  card_token: string;
  /**
   * The reader's current journey (a reader_journeys id), or null. One field,
   * so "at most one active journey" holds even when devices sync later.
   */
  active_journey_id: Id | null;
}

export type BookSource = 'openlibrary' | 'google' | 'manual';

export interface Book {
  isbn: Isbn;
  title: string;
  authors: string[];
  /**
   * Display URL for the cover, or null. May be session-scoped (e.g. a blob:
   * URL for a photo stored on the device): render it, but don't copy it into
   * other storage. Passing it back to putBook() unchanged is fine.
   */
  cover_url: string | null;
  source: BookSource;
}

export interface HomeItem {
  /** The book key, so a household holds each book once. */
  id: BookKey;
  household_id: Id;
  isbn: BookKey;
  added_at: Timestamp;
}

export interface Library {
  id: Id;
  household_id: Id;
  name: string;
  /** Catalogue search URL with an {isbn} placeholder, e.g. "https://example.org/search?q={isbn}". */
  search_url_template: string | null;
  homepage_url: string | null;
  /** Used to suggest a due date when a loan is created. */
  default_loan_days: number;
  /** Library stickers start with this, used to tell them from other barcodes. */
  sticker_prefix: string | null;
}

export interface Loan {
  id: Id;
  household_id: Id;
  reader_id: Id;
  isbn: Isbn;
  library_id: Id | null;
  /** Free-text library name, used when the loan isn't linked to a Library. */
  library_name: string | null;
  /** The library's own barcode sticker on the book, if scanned. */
  sticker_barcode: string | null;
  borrowed_at: Timestamp;
  due_date: CalendarDate | null;
  returned_at: Timestamp | null;
  renew_count: number;
}

/** One "I read this!" tap. A book can be read many times. */
export interface ReadEvent {
  id: Id;
  /** Denormalised from the reader so household totals are indexed. */
  household_id: Id;
  reader_id: Id;
  isbn: BookKey;
  read_at: Timestamp;
}

/**
 * Derived from a reader's events for one book and kept up to date with every
 * event change. A reader has read a book when a summary exists.
 */
export interface ReadSummary {
  reader_id: Id;
  isbn: BookKey;
  household_id: Id;
  /** The earliest read. Journey progress and the household staircase count first reads. */
  first_read_at: Timestamp;
  last_read_at: Timestamp;
  /** Number of read events, 1 or more. */
  count: number;
}

export interface ReaderJourney {
  id: Id;
  reader_id: Id;
  /** Id of a Journey definition from src/journeys/journeys.ts. */
  journey_id: string;
  started_at: Timestamp;
  /** Set once the journey is finished. Permanent: undoing reads never clears it. */
  completed_at: Timestamp | null;
  /** Set when the reader switched to another journey before finishing this one. */
  abandoned_at: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type HouseholdPatch = Partial<Omit<Household, 'id'>>;

/** card_token is generated by the adapter when omitted. */
export type NewReader = Pick<Reader, 'household_id' | 'display_name' | 'avatar'> &
  Partial<Pick<Reader, 'card_token'>>;
export type ReaderPatch = Partial<Pick<Reader, 'display_name' | 'avatar'>>;

export type NewLibrary = Pick<Library, 'household_id' | 'name'> &
  Partial<Pick<Library, 'search_url_template' | 'homepage_url' | 'default_loan_days' | 'sticker_prefix'>>;
export type LibraryPatch = Partial<Omit<Library, 'id' | 'household_id'>>;

export type NewLoan = Pick<Loan, 'household_id' | 'reader_id' | 'isbn'> &
  Partial<Pick<Loan, 'library_id' | 'library_name' | 'sticker_barcode' | 'borrowed_at' | 'due_date'>>;
export type LoanPatch = Partial<
  Pick<
    Loan,
    | 'isbn'
    | 'library_id'
    | 'library_name'
    | 'sticker_barcode'
    | 'borrowed_at'
    | 'due_date'
    | 'returned_at'
    | 'reader_id'
    | 'renew_count'
  >
>;

export interface ListLoansOptions {
  /** true: only loans not yet returned. false: only returned. Omitted: all. */
  active?: boolean;
  reader_id?: Id;
}

/** What deleteReader() would remove, for the confirm. */
export interface DeleteReaderPreview {
  /** Read events ("I read this!" taps). */
  readEvents: number;
  /** Different books read. */
  booksRead: number;
  journeys: number;
  returnedLoans: number;
  /** Loans not yet returned. deleteReader() refuses while this is above 0. */
  activeLoans: number;
}

/** Loan length when a library sets none, or a loan has no library. */
export const DEFAULT_LOAN_DAYS = 30;

/** A second "I read this!" on the same book by the same reader within this window is ignored. */
export const READ_TAP_GUARD_MS = 10_000;

/** Largest cover photo saveCoverImage accepts (older photos and backups may be this large). */
export const MAX_COVER_BYTES = 512 * 1024;

/**
 * New cover photos are re-encoded to at most this, so every one still fits the sync relay's
 * 512 KB limit once sealed and padded to its 16 KB size bucket (src/sync/photos.ts).
 */
export const COVER_TARGET_BYTES = 480 * 1024;

// ---------------------------------------------------------------------------
// Change notifications
// ---------------------------------------------------------------------------

export type DataTable =
  | 'households'
  | 'readers'
  | 'books'
  | 'covers'
  | 'home_items'
  | 'libraries'
  | 'loans'
  /** Read events; read summaries change with them. */
  | 'read_events'
  | 'reader_journeys';

export interface DataChange {
  /** Tables touched by the write. */
  tables: DataTable[];
  /** false for writes made in this tab, true for writes from another tab or device. */
  remote: boolean;
}

export type DataChangeListener = (change: DataChange) => void;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type DataStoreErrorCode =
  | 'not_found'
  /** A uniqueness rule would be broken, e.g. a duplicate card token. */
  | 'conflict'
  /** Not allowed while other data depends on it, e.g. deleting a reader with active loans. */
  | 'blocked'
  /** Not allowed while sync is on, e.g. restoring a backup (the sync adapter only). */
  | 'sync_enabled'
  | 'invalid'
  | 'unavailable';

export class DataStoreError extends Error {
  readonly code: DataStoreErrorCode;

  constructor(code: DataStoreErrorCode, message: string) {
    super(message);
    this.name = 'DataStoreError';
    this.code = code;
  }
}

export function isDataStoreError(error: unknown, code?: DataStoreErrorCode): error is DataStoreError {
  return error instanceof DataStoreError && (code === undefined || error.code === code);
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface DataStore {
  /** Short adapter name, e.g. "local". For diagnostics only. */
  readonly adapterName: string;

  /**
   * Calls listener after every successful write, including writes from other
   * tabs (and, for synced backends, other devices). Returns an unsubscribe function.
   */
  subscribe(listener: DataChangeListener): () => void;

  // Household ---------------------------------------------------------------
  /** This device's household (id HOUSEHOLD_ID), created on first use. */
  getCurrentHousehold(): Promise<Household>;
  getHousehold(id: Id): Promise<Household | null>;
  /** A name is trimmed and must not be empty ("invalid"). */
  updateHousehold(id: Id, patch: HouseholdPatch): Promise<Household>;

  // Readers -----------------------------------------------------------------
  createReader(input: NewReader): Promise<Reader>;
  getReader(id: Id): Promise<Reader | null>;
  getReaderByCardToken(token: string): Promise<Reader | null>;
  listReaders(householdId: Id): Promise<Reader[]>;
  updateReader(id: Id, patch: ReaderPatch): Promise<Reader>;
  /** Issues a new card token. The old card stops working immediately. */
  rotateCardToken(readerId: Id): Promise<Reader>;
  /**
   * Deletes the reader with their read events, read summaries, journeys and
   * returned loans (one delete per row, one transaction). Rejects with
   * "blocked" while the reader has loans not yet returned.
   */
  deleteReader(id: Id): Promise<void>;
  /** Counts what deleteReader() would remove, without deleting. "not_found" for an unknown reader. */
  previewDeleteReader(id: Id): Promise<DeleteReaderPreview>;

  // Books (shared metadata cache, not owned by a household) -----------------
  getBook(isbn: Isbn): Promise<Book | null>;
  /** Missing ISBNs are simply absent from the result. */
  getBooks(isbns: Isbn[]): Promise<Book[]>;
  /** Insert or replace. */
  putBook(book: Book): Promise<Book>;
  /**
   * Stores a cover photo (at most MAX_COVER_BYTES) and returns a cover_url to
   * save on a book with putBook(). Photos are kept by content (SHA-256), so the
   * same image is stored once. Does not change any book.
   */
  saveCoverImage(image: Blob): Promise<string>;

  // Home library (one row per household + ISBN) ------------------------------
  /** Idempotent: adding an ISBN already in the household returns the existing item. */
  addHomeItem(householdId: Id, isbn: Isbn): Promise<HomeItem>;
  getHomeItem(householdId: Id, isbn: Isbn): Promise<HomeItem | null>;
  /** Newest first. */
  listHomeItems(householdId: Id): Promise<HomeItem[]>;
  /** Removes the book from Home only (the id is its book key). The book and every read of it are kept. */
  removeHomeItem(id: Id): Promise<void>;

  // Libraries (the places loans come from) ----------------------------------
  createLibrary(input: NewLibrary): Promise<Library>;
  getLibrary(id: Id): Promise<Library | null>;
  /** Sorted by name. */
  listLibraries(householdId: Id): Promise<Library[]>;
  updateLibrary(id: Id, patch: LibraryPatch): Promise<Library>;
  /**
   * Loans that pointed at the library are kept: library_id becomes null and
   * the library's name is copied to library_name (one write per loan).
   */
  deleteLibrary(id: Id): Promise<void>;

  // Borrowed library --------------------------------------------------------
  /** Rejects with "not_found" for an unknown reader or library. */
  createLoan(input: NewLoan): Promise<Loan>;
  getLoan(id: Id): Promise<Loan | null>;
  /** Newest borrowed first. */
  listLoans(householdId: Id, options?: ListLoansOptions): Promise<Loan[]>;
  /** The reader's loans not yet returned, soonest due first (no due date last). */
  listActiveLoans(readerId: Id): Promise<Loan[]>;
  /** The reader's returned loans, most recently returned first. */
  listReturnedLoans(readerId: Id): Promise<Loan[]>;
  /**
   * Active loans anywhere in the household with this library sticker, any
   * library. More than one means a duplicate: see pickStickerWinner().
   */
  findActiveLoansBySticker(householdId: Id, sticker: string): Promise<Loan[]>;
  /**
   * Edit a loan (grown-ups). reader_id, library_id and isbn must exist ("not_found"; isbn is a
   * saved book's key). borrowed_at and returned_at are timestamps (returned_at null makes the loan
   * active again), due_date YYYY-MM-DD or null, sticker_barcode trimmed text (empty clears it),
   * renew_count a whole number of 0 or more ("invalid" otherwise). Reads are never touched.
   */
  updateLoan(id: Id, patch: LoanPatch): Promise<Loan>;
  /**
   * Adds the library's default_loan_days (DEFAULT_LOAN_DAYS without a library)
   * to the due date (today when there is none) and counts the renewal.
   * Rejects with "invalid" for a returned loan.
   */
  renewLoan(id: Id): Promise<Loan>;
  /** Undoes renewLoan: puts the previous due date back and takes one off renew_count. */
  unrenewLoan(id: Id, previousDueDate: CalendarDate | null): Promise<Loan>;
  /** Shorthand for updateLoan(id, { returned_at }). Defaults to now. */
  returnLoan(id: Id, returnedAt?: Timestamp): Promise<Loan>;
  /** Undoes returnLoan: the loan is active again. */
  unreturnLoan(id: Id): Promise<Loan>;
  deleteLoan(id: Id): Promise<void>;

  // Reads ("I read this!") --------------------------------------------------
  /**
   * Adds one read event and returns it. Every call adds a new event (re-reads
   * count), except that without `readAt` a call within READ_TAP_GUARD_MS of
   * this reader's latest read of the book is ignored and returns null.
   */
  markRead(readerId: Id, isbn: BookKey, readAt?: Timestamp): Promise<ReadEvent | null>;
  /**
   * Removes the reader's latest event for the book (latest read_at, then id)
   * and returns it, or null if there is none.
   */
  undoLatestRead(readerId: Id, isbn: BookKey): Promise<ReadEvent | null>;
  /**
   * Deletes every read event of this reader for the book, and its summary, in
   * one transaction. Returns how many events were removed. Journeys already
   * completed stay completed.
   */
  clearReads(readerId: Id, isbn: BookKey): Promise<number>;
  /** Puts a removed event back with the same id (for Undo). */
  restoreReadEvent(event: ReadEvent): Promise<ReadEvent>;
  getReadSummary(readerId: Id, isbn: BookKey): Promise<ReadSummary | null>;
  /** One per book the reader has read; most recently read first. */
  listReadSummaries(readerId: Id): Promise<ReadSummary[]>;
  /** Newest first; all books, or one book when `isbn` is given. */
  listReadEvents(readerId: Id, isbn?: BookKey): Promise<ReadEvent[]>;
  /**
   * Distinct books whose FIRST read is at or after `since`; re-reads of books
   * first read earlier are not counted. Journey progress is this with the
   * journey's started_at. Use src/lib/dates.ts for local-time boundaries.
   */
  countReadsSince(readerId: Id, since: Timestamp): Promise<number>;
  /** Distinct (reader, book) pairs with at least one read: the Household Journey. */
  countHouseholdReads(householdId: Id): Promise<number>;
  /** Every reader's summaries in the household (the Family Staircase), in no particular order. */
  listHouseholdReadSummaries(householdId: Id): Promise<ReadSummary[]>;

  // Reading journeys --------------------------------------------------------
  /**
   * Starts a journey and makes it the reader's active_journey_id. A journey
   * that was still active is stopped first (abandoned_at is set), all in one
   * transaction.
   */
  startJourney(readerId: Id, journeyId: string, startedAt?: Timestamp): Promise<ReaderJourney>;
  /**
   * The journey readers.active_journey_id points to, or null if it is unset,
   * missing, completed or abandoned.
   */
  getActiveJourney(readerId: Id): Promise<ReaderJourney | null>;
  /** Every journey the reader started, newest first: active, completed and abandoned. */
  listJourneyHistory(readerId: Id): Promise<ReaderJourney[]>;
  /** How many times the reader completed each journey: journey_id -> count. */
  countCompletedJourneys(readerId: Id): Promise<Record<string, number>>;
  /**
   * Sets completed_at (the first completion is kept) and clears the reader's
   * active_journey_id if it pointed here. Permanent.
   */
  completeJourney(id: Id, completedAt?: Timestamp): Promise<ReaderJourney>;
  /** Removes a journey (e.g. a reader switches before finishing) and clears the pointer to it. */
  deleteReaderJourney(id: Id): Promise<void>;

  // Backup and reset --------------------------------------------------------
  /**
   * Everything on this device as a backup (see src/data/backup.ts): every
   * table except read_summaries, and each cover photo a book uses.
   */
  exportBackup(): Promise<Backup>;
  /**
   * Checks `data` with validateBackup() ("invalid" if it fails, or a photo
   * doesn't match its hash), then replaces ALL local data with it in one
   * transaction and rebuilds read_summaries. Returns the restored counts.
   */
  importBackup(data: unknown): Promise<BackupSummary>;
  /** Deletes all local data, including the household. getCurrentHousehold() then starts afresh. */
  resetDevice(): Promise<void>;
}
