import {
  HOUSEHOLD_ID,
  type Book,
  type CalendarDate,
  type HomeItem,
  type Household,
  type Library,
  type LibraryCard,
  type Loan,
  type ReadEvent,
  type Reader,
  type ReaderJourney,
  type ReaderKind,
  type Timestamp,
} from './DataStore';
import { checkLibraryCardBarcode } from './libraryCardRules';

/**
 * Backup files: the format, a validator and small helpers. Pure (no storage),
 * so it is unit-tested directly; the adapters use it to export and import.
 *
 *   {
 *     format: "library-card-backup", version: 1,
 *     schema: <the IndexedDB version that wrote it>, exported_at,
 *     tables: { households, readers, books, home_items, libraries, library_cards, loans, read_events,
 *               reader_journeys },
 *     covers: { "cover:<sha256>": "<base64>" }
 *   }
 *
 * read_summaries are derived from read_events, so they are rebuilt on import
 * rather than exported. library_cards came later (schema 6): a backup without it restores with
 * no library cards.
 */

export const BACKUP_FORMAT = 'library-card-backup';
export const BACKUP_VERSION = 1;

export const BACKUP_TABLES = [
  'households',
  'readers',
  'books',
  'home_items',
  'libraries',
  'library_cards',
  'loans',
  'read_events',
  'reader_journeys',
] as const;

/** Tables added after the first backups: a file without one restores it empty. */
const OPTIONAL_TABLES: readonly BackupTable[] = ['library_cards'];
export type BackupTable = (typeof BACKUP_TABLES)[number];

/** A reader as stored: files from before reader kinds and checks have neither (a child who needs the check). */
export type BackupReader = Omit<Reader, 'kind' | 'needs_check'> & { kind?: ReaderKind | null; needs_check?: boolean | null };
/** A read as stored: files from before checked reads have no status (confirmed). */
export type BackupReadEvent = Omit<ReadEvent, 'how' | 'status' | 'confirmed_at' | 'confirmed_by'> &
  Partial<Pick<ReadEvent, 'how' | 'status' | 'confirmed_at' | 'confirmed_by'>>;

export interface BackupTables {
  households: Household[];
  readers: BackupReader[];
  books: Book[];
  home_items: HomeItem[];
  libraries: Library[];
  library_cards: LibraryCard[];
  loans: Loan[];
  read_events: BackupReadEvent[];
  reader_journeys: ReaderJourney[];
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  schema: number;
  exported_at: Timestamp;
  tables: BackupTables;
  /** Cover photos by reference ("cover:<sha256 hex>"), base64-encoded. */
  covers: Record<string, string>;
}

export interface BackupSummary {
  readers: number;
  books: number;
  homeBooks: number;
  loans: number;
  reads: number;
  covers: number;
}

/** Why a file isn't a usable backup. Each has friendly text in en.ts (strings.grownups.settings.restoreProblems). */
export type BackupProblem =
  | 'not_json'
  | 'wrong_format'
  | 'newer_version'
  | 'missing_table'
  | 'bad_row'
  | 'duplicate'
  | 'no_household'
  | 'bad_reference'
  | 'bad_cover'
  | 'missing_cover';

export type BackupCheck = { ok: true; backup: Backup } | { ok: false; problem: BackupProblem; detail?: string };

// --- Validation ---------------------------------------------------------------

type FieldKind = 'string' | 'string?' | 'number' | 'strings' | 'boolean?';

