import { DataStoreError } from '../DataStore';
import { recomputeSummary, type DB, type OutboxEntry, type ReadTx, type StoredRecord } from '../adapters/local';
import {
  applyToRecord,
  compare,
  deleteRecord,
  isClock,
  isDeviceId,
  isLive,
  newClock,
  parseStamp,
  putRecord,
  receive,
  type Clock,
  type Op,
  type SyncRecord,
} from '../../sync/vendor/sync-core.js';
import {
  LARGEST_FIELDS,
  MONOTONIC_FIELDS,
  SYNCED_TABLES,
  isSyncedTable,
  parentOf,
  parseWireId,
  recordToRow,
  rowToRecord,
  validLocalId,
  validate,
  wireId,
  type SyncedTable,
} from './schema';

/**
 * The record layer under the sync adapter. Every write the local adapter makes to a synced table
 * also becomes sync-core ops, in the same IndexedDB transaction: the record is updated, the ops
 * go into the outbox and the clock moves on. Remote ops update records, and the typed tables
 * ("views") are rebuilt from them. Views only show rows that are live, complete and whose parent
 * reader is visible.
 */

/** Meta keys for sync bookkeeping (per device, never exported, never synced). */
export const SYNC_META = {
  device: 'sync_device_id',
  clock: 'sync_clock',
  cursor: 'sync_cursor',
  lastSynced: 'sync_last_synced',
  config: 'sync_config',
  /** When the relay said this household was deleted (ISO), so a reload shows it at once. */
  deleted: 'sync_deleted',
  /** When sync was last turned off on this device (ISO): it was in a household before. */
  wasPaired: 'sync_was_paired',
  /** The synced tables the version that last moved the cursor knew (schema.ts SYNCED_TABLES_MARKER). */
  tables: 'sync_tables',
} as const;

/** Ops in the outbox carry no id; sendable ops get their keyed, deterministic id when sent. */
const PENDING_ID = 'pending';

