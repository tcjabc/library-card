/**
 * The sync service: runs the vendored engine (vendor/sync.js) over the sync store, in one tab only.
 *
 *   const sync = await createSyncService({ store });   // store from createSyncStore()
 *   sync.subscribe((status) => …);
 *   await sync.start();                                // a new household: shows these words
 *   await sync.join(words, 'combine');                 // or 'replace'
 *
 * One visible tab per browser holds a Web Lock and runs the engine (relay socket, timers, push and
 * pull). The other tabs queue for the lock, hear data changes through the store's subscribe()
 * (applied ops are broadcast like any local write) and the engine's status through a
 * BroadcastChannel. A running tab that is hidden, frozen or closed hands the lock on (one quick
 * last sync, then it stops and releases it) and queues again once it is visible, so a waiting
 * visible tab takes over at once. Actions work from any tab: the result is in IndexedDB, and the
 * running tab is told to pick it up.
 *
 * Actions that change the household (start, join, stop, deleteHousehold) run in one tab at a time
 * (a second Web Lock); another tab trying one gets SyncBusyError. Two facts persist in meta: that
 * the household was deleted (shown at once after a reload, without asking the relay) and that
 * this device was in a household before (so starting a new one warns first).
 *
 * The running tab also moves cover photos (photoSync.ts): uploads after each good sync, downloads
 * when a cover isn't on this device. When a device starts or joins, every finished journey that
 * already exists is marked celebrated first (journeys/celebration.ts), and a household without a
 * time zone gets this device's.
 *
 * The app loads it lazily (src/sync/app.ts), so the sync code stays out of the main bundle.
 */
import { HOUSEHOLD_ID, withSyncLock, type SyncDataStore, type SyncFlags } from '../data';
import { markAllCompletionsCelebrated, pauseCelebrations } from '../journeys/celebration';
import { deviceTimeZone, isTimeZone } from '../lib/timezone';
import { createPhotoSync, type PhotoKeys } from './photoSync';
import * as crypto from './vendor/crypto.js';
import { t } from './vendor/i18n.js';
import { createKeyVault, type KeyVault, type VaultConfig } from './vendor/secure-key.js';
import {
  browserEnv,
  createSyncEngine,
  fetchTransport,
  JoinError,
  normalizeRelayUrl,
  type EngineStatus,
  type EngineStore,
  type SyncEngine,
  type SyncEnv,
  type Timers,
  type Transport,
} from './vendor/sync.js';
import { keyToWords, parseRecovery } from './vendor/words.js';

export type SyncState = 'off' | 'connecting' | 'live' | 'polling' | 'offline' | 'error' | 'deleted';
export type JoinMode = 'combine' | 'replace';

export interface SyncStatus {
  /**
   * off: sync isn't on here. connecting: the first sync since starting is running. live: synced,
   * and the relay's socket announces changes. polling: synced, without a socket (checked every 60 s).
   * offline / error: changes wait here and are retried. deleted: the household was deleted on the
   * relay; nothing is sent until this device starts a new one or turns sync off.
   */
  state: SyncState;
  /** When this device last finished a sync (ISO), or null. */
  lastSynced: string | null;
  /** Changes waiting to be sent. */
  pendingCount: number;
  /** A message for people ('' when there is none). Never contains the key. */
  message: string;
  /** This tab runs the engine. */
  leader: boolean;
  /** When sync was last turned off on this device (it was in a household before), or null. */
  wasPairedAt: string | null;
  /** Another tab is starting, joining, turning off or deleting right now. */
  busyElsewhere: boolean;
  /** This tab doesn't run sync and hasn't heard from the tab that does for a few seconds. */
  leaderSilent: boolean;
  /** Cover photos still to upload. */
  photosWaiting: number;
  /** Cover photos the relay can't take (too large, or the household's photo space is full). */
  photosFailed: number;
}

/** What a replace would drop on this device. */
export interface LocalCounts {
  readers: number;
  homeBooks: number;
  libraries: number;
  collections: number;
  notes: number;
  loans: number;
  libraryCards: number;
  reads: number;
}

/**
 * Whether typed recovery words (12 words, or the 22-character key) are this household key.
 * False for bad words (unknown word, checksum) and for another household's words.
 */