/** Required fields per table; nullable ("string?") fields may also be missing and become null. */
const FIELDS: Record<BackupTable, Record<string, FieldKind>> = {
  households: { id: 'string', name: 'string', parent_pin_hash: 'string?', time_zone: 'string?' },
  readers: {
    id: 'string',
    household_id: 'string',
    display_name: 'string',
    kind: 'string?',
    needs_check: 'boolean?',
    avatar: 'string',
    card_token: 'string',
    active_journey_id: 'string?',
  },
  books: { isbn: 'string', title: 'string', authors: 'strings', cover_url: 'string?', source: 'string' },
  home_items: { id: 'string', household_id: 'string', isbn: 'string', added_at: 'string' },
  libraries: {
    id: 'string',
    household_id: 'string',
    name: 'string',
    search_url_template: 'string?',
    homepage_url: 'string?',
    default_loan_days: 'number',
    sticker_prefix: 'string?',
  },
  library_cards: {
    id: 'string',
    household_id: 'string',
    reader_id: 'string',
    library_id: 'string?',
    library_name: 'string?',
    value: 'string',
    format: 'string',
    label: 'string?',
    created_at: 'string',
  },
  loans: {
    id: 'string',
    household_id: 'string',
    reader_id: 'string',
    isbn: 'string',
    library_id: 'string?',
    library_name: 'string?',
    sticker_barcode: 'string?',
    borrowed_at: 'string',
    due_date: 'string?',
    returned_at: 'string?',
    renew_count: 'number',
  },
  read_events: {
    id: 'string',
    household_id: 'string',
    reader_id: 'string',
    isbn: 'string',
    read_at: 'string',
    how: 'string?',
    status: 'string?',
    confirmed_at: 'string?',
    confirmed_by: 'string?',
  },
  reader_journeys: {
    id: 'string',
    reader_id: 'string',
    journey_id: 'string',
    started_at: 'string',
    completed_at: 'string?',
    abandoned_at: 'string?',
  },
};

/** The key each table is stored under (must be unique). */
const KEY_FIELD: Record<BackupTable, string> = {
  households: 'id',
  readers: 'id',
  books: 'isbn',
  home_items: 'id',
  libraries: 'id',
  library_cards: 'id',
  loans: 'id',
  read_events: 'id',
  reader_journeys: 'id',
};

