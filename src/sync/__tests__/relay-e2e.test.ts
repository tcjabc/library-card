import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HOUSEHOLD_ID } from '../../data/DataStore';
import { createSyncStore } from '../../data/sync/adapter';
import type { SyncDataStore } from '../../data/sync/types';
import { createSyncService, type SyncService, type SyncState } from '../service';
import { deriveKeys } from '../vendor/crypto.js';
import { fetchTransport, type SyncEnv, type Timers } from '../vendor/sync.js';

/**
 * End to end: devices (each a sync store and a sync service) sync through the real relay Worker,
 * its Durable Object and R2, run locally in workerd by Wrangler's test harness, as the relay's own
 * tests do. Real fetch, WebSocket and encryption; only the engine's timers are fake, so polling
 * can be checked without waiting. Wrangler comes from relay/node_modules (`npm ci --prefix relay`,
 * as CI does); without it these tests are skipped.
 */

const relayDir = fileURLToPath(new URL('../../../relay/', import.meta.url));
let wranglerPath: string | null = null;
try {
  wranglerPath = createRequire(`${relayDir}package.json`).resolve('wrangler');
} catch {
  wranglerPath = null;
}

interface Harness {
  listen(): Promise<{ url: URL }>;
  close(): Promise<void>;
}

/** Timers that only run when the test says so (the engine's; the network is real). */
function fakeTimers() {
  let n = 0;
  const pending = new Map<number, { fn: () => unknown; ms: number; repeat: boolean }>();
  const timers: Timers & { intervals(): number[]; tickIntervals(): Promise<void>; fire(): Promise<void> } = {
    setTimeout: (fn, ms) => { const id = ++n; pending.set(id, { fn, ms, repeat: false }); return id; },
    clearTimeout: (id) => { pending.delete(id as number); },
    setInterval: (fn, ms) => { const id = ++n; pending.set(id, { fn, ms, repeat: true }); return id; },
    clearInterval: (id) => { pending.delete(id as number); },
    /** The engine's poll interval(s); the socket's 30 s ping is left out. */
    intervals: () => [...pending.values()].filter((t) => t.repeat && t.ms !== 30_000).map((t) => t.ms),
    async tickIntervals() {
      for (const t of [...pending.values()].filter((x) => x.repeat && x.ms !== 30_000)) await t.fn();
    },
    async fire() {
      const due = [...pending.entries()].filter(([, t]) => !t.repeat);
      for (const [id] of due) pending.delete(id);
      for (const [, t] of due) await t.fn();
    },
  };
  return timers;
}