export async function wordsMatchKey(words: string, householdKey: string): Promise<boolean> {
  try {
    return (await parseRecovery(words)) === householdKey;
  } catch {
    return false;
  }
}

/** start / join / stop / deleteHousehold is already running, in this tab or another. */
export class SyncBusyError extends Error {
  readonly code = 'busy';
  constructor() {
    super('Another sync action is running (maybe in another tab).');
  }
}

export interface SyncService {
  getStatus(): SyncStatus;
  /** Called with every status change. Returns an unsubscribe function. */
  subscribe(listener: (status: SyncStatus) => void): () => void;
  /**
   * newHousehold (the default): make a new household key, claim its room on the relay and send
   * this device's data. Resolves the 12 recovery words. With false: turn sync back on with the key
   * this device already has (resolves its words).
   */
  start(newHousehold?: boolean): Promise<{ words: string }>;
  /**
   * Join the household for these 12 words (or 22-character key). combine: this device's data and
   * the household's are merged, the later change to each field winning. replace: this device's
   * synced data is replaced by the household's (the UI confirms first). A device with nothing on it
   * always joins as replace. Rejects with WordsError (bad words) or JoinError (no household,
   * offline, relay); nothing is changed then.
   */
  join(words: string, mode: JoinMode): Promise<{ mode: JoinMode }>;
  /** Turn sync off on this device and forget the key. keepData false also clears this device. */
  stop(keepData?: boolean): Promise<void>;
  /** Delete the household on the relay (log and photos). Every device goes to "deleted". */
  deleteHousehold(): Promise<void>;
  /** Sync now; resolves when done (in the running tab). Never rejects. */
  syncNow(): Promise<void>;
  /** Readers, home books, libraries, loans and reads on this device: what a replace would drop. */
  localCounts(): Promise<LocalCounts>;
  /** The sum of localCounts(); 0 means joining needs no choice. */
  localItemCount(): Promise<number>;
  /** The 12 recovery words for this device's household, or null. */
  recoveryWords(): Promise<string | null>;
  /** These words are this device's household (forgot PIN). False for other or bad words, or no household. */
  checkRecoveryWords(words: string): Promise<boolean>;
  /** Resolves once nothing is running: no sync, no take-over (tests). */
  idle(): Promise<void>;
  /** Stop the engine and give up the lock (tests; the app keeps one service for its lifetime). */
  dispose(): Promise<void>;
}

interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
}

interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface SyncServiceOptions {
  store: SyncDataStore;
  /** The relay's base URL. Default: VITE_SYNC_RELAY_URL. A relayUrl saved in the config wins. */
  relayUrl?: string;
  transport?: Transport;
  env?: SyncEnv;
  timers?: Timers;
  now?: () => number;
  random?: () => number;
  log?: Pick<Console, 'error' | 'warn'>;
  clientId?: string;
  debounceMs?: number;
  intervalMs?: number;
  liveIntervalMs?: number;
  /** Web Locks; null runs the engine in this instance without a lock (tests). */
  locks?: LockManagerLike | null;
  /** Status between tabs; null for none (tests). */
  channel?: ChannelLike | null;
  /** How long a tab waits to hear from the running tab before saying so (ms, default 4000). */
  leaderSilentMs?: number;
  /** The most a hiding tab spends on its last sync before handing over (ms, default 1500). */
  handOffSyncMs?: number;
  /** fetch for cover photos (tests; the engine uses `transport`). */
  fetch?: typeof fetch;
}

const ACTION_LOCK_NAME = 'library-card-sync-action';
/** A tab that closed mid-action never says it finished; forget its "busy" after this long. */
const BUSY_TIMEOUT_MS = 120_000;
const LEADER_SILENT_MS = 4000;
const HAND_OFF_SYNC_MS = 1500;

const CHANNEL_NAME = 'library-card-sync';
const NO_CONFIG: VaultConfig = { householdKey: '', relayUrl: '', enabled: false, keyLocation: 'idb', keyTag: '' };

type Message =
  | { type: 'status'; status: Pick<SyncStatus, 'state' | 'lastSynced' | 'pendingCount' | 'message' | 'photosWaiting' | 'photosFailed'> }
  | { type: 'hello' }
  | { type: 'config' }
  | { type: 'syncNow' }
  | { type: 'busy'; on: boolean }
  | { type: 'wantPhoto'; hash: string };

