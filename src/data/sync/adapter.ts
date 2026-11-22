import { DataStoreError, HOUSEHOLD_ID, type DataTable } from '../DataStore';
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
import { isWaiting, openPhotoOutbox, type BlobOutboxEntry, type PhotoOutboxDb } from './photoStore';
import { SYNCED_TABLES, rowToRecord, validate } from './schema';
import type { SyncConfig, SyncDataStore, SyncEngineStore, SyncPhotoStore } from './types';

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
  const photos = await openPhotoOutbox(dbName);
  return createStoreWith(dbName, options, {
    wrap: (db) => wrapForSync(db, state),
    extend: (store, internals) => ({ ...syncMethods(store, internals, state, photos), ...photoMethods(store, internals, photos) }),
  });
}

const COVER_PREFIX = 'cover:';
const coverHash = (value: unknown): string | null =>
  typeof value === 'string' && value.startsWith(COVER_PREFIX) ? value.slice(COVER_PREFIX.length) : null;

/** Photos books and collections point at that are on this device, with their outbox entries (one read of each store). */
async function photoPicture(internals: StoreInternals, photos: PhotoOutboxDb) {
  const d = await internals.rawDb();
  const tx = d.transaction(['books', 'collections', 'cover_images']);
  const books = await tx.objectStore('books').getAll();
  const collections = await tx.objectStore('collections').getAll();
  const local = new Set((await tx.objectStore('cover_images').getAllKeys()) as string[]);
  await tx.done;
  const referenced = new Set(
    [...books, ...collections].map((b) => coverHash(b.cover_url)).filter((h): h is string => h !== null && local.has(h)),
  );
  const entries = new Map((await photos.getAll('blob_outbox')).map((e) => [e.hash, e]));
  return { referenced, entries };
}

/** Photo sync for the sync adapter: the photo outbox, remote photos and the missing-photo hook. */
function photoMethods(
  store: LocalDataStore,
  internals: StoreInternals,
  photos: PhotoOutboxDb,
): SyncPhotoStore & Pick<LocalDataStore, 'resetDevice' | 'putBook'> {
  const localReset = store.resetDevice.bind(store);
  const localPutBook = store.putBook.bind(store);
  const hasLocal = async (hash: string) => (await (await internals.rawDb()).getKey('cover_images', hash)) !== undefined;
  const missing = new Set<(hash: string) => void>();
  internals.onMissingCover((hash) => missing.forEach((fn) => fn(hash)));

  return {
    async photosToUpload(now) {
      const { referenced, entries } = await photoPicture(internals, photos);
      const due = [...referenced].filter((h) => {
        const e = entries.get(h);
        return isWaiting(e) && (!e || e.next_at <= now);
      });
      const d = await internals.rawDb();
      const out: { hash: string; blob: Blob }[] = [];
      for (const hash of due) {
        const blob = (await d.get('cover_images', hash))?.blob;
        if (blob) out.push({ hash, blob });
      }
      return out;
    },

    async nextPhotoRetryAt() {
      const { referenced, entries } = await photoPicture(internals, photos);
      const times = [...referenced].map((h) => entries.get(h)).filter((e): e is BlobOutboxEntry => e?.state === 'pending').map((e) => e.next_at);
      return times.length ? Math.min(...times) : null;
    },

    async getPhotoState(hash) {
      return (await photos.get('blob_outbox', hash)) ?? null;
    },

    async setPhotoState(hash, entry) {
      await photos.put('blob_outbox', { ...entry, hash });
    },

    async photoCounts() {
      const { referenced, entries } = await photoPicture(internals, photos);
      let waiting = 0;
      let failed = 0;
      for (const h of referenced) {
        const e = entries.get(h);
        if (e?.state === 'failed') failed++;
        else if (isWaiting(e)) waiting++;
      }
      return { waiting, failed };
    },

    async saveRemotePhoto(hash, blob) {
      const d = await internals.rawDb();
      if (!(await d.getKey('cover_images', hash))) await d.put('cover_images', { hash, blob, saved_at: new Date(internals.now()).toISOString() });
      await photos.put('blob_outbox', { hash, state: 'uploaded', attempts: 0, next_at: 0, error: null });
      // Covers that showed as none can show now, here and in other tabs.
      internals.emit(['books', 'covers'], true);
      internals.broadcast(['books', 'covers']);
    },

    hasLocalPhoto: hasLocal,

    /**
     * A book whose photo hasn't arrived yet shows no cover, so saving it from the book sheet
     * sends no cover: keep the household's photo rather than removing it everywhere.
     */
    async putBook(book) {
      if (!book.cover_url) {
        const previous = coverHash((await (await internals.rawDb()).get('books', book.isbn))?.cover_url);
        if (previous && !(await hasLocal(previous))) return localPutBook({ ...book, cover_url: COVER_PREFIX + previous });
      }
      return localPutBook(book);
    },

    onMissingPhoto(listener) {
      missing.add(listener);
      return () => missing.delete(listener);
    },

    async resetDevice() {
      await localReset();
      await photos.clear('blob_outbox');
    },
  };
}

