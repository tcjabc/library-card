import { DataStoreError, type DataTable } from '../DataStore';
import {
  ALL_TABLES,
  createStoreWith,
  type LocalDataStore,
  type LocalStoreOptions,
  type OutboxEntry,
  type StoreInternals,
  type StoredRecord,
} from '../adapters/local';
import { deriveKeys, deriveOpIdKey, opId, parseKey } from '../../sync/vendor/crypto.js';
import { parseStamp, putRecord, type Op } from '../../sync/vendor/sync-core.js';
import {
  SYNC_META,
  applyOps,
  fromStored,
  loadClock,
  rebuildViews,
  saveClock,
  storeOf,
  toStored,
  wrapForSync,
  type RecorderState,
} from './records';
import { SYNCED_TABLES, rowToRecord, validate } from './schema';
import type { SyncConfig, SyncDataStore, SyncEngineStore } from './types';

export type { ApplyResult, SyncConfig, SyncDataStore, SyncEngineStore } from './types';
export { isSyncStore } from './types';

/**
 * The "sync" storage adapter: the local adapter's behaviour, with every write also recorded as
 * sync-core ops (see records.ts), plus the store side of the sync engine (src/sync/sync.js, 6d).
 * No network here: nothing is sent until the engine exists.
 */

const DB_NAME = 'library-card';

const VIEW_STORES = [...SYNCED_TABLES, 'read_summaries'] as const;
const APPLY_STORES = [...VIEW_STORES, 'records', 'meta'];

function checkCursor(cursor: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new DataStoreError('invalid', 'A sync cursor is a whole number of 0 or more.');
}

function checkedKey(householdKey: string): string {
  try {
    parseKey(householdKey);
  } catch (error) {
    throw new DataStoreError('invalid', error instanceof Error ? error.message : 'That household key is not valid.');
  }
  return householdKey.trim();
}

export async function createSyncStore(dbName = DB_NAME, options: LocalStoreOptions = {}): Promise<SyncDataStore> {
  const state: RecorderState = { now: options.now ?? (() => Date.now()), enqueued: false };
  return createStoreWith(dbName, options, {
    wrap: (db) => wrapForSync(db, state),
    extend: (store, internals) => syncMethods(store, internals, state),
  });
}

