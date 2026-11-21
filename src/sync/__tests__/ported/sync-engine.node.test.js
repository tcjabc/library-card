// Ported from Peek Budget tests/sync-engine.node.test.js (tcjabc/substracker, commit f0385ee); see
// VENDORED.md. Library Card: each device is a real sync store (createSyncStore on fake-indexeddb,
// read and written through the key vault as src/sync/service.ts does) instead of Peek's in-memory
// store, and Peek's "expense" items are libraries (name → name, price → default_loan_days,
// notes → sticker_prefix), written through the DataStore API like the app does. The relay is our
// own room logic (relay/src/room-logic.js). The two settings tests are dropped (Library Card has
// no shared settings record), and so are the settings lines of three join tests. Tests that
// needed Peek's store internals read IndexedDB instead.
//
// Node tests for js/sync.js: several simulated devices sync through an in-memory relay built on
// the relay's own room logic, with real encryption. Run with `npm test`.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as core from '../../vendor/sync-core.js';
import * as box from '../../vendor/crypto.js';
import { createSyncEngine, RelayHttpError, JoinError, normalizeRelayUrl, DEFAULT_RELAY_URL, keyNeededMessage } from '../../vendor/sync.js';
import { RoomCore, memoryStore } from '../../../../relay/src/room-logic.js';
import { createSyncStore } from '../../../data/sync/adapter';
import { wireId } from '../../../data/sync/schema';
import { rawAll } from '../../../data/testing/fixtures';
import { HOUSEHOLD_ID } from '../../../data/DataStore';
import { engineStoreFor } from '../../service';

const RELAY = 'https://relay.example';
const KEY = box.generateKey();

/* ------------------------------------------------------------------ Fakes */

/** The relay: one RoomCore per room. Devices can be cut off; responses can be forced. */
function memoryRelay() {
  const rooms = new Map();
  const sockets = new Set();
  const forced = []; // [{ action, status, retryAfter }]
  const roomOf = (id) => {
    if (!rooms.has(id)) rooms.set(id, { store: memoryStore(), core: null });
    const r = rooms.get(id);
    r.core ??= new RoomCore(r.store, { limits: { rateCapacity: 1e9 } });
    return r;
  };
  const relay = {
    rooms, forced, calls: [],
    // Library Card: test keys ('x', 'y', …) → library ids, shared by every device on this relay.
    ids: new Map(),
    wipe() { rooms.clear(); },
    /** A transport as seen from one device; `net.up` false makes requests fail like fetch does offline. */
    transport(net, hooks = {}) {
      const check = (action) => {
        relay.calls.push(action);
        if (!net.up) throw new TypeError('fetch failed');
        const i = forced.findIndex((f) => f.action === action);
        if (i >= 0) {
          const [f] = forced.splice(i, 1);
          throw new RelayHttpError(f.status, f.code ?? 'forced', 'forced', f.retryAfter ? f.retryAfter * 1000 : undefined);
        }
      };
      const unwrap = (r) => {
        if (r.status !== 200) throw new RelayHttpError(r.status, r.body.error, r.body.message, r.headers?.['Retry-After'] * 1000 || undefined);
        return JSON.parse(JSON.stringify(r.body));
      };
      return {
        async push(base, room, token, envelopes, client) {
          check('push');
          await hooks.beforePush?.();
          const res = unwrap(await roomOf(room).core.push({ token, bodyText: JSON.stringify({ envelopes }) }));
          if (res.accepted) for (const s of sockets) if (s.room === room && s.client !== client) s.onHead(res.head);
          return res;
        },
        async pull(base, room, token, after, limit) {
          check('pull');
          await hooks.beforePull?.(after);
          if (!rooms.has(room)) return unwrap({ status: 404, body: { error: 'no_room', message: 'none' } });
          return unwrap(await roomOf(room).core.pull({ token, after: String(after), limit: String(limit) }));
        },
        live(base, room, token, client, { onHead, onClose }) {
          if (!net.up) { onClose(); return { close() {} }; }
          const s = { room, client, onHead, onClose };
          sockets.add(s);
          return { close() { if (sockets.delete(s)) onClose(); } };
        },
        async deleteRoom() { throw new Error('not used here'); },
      };
    },
    dropSockets() { for (const s of [...sockets]) { sockets.delete(s); s.onClose(); } },
  };
  return relay;
}