function syncMethods(
  store: LocalDataStore,
  internals: StoreInternals,
  state: RecorderState,
  photos: PhotoOutboxDb,
): SyncEngineStore & Pick<LocalDataStore, 'importBackup' | 'clearHouseholdPin'> {
  const raw = internals.rawDb;
  // The store is extended in place, so keep the local adapter's own importBackup.
  const localImport = store.importBackup.bind(store);
  const localClearPin = store.clearHouseholdPin.bind(store);
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
    async setAsideLocalPin() {
      const tx = (await raw()).transaction(['households', 'records', 'outbox'], 'readwrite');
      const households = storeOf(tx, 'households');
      const row = await households.get(HOUSEHOLD_ID);
      if (!row?.parent_pin_hash) {
        await tx.done;
        return null;
      }
      const rec = `households:${HOUSEHOLD_ID}`;
      const record: StoredRecord | undefined = await storeOf(tx, 'records').get(rec);
      const recorded = record && 'parent_pin_hash' in record.fields ? { v: record.fields.parent_pin_hash, t: record.ts.parent_pin_hash } : null;
      const queued: OutboxEntry | undefined = await storeOf(tx, 'outbox').get([rec, 'parent_pin_hash']);
      await households.put({ ...row, parent_pin_hash: null });
      if (record && recorded) {
        const fields = { ...record.fields };
        const ts = { ...record.ts };
        delete fields.parent_pin_hash;
        delete ts.parent_pin_hash;
        await storeOf(tx, 'records').put({ ...record, fields, ts });
      }
      if (queued) await storeOf(tx, 'outbox').delete([rec, 'parent_pin_hash']);
      await tx.done;
      internals.emit(['households'], false);
      internals.broadcast(['households']);
      return { hash: row.parent_pin_hash, recorded, queued: queued ?? null };
    },

    async putBackLocalPin(saved) {
      const tx = (await raw()).transaction(['households', 'records', 'outbox'], 'readwrite');
      const rec = `households:${HOUSEHOLD_ID}`;
      const row = await storeOf(tx, 'households').get(HOUSEHOLD_ID);
      if (row) await storeOf(tx, 'households').put({ ...row, parent_pin_hash: saved.hash });
      const record: StoredRecord | undefined = await storeOf(tx, 'records').get(rec);
      if (record && saved.recorded) {
        await storeOf(tx, 'records').put({
          ...record,
          fields: { ...record.fields, parent_pin_hash: saved.recorded.v },
          ts: { ...record.ts, parent_pin_hash: saved.recorded.t },
        });
      }
      if (saved.queued) await storeOf(tx, 'outbox').put(saved.queued);
      await tx.done;
      internals.emit(['households'], false);
      internals.broadcast(['households']);
    },

    async clearHouseholdPin() {
      // A synced household keeps a PIN (other devices rely on it); it can only be changed.
      if (await getConfig()) {
        throw new DataStoreError('blocked', 'Sync is on for this device. A synced household keeps its PIN; change it instead.');
      }
      return localClearPin();
    },

    async importBackup(data) {
      if (await getConfig()) {
        throw new DataStoreError('sync_enabled', 'Sync is on for this device. Restoring a backup would replace the household’s data on every device.');
      }
      return localImport(data);
    },

    getConfig,

    async setConfig(patch) {
      const current = await getConfig();
      if (patch.householdKey === '') {
        // Forget the key on this device (turning sync off). Local data, records and outbox stay.
        const off = { householdKey: '', relayUrl: current?.relayUrl ?? '', enabled: false, roomId: '', enabledAt: current?.enabledAt ?? '' };
        await (await raw()).put('meta', { key: SYNC_META.config, value: off });
        return off;
      }
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
      const all: OutboxEntry[] = await (await raw()).getAllFromIndex('outbox', 'by_t');
      // A cover set to a photo that isn't on the relay yet waits until it is (or has failed).
      const { referenced, entries: photoEntries } = await photoPicture(internals, photos);
      const held = (e: OutboxEntry) => {
        if (e.f !== 'cover_url' || !e.rec.startsWith('books:')) return false;
        const hash = coverHash(e.v);
        return hash !== null && referenced.has(hash) && isWaiting(photoEntries.get(hash));
      };
      const entries = all.filter((e) => !held(e)).slice(0, limit);
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
      // The household's photos are fetched as needed; nothing of this device's is waiting to upload.
      await photos.clear('blob_outbox');
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

    async mergeOutbox(received = []) {
      const known = new Set([...received].map((r) => `${r.rec}\u0000${r.f}\u0000${r.t}`));
      const tx = (await raw()).transaction(['records', 'outbox'], 'readwrite');
      const entries = await tx.objectStore('outbox').getAll();
      let kept = 0;
      let dropped = 0;
      for (const e of entries) {
        const record = await tx.objectStore('records').get(e.rec);
        // Keep it only if this device's value is still the newest and the relay doesn't have it yet.
        if (record && record.ts[e.f] === e.t && !known.has(`${e.rec}\u0000${e.f}\u0000${e.t}`)) {
          kept++;
        } else {
          await tx.objectStore('outbox').delete([e.rec, e.f]);
          dropped++;
        }
      }
      await tx.done;
      return { kept, dropped };
    },

    async getSyncFlags() {
      const [deleted, wasPaired] = await Promise.all([readMeta(SYNC_META.deleted), readMeta(SYNC_META.wasPaired)]);
      return {
        deletedAt: typeof deleted === 'string' ? deleted : null,
        wasPairedAt: typeof wasPaired === 'string' ? wasPaired : null,
      };
    },

    async setSyncFlags(patch) {
      const keys = { deletedAt: SYNC_META.deleted, wasPairedAt: SYNC_META.wasPaired } as const;
      const fields = (['deletedAt', 'wasPairedAt'] as const).filter((field) => field in patch);
      for (const field of fields) {
        const value = patch[field];
        if (value !== null && !(typeof value === 'string' && value)) throw new DataStoreError('invalid', 'A sync flag is a date text or null.');
      }
      const tx = (await raw()).transaction('meta', 'readwrite');
      for (const field of fields) {
        const value = patch[field];
        if (value === null) await tx.store.delete(keys[field]);
        else await tx.store.put({ key: keys[field], value });
      }
      await tx.done;
      return this.getSyncFlags();
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
      let queued: number;
      let skipped = 0;
      try {
        let clock = await loadClock(tx);
        for (const table of SYNCED_TABLES) {
          const rows: Record<string, unknown>[] = await storeOf(tx, table).getAll();
          for (const row of rows) {
            const target = rowToRecord(table, row);
            if (!target) continue;
            // Fields already recorded keep their stamps, so an older value here doesn't beat a newer
            // one in the household; a row with no record yet (data from before sync) gets new stamps.
            const existing: StoredRecord | undefined = await storeOf(tx, 'records').get(target.rec);
            const replica = { clock, records: new Map(existing ? [[existing.id, fromStored(existing)]] : []) };
            const ops = putRecord(replica, target.rec, target.fields, { now: internals.now(), newId: () => 'pending' });
            if (!ops.every((op) => validate(op).ok)) {
              skipped++;
              continue;
            }
            clock = replica.clock;
            if (ops.length) await storeOf(tx, 'records').put(toStored(fromStoredish(replica.records.get(target.rec)), table));
            records++;
          }
        }
        await saveClock(tx, clock);
        // Every field of every record, with its current stamp (the relay dedupes what it already has).
        await storeOf(tx, 'outbox').clear();
        queued = await queueAll(tx);
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
      // A new room: every photo a book points at is uploaded again (the relay skips what it has).
      await photos.clear('blob_outbox');
      if (queued) notifyEnqueued();
      return { records, queued, skipped };
    },
  };
}

/** A record from a sync-core replica, as stored (no table yet). */
const fromStoredish = (r: unknown) => fromStored(r as StoredRecord);