function syncMethods(store: LocalDataStore, internals: StoreInternals, state: RecorderState): SyncEngineStore & Pick<LocalDataStore, 'importBackup'> {
  const raw = internals.rawDb;
  // The store is extended in place, so keep the local adapter's own importBackup.
  const localImport = store.importBackup.bind(store);
  const enqueuedListeners = new Set<() => void>();
  const opIdKeys = new Map<string, Promise<CryptoKey>>();

  const notifyEnqueued = () => {
    for (const listener of [...enqueuedListeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[data/sync] listener failed', error);
      }
    }
  };
  // A local write that queued ops has committed once the local adapter announces it.
  store.subscribe((change) => {
    if (change.remote || !state.enqueued) return;
    state.enqueued = false;
    notifyEnqueued();
  });

  /** Tell this tab (as remote: the data came from elsewhere) and the other tabs. */
  const announce = (tables: Iterable<string>) => {
    const list = [...new Set(tables)].filter((t): t is DataTable => (ALL_TABLES as string[]).includes(t));
    if (!list.length) return;
    internals.emit(list, true);
    internals.broadcast(list);
  };

  const readMeta = async (key: string) => (await (await raw()).get('meta', key))?.value;
  const getConfig = async (): Promise<SyncConfig | null> => {
    const value = (await readMeta(SYNC_META.config)) as SyncConfig | undefined;
    return value && typeof value.householdKey === 'string' && value.householdKey ? value : null;
  };

  const queueAll = async (tx: unknown): Promise<number> => {
    let queued = 0;
    const records: StoredRecord[] = await storeOf(tx, 'records').getAll();
    for (const r of records) {
      for (const [f, v] of Object.entries(r.fields)) {
        const stamp = parseStamp(r.ts[f]);
        if (!stamp) continue;
        const entry: OutboxEntry = { rec: r.id, f, v, t: r.ts[f], dev: stamp.dev };
        await storeOf(tx, 'outbox').put(entry);
        queued++;
      }
    }
    return queued;
  };

  const opIdKeyFor = (householdKey: string) => {
    if (!opIdKeys.has(householdKey)) opIdKeys.set(householdKey, deriveOpIdKey(householdKey));
    return opIdKeys.get(householdKey)!;
  };

  return {
    async importBackup(data) {
      if (await getConfig()) {
        throw new DataStoreError('sync_enabled', 'Sync is on for this device. Restoring a backup would replace the household’s data on every device.');
      }
      return localImport(data);
    },

    getConfig,

    async setConfig(patch) {
      const current = await getConfig();
      const householdKey = patch.householdKey !== undefined ? checkedKey(patch.householdKey) : current?.householdKey;
      if (!householdKey) throw new DataStoreError('invalid', 'Sync needs a household key.');
      const roomId = householdKey === current?.householdKey ? current.roomId : (await deriveKeys(householdKey)).roomId;
      const next: SyncConfig = {
        householdKey,
        relayUrl: typeof patch.relayUrl === 'string' ? patch.relayUrl.trim() : (current?.relayUrl ?? ''),
        enabled: typeof patch.enabled === 'boolean' ? patch.enabled : (current?.enabled ?? false),
        roomId,
        enabledAt: current?.enabledAt ?? new Date(internals.now()).toISOString(),
      };
      const tx = (await raw()).transaction(['meta', 'records', 'outbox'], 'readwrite');
      await tx.objectStore('meta').put({ key: SYNC_META.config, value: next });
      let requeued = 0;
      if (current && current.householdKey !== householdKey) {
        // Another household is another room: start from its beginning and send it everything.
        await tx.objectStore('meta').put({ key: SYNC_META.cursor, value: 0 });
        requeued = await queueAll(tx);
      }
      await tx.done;
      if (requeued) notifyEnqueued();
      return next;
    },

    async pendingOps(limit = 500) {
      const config = await getConfig();
      if (!config) throw new DataStoreError('invalid', 'Sync is not on for this device.');
      const entries: OutboxEntry[] = await (await raw()).getAllFromIndex('outbox', 'by_t', null, limit);
      const key = await opIdKeyFor(config.householdKey);
      return Promise.all(entries.map(async (e) => ({ id: await opId(key, e.rec, e.f, e.t), rec: e.rec, f: e.f, v: e.v, t: e.t, dev: e.dev }) as Op));
    },

    async pendingCount() {
      return (await raw()).count('outbox');
    },

    async removeSentOps(sent) {
      const tx = (await raw()).transaction('outbox', 'readwrite');
      let removed = 0;
      for (const s of sent) {
        const row = await tx.store.get([s.rec, s.f]);
        // A newer local edit made while the push was in flight replaced it: keep that one.
        if (row?.t === s.t) {
          await tx.store.delete([s.rec, s.f]);
          removed++;
        }
      }
      await tx.done;
      return removed;
    },

    async getCursor() {
      const value = await readMeta(SYNC_META.cursor);
      return Number.isSafeInteger(value) ? (value as number) : 0;
    },

    async applyRemote(ops, cursor) {
      checkCursor(cursor);
      const tx = (await raw()).transaction(APPLY_STORES as never, 'readwrite');
      let outcome;
      let rebuilt;
      try {
        outcome = await applyOps(tx, ops, await loadClock(tx), internals.now());
        rebuilt = await rebuildViews(tx, outcome.touched);
        await saveClock(tx, outcome.clock);
        await storeOf(tx, 'meta').put({ key: SYNC_META.cursor, value: cursor });
      } catch (error) {
        try { tx.abort(); } catch { /* already finished */ }
        throw error;
      }
      await tx.done;
      announce(rebuilt.tables);
      return { changed: outcome.changed, skipped: outcome.skipped, tokenConflicts: rebuilt.tokenConflicts };
    },

    async replaceWithRemote(ops, cursor, config) {
      checkCursor(cursor);
      const current = await getConfig();
      const householdKey = config?.householdKey !== undefined ? checkedKey(config.householdKey) : current?.householdKey;
      const roomId = householdKey && householdKey !== current?.householdKey ? (await deriveKeys(householdKey)).roomId : current?.roomId;
      const tx = (await raw()).transaction([...APPLY_STORES, 'outbox'] as never, 'readwrite');
      let outcome;
      let rebuilt;
      try {
        for (const name of [...VIEW_STORES, 'records', 'outbox']) await storeOf(tx, name).clear();
        outcome = await applyOps(tx, ops, await loadClock(tx), internals.now());
        rebuilt = await rebuildViews(tx, outcome.touched);
        await saveClock(tx, outcome.clock);
        await storeOf(tx, 'meta').put({ key: SYNC_META.cursor, value: cursor });
        if (householdKey) {
          const next: SyncConfig = {
            householdKey,
            roomId: roomId ?? '',
            relayUrl: config?.relayUrl?.trim() ?? current?.relayUrl ?? '',
            enabled: config?.enabled ?? current?.enabled ?? true,
            enabledAt: current?.enabledAt ?? new Date(internals.now()).toISOString(),
          };
          await storeOf(tx, 'meta').put({ key: SYNC_META.config, value: next });
        }
      } catch (error) {
        try { tx.abort(); } catch { /* already finished */ }
        throw error;
      }
      await tx.done;
      internals.revokeAllCoverUrls();
      announce(ALL_TABLES);
      return { changed: outcome.changed, skipped: outcome.skipped, tokenConflicts: rebuilt.tokenConflicts, records: outcome.touched.size };
    },

    async requeueAll() {
      const tx = (await raw()).transaction(['records', 'outbox', 'meta'], 'readwrite');
      const queued = await queueAll(tx);
      await tx.objectStore('meta').put({ key: SYNC_META.cursor, value: 0 });
      await tx.done;
      if (queued) notifyEnqueued();
      return queued;
    },

    async mergeOutbox() {
      const tx = (await raw()).transaction(['records', 'outbox'], 'readwrite');
      const entries = await tx.objectStore('outbox').getAll();
      let kept = 0;
      let dropped = 0;
      for (const e of entries) {
        const record = await tx.objectStore('records').get(e.rec);
        if (record && record.ts[e.f] === e.t) {
          kept++;
        } else {
          await tx.objectStore('outbox').delete([e.rec, e.f]);
          dropped++;
        }
      }
      await tx.done;
      return { kept, dropped };
    },

    async getLastSynced() {
      const value = await readMeta(SYNC_META.lastSynced);
      return typeof value === 'string' ? value : null;
    },

    async setLastSynced(at) {
      await (await raw()).put('meta', { key: SYNC_META.lastSynced, value: at });
    },

    onChangesEnqueued(listener) {
      enqueuedListeners.add(listener);
      return () => {
        enqueuedListeners.delete(listener);
      };
    },

    async enableSync(householdKey, options = {}) {
      const key = checkedKey(householdKey);
      const { roomId } = await deriveKeys(key);
      const current = await getConfig();
      const tx = (await raw()).transaction([...SYNCED_TABLES, 'records', 'outbox', 'meta'] as never, 'readwrite');
      let records = 0;
      let queued = 0;
      let skipped = 0;
      try {
        await storeOf(tx, 'records').clear();
        await storeOf(tx, 'outbox').clear();
        let clock = await loadClock(tx);
        for (const table of SYNCED_TABLES) {
          const rows: Record<string, unknown>[] = await storeOf(tx, table).getAll();
          for (const row of rows) {
            const target = rowToRecord(table, row);
            if (!target) continue;
            const replica = { clock, records: new Map() };
            const ops = putRecord(replica, target.rec, target.fields, { now: internals.now(), newId: () => 'pending' });
            if (!ops.every((op) => validate(op).ok)) {
              skipped++;
              continue;
            }
            clock = replica.clock;
            await storeOf(tx, 'records').put(toStored(fromStoredish(replica.records.get(target.rec)), table));
            for (const op of ops) await storeOf(tx, 'outbox').put({ rec: op.rec, f: op.f, v: op.v, t: op.t, dev: op.dev });
            records++;
            queued += ops.length;
          }
        }
        await saveClock(tx, clock);
        await storeOf(tx, 'meta').put({ key: SYNC_META.cursor, value: 0 });
        const config: SyncConfig = {
          householdKey: key,
          roomId,
          relayUrl: options.relayUrl?.trim() ?? current?.relayUrl ?? '',
          enabled: true,
          enabledAt: new Date(internals.now()).toISOString(),
        };
        await storeOf(tx, 'meta').put({ key: SYNC_META.config, value: config });
      } catch (error) {
        try { tx.abort(); } catch { /* already finished */ }
        throw error;
      }
      await tx.done;
      if (queued) notifyEnqueued();
      return { records, queued, skipped };
    },
  };
}

/** A record from a sync-core replica, as stored (no table yet). */
const fromStoredish = (r: unknown) => fromStored(r as StoredRecord);
