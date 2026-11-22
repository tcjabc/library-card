import { afterEach, describe, expect, it } from 'vitest';
import { HOUSEHOLD_ID, isDataStoreError, type DataChange } from '../../DataStore';
import { createLocalStore } from '../../adapters/local';
import { rawAll } from '../../testing/fixtures';
import { createSyncStore } from '../adapter';
import { withSyncLock } from '../lock';
import { isSyncStore, type SyncDataStore } from '../types';
import { deriveKeys, deriveOpIdKey, generateKey, opId } from '../../../sync/vendor/crypto.js';
import { formatStamp } from '../../../sync/vendor/sync-core.js';

/** The store side of the sync engine (6d will drive these), and the rules around them. */

const ISBN_A = '9780000000002';
let t = Date.parse('2026-06-01T00:00:00.000Z');
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function open(dbName = `eng-${crypto.randomUUID()}`): Promise<{ store: SyncDataStore; dbName: string }> {
  const store = await createSyncStore(dbName, { now: () => (t += 1000) });
  closers.push(async () => {
    await store.close();
    indexedDB.deleteDatabase(dbName);
  });
  return { store, dbName };
}

async function withReader() {
  const o = await open();
  const h = await o.store.getCurrentHousehold();
  const reader = await o.store.createReader({ household_id: h.id, display_name: 'Ada', avatar: '🦊' });
  return { ...o, h, reader };
}

