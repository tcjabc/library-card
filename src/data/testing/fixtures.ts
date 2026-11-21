import { openDB } from 'idb';

/**
 * Helpers for the shared storage checks: raw IndexedDB access (bypassing the
 * adapter), Blob helpers, and databases built exactly as older versions of
 * the local adapter left them.
 */

export const ISBN_A = '9780000000002';
export const ISBN_B = '9780000000019';
export const ISBN_C = '9780000000026';
export const ISBN_D = '9780000000033';

export const T = (iso: string) => new Date(iso).toISOString();

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sameBytes(a: Blob | null | undefined, b: Blob | null | undefined): Promise<boolean> {
  if (!a || !b || a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  return u.every((byte, i) => byte === v[i]);
}

/** The bytes behind a blob: URL the adapter handed out. */
export async function blobAt(url: string | null | undefined): Promise<Blob | null> {
  if (!url) return null;
  return (await fetch(url)).blob();
}

export function jpeg(...bytes: number[]): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, ...bytes])], { type: 'image/jpeg' });
}

/** Every row of one store, read without the adapter. */
export async function rawAll<T = Record<string, unknown>>(dbName: string, storeName: string): Promise<T[]> {
  const raw = await openDB(dbName);
  try {
    if (!raw.objectStoreNames.contains(storeName)) return [];
    return (await raw.getAll(storeName)) as T[];
  } finally {
    raw.close();
  }
}

export async function rawGet<T = Record<string, unknown>>(dbName: string, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const raw = await openDB(dbName);
  try {
    return (await raw.get(storeName, key)) as T | undefined;
  } finally {
    raw.close();
  }
}

export async function rawDelete(dbName: string, storeName: string, key: IDBValidKey): Promise<void> {
  const raw = await openDB(dbName);
  try {
    await raw.delete(storeName, key);
  } finally {
    raw.close();
  }
}

export async function rawStoreNames(dbName: string): Promise<{ version: number; stores: string[] }> {
  const raw = await openDB(dbName);
  const out = { version: raw.version, stores: [...raw.objectStoreNames] };
  raw.close();
  return out;
}