const COVER_REF = /^cover:[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

class Problem extends Error {
  constructor(
    readonly problem: BackupProblem,
    readonly detail?: string,
  ) {
    super(problem);
  }
}

function checkRow(table: BackupTable, row: unknown, index: number): Record<string, unknown> {
  const where = `${table}[${index}]`;
  if (!isObject(row)) throw new Problem('bad_row', where);
  const out: Record<string, unknown> = { ...row };
  for (const [field, kind] of Object.entries(FIELDS[table])) {
    const value = row[field];
    const fine =
      kind === 'string'
        ? typeof value === 'string' && value !== ''
        : kind === 'string?'
          ? value === undefined || value === null || typeof value === 'string'
          : kind === 'boolean?'
            ? value === undefined || value === null || typeof value === 'boolean'
            : kind === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : Array.isArray(value) && value.every((v) => typeof v === 'string');
    if (!fine) throw new Problem('bad_row', `${where}.${field}`);
    if ((kind === 'string?' || kind === 'boolean?') && value === undefined) out[field] = null;
  }
  return out;
}

export interface ValidateOptions {
  /** The newest IndexedDB schema this app understands; a backup from a newer one is refused. */
  maxSchema?: number;
}

/**
 * Checks that `data` is a backup this app can restore, and returns it with
 * missing nullable fields filled in as null. Checks the format and version,
 * every required field, unique keys and card tokens, that the household is
 * there, that loans, reads, journeys and library cards belong to readers in the file, and
 * that every cover photo a book uses is included and is valid base64.
 */
export function validateBackup(data: unknown, options: ValidateOptions = {}): BackupCheck {
  try {
    return { ok: true, backup: validate(data, options.maxSchema ?? Infinity) };
  } catch (error) {
    if (error instanceof Problem) return { ok: false, problem: error.problem, detail: error.detail };
    throw error;
  }
}

function validate(data: unknown, maxSchema: number): Backup {
  if (!isObject(data) || data.format !== BACKUP_FORMAT) throw new Problem('wrong_format');
  const { version, schema, exported_at } = data;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new Problem('wrong_format', 'version');
  if (version > BACKUP_VERSION) throw new Problem('newer_version', `version ${version}`);
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) throw new Problem('wrong_format', 'schema');
  if (schema > maxSchema) throw new Problem('newer_version', `schema ${schema}`);
  if (typeof exported_at !== 'string' || Number.isNaN(Date.parse(exported_at))) throw new Problem('wrong_format', 'exported_at');
  if (!isObject(data.tables)) throw new Problem('missing_table', 'tables');
  if (!isObject(data.covers)) throw new Problem('bad_cover', 'covers');

  const tables = {} as Record<BackupTable, Record<string, unknown>[]>;
  for (const table of BACKUP_TABLES) {
    const rows = data.tables[table] === undefined && OPTIONAL_TABLES.includes(table) ? [] : data.tables[table];
    if (!Array.isArray(rows)) throw new Problem('missing_table', table);
    tables[table] = rows.map((row, i) => checkRow(table, row, i));
    const keys = new Set<unknown>();
    for (const row of tables[table]) {
      const key = row[KEY_FIELD[table]];
      if (keys.has(key)) throw new Problem('duplicate', `${table} ${String(key)}`);
      keys.add(key);
    }
  }

  if (!tables.households.some((h) => h.id === HOUSEHOLD_ID)) throw new Problem('no_household');
  const tokens = new Set<unknown>();
  for (const reader of tables.readers) {
    if (tokens.has(reader.card_token)) throw new Problem('duplicate', 'card_token');
    tokens.add(reader.card_token);
  }
  // Reads from before checked reads have no status (null: confirmed).
  tables.read_events.forEach((event, i) => {
    if (![null, 'self', 'help'].includes(event.how as string | null)) throw new Problem('bad_row', `read_events[${i}].how`);
    if (![null, 'pending', 'confirmed'].includes(event.status as string | null)) throw new Problem('bad_row', `read_events[${i}].status`);
  });
  // Backups from before reader kinds have none (null: a child).
  tables.readers.forEach((reader, i) => {
    if (reader.kind !== null && reader.kind !== 'child' && reader.kind !== 'grown_up') throw new Problem('bad_row', `readers[${i}].kind`);
  });
  const readerIds = new Set(tables.readers.map((r) => r.id));
  for (const table of ['loans', 'read_events', 'reader_journeys', 'library_cards'] as const) {
    tables[table].forEach((row, i) => {
      if (!readerIds.has(row.reader_id)) throw new Problem('bad_reference', `${table}[${i}].reader_id`);
    });
  }
  // A card's number must fit its barcode type. A library_id whose library isn't in the file is
  // allowed: the card shows its saved library name, as it would after a sync.
  tables.library_cards.forEach((row, i) => {
    const check = checkLibraryCardBarcode(row.value as string, row.format as string);
    if (!check.ok || check.value !== row.value) throw new Problem('bad_row', `library_cards[${i}].value`);
  });

  const covers: Record<string, string> = {};
  for (const [ref, value] of Object.entries(data.covers)) {
    if (!COVER_REF.test(ref) || typeof value !== 'string' || !BASE64.test(value)) throw new Problem('bad_cover', ref);
    covers[ref] = value;
  }
  tables.books.forEach((book, i) => {
    const ref = book.cover_url as string | null;
    if (ref === null || /^https?:\/\//.test(ref)) return;
    if (!COVER_REF.test(ref)) throw new Problem('bad_row', `books[${i}].cover_url`);
    if (!(ref in covers)) throw new Problem('missing_cover', ref);
  });

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schema,
    exported_at,
    tables: tables as unknown as BackupTables,
    covers,
  };
}

/** JSON text (e.g. a picked file) -> a checked backup. */
export function parseBackupText(text: string, options?: ValidateOptions): BackupCheck {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'not_json' };
  }
  return validateBackup(data, options);
}

// --- Summary and helpers --------------------------------------------------------

/** Counts for the restore preview. */
export function summariseBackup(backup: Backup): BackupSummary {
  const { tables } = backup;
  return {
    readers: tables.readers.length,
    books: tables.books.length,
    homeBooks: tables.home_items.length,
    loans: tables.loans.length,
    reads: tables.read_events.length,
    covers: Object.keys(backup.covers).length,
  };
}

/** "library-card-backup-2026-11-22.json" */
export function backupFileName(date: CalendarDate): string {
  return `library-card-backup-${date}.json`;
}

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Throws on text that isn't base64. */
export function base64ToBytes(text: string): Uint8Array {
  if (!BASE64.test(text)) throw new Error('Not base64.');
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The image type from a file's first bytes, for cover photos restored without one. */
export function sniffImageType(bytes: Uint8Array): string {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (starts(0x47, 0x49, 0x46)) return 'image/gif';
  return 'application/octet-stream';
}
