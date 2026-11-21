// Types for sync.js (vendored from Peek Budget and changed; see VENDORED.md). Hand-written.

import type { DerivedKeys, Envelope } from './crypto.js';
import type { Op } from './sync-core.js';

/** '' in Library Card: the relay URL is passed in (createSyncEngine's defaultRelayUrl). */
export declare const DEFAULT_RELAY_URL: string;
export declare const keyNeededMessage: () => string;
/** A clean relay base URL (HTTPS, or HTTP to this machine), or null. */
export declare function normalizeRelayUrl(text: unknown): string | null;

export declare class RelayHttpError extends Error {
  constructor(status: number, code?: string, message?: string, retryAfterMs?: number);
  status: number;
  code: string | undefined;
  retryAfterMs: number | undefined;
}

export type JoinErrorCode = 'no_household' | 'offline' | 'relay' | 'key' | 'deleted';
export declare class JoinError extends Error {
  constructor(code: JoinErrorCode, message: string);
  code: JoinErrorCode;
}

export interface PushResult { head?: number; rejected?: string[] }
export interface PullEntry extends Envelope { seq: number }
export interface PullResult { entries?: PullEntry[]; head?: number }
export interface LiveHandlers {
  onOpen?: () => void;
  onHead: (seq: number) => void;
  onClose: (code?: number) => void;
  onDeleted?: () => void;
}

export interface Transport {
  push(base: string, room: string, token: string, envelopes: Envelope[], client: string): Promise<PushResult>;
  pull(base: string, room: string, token: string, after: number, limit: number): Promise<PullResult>;
  live(base: string, room: string, token: string, client: string, handlers: LiveHandlers): { close(): void };
  deleteRoom(base: string, room: string, token: string): Promise<unknown>;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface SyncEnv {
  isVisible(): boolean;
  isOnline(): boolean;
  onVisibility(fn: (visible: boolean) => void): void;
  onOnline(fn: () => void): void;
  onOffline?(fn: () => void): void;
}

export declare function fetchTransport(options?: {
  fetch?: typeof fetch;
  WebSocket?: unknown;
  timers?: Pick<Timers, 'setInterval' | 'clearInterval'>;
}): Transport;
export declare function browserEnv(): SyncEnv;

/** The config as the engine reads it (the key vault's readConfig). */
export interface EngineConfig {
  relayUrl: string;
  householdKey: string;
  enabled: boolean;
  keyUnavailable?: boolean;
}

/** What the engine calls on its store (src/sync/service.ts builds it from the sync store and the key vault). */
export interface EngineStore {
  getConfig(): Promise<EngineConfig | null>;
  setConfig(patch: Partial<EngineConfig>): Promise<unknown>;
  pendingOps(limit?: number): Promise<Op[]>;
  pendingCount(): Promise<number>;
  removeSentOps(sent: Pick<Op, 'rec' | 'f' | 't'>[]): Promise<unknown>;
  getCursor(): Promise<number>;
  applyRemote(ops: unknown[], cursor: number): Promise<{ changed: number; skipped: number }>;
  replaceWithRemote(ops: unknown[], cursor: number, config: Partial<EngineConfig>): Promise<unknown>;
  requeueAll(): Promise<unknown>;
  mergeOutbox(received?: Iterable<Pick<Op, 'rec' | 'f' | 't'>>): Promise<unknown>;
  getLastSynced(): Promise<string | number | null>;
  setLastSynced(at: number): Promise<unknown>;
  onChangesEnqueued(listener: () => void): unknown;
  enableSync(householdKey: string, options?: { relayUrl?: string }): Promise<unknown>;
}

export type EngineState = 'off' | 'syncing' | 'ok' | 'offline' | 'error' | 'deleted';
export interface EngineStatus {
  state: EngineState;
  lastSyncedAt: number | string | null;
  pendingCount: number;
  lastError: string;
  /** Library Card: the live socket is open. */
  live: boolean;
}

export interface EngineOptions {
  store: EngineStore;
  transport?: Transport;
  crypto?: {
    deriveKeys(keyText: string): Promise<DerivedKeys>;
    seal(key: CryptoKey, op: Op): Promise<Envelope>;
    open(key: CryptoKey, envelope: Envelope): Promise<Op>;
  };
  env?: SyncEnv;
  timers?: Timers;
  now?: () => number;
  random?: () => number;
  log?: Pick<Console, 'error' | 'warn'>;
  clientId?: string;
  debounceMs?: number;
  intervalMs?: number;
  liveIntervalMs?: number;
  batchSize?: number;
  maxBatchChars?: number;
  defaultRelayUrl?: string;
}

export interface SyncEngine {
  start(): Promise<void>;
  stop(): void;
  syncNow(): Promise<void>;
  configure(patch: Partial<EngineConfig>): Promise<void>;
  restart(): Promise<void>;
  deleteHousehold(): Promise<void>;
  disconnect(): Promise<void>;
  checkHousehold(keyText: string): Promise<{ exists: boolean; head: number }>;
  startHousehold(keyText: string): Promise<void>;
  joinHousehold(keyText: string, mode: 'replace' | 'merge'): Promise<{ mode: 'replace' | 'merge' } & Record<string, unknown>>;
  getStatus(): EngineStatus;
  onStatus(fn: (status: EngineStatus) => void): () => boolean;
  onRemoteChanges(fn: () => void | Promise<void>): () => boolean;
  idle(): Promise<void>;
}

export declare function createSyncEngine(options: EngineOptions): SyncEngine;