/** Timers that only run when the test says so. */
function fakeTimers() {
  let n = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout(fn, ms) { const id = ++n; pending.set(id, { fn, ms, repeat: false }); return id; },
    clearTimeout(id) { pending.delete(id); },
    setInterval(fn, ms) { const id = ++n; pending.set(id, { fn, ms, repeat: true }); return id; },
    clearInterval(id) { pending.delete(id); },
    delays: () => [...pending.values()].filter((t) => !t.repeat).map((t) => t.ms),
    /** Run the one-shot timers that are due now (all of them). */
    async fire() {
      const due = [...pending.entries()].filter(([, t]) => !t.repeat);
      for (const [id] of due) pending.delete(id);
      for (const [, t] of due) await t.fn();
    },
    async tickIntervals() { for (const t of [...pending.values()].filter((x) => x.repeat)) await t.fn(); },
  };
}

let dbCount = 0;

/**
 * A device: a sync store of its own (Library Card: a fake-indexeddb database), local edit helpers,
 * its own clock offset, network, timers and engine.
 */
async function device(name, relay, { skewMs = 0, hooks, key = KEY } = {}) {
  const net = { up: true };
  const env = {
    visible: true, online: true, listeners: { vis: [], on: [], off: [] },
    isVisible() { return this.visible; }, isOnline() { return this.online; },
    onVisibility(fn) { this.listeners.vis.push(fn); }, onOnline(fn) { this.listeners.on.push(fn); }, onOffline(fn) { this.listeners.off.push(fn); },
  };
  const now = () => Date.now() + skewMs;
  const dbName = `engine-${name}-${++dbCount}`;
  const data = await createSyncStore(dbName, { now });
  if (key) await data.enableSync(key, { relayUrl: RELAY });
  // Library Card: failure switches and counters around the real store (Peek's fake had them inside).
  const s = { failApply: false, failReplace: false, applyCalls: 0, replaceCalls: 0, keyUnavailable: false };
  const real = engineStoreFor(data);
  const store = {
    ...real,
    async getConfig() {
      if (s.keyUnavailable) return { relayUrl: RELAY, householdKey: '', enabled: true, keyUnavailable: true };
      return real.getConfig();
    },
    async setConfig(p) { if (typeof p.householdKey === 'string') s.keyUnavailable = false; return real.setConfig(p); },
    async applyRemote(ops, cursor) {
      s.applyCalls++;
      if (s.failApply) throw new Error('disk full'); // the real one is one transaction: nothing applied
      return real.applyRemote(ops, cursor);
    },
    async replaceWithRemote(ops, cursor, cfg) {
      s.replaceCalls++;
      if (s.failReplace) throw new Error('disk full');
      s.keyUnavailable = false;
      return real.replaceWithRemote(ops, cursor, cfg);
    },
    async enableSync(k, o) { s.keyUnavailable = false; return real.enableSync(k, o); },
  };
  const timers = fakeTimers();
  const warnings = [];
  const engine = createSyncEngine({
    store, transport: relay.transport(net, hooks), env, timers, now, random: () => 0.5,
    log: { warn: (m) => warnings.push(m), error: (e) => warnings.push(String(e)) },
    clientId: `client-${name}`,
    defaultRelayUrl: RELAY,
  });
  const idOf = (k) => relay.ids.get(k);
  const keyOf = (id) => [...relay.ids].find(([, v]) => v === id)?.[0] ?? id;
  const fieldsOf = (fields) => {
    const out = {};
    if ('name' in fields) out.name = fields.name;
    if ('price' in fields) out.default_loan_days = fields.price;
    if ('notes' in fields) out.sticker_prefix = fields.notes || null;
    return out;
  };
  return {
    name, s, net, env, timers, engine, warnings, store, data, dbName,
    async add(k, fields) {
      await data.getCurrentHousehold();
      if (idOf(k)) {
        // Library Card: a library with an id another device made (Peek: "same id"). The API makes
        // new ids, so write it the way a restore would, before this device syncs.
        const backup = await data.exportBackup();
        backup.tables.libraries.push({ id: idOf(k), household_id: HOUSEHOLD_ID, search_url_template: null, homepage_url: null, default_loan_days: 21, sticker_prefix: null, ...fieldsOf(fields) });
        await data.importBackup(backup);
        return;
      }
      const lib = await data.createLibrary({ household_id: HOUSEHOLD_ID, ...fieldsOf(fields) });
      relay.ids.set(k, lib.id);
    },
    async edit(k, fields) { await data.updateLibrary(idOf(k), fieldsOf(fields)); },
    async remove(k) { await data.deleteLibrary(idOf(k)); },
    async items() {
      const libs = await data.listLibraries(HOUSEHOLD_ID);
      return libs.map((l) => ({ id: keyOf(l.id), name: l.name, price: l.default_loan_days, notes: l.sticker_prefix ?? '' }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    /** Library Card: what Peek's tests read from the fake store. */
    outboxSize: () => data.pendingCount(),
    cursor: () => data.getCursor(),
    async config() { return (await data.getConfig()) ?? { householdKey: '', enabled: false }; },
    async records() { return new Map((await rawAll(dbName, 'records')).map((r) => [r.id, r])); },
    record: async (k) => (await rawAll(dbName, 'records')).find((r) => r.id === wireId('libraries', idOf(k) ?? k)),
    async snapshot() {
      const [records, outbox, meta] = await Promise.all(['records', 'outbox', 'meta'].map((t) => rawAll(dbName, t)));
      return JSON.stringify({ records, outbox, meta, items: await this.items() });
    },
    goOffline() { net.up = false; env.online = false; },
    goOnline() { net.up = true; env.online = true; return Promise.all(env.listeners.on.map((fn) => fn())); },
  };
}

const sync = (...devices) => devices.reduce((p, d) => p.then(() => d.engine.syncNow()), Promise.resolve());
const expense = (name, price) => ({ name, price, notes: '' });
/** Library Card: how many fields a device has recorded (what it would send). */
const fieldCount = async (d) => [...(await d.records()).values()].reduce((n, r) => n + Object.keys(r.fields).length, 0);

/* ------------------------------------------------------------------ Tests */

test('an expense added on one device appears on another, and edits and deletes follow', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  const b = await device('devB', relay);
  await a.engine.start();
  await b.engine.start();
  await a.add('x', expense('Example Streaming', 250));
  await sync(a, b);
  assert.deepEqual(await b.items(), await a.items());
  assert.equal((await b.items())[0].name, 'Example Streaming');
  assert.equal(b.engine.getStatus().state, 'ok');

  await b.edit('x', { price: 300 });
  await sync(b, a);
  assert.equal((await a.items())[0].price, 300);

  await a.remove('x');
  await sync(a, b);
  assert.deepEqual(await b.items(), []);
  assert.equal((await b.record('x')).fields[core.DELETED], true, 'tombstone, not removed');
});

test('three devices converge through offline periods and concurrent edits', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  const b = await device('devB', relay, { skewMs: -3 * 3600_000 }); // clock 3 h behind
  const c = await device('devC', relay, { skewMs: 2 * 3600_000 }); // clock 2 h ahead
  for (const d of [a, b, c]) await d.engine.start();

  await a.add('x', expense('Example Streaming', 250));
  await a.add('y', expense('Example Cloud', 30));
  await sync(a, b, c);

  c.goOffline();
  await b.edit('x', { notes: 'from B' }); // different fields of the same record
  await a.edit('x', { price: 260 });
  await c.edit('y', { price: 35 }); // made offline
  await c.add('z', expense('Example Gym', 900));
  await c.engine.syncNow();
  assert.equal(c.engine.getStatus().state, 'offline');
  await sync(a, b);
  await a.remove('y'); // deleted while C still has an edit for it queued
  await sync(a, b);
  await c.goOnline(); // the online event triggers a sync
  await c.engine.idle();
  await sync(a, b, c, a, b);

  for (const d of [b, c]) assert.deepEqual(await d.items(), await a.items(), `${d.name} converged`);
  const [x, z] = await a.items();
  assert.deepEqual([x.id, x.price, x.notes, z.id], ['x', 260, 'from B', 'z']);
  assert.equal((await a.items()).some((i) => i.id === 'y'), false, 'the delete stands');
  for (const d of [a, b, c]) assert.equal(await d.outboxSize(), 0, `${d.name} sent everything`);
});

test('pulled ops are never queued to send back (no outbox echo)', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  const b = await device('devB', relay);
  await a.engine.start();
  await b.engine.start();
  await a.add('x', expense('Example', 1));
  await sync(a);
  const pushesBefore = relay.calls.filter((c) => c === 'push').length;
  await sync(b, b);
  assert.equal(await b.outboxSize(), 0);
  assert.equal(relay.calls.filter((c) => c === 'push').length, pushesBefore, 'B pushed nothing');
  const [room] = relay.rooms.values();
  assert.equal(room.store.size, await fieldCount(a), 'relay holds only A\'s ops');
});