/** The vault's store, over the sync store's config (web: the key stays in IndexedDB). */
function vaultStore(store: SyncDataStore) {
  // Only the fields our config has (the vault adds keyLocation and keyTag for phones).
  const strip = (patch: Partial<VaultConfig>) => {
    const rest: Record<string, unknown> = { ...patch };
    for (const field of ['keyLocation', 'keyTag', 'wasPaired', 'keyUnavailable']) delete rest[field];
    return rest as Parameters<SyncDataStore['setConfig']>[0];
  };
  return {
    async getSyncConfig(): Promise<VaultConfig> {
      const c = await store.getConfig();
      return c ? { ...c, keyLocation: 'idb', keyTag: '' } : { ...NO_CONFIG };
    },
    setSyncConfig: (patch: Partial<VaultConfig>) => store.setConfig(strip(patch)),
    replaceWithRemote: (ops: unknown[], cursor: number, config: Partial<VaultConfig>) => store.replaceWithRemote(ops, cursor, strip(config)),
  };
}

/** What the engine calls: the sync store, with the key read and written through the key vault. */
export function engineStoreFor(store: SyncDataStore, vault: KeyVault = createKeyVault({ store: vaultStore(store) })): EngineStore {
  let unsubscribe: (() => void) | null = null;
  return {
    getConfig: () => vault.readConfig(),
    setConfig: (patch) => vault.setConfig(patch),
    replaceWithRemote: (ops, cursor, config) => vault.replaceWithRemote(ops, cursor, config),
    pendingOps: (limit) => store.pendingOps(limit),
    pendingCount: () => store.pendingCount(),
    removeSentOps: (sent) => store.removeSentOps(sent),
    getCursor: () => store.getCursor(),
    applyRemote: (ops, cursor) => store.applyRemote(ops, cursor),
    requeueAll: () => store.requeueAll(),
    mergeOutbox: (received) => store.mergeOutbox(received),
    getLastSynced: () => store.getLastSynced(),
    setLastSynced: (at) => store.setLastSynced(new Date(at).toISOString()),
    // The engine sets one listener (Peek's store kept one); a new one replaces the old.
    onChangesEnqueued(listener) {
      unsubscribe?.();
      unsubscribe = store.onChangesEnqueued(listener);
    },
    enableSync: (key, options) => store.enableSync(key, options),
  };
}

/** A status for the other tabs (each tab sets `leader`, `wasPairedAt` and `busyElsewhere` itself). */
const shared = ({ state, lastSynced, pendingCount, message, photosWaiting, photosFailed }: SyncStatus) => ({
  state,
  lastSynced,
  pendingCount,
  message,
  photosWaiting,
  photosFailed,
});

const iso = (at: number | string | null): string | null =>
  at === null || at === undefined ? null : typeof at === 'number' ? new Date(at).toISOString() : at;

