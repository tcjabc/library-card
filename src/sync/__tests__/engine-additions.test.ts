import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOUSEHOLD_ID } from '../../data/DataStore';
import { createSyncStore } from '../../data/sync/adapter';
import type { SyncDataStore } from '../../data/sync/types';
import { strings } from '../../strings';
import { createSyncService, engineStoreFor, type SyncService } from '../service';
import { generateKey } from '../vendor/crypto.js';
import { statusText } from '../vendor/pairing.js';
import { recoveryFromQr } from '../vendor/qr-scan.js';
import { createKeyVault, SECURE_KEY_ID } from '../vendor/secure-key.js';
import { createSyncEngine, fetchTransport, JoinError, RelayHttpError, type SyncEngine } from '../vendor/sync.js';
import { keyToWords } from '../vendor/words.js';
import { fakeChannels, fakeEnv, fakeLocks, fakeRelay, fakeTimers, RELAY } from './fakes';

/**
 * Library Card's changes to the vendored engine (deleted rooms, polling pace, injected relay URL,
 * subprotocol, deleteRoom) and the sync service (one tab runs the engine), with a fake relay.
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
  const store = await createSyncStore(`additions-${++count}`);
  open.push(store);
  return store;
}

async function pairedEngine(relay = fakeRelay()) {
  const store = await newStore();
  await store.getCurrentHousehold();
  await store.createLibrary({ household_id: HOUSEHOLD_ID, name: 'Central' });
  await store.enableSync(generateKey());
  const timers = fakeTimers();
  const env = fakeEnv();
  const engineStore = engineStoreFor(store);
  const engine: SyncEngine = createSyncEngine({
    store: engineStore, transport: relay.transport, env, timers, random: () => 0.5,
    log: { warn: () => {}, error: () => {} }, defaultRelayUrl: RELAY,
  });
  return { store, timers, env, engine, relay, engineStore };
}

describe('deleted household (410)', () => {
  for (const action of ['push', 'pull'] as const) {
    it(`a 410 on ${action} is terminal: no retry, no re-queue, no more requests`, async () => {
      const { store, timers, env, engine, relay } = await pairedEngine();
      const requeue = vi.spyOn(store, 'requeueAll');
      if (action === 'pull') {
        await engine.start(); // pushes everything first
        relay.fail.pull = 410;
        await engine.syncNow();
      } else {
        relay.fail.push = 410;
        await engine.start();
      }
      const status = engine.getStatus();
      expect(status.state).toBe('deleted');
      expect(status.lastError).toBe(strings.sync.deleted);
      expect(status.live).toBe(false);
      expect([timers.delays(), timers.intervals()]).toEqual([[], []]);
      expect(requeue).not.toHaveBeenCalled();
      const pending = await store.pendingCount();
      const calls = relay.calls.length;
      await engine.syncNow();
      await Promise.all(env.listeners.on.map((fn) => fn()));
      for (const fn of env.listeners.off) fn();
      expect(relay.calls.length).toBe(calls);
      expect(await store.pendingCount()).toBe(pending);
      expect(engine.getStatus().state).toBe('deleted');
      expect(statusText(engine.getStatus())).toBe('Household deleted');
    });
  }

  it('a {"type":"deleted"} message or close code 4410 on the socket is terminal too', async () => {
    for (const how of ['message', 'close'] as const) {
      const sockets: FakeSocket[] = [];
      class FakeSocket {
        onopen: (() => void) | null = null;
        onmessage: ((m: { data: string }) => void) | null = null;
        onclose: ((e: { code: number }) => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public url: string, public protocols: string[]) { sockets.push(this); }
        send() {}
        close() {}
      }
      const timers = fakeTimers();
      const transport = fetchTransport({ fetch: (async () => new Response('{}')) as typeof fetch, WebSocket: FakeSocket, timers });
      const onDeleted = vi.fn();
      const onClose = vi.fn();
      transport.live('https://r.example', 'room', 'tok', 'client', { onHead: () => {}, onClose, onDeleted });
      expect(sockets[0].url).toBe('wss://r.example/v1/rooms/room/live?client=client');
      expect(sockets[0].protocols).toEqual(['library-card-sync.v1', 'bearer.tok']);
      sockets[0].onopen?.();
      if (how === 'message') sockets[0].onmessage?.({ data: '{"type":"deleted"}' });
      else sockets[0].onclose?.({ code: 4410 });
      expect(onDeleted).toHaveBeenCalledTimes(1);
      if (how === 'close') expect(onClose).toHaveBeenCalledWith(4410);
    }

    const { engine, relay, timers } = await pairedEngine();
    await engine.start();
    expect(engine.getStatus().state).toBe('ok');
    relay.sockets.at(-1)!.onDeleted!();
    expect(engine.getStatus().state).toBe('deleted');
    expect([timers.delays(), timers.intervals()]).toEqual([[], []]);
  });

  it('deleteHousehold deletes the room and goes to "deleted"; a room already deleted counts as done', async () => {
    for (const already of [false, true]) {
      const { engine, relay } = await pairedEngine();
      await engine.start();
      if (already) relay.fail.deleteRoom = 410;
      await engine.deleteHousehold();
      expect(relay.calls).toContain('deleteRoom');
      expect(engine.getStatus().state).toBe('deleted');
    }
    const { engine, relay } = await pairedEngine();
    relay.fail.deleteRoom = 503;
    await expect(engine.deleteHousehold()).rejects.toBeInstanceOf(RelayHttpError);
    expect(engine.getStatus().state).not.toBe('deleted');
  });

  it('joining a deleted household fails with JoinError("deleted") and saves nothing', async () => {
    const relay = fakeRelay();
    relay.fail.pull = 410;
    const store = await newStore();
    const engine = createSyncEngine({
      store: engineStoreFor(store), transport: relay.transport, env: fakeEnv(), timers: fakeTimers(),
      log: { warn: () => {}, error: () => {} }, defaultRelayUrl: RELAY,
    });
    for (const mode of ['replace', 'merge'] as const) {
      const error = await engine.joinHousehold(generateKey(), mode).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(JoinError);
      expect((error as JoinError).code).toBe('deleted');
      expect((error as JoinError).message).toBe(strings.sync.join.deleted);
    }
    expect(await store.getConfig()).toBeNull();
  });

  it('fetchTransport.deleteRoom sends DELETE with the token', async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const transport = fetchTransport({ fetch: (async (u: string, init?: RequestInit) => { seen.push([u, init]); return new Response('{"deleted":true}'); }) as typeof fetch });
    await transport.deleteRoom('https://r.example', 'abc', 'tok');
    expect(seen).toEqual([['https://r.example/v1/rooms/abc', { method: 'DELETE', headers: { Authorization: 'Bearer tok' } }]]);
  });
});

describe('polling pace', () => {
  it('every 10 minutes while the socket is open, every 60 s when it closes, and back', async () => {
    const { engine, relay, timers } = await pairedEngine();
    await engine.start();
    expect(engine.getStatus()).toMatchObject({ state: 'ok', live: true });
    expect(timers.intervals()).toEqual([600_000]);
    relay.sockets.at(-1)!.onClose(1006);
    expect(engine.getStatus().live).toBe(false);
    expect(timers.intervals()).toEqual([60_000]);
    expect(timers.delays()).toHaveLength(1); // the socket retry
  });

  it('the paces can be set', async () => {
    const relay = fakeRelay();
    const { store } = await pairedEngine(relay);
    const timers = fakeTimers();
    const engine = createSyncEngine({
      store: engineStoreFor(store), transport: relay.transport, env: fakeEnv(), timers,
      log: { warn: () => {}, error: () => {} }, defaultRelayUrl: RELAY, intervalMs: 5_000, liveIntervalMs: 50_000,
    });
    await engine.start();
    expect(timers.intervals()).toEqual([50_000]);
    engine.stop();
  });
});

describe('vendored helpers', () => {
  it('secure-key: web only, our entry name, the key stays in the store config', async () => {
    expect(SECURE_KEY_ID).toBe('library-card.household-key');
    const store = await newStore();
    const engineStore = engineStoreFor(store);
    const key = generateKey();
    await engineStore.setConfig({ householdKey: key, enabled: true });
    expect(await engineStore.getConfig()).toMatchObject({ householdKey: key, enabled: true, keyUnavailable: false });
    expect((await store.getConfig())!.householdKey).toBe(key);
    await engineStore.setConfig({ householdKey: '', enabled: false });
    expect(await store.getConfig()).toBeNull();
    expect(createKeyVault({ store: { getSyncConfig: async () => ({ householdKey: '', relayUrl: '', enabled: false }), setSyncConfig: async () => {}, replaceWithRemote: async () => {} } }).kind).toBe('web-indexeddb');
  });

  it('qr-scan: recovery words from QR text, or null', async () => {
    const words = (await keyToWords(generateKey())).join(' ');
    expect(await recoveryFromQr(`  ${words.toUpperCase()} `)).toBe(words);
    expect(await recoveryFromQr('https://example.org')).toBeNull();
    expect(await recoveryFromQr(words.split(' ').slice(0, 11).join(' '))).toBeNull();
  });
});

describe('sync service', () => {
  async function service(store: SyncDataStore, relay: ReturnType<typeof fakeRelay>, extra: Partial<Parameters<typeof createSyncService>[0]> = {}) {
    const sync = await createSyncService({
      store, relayUrl: RELAY, transport: relay.transport, env: fakeEnv(), timers: fakeTimers(), random: () => 0.5,
      locks: null, channel: null, log: { warn: () => {}, error: () => {} }, ...extra,
    });
    services.push(sync);
    return sync;
  }

  it('is off until started; start makes a household and goes live; stop(false) clears the device', async () => {
    const relay = fakeRelay();
    const store = await newStore();
    await store.getCurrentHousehold();
    await store.createLibrary({ household_id: HOUSEHOLD_ID, name: 'Central' });
    const sync = await service(store, relay);
    expect(sync.getStatus()).toMatchObject({ state: 'off', leader: true, pendingCount: 0 });
    expect(relay.calls).toEqual([]);

    const seen: string[] = [];
    sync.subscribe((s) => seen.push(s.state));
    const { words } = await sync.start();
    await sync.idle();
    expect(words.split(' ')).toHaveLength(12);
    expect(await sync.recoveryWords()).toBe(words);
    expect(sync.getStatus()).toMatchObject({ state: 'live', pendingCount: 0 });
    expect(sync.getStatus().lastSynced).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(seen).toContain('connecting');
    expect(relay.entries.length).toBeGreaterThan(0);

    await sync.stop(false);
    expect(sync.getStatus().state).toBe('off');
    expect(await sync.localItemCount()).toBe(0);
    expect(await store.getConfig()).toBeNull();
  });

  it('join: an empty device joins as replace even when asked to combine; bad words change nothing', async () => {
    const relay = fakeRelay();
    const a = await service(await newStore(), relay);
    const { words } = await a.start();
    const store = await newStore();
    const b = await service(store, relay);
    await expect(b.join('not twelve words', 'combine')).rejects.toThrow();
    expect(await store.getConfig()).toBeNull();
    expect(await b.join(words, 'combine')).toEqual({ mode: 'replace' });
    await b.idle();
    expect(b.getStatus().state).toBe('live');
  });

  it('only one tab runs the engine; the others show its status and take over when it closes', async () => {
    const relay = fakeRelay();
    const store = await newStore();
    await store.enableSync(generateKey());
    const locks = fakeLocks();
    const channel = fakeChannels();
    const first = await service(store, relay, { locks, channel: channel() });
    await first.idle();
    expect(first.getStatus()).toMatchObject({ leader: true, state: 'live' });

    const second = await service(store, relay, { locks, channel: channel() });
    expect(second.getStatus().leader).toBe(false);
    await vi.waitFor(() => expect(second.getStatus().state).toBe('live')); // told by the first tab

    const pulls = relay.calls.filter((c) => c === 'pull').length;
    await second.syncNow(); // asks the running tab
    await vi.waitFor(() => expect(relay.calls.filter((c) => c === 'pull').length).toBe(pulls + 1));

    await first.dispose();
    await vi.waitFor(() => expect(second.getStatus().leader).toBe(true));
    await second.idle();
    expect(second.getStatus().state).toBe('live');
  });
});
