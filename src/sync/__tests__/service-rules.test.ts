import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOUSEHOLD_ID } from '../../data/DataStore';
import { createSyncStore } from '../../data/sync/adapter';
import type { SyncDataStore } from '../../data/sync/types';
import { strings } from '../../strings';
import { createSyncService, SyncBusyError, type SyncService } from '../service';
import { generateKey } from '../vendor/crypto.js';
import { JoinError } from '../vendor/sync.js';
import { fakeChannels, fakeEnv, fakeLocks, fakeRelay, fakeTimers, RELAY } from './fakes';

/**
 * 6d-2 rules in the sync store and service: the persisted "deleted" state, was_paired, one
 * household action at a time across tabs, and the counts a replace would drop.
 */

const open: { close(): Promise<void> }[] = [];
const services: SyncService[] = [];
let count = 0;
afterEach(async () => {
  for (const s of services.splice(0)) await s.dispose();
  for (const s of open.splice(0)) await s.close();
  vi.restoreAllMocks();
});

async function newStore(): Promise<SyncDataStore> {
  const store = await createSyncStore(`rules-${++count}`);
  open.push(store);
  return store;
}

const NOW = Date.parse('2026-11-22T10:00:00.000Z');

async function service(store: SyncDataStore, relay = fakeRelay(), extra: Partial<Parameters<typeof createSyncService>[0]> = {}) {
  const sync = await createSyncService({
    store, relayUrl: RELAY, transport: relay.transport, env: fakeEnv(), timers: fakeTimers(), random: () => 0.5,
    now: () => NOW, locks: null, channel: null, log: { warn: () => {}, error: () => {} }, ...extra,
  });
  services.push(sync);
  return sync;
}

describe('sync flags in the store', () => {
  it('start empty, set and clear one at a time, and are refused if not a date text', async () => {
    const store = await newStore();
    expect(await store.getSyncFlags()).toEqual({ deletedAt: null, wasPairedAt: null });
    expect(await store.setSyncFlags({ deletedAt: '2026-11-22T10:00:00.000Z' })).toEqual({ deletedAt: '2026-11-22T10:00:00.000Z', wasPairedAt: null });
    expect(await store.setSyncFlags({ wasPairedAt: '2026-11-21T09:00:00.000Z' })).toEqual({ deletedAt: '2026-11-22T10:00:00.000Z', wasPairedAt: '2026-11-21T09:00:00.000Z' });
    expect(await store.setSyncFlags({ deletedAt: null })).toEqual({ deletedAt: null, wasPairedAt: '2026-11-21T09:00:00.000Z' });
    await expect(store.setSyncFlags({ deletedAt: '' })).rejects.toMatchObject({ code: 'invalid' });
    expect((await store.exportBackup()) as unknown).not.toHaveProperty('meta');
    await store.resetDevice();
    expect(await store.getSyncFlags()).toEqual({ deletedAt: null, wasPairedAt: null });
  });
});

describe('deleted, persisted', () => {
  it('a reload shows "deleted" at once and asks the relay nothing', async () => {
    const store = await newStore();
    const relay = fakeRelay();
    const first = await service(store, relay);
    await first.start();
    await first.idle();
    await first.deleteHousehold();
    expect(first.getStatus().state).toBe('deleted');
    expect((await store.getSyncFlags()).deletedAt).toBe(new Date(NOW).toISOString());
    await first.dispose();

    const calls = relay.calls.length;
    const again = await service(store, relay);
    expect(again.getStatus()).toMatchObject({ state: 'deleted', message: strings.sync.deleted });
    await again.idle();
    await again.syncNow();
    expect(again.getStatus().state).toBe('deleted');
    expect(relay.calls.length).toBe(calls);
  });

  it('a 410 heard by the engine is remembered too', async () => {
    const store = await newStore();
    const relay = fakeRelay();
    const sync = await service(store, relay);
    await sync.start();
    await sync.idle();
    relay.sockets.at(-1)!.onDeleted!();
    await sync.idle();
    expect((await store.getSyncFlags()).deletedAt).not.toBeNull();
  });

  it('only "Keep a copy" (turn off) or "Start a new household" clears it; joining is refused', async () => {
    for (const way of ['keep', 'startNew'] as const) {
      const store = await newStore();
      await store.setSyncFlags({ deletedAt: '2026-11-20T00:00:00.000Z' });
      const relay = fakeRelay();
      const sync = await service(store, relay);
      expect(sync.getStatus().state).toBe('deleted');
      const error = await sync.join('abandon '.repeat(11) + 'about', 'combine').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(JoinError);
      expect((error as JoinError).code).toBe('deleted');
      await expect(sync.start(false)).rejects.toBeInstanceOf(JoinError);
      expect(sync.getStatus().state).toBe('deleted');

      if (way === 'keep') {
        await sync.stop(true);
        expect(sync.getStatus().state).toBe('off');
      } else {
        await sync.start();
        await sync.idle();
        expect(sync.getStatus().state).toBe('live');
      }
      expect((await store.getSyncFlags()).deletedAt).toBeNull();
    }
  });
});