test('a sent op leaves the outbox only if no newer local edit replaced it meanwhile', async () => {
  const relay = memoryRelay();
  let a;
  let editDuringPush = false;
  a = await device('devA', relay, {
    hooks: { beforePush: async () => { if (editDuringPush) { editDuringPush = false; await a.edit('x', { price: 2 }); } } },
  });
  const b = await device('devB', relay);
  await a.engine.start();
  await b.engine.start();
  await a.add('x', expense('Example', 1));
  editDuringPush = true;
  await a.engine.syncNow(); // the edit lands while the first push is in flight
  // The newer price stayed pending and went out in the next round of the same sync.
  assert.equal(await a.outboxSize(), 0);
  await sync(b);
  assert.equal((await b.items())[0].price, 2, 'the later edit reached B');
});

test('cursor and ops move together: a failed apply changes nothing and is retried', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  const b = await device('devB', relay);
  await a.engine.start();
  await a.add('x', expense('Example', 1));
  await sync(a);
  b.s.failApply = true;
  await b.engine.start(); // first sync fails while applying
  assert.deepEqual([await b.cursor(), (await b.items()).length], [0, 0], 'nothing applied, cursor not moved');
  assert.equal(b.engine.getStatus().state, 'error');
  assert.equal(b.timers.delays().length, 1, 'a retry is scheduled');
  b.s.failApply = false;
  await b.timers.fire();
  await b.engine.idle();
  assert.deepEqual([(await b.items()).length, (await b.cursor()) > 0], [1, true]);
});