// The typed idb stores are generic over every table; the record layer works on plain rows.
/* eslint-disable @typescript-eslint/no-explicit-any */
interface LooseIndex {
  get(query: any): Promise<any>;
  getAll(query?: any, count?: number): Promise<any[]>;
  getAllKeys(query?: any): Promise<any[]>;
  count(query?: any): Promise<number>;
}
export interface LooseStore {
  get(key: any): Promise<any>;
  getAll(query?: any, count?: number): Promise<any[]>;
  getAllKeys(query?: any): Promise<any[]>;
  put(value: any, key?: any): Promise<any>;
  add(value: any, key?: any): Promise<any>;
  delete(key: any): Promise<void>;
  clear(): Promise<void>;
  count(query?: any): Promise<number>;
  index(name: string): LooseIndex;
}
export interface LooseTx {
  objectStore(name: string): LooseStore;
  abort(): void;
  done: Promise<void>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const storeOf = (tx: unknown, name: string) => (tx as LooseTx).objectStore(name);

/* --------------------------------------------------------------------------
   Clock and device
   -------------------------------------------------------------------------- */

function newDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** This device's clock, creating the device id on first use. */
export async function loadClock(tx: unknown): Promise<Clock> {
  const meta = storeOf(tx, 'meta');
  let dev = (await meta.get(SYNC_META.device))?.value;
  if (!isDeviceId(dev)) {
    dev = newDeviceId();
    await meta.put({ key: SYNC_META.device, value: dev });
  }
  const saved = (await meta.get(SYNC_META.clock))?.value;
  return isClock(saved) && saved.dev === dev ? saved : newClock(dev);
}

export const saveClock = (tx: unknown, clock: Clock) => storeOf(tx, 'meta').put({ key: SYNC_META.clock, value: { ...clock } });

/* --------------------------------------------------------------------------
   Records
   -------------------------------------------------------------------------- */

export function toStored(record: SyncRecord, table: SyncedTable): StoredRecord {
  const stored: StoredRecord = { id: record.id, fields: record.fields, ts: record.ts, t: table };
  const parent = parentOf(table, record.fields);
  if (parent) stored.p = parent;
  return stored;
}

export const fromStored = (s: StoredRecord): SyncRecord => ({ id: s.id, fields: s.fields as SyncRecord['fields'], ts: s.ts });

const toOutbox = (op: Op): OutboxEntry => ({ rec: op.rec, f: op.f, v: op.v, t: op.t, dev: op.dev });

/**
 * Rank of a value in a monotonic field: set beats unset, whatever the stamps. Within a rank the
 * later stamp wins (then sync-core's tie rule). That's a max over a total order, so every device
 * ends with the same value whatever order ops arrive in, and a completion can't be undone by a
 * late or stale op.
 */
const mergeRank = (v: unknown) => (v === null || v === undefined ? 0 : 1);

/** sync-core's last-writer-wins, except for monotonic fields (see mergeRank) and largest-wins fields. */
export function mergeOp(record: SyncRecord | undefined, op: Op, table: SyncedTable): { record: SyncRecord; changed: boolean } {
  // Largest wins (a custom journey's length): a max over (value, then stamp), so every device ends
  // with the same, longest value whatever order the ops arrive in. Equal values fall through.
  if (record && LARGEST_FIELDS[table]?.includes(op.f) && record.ts[op.f] !== undefined) {
    const have = record.fields[op.f];
    if (typeof have === 'number' && typeof op.v === 'number' && have !== op.v) {
      if (op.v < have) return { record, changed: false };
      return {
        record: { id: record.id, fields: { ...record.fields, [op.f]: structuredClone(op.v) }, ts: { ...record.ts, [op.f]: op.t } },
        changed: true,
      };
    }
  }
  if (record && MONOTONIC_FIELDS[table]?.includes(op.f) && record.ts[op.f] !== undefined) {
    const have = mergeRank(record.fields[op.f]);
    const incoming = mergeRank(op.v);
    if (incoming < have) return { record, changed: false };
    if (incoming > have) {
      return {
        record: { id: record.id, fields: { ...record.fields, [op.f]: structuredClone(op.v) }, ts: { ...record.ts, [op.f]: op.t } },
        changed: true,
      };
    }
  }
  return applyToRecord(record, op);
}

/* --------------------------------------------------------------------------
   Recording local writes
   -------------------------------------------------------------------------- */

export interface RecorderState {
  now(): number;
  /** Set whenever a write queued ops; the adapter reports it once the write has committed. */
  enqueued: boolean;
}

async function save(tx: unknown, table: SyncedTable, record: SyncRecord, ops: Op[], clock: Clock, state: RecorderState) {
  for (const op of ops) {
    const check = validate(op);
    if (!check.ok) throw new DataStoreError('invalid', `This change can't be synced (${op.f}: ${check.problem}).`);
  }
  await storeOf(tx, 'records').put(toStored(record, table));
  for (const op of ops) await storeOf(tx, 'outbox').put(toOutbox(op));
  await saveClock(tx, clock);
  state.enqueued = true;
}

/** A row was written to a synced table: record its changed fields as ops. */
export async function recordPut(tx: unknown, table: SyncedTable, row: Record<string, unknown>, state: RecorderState) {
  const target = rowToRecord(table, row);
  if (!target) return;
  const stored: StoredRecord | undefined = await storeOf(tx, 'records').get(target.rec);
  const replica = { clock: await loadClock(tx), records: new Map(stored ? [[stored.id, fromStored(stored)]] : []) };
  const ops = putRecord(replica, target.rec, target.fields, { now: state.now(), newId: () => PENDING_ID });
  if (!ops.length) return;
  await save(tx, table, replica.records.get(target.rec)!, ops, replica.clock, state);
}

/** A row is about to be deleted from a synced table: tombstone its record. */
export async function recordDelete(tx: unknown, table: SyncedTable, key: unknown, state: RecorderState) {
  if (typeof key !== 'string' || !validLocalId(table, key)) return;
  const row = await storeOf(tx, table).get(key);
  if (row && !rowToRecord(table, row)) return; // never synced (another household, test-only)
  const rec = wireId(table, key);
  const stored: StoredRecord | undefined = await storeOf(tx, 'records').get(rec);
  if (!stored || !isLive(fromStored(stored))) return;
  const replica = { clock: await loadClock(tx), records: new Map([[rec, fromStored(stored)]]) };
  const ops = deleteRecord(replica, rec, { now: state.now(), newId: () => PENDING_ID });
  if (!ops.length) return;
  await save(tx, table, replica.records.get(rec)!, ops, replica.clock, state);
}

const RECORDING_STORES = ['records', 'outbox', 'meta'];

/**
 * The database handle the sync adapter gives the local adapter's methods: read-write
 * transactions on synced tables also include records, outbox and meta, and every put, add or
 * delete on a synced table is recorded. clear() is not recorded (resetDevice and importBackup
 * clear the records too). Read-only access is untouched.
 */
export function wrapForSync(db: DB, state: RecorderState): DB {
  const wrapStore = (tx: LooseTx, name: string): LooseStore => {
    const target = tx.objectStore(name);
    if (!isSyncedTable(name)) return target;
    const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        try { tx.abort(); } catch { /* already finished */ }
        // The caller gets this error; the aborted transaction's own rejection is expected.
        tx.done.catch(() => {});
        throw error;
      }
    };
    return new Proxy(target, {
      get(store, prop) {
        if (prop === 'put' || prop === 'add') {
          return (value: Record<string, unknown>, key?: unknown) =>
            guarded(async () => {
              const result = await (prop === 'put' ? store.put(value, key) : store.add(value, key));
              await recordPut(tx, name, value, state);
              return result;
            });
        }
        if (prop === 'delete') {
          return (key: unknown) =>
            guarded(async () => {
              await recordDelete(tx, name, key, state);
              await store.delete(key);
            });
        }
        const v = Reflect.get(store, prop, store);
        return typeof v === 'function' ? v.bind(store) : v;
      },
    });
  };

  const wrapTx = (tx: LooseTx, single: string | null): LooseTx =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === 'objectStore') return (name: string) => wrapStore(target, name);
        if (prop === 'store') return single ? wrapStore(target, single) : undefined;
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });

  const handle = new Proxy(db, {
    get(target, prop) {
      if (prop === 'transaction') {
        return (names: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) => {
          const list = typeof names === 'string' ? [names] : [...names];
          if (mode !== 'readwrite' || !list.some(isSyncedTable)) {
            return target.transaction(names as never, mode, options);
          }
          const all = [...new Set([...list, ...RECORDING_STORES])];
          const tx = target.transaction(all as never, 'readwrite', options) as unknown as LooseTx;
          return wrapTx(tx, typeof names === 'string' ? names : null);
        };
      }
      // The one-call shortcuts (db.put('loans', …)) go through a recorded transaction too.
      if (prop === 'put' || prop === 'add' || prop === 'delete') {
        return async (name: string, valueOrKey: unknown, key?: unknown) => {
          if (!isSyncedTable(name)) return (Reflect.get(target, prop, target) as (...a: unknown[]) => Promise<unknown>).call(target, name, valueOrKey, key);
          const tx = (handle as unknown as { transaction(n: string, m: IDBTransactionMode): LooseTx }).transaction(name, 'readwrite');
          const store = tx.objectStore(name);
          try {
            const result = prop === 'delete' ? await store.delete(valueOrKey) : await store[prop](valueOrKey, key);
            await tx.done;
            return result;
          } catch (error) {
            tx.done.catch(() => {});
            throw error;
          }
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return handle;
}

/* --------------------------------------------------------------------------
   Views from records
   -------------------------------------------------------------------------- */

/** Parents before children, so a child sees its reader's new state. */
const REBUILD_ORDER: readonly SyncedTable[] = SYNCED_TABLES;
const READER_CHILDREN: readonly SyncedTable[] = ['loans', 'read_events', 'reader_journeys', 'library_cards', 'note_views'];

export interface RebuildResult {
  /** Tables whose rows changed. */
  tables: Set<string>;
  /** Readers hidden because another visible reader already has their card token. */
  tokenConflicts: number;
}

/**
 * Rebuild the view rows for these records (and, for readers, every child record) from the
 * records store, and the read summaries they touch. Runs inside a transaction over every synced
 * table, records and read_summaries. Writes go to the raw stores: nothing here is recorded.
 */
export async function rebuildViews(tx: unknown, touched: Iterable<string>): Promise<RebuildResult> {
  const byTable = new Map<SyncedTable, Set<string>>();
  for (const rec of touched) {
    const parsed = parseWireId(rec);
    if (!parsed) continue;
    if (!byTable.has(parsed.table)) byTable.set(parsed.table, new Set());
    byTable.get(parsed.table)!.add(parsed.localId);
  }
  // A reader's change can show or hide its children, and change which journey is active.
  for (const readerId of byTable.get('readers') ?? []) {
    const children: StoredRecord[] = await storeOf(tx, 'records').index('by_parent').getAll(wireId('readers', readerId));
    for (const child of children) {
      const parsed = parseWireId(child.id);
      if (!parsed || !READER_CHILDREN.includes(parsed.table)) continue;
      if (!byTable.has(parsed.table)) byTable.set(parsed.table, new Set());
      byTable.get(parsed.table)!.add(parsed.localId);
    }
  }

  const result: RebuildResult = { tables: new Set(), tokenConflicts: 0 };
  const summaryPairs = new Map<string, [string, string]>();
  const addPair = (row: Record<string, unknown> | undefined | null) => {
    if (row && typeof row.reader_id === 'string' && typeof row.isbn === 'string') {
      summaryPairs.set(`${row.reader_id}\u0000${row.isbn}`, [row.reader_id, row.isbn]);
    }
  };

  for (const table of REBUILD_ORDER) {
    const ids = byTable.get(table);
    if (!ids) continue;
    const view = storeOf(tx, table);
    for (const localId of ids) {
      const stored: StoredRecord | undefined = await storeOf(tx, 'records').get(wireId(table, localId));
      const old = await view.get(localId);
      let row = stored ? recordToRow(table, localId, stored.fields) : null;
      if (row && typeof row.reader_id === 'string') {
        const reader = await storeOf(tx, 'readers').get(row.reader_id);
        if (!reader) row = null; // orphan: hidden until its reader is visible
        else if (table === 'reader_journeys' && row.completed_at === null && row.abandoned_at === null && reader.active_journey_id !== localId) {
          // Two devices started journeys at once and the other won the reader's pointer: this one
          // shows as abandoned (when it started), the same on every device.
          row = { ...row, abandoned_at: row.started_at };
        }
      }
      if (row && table === 'readers') {
        const holder = await view.index('by_card_token').get(row.card_token);
        if (holder && holder.id !== localId) {
          row = null;
          result.tokenConflicts++;
        }
      }
      if (row) {
        if (JSON.stringify(row) !== JSON.stringify(old)) {
          await view.put(row);
          result.tables.add(table);
        }
      } else if (old) {
        await view.delete(localId);
        result.tables.add(table);
      }
      if (table === 'read_events') {
        addPair(old);
        addPair(row);
      }
    }
  }
  for (const [readerId, isbn] of summaryPairs.values()) {
    await recomputeSummary(tx as ReadTx, readerId, isbn);
    result.tables.add('read_events');
  }
  return result;
}

/* --------------------------------------------------------------------------
   Remote ops
   -------------------------------------------------------------------------- */

export interface ApplyOutcome {
  changed: number;
  skipped: number;
  touched: Set<string>;
  clock: Clock;
}

/**
 * Apply ops from elsewhere to the records store: validate each (skip and count bad ones), fold its
 * stamp into the clock, merge. Returns the touched record ids; the caller rebuilds their views.
 */
export async function applyOps(tx: unknown, ops: readonly unknown[], clock: Clock, now: number): Promise<ApplyOutcome> {
  const records = storeOf(tx, 'records');
  const cache = new Map<string, SyncRecord | undefined>();
  const out: ApplyOutcome = { changed: 0, skipped: 0, touched: new Set(), clock };
  for (const raw of ops) {
    const check = validate(raw);
    if (!check.ok) {
      out.skipped++;
      continue;
    }
    const op = raw as Op;
    out.clock = receive(out.clock, op.t, now);
    if (!cache.has(op.rec)) {
      const stored: StoredRecord | undefined = await records.get(op.rec);
      cache.set(op.rec, stored ? fromStored(stored) : undefined);
    }
    const { record, changed } = mergeOp(cache.get(op.rec), op, check.table);
    if (!changed) continue;
    cache.set(op.rec, record);
    out.changed++;
    out.touched.add(op.rec);
  }
  for (const rec of out.touched) {
    const parsed = parseWireId(rec)!;
    await records.put(toStored(cache.get(rec)!, parsed.table));
  }
  return out;
}

/** The newest stamp in a record (for "is anything newer than…"). */
export function newestStamp(record: SyncRecord): string | null {
  let best: string | null = null;
  for (const t of Object.values(record.ts)) if (parseStamp(t) && (best === null || compare(t, best) > 0)) best = t;
  return best;
}