describe('was_paired', () => {
  it('turning off remembers when; a device never in a household has none', async () => {
    const store = await newStore();
    const sync = await service(store);
    expect(sync.getStatus().wasPairedAt).toBeNull();
    await sync.stop(true); // not in a household: nothing to remember
    expect(sync.getStatus().wasPairedAt).toBeNull();

    await sync.start();
    await sync.stop(true);
    expect(sync.getStatus().wasPairedAt).toBe(new Date(NOW).toISOString());
    expect((await store.getSyncFlags()).wasPairedAt).toBe(new Date(NOW).toISOString());
  });

  it('turning off and clearing the device still remembers it (reset leaves only this device)', async () => {
    const store = await newStore();
    await store.getCurrentHousehold();
    await store.createLibrary({ household_id: HOUSEHOLD_ID, name: 'Central' });
    const sync = await service(store);
    await sync.start();
    await sync.stop(false);
    expect(await sync.localItemCount()).toBe(0);
    expect(await store.getConfig()).toBeNull();
    expect((await store.getSyncFlags()).wasPairedAt).toBe(new Date(NOW).toISOString());
  });
});

describe('one household action at a time', () => {
  it('a second tab gets SyncBusyError and sees "busy" until the first finishes', async () => {
    const relay = fakeRelay();
    const locks = fakeLocks();
    const channel = fakeChannels();
    const storeA = await newStore();
    const storeB = await newStore();
    const a = await service(storeA, relay, { locks, channel: channel() });
    const b = await service(storeB, relay, { locks, channel: channel() });

    let release!: () => void;
    relay.control.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const starting = a.start(); // waits in its first push
    await vi.waitFor(() => expect(b.getStatus().busyElsewhere).toBe(true));
    await expect(b.start()).rejects.toBeInstanceOf(SyncBusyError);
    await expect(b.join('abandon '.repeat(11) + 'about', 'combine')).rejects.toBeInstanceOf(SyncBusyError);
    await expect(b.stop(true)).rejects.toBeInstanceOf(SyncBusyError);
    await expect(b.deleteHousehold()).rejects.toBeInstanceOf(SyncBusyError);
    await expect(a.start()).rejects.toBeInstanceOf(SyncBusyError); // the same tab, twice

    relay.control.hold = null;
    release();
    await starting;
    await vi.waitFor(() => expect(b.getStatus().busyElsewhere).toBe(false));
    await b.stop(true); // free again
  });
});

describe('local counts', () => {
  it('counts readers, home books, libraries, loans and reads', async () => {
    const store = await newStore();
    const sync = await service(store);
    expect(await sync.localCounts()).toEqual({ readers: 0, homeBooks: 0, libraries: 0, loans: 0, reads: 0 });
    expect(await sync.localItemCount()).toBe(0);

    await store.getCurrentHousehold();
    const reader = await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Ada', avatar: '🦊' });
    const isbn = '9780000000002';
    await store.putBook({ isbn, title: 'A book', authors: [], cover_url: null, source: 'manual' });
    await store.addHomeItem(HOUSEHOLD_ID, isbn);
    const library = await store.createLibrary({ household_id: HOUSEHOLD_ID, name: 'Central' });
    await store.createLoan({ household_id: HOUSEHOLD_ID, reader_id: reader.id, isbn, library_id: library.id });
    await store.markRead(reader.id, isbn);
    await store.markRead(reader.id, isbn, new Date(Date.now() + 60_000).toISOString());
    expect(await sync.localCounts()).toEqual({ readers: 1, homeBooks: 1, libraries: 1, loans: 1, reads: 2 });
    expect(await sync.localItemCount()).toBe(6);
    void generateKey;
  });
});

