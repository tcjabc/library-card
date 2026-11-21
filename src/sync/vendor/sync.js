// Vendored from Peek Budget js/sync.js (tcjabc/substracker, commit f0385ee) and changed for
// Library Card: the relay URL is injected, the subprotocol is ours, polling slows while the live
// socket is open, a deleted room (410 / close 4410 / {"type":"deleted"}) is a terminal state, and
// joining with "merge" uses the store's mergeOutbox. Every change is marked "Library Card:". See VENDORED.md.
//
// Sync engine: sends this device's outbox to the relay and applies everything other devices sent,
// end-to-end encrypted with the household key. Plain JS with every dependency injected (storage,
// transport, crypto, clock, timers, environment), so Node tests run it against an in-memory relay
// and the browser, Android and iOS builds all run the same code.
//
// It never throws into the UI and never blocks a local save: failures become a status and a retry.
// Nothing here logs keys, tokens or the contents of changes.

import * as box from './crypto.js';
import { t } from './i18n.js';

const PULL_LIMIT = 500;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 5 * 60_000;
const SOCKET_RETRY_MAX_MS = 60_000;
const PING_MS = 30_000;
// Library Card: how often to pull as a safety net while the live socket is open (it announces new
// changes itself); without a socket the engine polls every intervalMs (60 s).
const LIVE_INTERVAL_MS = 10 * 60_000;
const PROTOCOL = 'library-card-sync.v1';
const DELETED_CLOSE_CODE = 4410;

/* --------------------------------------------------------------------------
   Relay URL and transport
   -------------------------------------------------------------------------- */
/**
 * Library Card: no relay URL is written here. The app passes one in (createSyncEngine's
 * defaultRelayUrl, from VITE_SYNC_RELAY_URL); a stored relayUrl overrides it.
 */
export const DEFAULT_RELAY_URL = '';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Status text when this device has a household but can't read its key, e.g. app data restored from
 * a backup to a new phone, where the Keystore/Keychain entry doesn't exist (see js/secure-key.js).
 */
/** The status message when this device's key can't be read (in the language in use). */
export const keyNeededMessage = () => t('sync.needsWords');

/**
 * A clean relay base URL, or null. HTTPS only, except plain HTTP to this machine for development,
 * so the token is never sent in the clear over a network.
 */