test('401 stops automatic retries until Sync now; 429 waits for Retry-After; network errors back off', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  await a.engine.start();
  await a.add('x', expense('Example', 1));

  relay.forced.push({ action: 'push', status: 401 });
  await a.engine.syncNow();
  let st = a.engine.getStatus();
  assert.equal(st.state, 'error');
  assert.match(st.lastError, /household key/);
  assert.deepEqual(a.timers.delays(), [], 'no automatic retry after 401');
  assert.equal((await a.outboxSize()) > 0, true, 'nothing lost');

  relay.forced.push({ action: 'push', status: 429, retryAfter: 7 });
  await a.engine.syncNow();
  assert.match(a.engine.getStatus().lastError, /busy/);
  assert.deepEqual(a.timers.delays(), [7000], 'Retry-After respected');
  await a.timers.fire();
  await a.engine.idle();
  assert.equal(a.engine.getStatus().state, 'ok');
  assert.equal(await a.outboxSize(), 0);

  // Network down while the device thinks it's online: offline status and growing, jittered delays.
  a.net.up = false;
  await a.add('y', expense('Example 2', 2));
  const delays = [];
  for (let i = 0; i < 4; i++) {
    if (i === 0) await a.engine.syncNow(); else { await a.timers.fire(); await a.engine.idle(); }
    delays.push(...a.timers.delays());
  }
  assert.equal(a.engine.getStatus().state, 'offline');
  assert.deepEqual(delays, [2000, 4000, 8000, 16000], 'exponential (jitter fixed at ×1 here)');
  await a.add('z', expense('Saved offline', 3)); // local saves keep working
  assert.equal((await a.outboxSize()) > 0, true);
  a.net.up = true;
  await a.timers.fire();
  await a.engine.idle();
  assert.equal(a.engine.getStatus().state, 'ok');
  assert.equal(await a.outboxSize(), 0);
});

test('jitter keeps retries between half and one and a half times the base delay', async () => {
  const relay = memoryRelay();
  for (const r of [0, 0.999]) {
    const d = await device('devJ', relay);
    d.engine.stop();
    const e = createSyncEngine({ store: d.store, transport: relay.transport({ up: false }), env: d.env, timers: d.timers, random: () => r, log: { warn() {}, error() {} }, defaultRelayUrl: RELAY });
    await e.start();
    const [ms] = d.timers.delays();
    assert.equal(ms >= 1000 && ms <= 3000, true, `${ms}`);
  }
});