/** An environment whose visibility the test controls, like a browser tab. */
function tabEnv(visible = true) {
  const listeners: ((visible: boolean) => void)[] = [];
  const env = {
    visible,
    isVisible: () => env.visible,
    isOnline: () => true,
    onVisibility: (fn: (visible: boolean) => void) => void listeners.push(fn),
    onOnline: () => {},
    onOffline: () => {},
    hide() {
      env.visible = false;
      for (const fn of [...listeners]) fn(false);
    },
    show() {
      env.visible = true;
      for (const fn of [...listeners]) fn(true);
    },
  };
  return env;
}

describe('hand-off between tabs', () => {
  async function pairedDb() {
    const name = `handoff-${++count}`;
    const first = await createSyncStore(name);
    open.push(first);
    await first.enableSync(generateKey());
    const second = await createSyncStore(name); // the same database, as another tab sees it
    open.push(second);
    return [first, second] as const;
  }

  it('a hidden leader syncs once more, stops and lets the visible tab take over; it queues again when shown', async () => {
    const [storeA, storeB] = await pairedDb();
    const relay = fakeRelay();
    const locks = fakeLocks();
    const channel = fakeChannels();
    const envA = tabEnv();
    const envB = tabEnv();
    const a = await service(storeA, relay, { locks, channel: channel(), env: envA, handOffSyncMs: 50 });
    await a.idle();
    expect(a.getStatus()).toMatchObject({ leader: true, state: 'live' });
    const b = await service(storeB, relay, { locks, channel: channel(), env: envB, handOffSyncMs: 50 });
    expect(b.getStatus().leader).toBe(false);

    await storeA.getCurrentHousehold(); // a change made just before hiding
    const pulls = relay.calls.filter((c) => c === 'pull').length;
    envA.hide();
    await vi.waitFor(() => expect(b.getStatus().leader).toBe(true));
    expect(a.getStatus().leader).toBe(false);
    expect(relay.calls.filter((c) => c === 'pull').length).toBeGreaterThan(pulls); // A's last sync
    await b.idle();
    expect(b.getStatus().state).toBe('live');
    await vi.waitFor(() => expect(a.getStatus().state).toBe('live')); // told by B

    // A is shown again: it waits its turn and runs sync once B hides.
    envA.show();
    expect(a.getStatus().leader).toBe(false);
    envB.hide();
    await vi.waitFor(() => expect(a.getStatus().leader).toBe(true));
    await a.idle();
    expect(a.getStatus().state).toBe('live');
  });

  it('a tab opened in the background does not take the lock until it is shown', async () => {
    const [store] = await pairedDb();
    const env = tabEnv(false);
    const sync = await service(store, fakeRelay(), { locks: fakeLocks(), channel: null, env });
    expect(sync.getStatus().leader).toBe(false);
    env.show();
    await vi.waitFor(() => expect(sync.getStatus().leader).toBe(true));
  });

  it('a tab that never hears from the running tab says so, until it does', async () => {
    const [store] = await pairedDb();
    const locks = fakeLocks();
    // Another tab holds the engine lock and never answers (frozen).
    void locks.request('library-card-sync-engine', {}, () => new Promise(() => {}));
    const channel = fakeChannels();
    const sync = await service(store, fakeRelay(), { locks, channel: channel(), env: tabEnv(), leaderSilentMs: 30 });
    expect(sync.getStatus()).toMatchObject({ leader: false, leaderSilent: false });
    await vi.waitFor(() => expect(sync.getStatus().leaderSilent).toBe(true));

    channel().postMessage({ type: 'status', status: { state: 'live', lastSynced: null, pendingCount: 0, message: '' } });
    await vi.waitFor(() => expect(sync.getStatus()).toMatchObject({ leaderSilent: false, state: 'live' }));
  });
});