/** Poll (in real time) until `check` passes. */
async function until(check: () => Promise<boolean> | boolean, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface Device {
  name: string;
  store: SyncDataStore;
  sync: SyncService;
  timers: ReturnType<typeof fakeTimers>;
  net: { up: boolean };
  env: SyncEnv & { online: boolean; offline(): void; reconnect(): Promise<void> };
  libraries(): Promise<{ name: string; days: number }[]>;
  addLibrary(name: string, days?: number): Promise<string>;
  state(): SyncState;
}

describe.skipIf(!wranglerPath)('sync through the local relay (workerd)', () => {
  let harness: Harness;
  let base = '';
  const devices: Device[] = [];
  let count = 0;

  beforeAll(async () => {
    const { createTestHarness } = (await import(pathToFileURL(wranglerPath!).href)) as {
      createTestHarness(options: { root: string; workers: { configPath: string }[] }): Harness;
    };
    harness = createTestHarness({ root: relayDir, workers: [{ configPath: 'wrangler.toml' }] });
    base = (await harness.listen()).url.href;
  }, 120_000);

  afterEach(async () => {
    for (const d of devices.splice(0)) {
      await d.sync.dispose();
      await d.store.close();
    }
  });

  afterAll(async () => {
    await harness?.close();
  }, 60_000);

  async function device(name: string): Promise<Device> {
    const store = await createSyncStore(`e2e-${name}-${++count}`);
    const net = { up: true };
    const timers = fakeTimers();
    const listeners = { vis: [] as ((v: boolean) => void)[], on: [] as (() => unknown)[], off: [] as (() => void)[] };
    const env: Device['env'] = {
      online: true,
      isVisible: () => true,
      isOnline: () => env.online,
      onVisibility: (fn) => listeners.vis.push(fn),
      onOnline: (fn) => listeners.on.push(fn),
      onOffline: (fn) => listeners.off.push(fn),
      offline() {
        net.up = false;
        env.online = false;
        for (const fn of listeners.off) fn();
      },
      async reconnect() {
        net.up = true;
        env.online = true;
        await Promise.all(listeners.on.map((fn) => fn()));
      },
    };
    const fetchFn: typeof fetch = (input, init) => (net.up ? fetch(input, init) : Promise.reject(new TypeError('fetch failed')));
    const sync = await createSyncService({
      store,
      relayUrl: base,
      transport: fetchTransport({ fetch: fetchFn, timers }),
      env,
      timers,
      random: () => 0.5,
      locks: null,
      channel: null,
      log: { warn: () => {}, error: (e) => console.error(name, e) },
    });
    const d: Device = {
      name, store, sync, timers, net, env,
      async libraries() {
        return (await store.listLibraries(HOUSEHOLD_ID)).map((l) => ({ name: l.name, days: l.default_loan_days })).sort((a, b) => a.name.localeCompare(b.name));
      },
      async addLibrary(libName, days = 21) {
        await store.getCurrentHousehold();
        return (await store.createLibrary({ household_id: HOUSEHOLD_ID, name: libName, default_loan_days: days })).id;
      },
      state: () => sync.getStatus().state,
    };
    devices.push(d);
    return d;
  }

  /** Entries the relay holds for this device's household (its log's head). */
  async function relayEntries(d: Device): Promise<number> {
    const key = (await d.store.getConfig())!.householdKey;
    const { roomId, token } = await deriveKeys(key);
    const res = await fetch(`${base}v1/rooms/${roomId}/pull?after=0&limit=1`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) return -res.status;
    return ((await res.json()) as { head: number }).head;
  }

  const live = (d: Device) => until(() => d.state() === 'live', `${d.name} live`);

  it('start on A, join B with combine: both have everything, edits and deletes go both ways', async () => {
    const a = await device('a');
    const b = await device('b');
    await a.addLibrary('Central', 14);
    const { words } = await a.sync.start();
    expect(words.split(' ')).toHaveLength(12);
    await live(a);

    await b.addLibrary('Branch', 21);
    expect(await b.sync.join(words, 'combine')).toEqual({ mode: 'combine' });
    await live(b);
    await a.sync.syncNow();
    expect(await a.libraries()).toEqual([{ name: 'Branch', days: 21 }, { name: 'Central', days: 14 }]);
    expect(await b.libraries()).toEqual(await a.libraries());

    // A edit on B reaches A over the live socket (no Sync now on A).
    const [branch] = await b.store.listLibraries(HOUSEHOLD_ID).then((l) => l.filter((x) => x.name === 'Branch'));
    await b.store.updateLibrary(branch.id, { default_loan_days: 28 });
    await b.sync.syncNow();
    await until(async () => (await a.libraries()).some((l) => l.days === 28), 'edit on A');

    // A delete on A reaches B.
    const [central] = await a.store.listLibraries(HOUSEHOLD_ID).then((l) => l.filter((x) => x.name === 'Central'));
    await a.store.deleteLibrary(central.id);
    await a.sync.syncNow();
    await until(async () => (await b.libraries()).length === 1, 'delete on B');
    expect(await b.libraries()).toEqual([{ name: 'Branch', days: 28 }]);
    expect(b.sync.getStatus().pendingCount).toBe(0);
  }, 60_000);

  it('join B with replace: B ends up with exactly the household data', async () => {
    const a = await device('a');
    const b = await device('b');
    await a.addLibrary('Household library');
    const { words } = await a.sync.start();
    await b.addLibrary('Only on B');
    expect(await b.sync.join(words, 'replace')).toEqual({ mode: 'replace' });
    expect(await b.libraries()).toEqual([{ name: 'Household library', days: 21 }]);
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(await a.libraries()).toEqual([{ name: 'Household library', days: 21 }]);
  }, 60_000);

  it('an empty device joins as replace without asking', async () => {
    const a = await device('a');
    const b = await device('b');
    await a.addLibrary('Central');
    const { words } = await a.sync.start();
    expect(await b.sync.localItemCount()).toBe(0);
    expect(await b.sync.join(words, 'combine')).toEqual({ mode: 'replace' });
    expect(await b.libraries()).toEqual(await a.libraries());
    expect(await b.store.pendingCount()).toBe(0);
  }, 60_000);

  it('concurrent edits to the same field converge on both devices', async () => {
    const a = await device('a');
    const b = await device('b');
    const id = await a.addLibrary('Central');
    const { words } = await a.sync.start();
    await b.sync.join(words, 'replace');
    await live(a);
    await live(b);
    // Both edit before either has synced; the later stamp wins everywhere.
    a.env.offline();
    b.env.offline();
    await a.store.updateLibrary(id, { name: 'Central (A)', default_loan_days: 7 });
    await b.store.updateLibrary(id, { name: 'Central (B)' });
    await a.env.reconnect();
    await b.env.reconnect();
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(await a.libraries()).toEqual([{ name: 'Central (B)', days: 7 }]);
    expect(await b.libraries()).toEqual(await a.libraries());
  }, 60_000);

  it('re-joining sends no duplicates: the relay log does not grow', async () => {
    const a = await device('a');
    const b = await device('b');
    await a.addLibrary('Central');
    const { words } = await a.sync.start();
    await b.addLibrary('Branch');
    await b.sync.join(words, 'combine');
    await b.sync.syncNow();
    await a.sync.syncNow();
    const entries = await relayEntries(a);
    expect(entries).toBeGreaterThan(0);

    // B turns sync off (keeping its data) and joins again with the same words, both ways round.
    await b.sync.stop(true);
    expect(b.state()).toBe('off');
    await b.sync.join(words, 'combine');
    await b.sync.syncNow();
    expect(await relayEntries(a)).toBe(entries);
    await a.sync.stop(true);
    await a.sync.join(words, 'combine');
    await a.sync.syncNow();
    expect(await relayEntries(a)).toBe(entries);
    expect(await a.libraries()).toEqual(await b.libraries());
  }, 60_000);

  it('polls every 10 minutes while the socket is open and every 60 s while it is down', async () => {
    const a = await device('a');
    await a.sync.start();
    await live(a);
    expect(a.timers.intervals()).toEqual([600_000]);

    // The socket goes (offline): the engine falls back to polling every minute.
    a.env.offline();
    await until(() => a.state() === 'offline', 'offline');
    expect(a.timers.intervals()).toEqual([60_000]);

    // Back online: it syncs, the socket opens again and polling slows down.
    await a.env.reconnect();
    await live(a);
    expect(a.timers.intervals()).toEqual([600_000]);
  }, 60_000);

  it('a device without WebSocket polls every 60 s and still gets changes', async () => {
    const a = await device('a');
    const { words } = await a.sync.start();
    const store = await createSyncStore(`e2e-nows-${++count}`);
    const timers = fakeTimers();
    const env = { isVisible: () => true, isOnline: () => true, onVisibility() {}, onOnline() {}, onOffline() {} };
    const sync = await createSyncService({
      store, relayUrl: base, transport: fetchTransport({ WebSocket: null as never, timers }), env, timers,
      random: () => 0.5, locks: null, channel: null, log: { warn: () => {}, error: () => {} },
    });
    try {
      await sync.join(words, 'replace');
      await until(() => sync.getStatus().state === 'polling', 'polling');
      expect(timers.intervals()).toEqual([60_000]);
      await a.addLibrary('Polled');
      await a.sync.syncNow();
      await timers.tickIntervals();
      await sync.idle();
      expect((await store.listLibraries(HOUSEHOLD_ID)).map((l) => l.name)).toEqual(['Polled']);
    } finally {
      await sync.dispose();
      await store.close();
    }
  }, 60_000);

  it('offline, then online: queued changes go out and the other side catches up', async () => {
    const a = await device('a');
    const b = await device('b');
    const { words } = await a.sync.start();
    await b.sync.join(words, 'replace');
    b.env.offline();
    await b.addLibrary('Added offline', 10);
    await b.sync.syncNow();
    expect(b.state()).toBe('offline');
    expect(b.sync.getStatus().pendingCount).toBeGreaterThan(0);
    await a.addLibrary('Added on A', 12);
    await a.sync.syncNow();

    await b.env.reconnect(); // the online event syncs
    await b.sync.idle();
    await a.sync.syncNow();
    const both = [{ name: 'Added offline', days: 10 }, { name: 'Added on A', days: 12 }];
    expect(await b.libraries()).toEqual(both);
    expect(await a.libraries()).toEqual(both);
    expect(b.sync.getStatus().pendingCount).toBe(0);
  }, 60_000);

  it('deleteHousehold puts both devices into "deleted", and nothing recreates the room', async () => {
    const a = await device('a');
    const b = await device('b');
    await a.addLibrary('Central');
    const { words } = await a.sync.start();
    await b.sync.join(words, 'combine');
    await live(a);
    await live(b);

    await a.sync.deleteHousehold();
    expect(a.state()).toBe('deleted');
    await until(() => b.state() === 'deleted', 'B told over its socket');
    expect(b.sync.getStatus().message).toMatch(/deleted/);
    expect(await relayEntries(a)).toBe(-410);

    // Local edits on B are kept but never sent; Sync now does nothing.
    await b.addLibrary('After the delete');
    await b.sync.syncNow();
    expect(b.state()).toBe('deleted');
    expect(await b.libraries()).toContainEqual({ name: 'After the delete', days: 21 });

    // A fresh service on B's store (the app reopened) hears 410 and stays deleted, no new room.
    await b.sync.dispose();
    const again = await createSyncService({
      store: b.store, relayUrl: base, transport: fetchTransport({ timers: b.timers }), env: b.env, timers: b.timers,
      random: () => 0.5, locks: null, channel: null, log: { warn: () => {}, error: () => {} },
    });
    try {
      await until(() => again.getStatus().state === 'deleted', 'deleted after reopening');
      expect(await relayEntries(a)).toBe(-410);
    } finally {
      await again.dispose();
    }
    b.sync = again; // disposed above; afterEach disposes again harmlessly

    // Starting a new household from B works (a new key, a new room) and keeps B's data.
    const fresh = await createSyncService({
      store: b.store, relayUrl: base, transport: fetchTransport({ timers: b.timers }), env: b.env, timers: b.timers,
      random: () => 0.5, locks: null, channel: null, log: { warn: () => {}, error: () => {} },
    });
    try {
      await fresh.stop(true);
      await fresh.start();
      await until(() => fresh.getStatus().state === 'live', 'the new household is live');
      expect(await relayEntries(b)).toBeGreaterThan(0);
    } finally {
      await fresh.dispose();
    }
  }, 90_000);
});