export function normalizeRelayUrl(text) {
  let u;
  try { u = new URL(String(text ?? '').trim()); } catch { return null; }
  const local = LOCAL_HOSTS.has(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** An HTTP error from the relay. `message` is the relay's text, which never contains secrets. */
export class RelayHttpError extends Error {
  constructor(status, code, message, retryAfterMs) {
    super(message || t('sync.error.relayAnswered', { status }));
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The relay protocol over fetch and WebSocket. Network failures reject with a TypeError (from fetch). */
export function fetchTransport({ fetch = (...a) => globalThis.fetch(...a), WebSocket = globalThis.WebSocket, timers = globalThis } = {}) {
  const roomUrl = (base, room, action) => `${base}/v1/rooms/${room}/${action}`;
  async function call(url, init) {
    const res = await fetch(url, init);
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const ra = Number(res.headers.get('Retry-After'));
      throw new RelayHttpError(res.status, body?.error, body?.message, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
    }
    return body;
  }
  return {
    /** Library Card: delete the room (DELETE /v1/rooms/:room). */
    deleteRoom(base, room, token) {
      return call(`${base}/v1/rooms/${room}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    },
    push(base, room, token, envelopes, client) {
      return call(roomUrl(base, room, 'push'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Sync-Client': client },
        body: JSON.stringify({ envelopes }),
      });
    },
    pull(base, room, token, after, limit) {
      return call(`${roomUrl(base, room, 'pull')}?after=${after}&limit=${limit}`, { headers: { Authorization: `Bearer ${token}` } });
    },
    /**
     * Open the live socket. Calls onHead(seq) for each announcement, onDeleted() if the room is
     * deleted (Library Card), and onClose(code) once. Returns { close }.
     */
    live(base, room, token, client, { onOpen, onHead, onClose, onDeleted }) {
      if (typeof WebSocket !== 'function') { onClose(); return { close() {} }; }
      const url = `${roomUrl(base, room, 'live').replace(/^http/, 'ws')}?client=${client}`;
      // The token rides in a subprotocol (browsers can't set headers on a WebSocket, and URLs get logged).
      const ws = new WebSocket(url, [PROTOCOL, `bearer.${token}`]);
      let ping = null;
      let closed = false;
      const finish = (code) => {
        if (closed) return;
        closed = true;
        timers.clearInterval(ping);
        if (code === DELETED_CLOSE_CODE) onDeleted?.();
        onClose(code);
      };
      ws.onopen = () => { ping = timers.setInterval(() => { try { ws.send('ping'); } catch { /* closing */ } }, PING_MS); onOpen?.(); };
      ws.onmessage = (m) => {
        if (m.data === 'pong') return;
        try {
          const msg = JSON.parse(m.data);
          if (msg?.type === 'head' && Number.isSafeInteger(msg.seq)) onHead(msg.seq);
          if (msg?.type === 'deleted') onDeleted?.(); // Library Card
        } catch { /* ignore */ }
      };
      ws.onclose = (e) => finish(e?.code);
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } finish(); };
      return { close() { try { ws.close(1000); } catch { /* ignore */ } finish(); } };
    },
  };
}

/** Visibility and connectivity from the browser (also the Android and iOS WebViews). */
export function browserEnv() {
  const doc = globalThis.document;
  return {
    isVisible: () => !doc || doc.visibilityState !== 'hidden',
    isOnline: () => globalThis.navigator?.onLine !== false,
    onVisibility(fn) { doc?.addEventListener('visibilitychange', () => fn(doc.visibilityState !== 'hidden')); },
    onOnline(fn) { globalThis.addEventListener?.('online', fn); },
    onOffline(fn) { globalThis.addEventListener?.('offline', fn); },
  };
}

function randomId() {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* --------------------------------------------------------------------------
   Engine
   -------------------------------------------------------------------------- */
/** Human-readable messages for failures. They never include keys, tokens or data. */
function describe(err) {
  if (err instanceof RelayHttpError) {
    switch (err.status) {
      case 401: return t('sync.error.401');
      case 410: return t('sync.error.410'); // Library Card
      case 413: return t('sync.error.413');
      case 429: return t('sync.error.429');
      case 507: return t('sync.error.507');
      default: return err.status >= 500 ? t('sync.error.5xx') : t('sync.error.refused', { status: err.status });
    }
  }
  if (err instanceof TypeError) return t('sync.error.unreachable');
  return err?.message ? String(err.message) : t('sync.error.failed');
}

/**
 * Starting or joining a household failed. `code` is 'no_household' (nobody has started a household
 * with this key), 'offline' or 'relay'. The message is for people and never includes the key.
 */
export class JoinError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}


function joinError(err) {
  if (err instanceof JoinError) return err;
  if (err instanceof RelayHttpError && err.status === 404) return new JoinError('no_household', t('sync.join.noHousehold'));
  if (err instanceof RelayHttpError && err.status === 410) return new JoinError('deleted', t('sync.join.deleted')); // Library Card
  if (err instanceof TypeError) return new JoinError('offline', t('sync.join.offline'));
  return new JoinError('relay', describe(err));
}

/**
 * Create the engine. Options (all optional except `store`):
 *   store      storage adapter (storage.syncStore in the app)
 *   transport  relay client (fetchTransport())       crypto  { deriveKeys, seal, open } (js/crypto.js)
 *   env        visibility/online hooks (browserEnv()) timers  { setTimeout, clearTimeout, setInterval, clearInterval }
 *   now, random, log, clientId, debounceMs (1000), intervalMs (60000), batchSize (200), maxBatchChars (512000)
 *   Library Card: defaultRelayUrl (the app's relay), liveIntervalMs (600000, while the socket is open)
 */
export function createSyncEngine(opts) {
  const {
    store, transport = fetchTransport(), crypto = box, env = browserEnv(), timers = globalThis,
    now = () => Date.now(), random = Math.random, log = console, clientId = randomId(),
    debounceMs = 1000, intervalMs = 60_000, batchSize = 200, maxBatchChars = 512_000,
    defaultRelayUrl = DEFAULT_RELAY_URL, liveIntervalMs = LIVE_INTERVAL_MS,
  } = opts;

  // Library Card: `live` says whether the live socket is open (the UI tells "live" from "polling").
  const status = { state: 'off', lastSyncedAt: null, pendingCount: 0, lastError: '', live: false };
  const statusListeners = new Set();
  const remoteListeners = new Set();
  let config = null;
  let keys = null; // { keyText, roomId, token, aesKey }
  let started = false;
  let running = null;
  let again = false;
  let failures = 0;
  let pausedUntilTrigger = false; // after a 401: no automatic retries until something changes
  let knownHead = 0;
  let batchLimit = batchSize;
  let retryTimer = null;
  let debounceTimer = null;
  let intervalTimer = null;
  let socket = null;
  let socketTimer = null;
  let socketFailures = 0;
  let socketOpen = false;
  // Library Card: the relay said this room was deleted. Terminal: no retries, no re-queue.
  let deleted = false;

  const emitStatus = () => {
    const copy = { ...status };
    for (const fn of statusListeners) { try { fn(copy); } catch (err) { log.error(err); } }
  };
  const setStatus = (state, lastError = status.lastError) => {
    status.state = state;
    status.lastError = lastError;
    emitStatus();
  };
  const clear = (t, fn = 'clearTimeout') => { if (t !== null) timers[fn](t); return null; };

  async function refreshPending() {
    try { status.pendingCount = await store.pendingCount(); } catch { /* fallback store: leave as is */ }
  }

  /** Read the config and derive keys when the household key changed. */
  async function loadConfig() {
    config = (await store.getConfig()) ?? { relayUrl: '', householdKey: '', enabled: false }; // Library Card: null before sync is on
    const keyText = config.keyUnavailable ? '' : config.householdKey || '';
    if (keys?.keyText !== keyText) keys = keyText ? { keyText, ...(await crypto.deriveKeys(keyText)) } : null;
    const url = normalizeRelayUrl(config.relayUrl || defaultRelayUrl);
    config = { ...config, relayUrl: url };
    return Boolean(config.enabled && url && keys);
  }

  /* ---------------- one sync: push, then pull ---------------- */
  async function pushAll() {
    let clockAhead = false;
    for (let round = 0; round < 50; round++) {
      const ops = await store.pendingOps(batchLimit);
      if (!ops.length) break;
      const batch = [];
      const envelopes = [];
      let size = 0;
      for (const op of ops) {
        const env = await crypto.seal(keys.aesKey, op);
        const n = env.c.length + env.id.length + 32;
        if (batch.length && size + n > maxBatchChars) break;
        batch.push(op);
        envelopes.push(env);
        size += n;
      }
      const res = await transport.push(config.relayUrl, keys.roomId, keys.token, envelopes, clientId);
      if (Number.isSafeInteger(res?.head)) knownHead = Math.max(knownHead, res.head);
      const rejected = new Set(Array.isArray(res?.rejected) ? res.rejected : []);
      const sent = batch.filter((op) => !rejected.has(op.id)).map(({ rec, f, t }) => ({ rec, f, t }));
      if (sent.length) await store.removeSentOps(sent);
      if (rejected.size) clockAhead = true;
      if (!sent.length) break; // everything left was refused (stamped too far ahead)
    }
    return { clockAhead };
  }

  async function pullAll() {
    let cursor = await store.getCursor();
    let changed = 0;
    let bad = 0;
    let lost = false;
    for (let page = 0; page < 10_000; page++) {
      let res;
      try {
        res = await transport.pull(config.relayUrl, keys.roomId, keys.token, cursor, PULL_LIMIT);
      } catch (err) {
        if (err instanceof RelayHttpError && err.status === 404) {
          // No room yet: nobody has pushed. If we had pulled before, the relay lost the room.
          if (cursor > 0) { await store.requeueAll(); lost = true; }
          knownHead = 0;
          break;
        }
        throw err;
      }
      const entries = Array.isArray(res?.entries) ? res.entries : [];
      const head = Number.isSafeInteger(res?.head) ? res.head : 0;
      if (head < cursor) {
        // The relay has fewer entries than we've already seen: its data was lost or reset.
        // Send everything again and read it from the start.
        await store.requeueAll();
        lost = true;
        cursor = 0;
        continue;
      }
      let last = cursor;
      const ops = [];
      for (const e of entries) {
        if (!Number.isSafeInteger(e?.seq) || e.seq <= last) throw new Error(t('sync.error.order'));
        last = e.seq;
        try { ops.push(await crypto.open(keys.aesKey, e)); } catch { bad++; }
      }
      if (entries.length) {
        const out = await store.applyRemote(ops, last); // ops, clock and cursor in one transaction
        changed += out.changed;
        bad += out.skipped;
        cursor = last;
      }
      knownHead = Math.max(head, cursor);
      if (!entries.length || cursor >= head) break;
    }
    if (bad) log.warn(`Sync: ignored ${bad} change(s) that could not be verified.`);
    return { changed, lost };
  }

  async function runOnce() {
    if (deleted) return; // Library Card
    let ready;
    try { ready = await loadConfig(); } catch (err) { setStatus('error', describe(err)); return; }
    if (!ready) {
      closeSocket();
      stopInterval();
      // No retry timer either way: an unreadable key waits for Join (a config change), never loops.
      if (config?.keyUnavailable) setStatus('error', keyNeededMessage()); else setStatus('off', '');
      return;
    }
    if (!env.isOnline()) { closeSocket(); setStatus('offline', t('sync.offline')); return; }
    setStatus('syncing');
    try {
      const { clockAhead } = await pushAll();
      const { changed, lost } = await pullAll();
      if (lost) again = true; // push what was re-queued
      failures = 0;
      batchLimit = batchSize;
      pausedUntilTrigger = false;
      status.lastSyncedAt = now();
      try { await store.setLastSynced(status.lastSyncedAt); } catch { /* not important */ }
      await refreshPending();
      setStatus('ok', clockAhead ? t('sync.clockAhead') : '');
      if (changed) for (const fn of remoteListeners) { try { await fn(); } catch (err) { log.error(err); } }
      ensureSocket();
      ensureInterval();
    } catch (err) {
      await refreshPending();
      fail(err);
    }
  }

  /** Decide the status and when to try again. */
  function fail(err) {
    const message = describe(err);
    if (err instanceof TypeError) { setStatus('offline', message); return retryIn(backoff()); }
    if (!(err instanceof RelayHttpError)) { setStatus('error', message); return retryIn(backoff()); }
    if (err.status === 410) return enterDeleted(); // Library Card
    if (err.status === 401) { pausedUntilTrigger = true; closeSocket(); return setStatus('error', message); }
    if (err.status === 413 && batchLimit > 1) { batchLimit = Math.max(1, Math.floor(batchLimit / 2)); setStatus('error', message); return retryIn(1000); }
    if (err.status === 429) { setStatus('error', message); return retryIn(err.retryAfterMs ?? backoff()); }
    if (err.status === 507) { setStatus('error', message); return retryIn(60 * 60_000); }
    setStatus('error', message);
    return retryIn(backoff());
  }

  /** Exponential backoff with jitter: 2 s, 4 s, 8 s … up to 5 minutes, each ×0.5–1.5. */
  function backoff() {
    const ms = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** failures);
    failures++;
    return Math.round(ms * (0.5 + random()));
  }

  function retryIn(ms) {
    retryTimer = clear(retryTimer);
    retryTimer = timers.setTimeout(() => { retryTimer = null; request('retry'); }, ms);
  }

  /** Run a sync now, or after the current one if one is running. Never rejects. */
  function request(reason) {
    if (!started || deleted) return Promise.resolve();
    if (reason === 'retry' && pausedUntilTrigger) return Promise.resolve();
    if (reason !== 'retry') retryTimer = clear(retryTimer);
    debounceTimer = clear(debounceTimer); // this run covers it
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        await runOnce();
      } while (again && started);
    })().catch((err) => log.error(err)).finally(() => { running = null; });
    return running;
  }

  /* ---------------- triggers ---------------- */
  // Library Card: one timer, every liveIntervalMs while the socket is open, else every intervalMs.
  let intervalEvery = 0;
  function ensureInterval() {
    if (deleted || !env.isVisible()) return;
    const every = socketOpen ? liveIntervalMs : intervalMs;
    if (intervalTimer !== null && intervalEvery === every) return;
    stopInterval();
    intervalEvery = every;
    intervalTimer = timers.setInterval(() => request('interval'), every);
  }
  function stopInterval() { intervalTimer = clear(intervalTimer, 'clearInterval'); intervalEvery = 0; }
  /** Library Card: the socket opened or closed; poll at the matching pace. */
  function socketChanged(open) {
    socketOpen = open;
    status.live = open;
    if (intervalTimer !== null) ensureInterval();
    emitStatus();
  }

  /** Library Card: the room was deleted on the relay. Stop everything; nothing is retried or re-queued. */
  function enterDeleted() {
    if (deleted) return;
    deleted = true;
    retryTimer = clear(retryTimer);
    debounceTimer = clear(debounceTimer);
    stopInterval();
    closeSocket();
    setStatus('deleted', t('sync.deleted'));
  }

  function ensureSocket() {
    if (deleted || socket || socketTimer !== null || !started || !keys || !config?.relayUrl || !config.enabled || pausedUntilTrigger) return;
    if (!env.isVisible() || !env.isOnline()) return;
    const retryLater = () => {
      if (!started || !env.isVisible() || !config?.enabled) return;
      const ms = Math.round(Math.min(SOCKET_RETRY_MAX_MS, 1000 * 2 ** socketFailures++) * (0.5 + random()));
      socketTimer = timers.setTimeout(() => { socketTimer = null; ensureSocket(); }, ms);
    };
    // A transport may close at once, inside live() (no WebSocket here, or offline), before `conn` exists.
    let conn = null;
    let closedAtOnce = false;
    conn = transport.live(config.relayUrl, keys.roomId, keys.token, clientId, {
      onOpen: () => { socketFailures = 0; socketChanged(true); },
      onHead: (seq) => { if (seq > knownHead) request('live'); },
      onDeleted: () => enterDeleted(), // Library Card
      onClose: () => {
        if (conn === null) { closedAtOnce = true; return; }
        if (socket !== conn) return;
        socket = null;
        socketChanged(false);
        retryLater();
      },
    });
    if (closedAtOnce) retryLater(); else socket = conn;
  }

  function closeSocket() {
    socketTimer = clear(socketTimer);
    const s = socket;
    socket = null;
    if (socketOpen) socketChanged(false);
    s?.close();
  }

  /** The relay base URL (the stored override, or the default) and the derived keys for keyText. */
  async function target(keyText) {
    const cfg = (await store.getConfig()) ?? {}; // Library Card: null before sync is on
    const base = normalizeRelayUrl(cfg.relayUrl || defaultRelayUrl);
    if (!base) throw new JoinError('relay', t('sync.error.relayAddress'));
    let k;
    try { k = await crypto.deriveKeys(keyText); } catch (err) { throw new JoinError('key', err.message); }
    return { base, k };
  }

  const onLocalChange = () => {
    refreshPending().then(emitStatus);
    debounceTimer = clear(debounceTimer);
    debounceTimer = timers.setTimeout(() => { debounceTimer = null; request('local'); }, debounceMs);
  };

  /** Library Card: every entry in the room, opened (the join paths; shared by replace and merge). Rejects with JoinError. */
  async function pullEverything(base, k) {
    const ops = [];
    let cursor = 0;
    let bad = 0;
    try {
      for (let page = 0; page < 10_000; page++) {
        const res = await transport.pull(base, k.roomId, k.token, cursor, PULL_LIMIT);
        const entries = Array.isArray(res?.entries) ? res.entries : [];
        const head = Number.isSafeInteger(res?.head) ? res.head : 0;
        for (const e of entries) {
          if (!Number.isSafeInteger(e?.seq) || e.seq <= cursor) throw new Error(t('sync.error.order'));
          cursor = e.seq;
          try { ops.push(await crypto.open(k.aesKey, e)); } catch { bad++; }
        }
        if (cursor >= head) break;
        if (!entries.length) throw new Error(t('sync.error.stopped'));
      }
    } catch (err) { throw joinError(err); }
    if (bad) log.warn(`Sync: ignored ${bad} change(s) that could not be verified.`);
    return { ops, cursor };
  }

  /** Library Card: the stored relay URL override, if any (kept when enableSync writes the config). */
  const cfg0 = (c) => c?.relayUrl || undefined;

  /* ---------------- public API ---------------- */
  return {
    /** Start listening for triggers and sync once if configured. */
    async start() {
      if (started) return;
      started = true;
      try { status.lastSyncedAt = await store.getLastSynced(); } catch { /* fallback store */ }
      store.onChangesEnqueued(onLocalChange);
      env.onVisibility((visible) => {
        if (!started) return;
        if (visible) { request('visible'); } else { stopInterval(); closeSocket(); }
      });
      env.onOnline(() => request('online'));
      env.onOffline?.(() => { closeSocket(); if (status.state !== 'off' && !deleted) setStatus('offline', t('sync.offline')); }); // Library Card: deleted stays
      await refreshPending();
      await request('start');
    },
    /** Stop all timers and the socket. Local data is untouched. */
    stop() {
      started = false;
      debounceTimer = clear(debounceTimer);
      retryTimer = clear(retryTimer);
      stopInterval();
      closeSocket();
      store.onChangesEnqueued(() => {});
    },
    /** Sync now (the dev screen's button). Resolves when done; never rejects. */
    syncNow() { pausedUntilTrigger = false; failures = 0; return request('manual'); },
    /** Save config fields ({ relayUrl, householdKey, enabled }) and sync with them. */
    async configure(patch) {
      await store.setConfig(patch);
      return this.restart();
    },
    /** Library Card: the config changed underneath (enableSync, replace): start over from it. */
    restart() {
      pausedUntilTrigger = false;
      failures = 0;
      knownHead = 0;
      deleted = false;
      closeSocket();
      return request('config');
    },
    /**
     * Library Card: delete the household's room on the relay (its log and photos). This device
     * goes to the terminal "deleted" state; the others do when they next hear from the relay.
     * Local data stays. Rejects with RelayHttpError (or TypeError offline) if the relay refused.
     */
    async deleteHousehold() {
      if (!(await loadConfig())) throw new JoinError('relay', t('sync.error.notOn'));
      await this.idle();
      try {
        await transport.deleteRoom(config.relayUrl, keys.roomId, keys.token);
      } catch (err) {
        if (!(err instanceof RelayHttpError && err.status === 410)) throw err;
      }
      enterDeleted();
    },
    /** Stop syncing and forget the household key on this device. Local data stays. */
    async disconnect() {
      closeSocket();
      stopInterval();
      retryTimer = clear(retryTimer);
      await store.setConfig({ enabled: false, householdKey: '' });
      keys = null;
      deleted = false; // Library Card: turning off clears the deleted state too
      return request('config');
    },
    /**
     * Does a household exist for this key? Reads one entry; never creates a room.
     * Resolves { exists, head }; rejects with JoinError for anything but "yes" or "no".
     */
    async checkHousehold(keyText) {
      const { base, k } = await target(keyText);
      try {
        const res = await transport.pull(base, k.roomId, k.token, 0, 1);
        return { exists: true, head: Number.isSafeInteger(res?.head) ? res.head : 0 };
      } catch (err) {
        if (err instanceof RelayHttpError && err.status === 404) return { exists: false, head: 0 };
        throw joinError(err);
      }
    },

    /**
     * Start a new household with a freshly generated key: claim its room on the relay (an empty
     * push, so other devices can join before anything is added), then save the key, turn sync on
     * and send this device's items. Rejects with JoinError (nothing saved) if the relay can't be reached.
     */
    async startHousehold(keyText) {
      const { base, k } = await target(keyText);
      try {
        const res = await transport.push(base, k.roomId, k.token, [], clientId);
        if (Number.isSafeInteger(res?.head) && res.head > 0) throw new JoinError('relay', t('sync.error.keyInUse'));
      } catch (err) { throw joinError(err); }
      // Library Card: enableSync records this device's data and queues all of it, then sync.
      await store.enableSync(keyText, { relayUrl: cfg0(await store.getConfig()) });
      return this.restart();
    },

    /**
     * Join an existing household. mode 'replace': this device's items and settings are replaced
     * by the household's. Everything is pulled first and then written in one transaction, so if
     * anything fails, this device is left exactly as it was. mode 'merge': this device's items are
     * sent to the household too (the later change to a field wins). Never creates a room: a key
     * with no household rejects with JoinError('no_household') and nothing is saved.
     */
    async joinHousehold(keyText, mode) {
      if (mode !== 'replace' && mode !== 'merge') throw new Error('Join mode must be replace or merge.');
      const { exists } = await this.checkHousehold(keyText);
      if (!exists) throw new JoinError('no_household', t('sync.join.noHousehold'));
      const { base, k } = await target(keyText);
      if (mode === 'merge') {
        // Library Card: queue this device's data (enableSync), apply the household's, then keep
        // queued only what is newer here and not already on the relay (mergeOutbox), and push that.
        await this.idle();
        await store.enableSync(keyText, { relayUrl: cfg0(await store.getConfig()) });
        debounceTimer = clear(debounceTimer); // the push below covers what enableSync queued
        const pulled = await pullEverything(base, k);
        if (pulled.ops.length || pulled.cursor) await store.applyRemote(pulled.ops, pulled.cursor);
        await store.mergeOutbox(pulled.ops);
        await this.restart();
        for (const fn of remoteListeners) { try { await fn(); } catch (err) { log.error(err); } }
        return { mode };
      }

      const { ops, cursor } = await pullEverything(base, k);
      await this.idle(); // no sync of the old config may run into the write below
      const out = await store.replaceWithRemote(ops, cursor, { householdKey: keyText, enabled: true });
      knownHead = cursor;
      pausedUntilTrigger = false;
      failures = 0;
      deleted = false; // Library Card
      closeSocket();
      await request('config');
      for (const fn of remoteListeners) { try { await fn(); } catch (err) { log.error(err); } }
      return { mode, ...out };
    },

    getStatus: () => ({ ...status }),
    /** Called with a status copy on every change. Returns an unsubscribe function. */
    onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    /** Called after a sync applied changes from other devices (refresh the screens). */
    onRemoteChanges(fn) { remoteListeners.add(fn); return () => remoteListeners.delete(fn); },
    /** Resolves once no sync is running (tests). */
    async idle() { while (running) await running; },
  };
}
