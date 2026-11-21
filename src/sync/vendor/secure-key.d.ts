// Types for secure-key.js (vendored from Peek Budget and changed; see VENDORED.md). Hand-written.

export declare const SECURE_KEY_ID: string;

export declare class KeyUnavailableError extends Error {
  code: 'key_unavailable';
}

/** A config as the vault reads it from the store (never null: the service passes a fallback). */
export interface VaultConfig {
  householdKey: string;
  relayUrl: string;
  enabled: boolean;
  keyLocation?: 'idb' | 'secure';
  keyTag?: string;
  wasPaired?: boolean;
  [field: string]: unknown;
}

export interface VaultStore {
  getSyncConfig(): Promise<VaultConfig>;
  setSyncConfig(patch: Partial<VaultConfig>): Promise<unknown>;
  replaceWithRemote(ops: unknown[], cursor: number, config: Partial<VaultConfig>): Promise<unknown>;
  moveKeyToSecure?(keyText: string, tag: string): Promise<boolean>;
}

export interface SecureStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

export interface KeyVault {
  readonly kind: 'native-secure' | 'web-indexeddb';
  readonly migration: string;
  get(): Promise<string>;
  set(keyText: string, extra?: Partial<VaultConfig>): Promise<unknown>;
  remove(extra?: Partial<VaultConfig>): Promise<unknown>;
  migrate(): Promise<string>;
  readConfig(): Promise<VaultConfig & { keyUnavailable: boolean }>;
  setConfig(patch?: Partial<VaultConfig>): Promise<unknown>;
  replaceWithRemote(ops: unknown[], cursor: number, config?: Partial<VaultConfig>): Promise<unknown>;
  status(): Promise<{
    paired: boolean;
    enabled: boolean;
    wasPaired: boolean | undefined;
    keyUnavailable: boolean;
    kind: 'native-secure' | 'web-indexeddb';
    keyLocation: string | undefined;
    relayUrl: string;
  }>;
}

export declare function createKeyVault(options: {
  store: VaultStore;
  secure?: SecureStore | null;
  log?: Pick<Console, 'warn'>;
}): KeyVault;
