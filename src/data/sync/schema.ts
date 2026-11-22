import { HOUSEHOLD_ID } from '../DataStore';
import { DELETED, isFieldName, isOp, type JsonValue, type Op } from '../../sync/vendor/sync-core.js';

/**
 * The sync wire schema: which tables sync, how their records are named, which fields travel and
 * what each may hold. Pure (no storage), so every rule is unit-tested.
 *
 * - A record's wire id is "<table>:<local id>", e.g. "readers:7c0e…" or "books:9780000000002".
 * - household_id is implied (one household per device, "main") and never sent; the local key
 *   (id, or isbn for books) is in the wire id, not a field.
 * - read_summaries are derived from read_events; cover photo bytes and meta never sync.
 * - Unknown but well-formed fields are kept in records (a newer version may have added them) and
 *   ignored by the views. Known fields must have the right type and size.
 */

export const SYNCED_TABLES = [
  'households',
  'readers',
  'books',
  'home_items',
  'libraries',
  'loans',
  'read_events',
  'reader_journeys',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export const isSyncedTable = (name: string): name is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(name);

type Kind =
  | { type: 'text'; max: number; pattern?: RegExp }
  | { type: 'id' }
  | { type: 'bookKey' }
  | { type: 'timestamp' }
  | { type: 'date' }
  | { type: 'int'; min: number; max: number }
  | { type: 'texts'; maxItems: number; max: number };

interface FieldSpec {
  kind: Kind;
  /** Must be present (and not null) for the row to be visible. */
  required?: boolean;
  /** May be null. Optional fields that are missing read as null. */
  nullable?: boolean;
}

interface TableSpec {
  /** The local key field (it is the second part of the wire id). */
  key: 'id' | 'isbn';
  /** Whether rows carry household_id (implied "main"; never sent). */
  household: boolean;
  /** Which local ids are allowed. */
  localId: 'household' | 'id' | 'bookKey';
  /** A field naming the parent reader: the row is hidden unless that reader is visible. */
  parentReader?: string;
  fields: Record<string, FieldSpec>;
}

const LOCAL_ID = /^[A-Za-z0-9_-]{1,40}$/;
const BOOK_KEY = /^(\d{13}|noisbn-[A-Za-z0-9_-]{1,40})$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (max: number, extra: Partial<FieldSpec> = {}, pattern?: RegExp): FieldSpec => ({ kind: { type: 'text', max, pattern }, ...extra });
const nullableText = (max: number) => text(max, { nullable: true });
const id = (extra: Partial<FieldSpec> = {}): FieldSpec => ({ kind: { type: 'id' }, ...extra });
const bookKey = (extra: Partial<FieldSpec> = {}): FieldSpec => ({ kind: { type: 'bookKey' }, ...extra });
const timestamp = (extra: Partial<FieldSpec> = {}): FieldSpec => ({ kind: { type: 'timestamp' }, ...extra });
const REQUIRED = { required: true };
const NULLABLE = { nullable: true };

export const SCHEMA: Record<SyncedTable, TableSpec> = {
  households: {
    key: 'id',
    household: false,
    localId: 'household',
    fields: { name: text(200, REQUIRED), parent_pin_hash: nullableText(300), time_zone: nullableText(64) },
  },
  readers: {
    key: 'id',
    household: true,
    localId: 'id',
    fields: {
      display_name: text(200, REQUIRED),
      avatar: text(32, REQUIRED),
      // Any non-empty text: older data and tests have short tokens, and the local adapter accepts them.
      card_token: text(200, REQUIRED),
      active_journey_id: id(NULLABLE),
    },
  },
  books: {
    key: 'isbn',
    household: false,
    localId: 'bookKey',
    fields: {
      title: text(1000, REQUIRED),
      authors: { kind: { type: 'texts', maxItems: 50, max: 300 }, required: true },
      // A "cover:<sha256>" reference (the photo itself syncs separately, later) or a web address.
      cover_url: nullableText(4096),
      // Free text rather than a fixed list, so a source added later isn't refused by older devices.
      source: text(32, REQUIRED),
    },
  },
  home_items: {
    key: 'id',
    household: true,
    localId: 'bookKey',
    fields: { isbn: bookKey(REQUIRED), added_at: timestamp(REQUIRED) },
  },
  libraries: {
    key: 'id',
    household: true,
    localId: 'id',
    fields: {
      name: text(200, REQUIRED),
      search_url_template: nullableText(4096),
      homepage_url: nullableText(4096),
      default_loan_days: { kind: { type: 'int', min: 1, max: 3650 }, required: true },
      sticker_prefix: nullableText(64),
    },
  },
  loans: {
    key: 'id',
    household: true,
    localId: 'id',
    parentReader: 'reader_id',
    fields: {
      reader_id: id(REQUIRED),
      isbn: bookKey(REQUIRED),
      library_id: id(NULLABLE),
      library_name: nullableText(300),
      sticker_barcode: nullableText(200),
      borrowed_at: timestamp(REQUIRED),
      due_date: { kind: { type: 'date' }, nullable: true },
      returned_at: timestamp(NULLABLE),
      renew_count: { kind: { type: 'int', min: 0, max: 100_000 }, required: true },
    },
  },
  read_events: {
    key: 'id',
    household: true,
    localId: 'id',
    parentReader: 'reader_id',
    fields: { reader_id: id(REQUIRED), isbn: bookKey(REQUIRED), read_at: timestamp(REQUIRED) },
  },
  reader_journeys: {
    key: 'id',
    household: false,
    localId: 'id',
    parentReader: 'reader_id',
    fields: {
      reader_id: id(REQUIRED),
      journey_id: text(64, REQUIRED),
      started_at: timestamp(REQUIRED),
      completed_at: timestamp(NULLABLE),
      abandoned_at: timestamp(NULLABLE),
    },
  },
};

/**
 * Fields whose value never goes back to null once set, whatever order ops arrive in: a journey's
 * completion (and abandonment) is permanent. See mergeRank() in records.ts.
 */
export const MONOTONIC_FIELDS: Partial<Record<SyncedTable, readonly string[]>> = {
  reader_journeys: ['completed_at', 'abandoned_at'],
};

/** Field names that are never sent: the local key and the implied household (and each table's own key, e.g. books' isbn). */
export const RESERVED_FIELDS = ['id', 'household_id'] as const;

/** The largest JSON size of a field this version doesn't know. */
export const MAX_UNKNOWN_FIELD_CHARS = 8192;

/* --------------------------------------------------------------------------
   Wire ids
   -------------------------------------------------------------------------- */

export const wireId = (table: SyncedTable, localId: string) => `${table}:${localId}`;

/** "<table>:<local id>" → its parts, or null for an unknown table or a local id that table can't have. */
export function parseWireId(rec: unknown): { table: SyncedTable; localId: string } | null {
  if (typeof rec !== 'string') return null;
  const at = rec.indexOf(':');
  if (at < 1) return null;
  const table = rec.slice(0, at);
  const localId = rec.slice(at + 1);
  if (!isSyncedTable(table) || !validLocalId(table, localId)) return null;
  return { table, localId };
}

export function validLocalId(table: SyncedTable, localId: string): boolean {
  switch (SCHEMA[table].localId) {
    case 'household':
      return localId === HOUSEHOLD_ID;
    case 'bookKey':
      return BOOK_KEY.test(localId);
    default:
      return LOCAL_ID.test(localId);
  }
}

/* --------------------------------------------------------------------------
   Values
   -------------------------------------------------------------------------- */

/** Whether `v` fits a field's kind (null is checked separately). */
function fits(kind: Kind, v: unknown): boolean {
  switch (kind.type) {
    case 'text':
      return typeof v === 'string' && v.length >= 1 && v.length <= kind.max && (!kind.pattern || kind.pattern.test(v));
    case 'id':
      return typeof v === 'string' && LOCAL_ID.test(v);
    case 'bookKey':
      return typeof v === 'string' && BOOK_KEY.test(v);
    case 'timestamp':
      return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
    case 'date':
      return typeof v === 'string' && CALENDAR_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= kind.min && v <= kind.max;
    case 'texts':
      return Array.isArray(v) && v.length <= kind.maxItems && v.every((x) => typeof x === 'string' && x.length <= kind.max);
  }
}

/** Whether `v` is acceptable for this known field (including null where allowed). */
export function validValue(spec: FieldSpec, v: unknown): boolean {
  if (v === null) return !!spec.nullable;
  return fits(spec.kind, v);
}

/* --------------------------------------------------------------------------
   Ops
   -------------------------------------------------------------------------- */

export type OpProblem =
  | 'not_op'
  | 'unknown_table'
  | 'bad_id'
  | 'reserved_field'
  | 'bad_field'
  | 'bad_value'
  | 'too_large';

export type OpCheck = { ok: true; table: SyncedTable; localId: string } | { ok: false; problem: OpProblem };

/**
 * Whether an op (from this device or another) may be stored. sync-core's shape rules first (ids,
 * stamp, plain JSON, del is a boolean), then ours: a known table and local id, no reserved field,
 * known fields with the right type and size, unknown fields kept if small.
 */
export function validate(op: unknown): OpCheck {
  if (!isOp(op)) return { ok: false, problem: 'not_op' };
  const o = op as Op;
  const at = o.rec.indexOf(':');
  const table = at > 0 ? o.rec.slice(0, at) : '';
  if (!isSyncedTable(table)) return { ok: false, problem: 'unknown_table' };
  const localId = o.rec.slice(at + 1);
  if (!validLocalId(table, localId)) return { ok: false, problem: 'bad_id' };
  if (o.f === DELETED) return { ok: true, table, localId }; // isOp has checked it is a boolean
  const spec = SCHEMA[table];
  if ((RESERVED_FIELDS as readonly string[]).includes(o.f) || o.f === spec.key) return { ok: false, problem: 'reserved_field' };
  if (!isFieldName(o.f)) return { ok: false, problem: 'bad_field' };
  const field = spec.fields[o.f];
  if (field) return validValue(field, o.v) ? { ok: true, table, localId } : { ok: false, problem: 'bad_value' };
  // A field this version doesn't know: kept for a newer version, if it isn't huge.
  return JSON.stringify(o.v).length <= MAX_UNKNOWN_FIELD_CHARS ? { ok: true, table, localId } : { ok: false, problem: 'too_large' };
}

/* --------------------------------------------------------------------------
   Rows ⇄ records
   -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

/**
 * The record for a local row: its wire id and the fields that travel. null for rows that never
 * sync: another household's (test-only), or a household other than "main".
 */
export function rowToRecord(table: SyncedTable, row: Row): { rec: string; fields: Record<string, JsonValue> } | null {
  const spec = SCHEMA[table];
  const localId = row[spec.key];
  if (typeof localId !== 'string' || !validLocalId(table, localId)) return null;
  if (spec.household && row.household_id !== HOUSEHOLD_ID) return null;
  const fields: Record<string, JsonValue> = {};
  for (const [name, value] of Object.entries(row)) {
    if (name === spec.key || name === 'household_id' || value === undefined) continue;
    // A household's time zone of null means "not set": never sent, so a device joining with
    // "Combine" can't wipe out the zone the household already has.
    if (table === 'households' && name === 'time_zone' && value === null) continue;
    fields[name] = value as JsonValue;
  }
  return { rec: wireId(table, localId), fields };
}

/**
 * The row a live record shows as, or null if it can't be shown yet: deleted, a required field
 * missing, or a known field with a bad value. Parents are checked by the caller (records.ts).
 */
export function recordToRow(table: SyncedTable, localId: string, fields: Record<string, unknown>): Row | null {
  const spec = SCHEMA[table];
  if (fields[DELETED] !== false) return null;
  const row: Row = { [spec.key]: localId };
  if (spec.household) row.household_id = HOUSEHOLD_ID;
  for (const [name, field] of Object.entries(spec.fields)) {
    const has = Object.hasOwn(fields, name) && fields[name] !== undefined;
    const value = has ? fields[name] : null;
    if (field.required && (value === null || !validValue(field, value))) return null;
    if (value !== null && !validValue(field, value)) return null;
    row[name] = value;
  }
  // A home book's id is its book key.
  if (table === 'home_items' && row.isbn !== localId) return null;
  return row;
}

/** The wire id of a row's parent reader, if the table has one. */
export function parentOf(table: SyncedTable, fields: Record<string, unknown>): string | undefined {
  const name = SCHEMA[table].parentReader;
  const v = name ? fields[name] : undefined;
  return typeof v === 'string' ? wireId('readers', v) : undefined;
}