describe('sync adapter: engine-facing store', () => {
  it('is a DataStore with the engine methods; the local adapter is not', async () => {
    const { store } = await open();
    expect(isSyncStore(store)).toBe(true);
    const local = await createLocalStore(`eng-local-${crypto.randomUUID()}`);
    expect(isSyncStore(local)).toBe(false);
    await local.close();
  });

  it('every local write is recorded and queued, in the same transaction', async () => {
    const { store, dbName, reader } = await withReader();
    const records = await rawAll<{ id: string; t: string }>(dbName, 'records');
    expect(records.map((r) => r.id).sort()).toEqual(['households:main', `readers:${reader.id}`].sort());
    const outbox = await rawAll<{ rec: string; f: string }>(dbName, 'outbox');
    expect(outbox.filter((o) => o.rec === `readers:${reader.id}`).map((o) => o.f).sort()).toEqual(
      ['active_journey_id', 'avatar', 'card_token', 'del', 'display_name', 'kind'].sort(),
    );
    expect(await store.pendingCount()).toBe(outbox.length);
  });

  it('the local adapter records nothing', async () => {
    const dbName = `eng-local-${crypto.randomUUID()}`;
    const local = await createLocalStore(dbName);
    const h = await local.getCurrentHousehold();
    await local.createReader({ household_id: h.id, display_name: 'A', avatar: '🦊' });
    expect(await rawAll(dbName, 'records')).toEqual([]);
    expect(await rawAll(dbName, 'outbox')).toEqual([]);
    await local.close();
    indexedDB.deleteDatabase(dbName);
  });

  it('a delete is a tombstone record, one per child row', async () => {
    const { store, dbName, reader } = await withReader();
    await store.markRead(reader.id, ISBN_A, '2026-06-02T00:00:00.000Z');
    await store.markRead(reader.id, ISBN_A, '2026-06-03T00:00:00.000Z');
    await store.deleteReader(reader.id);
    const records = await rawAll<{ id: string; fields: { del?: boolean } }>(dbName, 'records');
    const tombstones = records.filter((r) => r.fields.del === true).map((r) => r.id.split(':')[0]).sort();
    expect(tombstones).toEqual(['read_events', 'read_events', 'readers']);
  });

  it('pendingOps gives keyed, deterministic ids (vendor opId), oldest stamp first', async () => {
    const { store } = await withReader();
    const key = generateKey();
    await store.enableSync(key);
    const ops = await store.pendingOps();
    const opIdKey = await deriveOpIdKey(key);
    for (const op of ops) expect(op.id).toBe(await opId(opIdKey, op.rec, op.f, op.t));
    expect(ops.every((o) => /^[A-Za-z0-9_-]{22}$/.test(o.id))).toBe(true);
    expect([...ops].map((o) => o.t)).toEqual([...ops].map((o) => o.t).sort());
    expect((await store.pendingOps()).map((o) => o.id)).toEqual(ops.map((o) => o.id));
    expect((await store.pendingOps(2)).length).toBe(2);
  });

  it('pendingOps needs sync to be on', async () => {
    const { store } = await withReader();
    await expect(store.pendingOps()).rejects.toThrow(/not on/);
  });

  it('removeSentOps keeps an op that a newer local edit replaced while it was in flight', async () => {
    const { store, reader } = await withReader();
    await store.enableSync(generateKey());
    const sent = await store.pendingOps();
    await store.updateReader(reader.id, { display_name: 'Changed meanwhile' });
    const removed = await store.removeSentOps(sent);
    expect(removed).toBe(sent.length - 1);
    const left = await store.pendingOps();
    expect(left.map((o) => [o.f, o.v])).toEqual([['display_name', 'Changed meanwhile']]);
  });

  it('requeueAll queues every field again with its current stamp (same ids) and resets the cursor', async () => {
    const { store } = await withReader();
    await store.enableSync(generateKey());
    const first = await store.pendingOps();
    await store.removeSentOps(first);
    await store.applyRemote([], 12);
    expect(await store.pendingCount()).toBe(0);
    const queued = await store.requeueAll();
    expect(queued).toBe(first.length);
    expect((await store.pendingOps()).map((o) => o.id).sort()).toEqual(first.map((o) => o.id).sort());
    expect(await store.getCursor()).toBe(0);
  });

  it('applyRemote never touches the outbox, and moves the cursor with the ops', async () => {
    const { store, reader } = await withReader();
    await store.enableSync(generateKey());
    const before = await store.pendingCount();
    const op = { id: 'x', rec: `readers:${reader.id}`, f: 'display_name', v: 'From afar', t: formatStamp(t + 999_999, 0, 'devZ'), dev: 'devZ' };
    const result = await store.applyRemote([op], 7);
    expect(result).toEqual({ changed: 1, skipped: 0, tokenConflicts: 0 });
    expect(await store.pendingCount()).toBe(before);
    expect(await store.getCursor()).toBe(7);
    expect((await store.getReader(reader.id))?.display_name).toBe('From afar');
    await expect(store.applyRemote([], -1)).rejects.toThrow(/cursor/);
  });

  it('mergeOutbox keeps only queued fields whose local value is still the newest', async () => {
    const { store, reader } = await withReader();
    await store.enableSync(generateKey());
    const queued = await store.pendingCount();
    // The household's newer name wins over this device's.
    const op = { id: 'x', rec: `readers:${reader.id}`, f: 'display_name', v: 'Household name', t: formatStamp(t + 999_999, 0, 'devZ'), dev: 'devZ' };
    await store.applyRemote([op], 1);
    expect(await store.mergeOutbox()).toEqual({ kept: queued - 1, dropped: 1 });
    expect((await store.pendingOps()).some((o) => o.rec === `readers:${reader.id}` && o.f === 'display_name')).toBe(false);
  });

  it('replaceWithRemote: this device ends up with exactly the household data, nothing queued', async () => {
    const source = await withReader();
    const key = generateKey();
    await source.store.markRead(source.reader.id, ISBN_A, '2026-06-02T00:00:00.000Z');
    await source.store.enableSync(key);
    const target = await withReader(); // has its own reader, to be replaced
    const result = await target.store.replaceWithRemote(await source.store.pendingOps(), 40, { householdKey: key, relayUrl: 'http://localhost:8787' });
    expect(result.skipped).toBe(0);
    expect((await target.store.listReaders(HOUSEHOLD_ID)).map((r) => r.id)).toEqual([source.reader.id]);
    expect(await target.store.countHouseholdReads(HOUSEHOLD_ID)).toBe(1);
    expect(await target.store.pendingCount()).toBe(0);
    expect(await target.store.getCursor()).toBe(40);
    const config = await target.store.getConfig();
    expect(config).toMatchObject({ householdKey: key, relayUrl: 'http://localhost:8787', roomId: (await deriveKeys(key)).roomId });
  });

  it('config: enableSync records it; a different key resets the cursor and queues everything', async () => {
    const { store } = await withReader();
    expect(await store.getConfig()).toBeNull();
    const key = generateKey();
    await store.enableSync(key, { relayUrl: 'http://localhost:8787' });
    expect(await store.getConfig()).toMatchObject({ householdKey: key, enabled: true, relayUrl: 'http://localhost:8787', roomId: (await deriveKeys(key)).roomId });
    await store.removeSentOps(await store.pendingOps());
    await store.applyRemote([], 5);
    expect(await store.setConfig({ relayUrl: 'https://relay.example' })).toMatchObject({ householdKey: key, relayUrl: 'https://relay.example' });
    expect(await store.getCursor()).toBe(5);
    expect(await store.pendingCount()).toBe(0);
    const other = generateKey();
    await store.setConfig({ householdKey: other });
    expect(await store.getCursor()).toBe(0);
    expect(await store.pendingCount()).toBeGreaterThan(0);
    await expect(store.setConfig({ householdKey: 'not a key' })).rejects.toSatisfy((e) => isDataStoreError(e, 'invalid'));
    await expect(store.enableSync('nope')).rejects.toSatisfy((e) => isDataStoreError(e, 'invalid'));
  });

  it('last synced time is kept', async () => {
    const { store } = await open();
    expect(await store.getLastSynced()).toBeNull();
    await store.setLastSynced('2026-06-01T10:00:00.000Z');
    expect(await store.getLastSynced()).toBe('2026-06-01T10:00:00.000Z');
  });

  it('onChangesEnqueued fires after a local write commits, never for applyRemote', async () => {
    const { store, reader } = await withReader();
    await store.enableSync(generateKey());
    let calls = 0;
    const off = store.onChangesEnqueued(() => calls++);
    await store.updateReader(reader.id, { display_name: 'New' });
    expect(calls).toBe(1);
    await store.applyRemote([{ id: 'x', rec: `readers:${reader.id}`, f: 'avatar', v: '🐢', t: formatStamp(t + 999_999, 0, 'devZ'), dev: 'devZ' }], 1);
    expect(calls).toBe(1);
    off();
    await store.updateReader(reader.id, { display_name: 'Newer' });
    expect(calls).toBe(1);
  });

  it('after applyRemote, subscribers hear { remote: true } here and in another tab', async () => {
    const { store, dbName, reader } = await withReader();
    const otherTab = await createSyncStore(dbName);
    closers.push(() => otherTab.close());
    const here: DataChange[] = [];
    const there: DataChange[] = [];
    store.subscribe((c) => here.push(c));
    const heardThere = new Promise<void>((resolve) => otherTab.subscribe((c) => { there.push(c); resolve(); }));
    await store.applyRemote([{ id: 'x', rec: `readers:${reader.id}`, f: 'display_name', v: 'Remote', t: formatStamp(t + 999_999, 0, 'devZ'), dev: 'devZ' }], 1);
    await heardThere;
    expect(here).toEqual([{ tables: ['readers'], remote: true }]);
    expect(there).toEqual([{ tables: ['readers'], remote: true }]);
    expect((await otherTab.getReader(reader.id))?.display_name).toBe('Remote');
  });

  it('importBackup is refused while sync is on (sync_enabled), and allowed before', async () => {
    const { store } = await withReader();
    const backup = JSON.parse(JSON.stringify(await store.exportBackup()));
    await store.importBackup(backup); // sync off: fine
    await store.enableSync(generateKey());
    await expect(store.importBackup(backup)).rejects.toSatisfy((e) => isDataStoreError(e, 'sync_enabled'));
  });

  it('resetDevice clears records, outbox and sync meta', async () => {
    const { store, dbName } = await withReader();
    await store.enableSync(generateKey());
    await store.setLastSynced('2026-06-01T10:00:00.000Z');
    await store.resetDevice();
    expect(await rawAll(dbName, 'records')).toEqual([]);
    expect(await rawAll(dbName, 'outbox')).toEqual([]);
    expect(await store.getConfig()).toBeNull();
    expect(await store.getCursor()).toBe(0);
    expect(await store.getLastSynced()).toBeNull();
    expect(await rawAll(dbName, 'meta')).toEqual([]);
  });

  it('a card token clash from another device hides the incoming reader instead of failing', async () => {
    const { store, reader } = await withReader();
    const id = crypto.randomUUID();
    const s = (n: number) => formatStamp(t + 999_999 + n, 0, 'devZ');
    const ops = [
      { id: 'a', rec: `readers:${id}`, f: 'display_name', v: 'Twin', t: s(0), dev: 'devZ' },
      { id: 'b', rec: `readers:${id}`, f: 'avatar', v: '🐙', t: s(0), dev: 'devZ' },
      { id: 'c', rec: `readers:${id}`, f: 'card_token', v: reader.card_token, t: s(0), dev: 'devZ' },
      { id: 'd', rec: `readers:${id}`, f: 'del', v: false, t: s(0), dev: 'devZ' },
    ];
    const result = await store.applyRemote(ops, 1);
    expect(result.tokenConflicts).toBe(1);
    expect((await store.listReaders(HOUSEHOLD_ID)).map((r) => r.id)).toEqual([reader.id]);
  });
});

describe('withSyncLock', () => {
  it('runs the work when the lock is free, and skips it when another tab holds it', async () => {
    const held = new Set<string>();
    const locks = {
      async request(name: string, _options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<unknown>) {
        if (held.has(name)) return callback(null);
        held.add(name);
        try { return await callback({ name }); } finally { held.delete(name); }
      },
    };
    let inner: unknown;
    const outer = await withSyncLock(async () => {
      inner = await withSyncLock(async () => 'second tab', { locks });
      return 'first tab';
    }, { locks });
    expect(outer).toEqual({ ran: true, value: 'first tab' });
    expect(inner).toEqual({ ran: false });
  });

  it('without Web Locks it just runs', async () => {
    expect(await withSyncLock(async () => 42, { locks: undefined })).toEqual({ ran: true, value: 42 });
  });
});