test('envelopes that fail to decrypt are skipped and counted, never applied', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  const b = await device('devB', relay);
  await a.engine.start();
  await b.engine.start();
  await a.add('x', expense('Example', 1));
  await sync(a);
  // Someone with the token but not the key slips in garbage.
  const { roomId, token } = await box.deriveKeys(KEY);
  const room = relay.rooms.get(roomId);
  await room.core.push({ token, bodyText: JSON.stringify({ envelopes: [{ id: 'junk', wall: Date.now(), c: Buffer.from('not sealed').toString('base64') }] }) });
  const other = await box.deriveKeys(box.generateKey());
  const wrong = await box.seal(other.aesKey, { id: 'w1', rec: wireId('libraries', relay.ids.get('x')), f: 'default_loan_days', v: 999, t: core.formatStamp(Date.now() + 1000, 0, 'evil'), dev: 'evil' });
  await room.core.push({ token, bodyText: JSON.stringify({ envelopes: [wrong] }) });
  await sync(b);
  assert.equal((await b.items())[0].price, 1);
  assert.deepEqual(b.warnings, ['Sync: ignored 2 change(s) that could not be verified.']);
  assert.equal(await b.cursor(), room.store.head(), 'cursor moved past them');
});

test('syncs never overlap: requests during a run are coalesced into one more run', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  await a.engine.start();
  await a.add('x', expense('Example', 1));
  relay.calls.length = 0;
  await Promise.all([a.engine.syncNow(), a.engine.syncNow(), a.engine.syncNow(), a.engine.syncNow()]);
  const pulls = relay.calls.filter((c) => c === 'pull').length;
  assert.equal(pulls <= 2, true, `${pulls} pulls for 4 requests`);
});

test('triggers: local change (debounced), live head from another device, visibility and interval', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  const b = await device('devB', relay);
  await a.engine.start();
  await b.engine.start();

  await a.add('x', expense('Example', 1));
  assert.deepEqual(a.timers.delays(), [1000], 'debounced ~1 s');
  await a.timers.fire();
  await a.engine.idle();
  await b.engine.idle(); // B was told over its live socket and pulled on its own
  assert.equal((await b.items()).length, 1, 'arrived via the live socket');

  b.env.visible = false;
  b.env.listeners.vis.forEach((fn) => fn(false));
  assert.equal([...b.timers.pending.values()].some((t) => t.repeat), false, 'no interval while hidden');
  await a.edit('x', { price: 5 });
  await a.timers.fire();
  await a.engine.idle();
  assert.equal((await b.items())[0].price, 1, 'hidden: socket closed, nothing pulled');
  b.env.visible = true;
  await Promise.all(b.env.listeners.vis.map((fn) => fn(true)));
  await b.engine.idle();
  assert.equal((await b.items())[0].price, 5, 'pulled when visible again');

  await a.edit('x', { price: 6 });
  relay.dropSockets(); // B's socket is gone; the interval still catches up
  await a.engine.syncNow();
  await b.timers.tickIntervals();
  await b.engine.idle();
  assert.equal((await b.items())[0].price, 6);
});

test('a relay that lost its data gets everything again', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  await a.engine.start();
  await a.add('x', expense('Example', 1));
  await sync(a);
  relay.wipe();
  await sync(a); // pull → 404 with a cursor > 0 → re-queue everything and push again
  const b = await device('devB', relay);
  await b.engine.start();
  await b.engine.idle();
  assert.deepEqual(await b.items(), await a.items());
});

test('changes stamped more than a day ahead stay queued with a clear message, the rest goes through', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay, { skewMs: 3 * 86_400_000 });
  await a.engine.start();
  await a.add('x', expense('Example', 1));
  await a.engine.syncNow();
  const st = a.engine.getStatus();
  assert.equal(st.state, 'ok');
  assert.match(st.lastError, /clock/);
  assert.equal(st.pendingCount > 0, true, 'still queued');
});

