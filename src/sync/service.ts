/**
 * The sync service: runs the vendored engine (vendor/sync.js) over the sync store, in one tab only.
 *
 *   const sync = await createSyncService({ store });   // store from createSyncStore()
 *   sync.subscribe((status) => …);
 *   await sync.start();                                // a new household: shows these words
 *   await sync.join(words, 'combine');                 // or 'replace'
 *
 * One tab per browser holds a Web Lock and runs the engine (relay socket, timers, push and pull).
 * The other tabs queue for the lock, hear data changes through the store's subscribe() (applied
 * ops are broadcast like any local write) and the engine's status through a BroadcastChannel, and
 * take over when the running tab closes. Actions work from any tab: the result is in IndexedDB,
 * and the running tab is told to pick it up.
 *
 * Nothing in the app imports this yet (6d-2 adds the UI); import it lazily so the sync code stays
 * out of the main bundle.
 */
import { HOUSEHOLD_ID, withSyncLock, type SyncDataStore } from '../data';
import * as crypto from './vendor/crypto.js';
import { createKeyVault, type KeyVault, type VaultConfig } from './vendor/secure-key.js';
import {
  browserEnv,
  createSyncEngine,
  fetchTransport,
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
  /** Readers, home items, libraries and loans on this device: what a replace would drop. */
  localItemCount(): Promise<number>;
  /** The 12 recovery words for this device's household, or null. */
  recoveryWords(): Promise<string | null>;
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
}

const CHANNEL_NAME = 'library-card-sync';
const NO_CONFIG: VaultConfig = { householdKey: '', relayUrl: '', enabled: false, keyLocation: 'idb', keyTag: '' };

type Message =
  | { type: 'status'; status: Omit<SyncStatus, 'leader'> }
  | { type: 'hello' }
  | { type: 'config' }
  | { type: 'syncNow' };

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

/** A status for the other tabs (without `leader`, which each tab sets for itself). */
const shared = ({ state, lastSynced, pendingCount, message }: SyncStatus) => ({ state, lastSynced, pendingCount, message });

const iso = (at: number | string | null): string | null =>
  at === null || at === undefined ? null : typeof at === 'number' ? new Date(at).toISOString() : at;

export async function createSyncService(options: SyncServiceOptions): Promise<SyncService> {
  const { store, log = console } = options;
  const relayUrl = options.relayUrl ?? import.meta.env.VITE_SYNC_RELAY_URL ?? '';
  const vault = createKeyVault({ store: vaultStore(store), log });
  const engine: SyncEngine = createSyncEngine({
    store: engineStoreFor(store, vault),
    transport: options.transport ?? fetchTransport(),
    env: options.env ?? browserEnv(),
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
  let status: SyncStatus = {
    state: initial?.enabled ? 'connecting' : 'off',
    lastSynced: await store.getLastSynced(),
    pendingCount: await pendingWhen(initial?.enabled),
    message: '',
    leader: false,
  };
  let leader = false;
  let engineStarted = false;
  let hadSync = false;
  let disposed = false;

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
    if (!leader) return;
    // While sync is off the store still records changes, but nothing is waiting to be sent.
    emit({ state: stateOf(s), lastSynced: iso(s.lastSyncedAt), pendingCount: s.state === 'off' ? 0 : s.pendingCount, message: s.lastError, leader: true });
    post({ type: 'status', status: shared(status) });
  });

  /** In the running tab: start the engine once sync is on, or have it re-read the config. */
  async function pickUp(): Promise<void> {
    if (!leader || disposed) return;
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
    if (leader) {
      if (!engineStarted) await pickUp();
      else if (restart) await engine.restart();
    } else {
      post({ type: 'config' });
      const config = await store.getConfig();
      emit({ ...status, state: config?.enabled ? 'connecting' : 'off', pendingCount: await pendingWhen(config?.enabled) });
    }
  }

  channel?.addEventListener('message', (event) => {
    const message = event.data as Message | null;
    if (!message || typeof message !== 'object') return;
    if (leader) {
      if (message.type === 'hello') post({ type: 'status', status: shared(status) });
      else if (message.type === 'config') track(engineStarted ? engine.restart() : pickUp());
      else if (message.type === 'syncNow') void engine.syncNow();
    } else if (message.type === 'status') {
      emit({ ...message.status, leader: false });
    }
  });

  // Run the engine in whichever tab gets the lock; the others wait their turn.
  const abort = new AbortController();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired: () => void = () => {};
  const firstTurn = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const run = async () => {
    if (disposed) return;
    leader = true;
    emit({ ...status, leader: true });
    acquired();
    track(pickUp());
    await held;
  };
  const lockDone =
    options.locks === null
      ? run()
      : withSyncLock(run, { wait: true, signal: abort.signal, ...(options.locks ? { locks: options.locks as never } : {}) }).catch((error) => log.error(error));
  // Wait briefly for the lock, so a lone tab is the leader when this resolves.
  await Promise.race([firstTurn, new Promise((resolve) => setTimeout(resolve, 50))]);
  if (!leader) post({ type: 'hello' });

  async function localItemCount(): Promise<number> {
    const [readers, home, libraries, loans] = await Promise.all([
      store.listReaders(HOUSEHOLD_ID),
      store.listHomeItems(HOUSEHOLD_ID),
      store.listLibraries(HOUSEHOLD_ID),
      store.listLoans(HOUSEHOLD_ID),
    ]);
    return readers.length + home.length + libraries.length + loans.length;
  }

  return {
    getStatus: () => ({ ...status }),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start(newHousehold = true) {
      if (!newHousehold) {
        const config = await store.getConfig();
        if (!config) throw new Error('This device has no household key. Start a new household or join one.');
        await store.setConfig({ enabled: true });
        await changed(true);
        return { words: (await keyToWords(config.householdKey)).join(' ') };
      }
      const key = crypto.generateKey();
      await engine.startHousehold(key);
      await changed();
      return { words: (await keyToWords(key)).join(' ') };
    },

    async join(words, mode) {
      if (mode !== 'combine' && mode !== 'replace') throw new Error('Join mode must be combine or replace.');
      const key = await parseRecovery(words);
      const asReplace = mode === 'replace' || (await localItemCount()) === 0;
      await engine.joinHousehold(key, asReplace ? 'replace' : 'merge');
      await changed();
      return { mode: asReplace ? 'replace' : 'combine' };
    },

    async stop(keepData = true) {
      await engine.disconnect();
      if (!keepData) await store.resetDevice();
      await changed();
    },

    async deleteHousehold() {
      await engine.deleteHousehold();
      if (!leader) {
        post({ type: 'config' });
        emit({ ...status, state: 'deleted', message: engine.getStatus().lastError });
      }
    },

    async syncNow() {
      if (leader) await engine.syncNow();
      else post({ type: 'syncNow' });
    },

    localItemCount,

    async idle() {
      let seen: Promise<unknown> | null = null;
      while (seen !== background) {
        seen = background;
        await seen;
      }
      await engine.idle();
    },

    async recoveryWords() {
      const config = await store.getConfig();
      return config ? (await keyToWords(config.householdKey)).join(' ') : null;
    },

    async dispose() {
      disposed = true;
      abort.abort();
      engine.stop();
      await engine.idle();
      release();
      await lockDone;
      channel?.close();
      listeners.clear();
    },
  };
}