export async function createSyncService(options: SyncServiceOptions): Promise<SyncService> {
  const { store, log = console } = options;
  const now = options.now ?? (() => Date.now());
  const stamp = () => new Date(now()).toISOString();
  const relayUrl = options.relayUrl ?? import.meta.env.VITE_SYNC_RELAY_URL ?? '';
  const vault = createKeyVault({ store: vaultStore(store), log });
  // The engine registers its visibility and network listeners each time it starts; route them
  // through here so a hand-off (stop, then start again later) can drop the old ones.
  const baseEnv = options.env ?? browserEnv();
  const hub = { vis: new Set<(visible: boolean) => void>(), on: new Set<() => unknown>(), off: new Set<() => void>() };
  const clearHub = () => {
    hub.vis.clear();
    hub.on.clear();
    hub.off.clear();
  };
  baseEnv.onVisibility((visible) => {
    for (const fn of [...hub.vis]) fn(visible);
  });
  baseEnv.onOnline(() => {
    for (const fn of [...hub.on]) fn();
  });
  baseEnv.onOffline?.(() => {
    for (const fn of [...hub.off]) fn();
  });
  const engineEnv: SyncEnv = {
    isVisible: () => baseEnv.isVisible(),
    isOnline: () => baseEnv.isOnline(),
    onVisibility: (fn) => void hub.vis.add(fn),
    onOnline: (fn) => void hub.on.add(fn),
    onOffline: (fn) => void hub.off.add(fn),
  };
  const engine: SyncEngine = createSyncEngine({
    store: engineStoreFor(store, vault),
    transport: options.transport ?? fetchTransport(),
    env: engineEnv,
    timers: options.timers,
    now: options.now,
    random: options.random,
    log,
    clientId: options.clientId,
    debounceMs: options.debounceMs,
    intervalMs: options.intervalMs,
    liveIntervalMs: options.liveIntervalMs,
    defaultRelayUrl: relayUrl,
  });

  const listeners = new Set<(status: SyncStatus) => void>();
  const pendingWhen = async (enabled: boolean | undefined) => (enabled ? store.pendingCount() : 0);
  // Work started in the background (taking over as the running tab), for idle().
  let background: Promise<unknown> = Promise.resolve();
  const track = (work: Promise<unknown>) => {
    background = Promise.all([background, work.catch((error) => log.error(error))]);
  };
  const initial = await store.getConfig();
  let flags: SyncFlags = await store.getSyncFlags();
  let status: SyncStatus = {
    state: flags.deletedAt ? 'deleted' : initial?.enabled ? 'connecting' : 'off',
    lastSynced: await store.getLastSynced(),
    pendingCount: await pendingWhen(initial?.enabled),
    message: flags.deletedAt ? t('sync.deleted') : '',
    leader: false,
    wasPairedAt: flags.wasPairedAt,
    busyElsewhere: false,
    leaderSilent: false,
    photosWaiting: 0,
    photosFailed: 0,
  };
  let leader = false;
  let engineStarted = false;
  let hadSync = false;
  let disposed = false;
  let acting = false;
  let busyTimer: ReturnType<typeof setTimeout> | undefined;
  let silentTimer: ReturnType<typeof setTimeout> | undefined;
  let handingOff = false;
  let zoneChecked = false;

  const channel: ChannelLike | null =
    options.channel !== undefined ? options.channel : typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  const post = (message: Message) => {
    try {
      channel?.postMessage(message);
    } catch {
      /* closed */
    }
  };

  const emit = (next: SyncStatus) => {
    status = next;
    for (const fn of [...listeners]) {
      try {
        fn({ ...status });
      } catch (error) {
        log.error(error);
      }
    }
  };

  /** Re-read the flags (another tab, or this one, changed them). */
  async function refreshFlags(): Promise<void> {
    flags = await store.getSyncFlags();
    emit({ ...status, wasPairedAt: flags.wasPairedAt });
  }

  /** The household is gone: remember it, so a reload shows it without asking the relay. */
  async function markDeleted(): Promise<void> {
    photos.stop(); // no more photo traffic either
    if (flags.deletedAt) return;
    flags = await store.setSyncFlags({ deletedAt: stamp() });
    post({ type: 'config' });
  }

  /** The service's state for an engine status. */
  function stateOf(s: EngineStatus): SyncState {
    switch (s.state) {
      case 'ok':
        hadSync = true;
        return s.live ? 'live' : 'polling';
      case 'syncing':
        return hadSync ? (s.live ? 'live' : 'polling') : 'connecting';
      case 'deleted':
      case 'offline':
      case 'error':
      case 'off':
        hadSync = false;
        return s.state;
      default:
        return 'error';
    }
  }

  engine.onStatus((s) => {
    // Any tab's engine may be the one that hears it (a delete from this tab, or a 410).
    if (s.state === 'deleted') track(markDeleted());
    if (!leader) return;
    if (s.state === 'ok') {
      // The room exists and changes went through: move photos, and fill in a missing time zone.
      track(photos.kick());
      if (!zoneChecked) {
        zoneChecked = true;
        track(fillTimeZone());
      }
    }
    // While sync is off the store still records changes, but nothing is waiting to be sent.
    emit({
      ...status,
      state: stateOf(s),
      lastSynced: iso(s.lastSyncedAt),
      pendingCount: s.state === 'off' ? 0 : s.pendingCount,
      message: s.lastError,
      leader: true,
    });
    post({ type: 'status', status: shared(status) });
  });

  /** A household without a time zone gets this device's (the first device to sync sets it). */
  async function fillTimeZone(): Promise<void> {
    const household = await store.getCurrentHousehold();
    if (!isTimeZone(household.time_zone)) await store.updateHousehold(household.id, { time_zone: deviceTimeZone() });
  }

  // Cover photos, moved by the running tab only.
  let roomKeys: { key: string; keys: Omit<PhotoKeys, 'base'> } | null = null;
  const photoKeys = async (): Promise<PhotoKeys | null> => {
    if (!leader || disposed || flags.deletedAt) return null;
    const config = await store.getConfig();
    const base = config?.enabled ? normalizeRelayUrl(config.relayUrl || relayUrl) : null;
    if (!config || !base) return null;
    if (roomKeys?.key !== config.householdKey) {
      const [{ roomId, token }, { blobKey, blobIdKey }] = await Promise.all([
        crypto.deriveKeys(config.householdKey),
        crypto.deriveBlobKeys(config.householdKey),
      ]);
      roomKeys = { key: config.householdKey, keys: { roomId, token, blobKey, blobIdKey } };
    }
    return { base, ...roomKeys.keys };
  };
  const photos = createPhotoSync({
    store,
    keys: photoKeys,
    fetch: options.fetch,
    now: options.now,
    random: options.random,
    log,
    onDeleted: () => track(markDeleted()),
    onUploaded: () => {
      if (leader) void engine.syncNow(); // changes that waited for these photos
    },
    onCounts: ({ waiting, failed }) => {
      if (status.photosWaiting === waiting && status.photosFailed === failed) return;
      emit({ ...status, photosWaiting: waiting, photosFailed: failed });
      if (leader) post({ type: 'status', status: shared(status) });
    },
  });
  const offMissing = store.onMissingPhoto((hash) => {
    if (leader) photos.want(hash);
    else post({ type: 'wantPhoto', hash });
  });

  /** In the running tab: start the engine once sync is on, or have it re-read the config. */
  async function pickUp(): Promise<void> {
    if (!leader || disposed) return;
    if (flags.deletedAt) {
      // Known to be deleted: show it, and don't ask the relay again.
      emit({ ...status, state: 'deleted', message: t('sync.deleted'), pendingCount: await store.pendingCount(), leader: true });
      post({ type: 'status', status: shared(status) });
      return;
    }
    if (engineStarted) return engine.restart();
    const config = await store.getConfig();
    if (!config?.enabled) {
      emit({ ...status, state: 'off', message: '', pendingCount: 0, leader: true });
      return;
    }
    engineStarted = true;
    await engine.start();
  }

  /**
   * After an action: the running tab picks it up (the engine has already restarted itself unless
   * `restart`), another tab tells it to.
   */
  async function changed(restart = false): Promise<void> {
    await refreshFlags();
    zoneChecked = false; // a new or different household: check its time zone after the next sync
    if (leader) {
      if (!engineStarted || flags.deletedAt) await pickUp();
      else if (restart) await engine.restart();
    } else {
      post({ type: 'config' });
      const config = await store.getConfig();
      const state: SyncState = flags.deletedAt ? 'deleted' : config?.enabled ? 'connecting' : 'off';
      emit({ ...status, state, message: flags.deletedAt ? t('sync.deleted') : '', pendingCount: await pendingWhen(config?.enabled) });
      expectLeader();
    }
  }

  const setLeaderSilent = (on: boolean) => {
    if (status.leaderSilent !== on) emit({ ...status, leaderSilent: on });
  };

  /** A tab that doesn't run sync waits to hear from the one that does; if it doesn't, it says so. */
  function expectLeader(): void {
    clearTimeout(silentTimer);
    if (leader || disposed) return;
    silentTimer = setTimeout(() => {
      if (!leader && !disposed) setLeaderSilent(true);
    }, options.leaderSilentMs ?? LEADER_SILENT_MS);
  }

  const setBusyElsewhere = (on: boolean) => {
    clearTimeout(busyTimer);
    if (on) busyTimer = setTimeout(() => setBusyElsewhere(false), BUSY_TIMEOUT_MS);
    if (status.busyElsewhere !== on) emit({ ...status, busyElsewhere: on });
  };

  /** Run a household-changing action in this tab only, and in no other tab at the same time. */
  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    if (acting) throw new SyncBusyError();
    acting = true;
    const run = async () => {
      post({ type: 'busy', on: true });
      try {
        return await work();
      } finally {
        post({ type: 'busy', on: false });
      }
    };
    try {
      if (options.locks === null) return await run();
      const outcome = await withSyncLock(run, { name: ACTION_LOCK_NAME, ...(options.locks ? { locks: options.locks as never } : {}) });
      if (!outcome.ran) throw new SyncBusyError();
      return outcome.value;
    } finally {
      acting = false;
    }
  }

  channel?.addEventListener('message', (event) => {
    const message = event.data as Message | null;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'busy') return setBusyElsewhere(message.on);
    if (leader) {
      if (message.type === 'hello') post({ type: 'status', status: shared(status) });
      else if (message.type === 'config') track(refreshFlags().then(() => (engineStarted && !flags.deletedAt ? engine.restart() : pickUp())));
      else if (message.type === 'syncNow') void engine.syncNow();
      else if (message.type === 'wantPhoto' && typeof message.hash === 'string') photos.want(message.hash);
    } else if (message.type === 'status') {
      clearTimeout(silentTimer);
      emit({ ...status, ...message.status, leader: false, leaderSilent: false });
    } else if (message.type === 'config') {
      track(refreshFlags());
    }
  });

  // Run the engine in whichever visible tab gets the lock; the others wait their turn.
  const abort = new AbortController();
  const lockOptions = options.locks ? { locks: options.locks as never } : {};
  let releaseTurn: (() => void) | null = null;
  let queued = false;
  let lockDone: Promise<unknown> = Promise.resolve();
  let acquired: () => void = () => {};
  const firstTurn = new Promise<void>((resolve) => {
    acquired = resolve;
  });

  /** This tab's turn: run the engine until it hands over (or the service is disposed). */
  const lead = () =>
    new Promise<void>((resolve) => {
      if (disposed) return resolve();
      releaseTurn = resolve;
      leader = true;
      photos.reset();
      clearTimeout(silentTimer);
      emit({ ...status, leader: true, leaderSilent: false });
      acquired();
      track(pickUp());
    });

  /** Queue for the engine lock (once; only while visible, so a hidden tab never takes a turn). */
  function queueForTurn(): void {
    if (disposed || queued || leader) return;
    queued = true;
    const turn = options.locks === null ? lead() : withSyncLock(lead, { wait: true, signal: abort.signal, ...lockOptions });
    lockDone = turn.catch((error) => log.error(error)).finally(() => {
      queued = false;
    });
  }

  /**
   * Hidden, frozen or closing: one quick last sync (so a change made just now still goes out),
   * then stop the engine and release the lock, so a visible tab can run it. Queues again when
   * this tab is visible.
   */
  async function handOff(): Promise<void> {
    if (!leader || handingOff || disposed || options.locks === null) return;
    handingOff = true;
    try {
      await Promise.race([engine.syncNow(), new Promise((resolve) => setTimeout(resolve, options.handOffSyncMs ?? HAND_OFF_SYNC_MS))]);
    } catch {
      /* the next tab syncs */
    }
    engine.stop();
    photos.stop();
    clearHub();
    engineStarted = false;
    hadSync = false;
    leader = false;
    handingOff = false;
    emit({ ...status, leader: false });
    const release = releaseTurn;
    releaseTurn = null;
    release?.();
    post({ type: 'hello' });
    expectLeader();
  }

  baseEnv.onVisibility((visible) => {
    if (visible) queueForTurn();
    else track(handOff());
  });
  // Pages being frozen (Android does this to background tabs) or unloaded hand over too.
  if (typeof document !== 'undefined') document.addEventListener('freeze', () => track(handOff()));
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => track(handOff()));

  if (options.locks === null || baseEnv.isVisible()) queueForTurn();
  // Wait briefly for the lock, so a lone tab is the leader when this resolves.
  await Promise.race([firstTurn, new Promise((resolve) => setTimeout(resolve, 50))]);
  if (!leader) {
    post({ type: 'hello' });
    expectLeader();
  }

  async function localCounts(): Promise<LocalCounts> {
    const [readers, home, libraries, collections, notes, loans, libraryCards, summaries] = await Promise.all([
      store.listReaders(HOUSEHOLD_ID),
      store.listHomeItems(HOUSEHOLD_ID),
      store.listLibraries(HOUSEHOLD_ID),
      store.listCollections(HOUSEHOLD_ID),
      store.listNotes(HOUSEHOLD_ID),
      store.listLoans(HOUSEHOLD_ID),
      store.listHouseholdLibraryCards(HOUSEHOLD_ID),
      store.listHouseholdReadSummaries(HOUSEHOLD_ID),
    ]);
    // Every read event (re-reads too), as the backup summary counts them.
    const reads = summaries.reduce((n, s) => n + s.count, 0);
    return {
      readers: readers.length,
      homeBooks: home.length,
      libraries: libraries.length,
      collections: collections.length,
      notes: notes.length,
      loans: loans.length,
      libraryCards: libraryCards.length,
      reads,
    };
  }
  const localItemCount = async () => Object.values(await localCounts()).reduce((a, b) => a + b, 0);

  return {
    getStatus: () => ({ ...status }),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start: (newHousehold = true) =>
      guarded(async () => {
        if (!newHousehold) {
          if (flags.deletedAt) throw new JoinError('deleted', t('sync.join.deleted'));
          const config = await store.getConfig();
          if (!config) throw new Error('This device has no household key. Start a new household or join one.');
          await store.setConfig({ enabled: true });
          await changed(true);
          return { words: (await keyToWords(config.householdKey)).join(' ') };
        }
        const key = crypto.generateKey();
        // Journeys finished before syncing were celebrated (or are due) on this device already.
        await markAllCompletionsCelebrated(store);
        await fillTimeZone(); // the first device's zone, sent with everything else
        await engine.startHousehold(key);
        // A new household: the deleted one is behind us.
        if (flags.deletedAt) flags = await store.setSyncFlags({ deletedAt: null });
        await changed();
        return { words: (await keyToWords(key)).join(' ') };
      }),

    join: (words, mode) =>
      guarded(async () => {
        if (mode !== 'combine' && mode !== 'replace') throw new Error('Join mode must be combine or replace.');
        // A removed household is left with "Keep a copy" (turn off) or "Start a new household" first.
        if (flags.deletedAt) throw new JoinError('deleted', t('sync.join.deleted'));
        const key = await parseRecovery(words);
        const asReplace = mode === 'replace' || (await localItemCount()) === 0;
        // The household's finished journeys were celebrated where they happened: hold celebrations
        // until they are all on the list, so this device doesn't replay them.
        const resume = pauseCelebrations();
        // The joining device gets the household's PIN: its own goes (back only if the join fails).
        const ownPin = await store.setAsideLocalPin();
        try {
          await engine.joinHousehold(key, asReplace ? 'replace' : 'merge');
          await markAllCompletionsCelebrated(store);
        } catch (error) {
          if (ownPin && !(await store.getConfig())) await store.putBackLocalPin(ownPin);
          throw error;
        } finally {
          resume();
        }
        await changed();
        return { mode: asReplace ? 'replace' : 'combine' };
      }),

    stop: (keepData = true) =>
      guarded(async () => {
        const wasIn = Boolean((await store.getConfig()) || flags.deletedAt);
        await engine.disconnect();
        if (!keepData) await store.resetDevice(); // clears meta too; the flags are written after
        flags = await store.setSyncFlags({ deletedAt: null, ...(wasIn ? { wasPairedAt: stamp() } : {}) });
        await changed();
      }),

    deleteHousehold: () =>
      guarded(async () => {
        await engine.deleteHousehold();
        await markDeleted();
        if (!leader) emit({ ...status, state: 'deleted', message: engine.getStatus().lastError });
      }),

    async syncNow() {
      if (flags.deletedAt) return;
      if (leader) await engine.syncNow();
      else post({ type: 'syncNow' });
    },

    localCounts,
    localItemCount,

    async idle() {
      let seen: Promise<unknown> | null = null;
      while (seen !== background) {
        seen = background;
        await seen;
      }
      await engine.idle();
      await photos.idle();
    },

    async recoveryWords() {
      const config = await store.getConfig();
      return config ? (await keyToWords(config.householdKey)).join(' ') : null;
    },

    async checkRecoveryWords(words) {
      const config = await store.getConfig();
      return config ? wordsMatchKey(words, config.householdKey) : false;
    },

    async dispose() {
      disposed = true;
      clearTimeout(busyTimer);
      clearTimeout(silentTimer);
      abort.abort();
      engine.stop();
      photos.stop();
      offMissing();
      clearHub();
      await engine.idle();
      await photos.idle();
      releaseTurn?.();
      await lockDone;
      channel?.close();
      listeners.clear();
    },
  };
}