test('disconnect stops syncing and forgets the key but keeps local data', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  await a.engine.start();
  await a.add('x', expense('Example', 1));
  await sync(a);
  await a.engine.disconnect();
  const cfg = await a.config();
  assert.deepEqual([cfg.householdKey, cfg.enabled, a.engine.getStatus().state], ['', false, 'off']);
  assert.equal((await a.items()).length, 1);
  relay.calls.length = 0;
  await a.edit('x', { price: 2 });
  await a.timers.fire();
  await a.engine.idle();
  assert.deepEqual(relay.calls, [], 'no network after disconnect');
});

test('joining with the key on a device that already has data sends that data too', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  await a.engine.start();
  await a.add('x', expense('From A', 1));
  await sync(a);
  const b = await device('devB', relay, { key: '' });
  await b.engine.start();
  await b.add('y', expense('From B before joining', 2));
  // Library Card: B joins with "combine" (Peek set the key with configure(); our store turns sync
  // on with enableSync, which records and queues everything this device has).
  await b.engine.joinHousehold(KEY, 'merge');
  await sync(a);
  assert.deepEqual((await a.items()).map((i) => i.id), ['x', 'y']);
  assert.deepEqual(await b.items(), await a.items());
});

test('status updates are emitted and never contain the key or token', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  const seen = [];
  a.engine.onStatus((s) => seen.push(s));
  await a.engine.start();
  relay.forced.push({ action: 'pull', status: 500 });
  await a.engine.syncNow();
  const { token } = await box.deriveKeys(KEY);
  const text = JSON.stringify(seen);
  assert.equal(text.includes(KEY) || text.includes(token), false);
  assert.deepEqual([...new Set(seen.map((s) => s.state))].sort(), ['error', 'ok', 'syncing']);
});

