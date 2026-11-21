import { DataStoreError, type DataStore } from './DataStore';

export type AdapterName = 'local';

const ADAPTERS: Record<AdapterName, () => Promise<DataStore>> = {
  local: () => import('./adapters/local').then((m) => m.createLocalStore()),
  // supabase: () => import('./adapters/supabase').then((m) => m.createSupabaseStore()),
  // d1: () => import('./adapters/d1').then((m) => m.createD1Store()),
};

export const configuredAdapter: string = import.meta.env.VITE_DATA_ADAPTER?.trim() || 'local';

let storePromise: Promise<DataStore> | null = null;

/** Returns the shared DataStore instance, creating it on first call. */
export function getDataStore(): Promise<DataStore> {
  if (!storePromise) {
    const factory = ADAPTERS[configuredAdapter as AdapterName] as (() => Promise<DataStore>) | undefined;
    storePromise = factory
      ? factory()
      : Promise.reject(
          new DataStoreError(
            'unavailable',
            `Unknown VITE_DATA_ADAPTER "${configuredAdapter}". Expected one of: ${Object.keys(ADAPTERS).join(', ')}.`,
          ),
        );
    // Allow a retry after a failed open (e.g. storage blocked in private mode).
    storePromise.catch(() => {
      storePromise = null;
    });
  }
  return storePromise;
}