function openRaw(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/** A database exactly as the Phase 1 (v1) adapter left it. */
export function createV1Database(name: string): Promise<void> {
  return openRaw(name, 1, (db) => {
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
  });
}

export interface V2Fixture {
  oldHouseholdId: string;
  reads: { reader_id: string; isbn: string; read_at: string }[];
  coverA: Blob;
  coverB: Blob;
}

/** A database exactly as the Phase 2 (v2) adapter left it, with photos, reads and a second household. */
export async function createV2Database(name: string): Promise<V2Fixture> {
  const oldHouseholdId = 'hx-0000-old-household';
  const coverA = jpeg(0xe0, 10, 20, 30);
  const coverB = jpeg(0xe0, 40, 50, 60, 70);
  const reads = [
    { reader_id: 'r1', household_id: oldHouseholdId, isbn: ISBN_A, read_at: '2026-01-05T00:00:00.000Z' },
    { reader_id: 'r1', household_id: oldHouseholdId, isbn: ISBN_B, read_at: '2026-02-05T00:00:00.000Z' },
    { reader_id: 'r2', household_id: oldHouseholdId, isbn: ISBN_A, read_at: '2026-03-05T00:00:00.000Z' },
    { reader_id: 'r3', household_id: 'hy', isbn: ISBN_A, read_at: '2026-03-06T00:00:00.000Z' },
  ];
  await openRaw(name, 2, (db) => {
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
  });
  return { oldHouseholdId, reads, coverA, coverB };
}

/** Index names of one store, read without the adapter. */
export async function rawIndexNames(dbName: string, storeName: string): Promise<string[]> {
  const raw = await openDB(dbName);
  try {
    return [...raw.transaction(storeName).objectStore(storeName).indexNames];
  } finally {
    raw.close();
  }
}

export interface V3Fixture {
  loans: Record<string, unknown>[];
}

/** A database exactly as the Phase 2c (v3) adapter left it, with loans that have stickers. */
export async function createV3Database(name: string): Promise<V3Fixture> {
  const loans = [
    { id: 'loanA', household_id: 'main', reader_id: 'r1', isbn: ISBN_A, library_id: 'lib1', library_name: null, sticker_barcode: 'S1', borrowed_at: '2026-01-01T00:00:00.000Z', due_date: '2026-01-15', returned_at: null, renew_count: 0 },
    { id: 'loanB', household_id: 'main', reader_id: 'r1', isbn: ISBN_B, library_id: null, library_name: 'Free text', sticker_barcode: 'S2', borrowed_at: '2026-01-02T00:00:00.000Z', due_date: null, returned_at: null, renew_count: 1 },
    { id: 'loanC', household_id: 'main', reader_id: 'r1', isbn: ISBN_C, library_id: 'lib1', library_name: null, sticker_barcode: 'S1', borrowed_at: '2025-12-01T00:00:00.000Z', due_date: '2025-12-20', returned_at: '2025-12-19T00:00:00.000Z', renew_count: 0 },
  ];
  await openRaw(name, 3, (db) => {
    db.createObjectStore('households', { keyPath: 'id' }).add({ id: 'main', name: 'Test', parent_pin_hash: null });
    const meta = db.createObjectStore('meta', { keyPath: 'key' });
    meta.add({ key: 'current_household_id', value: 'main' });
    meta.add({ key: 'covers_rekeyed', value: true });

    const readers = db.createObjectStore('readers', { keyPath: 'id' });
    readers.createIndex('by_household', 'household_id');
    readers.createIndex('by_card_token', 'card_token', { unique: true });
    readers.add({ id: 'r1', household_id: 'main', display_name: 'A', avatar: '🦊', card_token: 'tok-r1-aaaaaaaaaaaaaa', active_journey_id: null });

    db.createObjectStore('books', { keyPath: 'isbn' }).createIndex('by_cover', 'cover_url');
    db.createObjectStore('cover_images', { keyPath: 'hash' });
    db.createObjectStore('covers', { keyPath: 'isbn' });

    const home = db.createObjectStore('home_items', { keyPath: 'id' });
    home.createIndex('by_household_isbn', ['household_id', 'isbn'], { unique: true });
    home.createIndex('by_household_added', ['household_id', 'added_at']);

    const libraries = db.createObjectStore('libraries', { keyPath: 'id' });
    libraries.createIndex('by_household', 'household_id');
    libraries.add({ id: 'lib1', household_id: 'main', name: 'Branch', search_url_template: null, homepage_url: null, default_loan_days: 14, sticker_prefix: 'S' });

    const loanStore = db.createObjectStore('loans', { keyPath: 'id' });
    loanStore.createIndex('by_household_borrowed', ['household_id', 'borrowed_at']);
    loanStore.createIndex('by_reader', 'reader_id');
    loanStore.createIndex('by_library', 'library_id');
    loanStore.createIndex('by_household_sticker', ['household_id', 'sticker_barcode']);
    for (const loan of loans) loanStore.add(loan);

    const events = db.createObjectStore('read_events', { keyPath: 'id' });
    events.createIndex('by_reader_isbn_read_at', ['reader_id', 'isbn', 'read_at']);
    events.createIndex('by_reader_read_at', ['reader_id', 'read_at']);
    events.createIndex('by_household', 'household_id');
    events.add({ id: 'e1', household_id: 'main', reader_id: 'r1', isbn: ISBN_A, read_at: '2026-01-05T00:00:00.000Z' });

    const summaries = db.createObjectStore('read_summaries', { keyPath: ['reader_id', 'isbn'] });
    summaries.createIndex('by_reader_first', ['reader_id', 'first_read_at']);
    summaries.createIndex('by_reader_last', ['reader_id', 'last_read_at']);
    summaries.createIndex('by_household', 'household_id');
    summaries.add({ reader_id: 'r1', isbn: ISBN_A, household_id: 'main', first_read_at: '2026-01-05T00:00:00.000Z', last_read_at: '2026-01-05T00:00:00.000Z', count: 1 });

    db.createObjectStore('reader_journeys', { keyPath: 'id' }).createIndex('by_reader_started', ['reader_id', 'started_at']);
  });
  return { loans };
}