test('relay URLs: HTTPS anywhere, plain HTTP only to this machine', () => {
  assert.equal(normalizeRelayUrl(' https://relay.example.workers.dev/ '), 'https://relay.example.workers.dev');
  assert.equal(normalizeRelayUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeRelayUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  for (const bad of ['http://relay.example', 'ftp://x', 'not a url', 'https://u:p@relay.example', 'https://relay.example/?t=1', '']) {
    assert.equal(normalizeRelayUrl(bad), null, bad);
  }
});

/* ------------------------------------------------------------------ Starting and joining a household */

/** A device with no household yet (sync off), already started. */
async function unpaired(name, relay, opts) {
  const d = await device(name, relay, { ...opts, key: '' });
  await d.engine.start();
  return d;
}

const roomSize = (relay) => [...relay.rooms.values()][0].store.size;

test('the relay URL is passed in, used when no override is stored', async () => {
  // Library Card: no URL is written in sync.js; the app passes VITE_SYNC_RELAY_URL in.
  assert.equal(DEFAULT_RELAY_URL, '');
  const relay = memoryRelay();
  const seen = [];
  const a = await unpaired('devA', relay, { hooks: { beforePull: () => {} } });
  const t = relay.transport(a.net);
  const injected = 'https://relay.injected.example';
  const engine = createSyncEngine({
    store: a.store, env: a.env, timers: a.timers, log: { warn() {}, error() {} }, defaultRelayUrl: injected,
    transport: { ...t, async pull(base, ...rest) { seen.push(base); return t.pull(base, ...rest); } },
  });
  await engine.checkHousehold(box.generateKey());
  assert.deepEqual(seen, [injected]);
});

test('start: claims the room before anything is added, so another device can join at once', async () => {
  const relay = memoryRelay();
  const a = await unpaired('devA', relay);
  const key = box.generateKey();
  await a.engine.startHousehold(key);
  assert.equal((await a.config()).householdKey, key);
  assert.equal((await a.config()).enabled, true);
  assert.equal(a.engine.getStatus().state, 'ok');
  const b = await unpaired('devB', relay);
  assert.deepEqual(await b.engine.checkHousehold(key), { exists: true, head: 0 });
  await b.engine.joinHousehold(key, 'replace');
  assert.equal(b.engine.getStatus().state, 'ok');
  await a.add('x', expense('Added after B joined', 1));
  await sync(a, b);
  assert.deepEqual(await b.items(), await a.items());
});

test('start: offline, nothing is saved and the error says so', async () => {
  const relay = memoryRelay();
  const a = await unpaired('devA', relay);
  a.net.up = false;
  await assert.rejects(a.engine.startHousehold(box.generateKey()), (err) => err instanceof JoinError && err.code === 'offline');
  assert.equal((await a.config()).householdKey, '');
  assert.equal(relay.rooms.size, 0);
});

test('join: unknown words find no household, create no room and save nothing', async () => {
  const relay = memoryRelay();
  const b = await unpaired('devB', relay);
  await b.add('y', expense('Mine', 2));
  const before = await b.snapshot();
  const stranger = box.generateKey();
  assert.deepEqual(await b.engine.checkHousehold(stranger), { exists: false, head: 0 });
  for (const mode of ['replace', 'merge']) {
    await assert.rejects(b.engine.joinHousehold(stranger, mode), (err) => {
      assert.ok(err instanceof JoinError);
      assert.equal(err.code, 'no_household');
      assert.equal(err.message, 'No household found for these words. Check them and try again.');
      return true;
    });
  }
  assert.equal(relay.rooms.size, 0, 'no room created');
  assert.equal(relay.calls.includes('push'), false, 'nothing pushed');
  assert.equal((await b.config()).householdKey, '');
  assert.equal(await b.snapshot(), before);
});

test('join an empty device: it gets the household data and sends nothing back', async () => {
  const relay = memoryRelay();
  const a = await unpaired('devA', relay);
  const key = box.generateKey();
  await a.add('x', expense('Household item', 5));
  await a.engine.startHousehold(key);
  const b = await unpaired('devB', relay);
  const out = await b.engine.joinHousehold(key, 'replace');
  assert.equal(out.mode, 'replace');
  assert.deepEqual(await b.items(), await a.items());
  assert.equal(await b.outboxSize(), 0);
  const head = roomSize(relay);
  await sync(b);
  assert.equal(roomSize(relay), head, 'B pushed nothing');
});

test('join with data → replace: this device ends up with exactly the household data', async () => {
  const relay = memoryRelay();
  const a = await unpaired('devA', relay);
  const key = box.generateKey();
  await a.add('x', expense('Household item', 5));
  await a.add('gone', expense('Deleted in the household', 6));
  await a.engine.startHousehold(key);
  await a.remove('gone');
  await sync(a);
  const c = await unpaired('devC', relay, { skewMs: 3600_000 }); // its edits are "newer"
  await c.add('mine', expense('Only on C', 7));
  await c.add('x', expense('C version of x', 99)); // same id: would win a merge
  const reloads = [];
  c.engine.onRemoteChanges(() => reloads.push(1));
  await c.engine.joinHousehold(key, 'replace');
  assert.deepEqual(await c.items(), await a.items(), 'only the household items');
  assert.equal((await c.items())[0].price, 5, "the household's version of x");
  assert.equal(await c.record('mine'), undefined);
  assert.equal((await c.record('gone'))?.fields[core.DELETED], true, 'the household tombstone arrived');
  assert.equal(await c.outboxSize(), 0);
  assert.equal((await c.config()).householdKey, key);
  assert.ok(reloads.length >= 1, 'screens refresh');
  await sync(c, a);
  assert.deepEqual((await a.items()).map((i) => i.id), ['x'], 'nothing of C reached the household');
  assert.equal((await a.items())[0].price, 5);
});

test('join with data → merge: both sides end up with everything', async () => {
  const relay = memoryRelay();
  const a = await unpaired('devA', relay);
  const key = box.generateKey();
  await a.add('x', expense('Household item', 5));
  await a.engine.startHousehold(key);
  const c = await unpaired('devC', relay);
  await c.add('mine', expense('Only on C', 7));
  await c.engine.joinHousehold(key, 'merge');
  await sync(a);
  assert.deepEqual((await a.items()).map((i) => i.id), ['mine', 'x']);
  assert.deepEqual(await c.items(), await a.items());
});

test('replace is atomic: a failed pull or write leaves this device exactly as it was', async () => {
  const relay = memoryRelay();
  const a = await unpaired('devA', relay);
  const key = box.generateKey();
  for (let i = 0; i < 700; i++) await a.add(`r${i}`, expense(`Item ${i}`, i + 1)); // more than one pull page (500)
  await a.engine.startHousehold(key);
  await sync(a);
  assert.equal(roomSize(relay) > 500, true);

  let failure = null; // what the next pull after the first page does
  const c = await unpaired('devC', relay, { hooks: { beforePull: (after) => { if (after > 0 && failure) failure(); } } });
  await c.add('mine', expense('Only on C', 7));
  const before = await c.snapshot();

  failure = () => { throw new RelayHttpError(503, 'unavailable', 'down'); };
  await assert.rejects(c.engine.joinHousehold(key, 'replace'), (err) => err instanceof JoinError && err.code === 'relay');
  assert.equal(await c.snapshot(), before, 'untouched after the relay failed on page 2');

  failure = () => { throw new TypeError('fetch failed'); };
  await assert.rejects(c.engine.joinHousehold(key, 'replace'), (err) => err instanceof JoinError && err.code === 'offline');
  assert.equal(await c.snapshot(), before, 'untouched after going offline on page 2');
  assert.equal(c.s.replaceCalls, 0, 'nothing was written');

  failure = null;
  c.s.failReplace = true;
  await assert.rejects(c.engine.joinHousehold(key, 'replace'), /disk full/);
  c.s.failReplace = false;
  assert.equal(await c.snapshot(), before, 'untouched after the write failed');

  await c.engine.joinHousehold(key, 'replace');
  assert.equal((await c.items()).length, 700);
  assert.equal(await c.record('mine'), undefined);
  assert.deepEqual(await c.items(), await a.items());
}, 120_000);

test('turning off keeps every item; the key is gone and nothing more is sent', async () => {
  const relay = memoryRelay();
  const a = await unpaired('devA', relay);
  const key = box.generateKey();
  await a.add('x', expense('Household item', 5));
  await a.engine.startHousehold(key);
  const items = await a.items();
  await a.engine.disconnect();
  assert.deepEqual(await a.items(), items);
  assert.equal((await a.config()).householdKey, '');
  assert.equal((await a.config()).enabled, false);
  assert.equal(a.engine.getStatus().state, 'off');
  await a.add('y', expense('After turning off', 1));
  const calls = relay.calls.length;
  await a.engine.syncNow();
  assert.equal(relay.calls.length, calls, 'no network while off');
  assert.deepEqual((await a.items()).map((i) => i.id), ['x', 'y']);
});

test('a key that cannot be read (backup restored to a new phone): a clear status, no retries, items untouched, Join works', async () => {
  const relay = memoryRelay();
  const a = await unpaired('devA', relay);
  const key = box.generateKey();
  await a.add('x', expense('Household item', 5));
  await a.engine.startHousehold(key);

  // B: restored from A's backup onto a new device. Its config says "in a household", but the key
  // can't be read here, so the vault reports keyUnavailable (Library Card: switched on in the wrapper).
  const b = await device('devB', relay, { key: '' });
  await b.data.importBackup(await a.data.exportBackup());
  b.s.keyUnavailable = true;
  const before = JSON.stringify(await b.items());
  const seen = [];
  b.engine.onStatus((st) => seen.push(st));
  const calls = relay.calls.length;
  await b.engine.start();
  assert.equal(b.engine.getStatus().state, 'error');
  assert.equal(b.engine.getStatus().lastError, keyNeededMessage());
  assert.equal(keyNeededMessage(), 'Sync needs the 12 words on this device. Join again with your recovery words.');
  assert.deepEqual(b.timers.delays(), [], 'no retry timer');
  await b.timers.tickIntervals();
  await b.engine.syncNow();
  assert.equal(relay.calls.length, calls, 'nothing sent to the relay');
  assert.equal(JSON.stringify(await b.items()), before, 'local items untouched');

  // Join again with the words.
  await b.engine.joinHousehold(key, 'merge');
  assert.equal(b.engine.getStatus().state, 'ok');
  assert.deepEqual(await b.items(), await a.items());
});

test('a live socket that closes at once (no WebSocket here) does not turn a good sync into an error', async () => {
  const relay = memoryRelay();
  const a = await device('devA', relay);
  const t = relay.transport(a.net);
  const engine = createSyncEngine({
    store: a.store, env: a.env, timers: a.timers, random: () => 0.5, log: { warn() {}, error() {} }, defaultRelayUrl: RELAY,
    transport: { ...t, live(base, room, token, client, { onClose }) { onClose(); return { close() {} }; } },
  });
  await engine.start();
  await a.add('x', expense('Example', 1));
  await engine.syncNow();
  assert.equal(engine.getStatus().state, 'ok');
  assert.equal(engine.getStatus().lastError, '');
  assert.ok(a.timers.delays().length >= 1, 'a socket retry is scheduled');
});
