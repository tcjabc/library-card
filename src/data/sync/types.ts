import type { LocalDataStore } from '../adapters/local';
import type { Op } from '../../sync/vendor/sync-core.js';

/** Types for the sync adapter (adapter.ts), kept apart so importing them costs nothing at runtime. */

export interface SyncConfig {
  /** The household key, 22 characters of base64url (also writable as 12 words). */
  householdKey: string;
  /** The relay's URL ('' until chosen). */
  relayUrl: string;
  /** Whether the engine should run. */
  enabled: boolean;
  /** The relay room for this key (derived from it). */
  roomId: string;
  enabledAt: string;
}

/** Per-device sync facts the UI needs, kept in meta (never synced or exported). */
export interface SyncFlags {
  /** When this device learned its household was deleted on the relay, or null. */
  deletedAt: string | null;
  /** When sync was last turned off here (so "Start a new household" warns first), or null. */
  wasPairedAt: string | null;
}

export interface ApplyResult {
  /** Ops that changed a record. */
  changed: number;
  /** Ops that failed validation, skipped. */
  skipped: number;
  /** Readers hidden because another visible reader has the same card token. */
  tokenConflicts: number;
}

/** What the sync engine needs from storage. */
export interface SyncEngineStore {
  getConfig(): Promise<SyncConfig | null>;
  /** Change config fields. A different household key resets the cursor and queues everything again; '' forgets the key. */
  setConfig(patch: Partial<SyncConfig>): Promise<SyncConfig>;
  /** Queued ops, oldest stamp first, each with its keyed, deterministic id (vendor opId). */
  pendingOps(limit?: number): Promise<Op[]>;
  pendingCount(): Promise<number>;
  /** Remove ops the relay has stored, but only where the outbox still holds that very stamp. */
  removeSentOps(sent: readonly Pick<Op, 'rec' | 'f' | 't'>[]): Promise<number>;
  getCursor(): Promise<number>;
  /** Apply pulled ops and move the cursor, in one transaction. Never touches the outbox. */
  applyRemote(ops: readonly unknown[], cursor: number): Promise<ApplyResult>;
  /** Replace everything synced on this device with the household's ops (join: "use the household's data"). */
  replaceWithRemote(ops: readonly unknown[], cursor: number, config?: Partial<SyncConfig>): Promise<ApplyResult & { records: number }>;
  /** Queue every field of every record again, with its current stamp (so the relay dedupes), and reset the cursor. */
  requeueAll(): Promise<number>;
  /**
   * After merging pulled ops into local data (join: "merge"): drop queued ops whose field has
   * since been overwritten by something received, so only fields where this device's value is
   * newer stay queued.
   */
  mergeOutbox(received?: Iterable<Pick<Op, 'rec' | 'f' | 't'>>): Promise<{ kept: number; dropped: number }>;
  getLastSynced(): Promise<string | null>;
  setLastSynced(at: string): Promise<void>;
  /** Called after a local write that queued ops has committed. Returns an unsubscribe function. */
  onChangesEnqueued(listener: () => void): () => void;
  /**
   * Turn sync on with a household key: rows without a record get one (fresh stamps), recorded
   * fields keep their stamps, and every field of every record is queued.
   */
  enableSync(householdKey: string, options?: { relayUrl?: string }): Promise<{ records: number; queued: number; skipped: number }>;
  getSyncFlags(): Promise<SyncFlags>;
  /** Set or clear (null) the flags in the patch; the others stay. */
  setSyncFlags(patch: Partial<SyncFlags>): Promise<SyncFlags>;
}

export type SyncDataStore = LocalDataStore & SyncEngineStore;

export function isSyncStore(store: unknown): store is SyncDataStore {
  return typeof (store as Partial<SyncEngineStore> | null)?.applyRemote === 'function';
}

