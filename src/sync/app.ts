import { configuredAdapter, getDataStore, isSyncStore } from '../data';
import type { SyncService } from './service';

/**
 * Sync in the app: only when the build uses the sync adapter AND has a relay
 * (VITE_DATA_ADAPTER=sync and VITE_SYNC_RELAY_URL). Otherwise there is no
 * sync UI and the service is never loaded.
 */
export const SYNC_ENABLED = configuredAdapter === 'sync' && Boolean(import.meta.env.VITE_SYNC_RELAY_URL?.trim());

let service: Promise<SyncService | null> | null = null;

/**
 * The app's one sync service, created on first use (main.tsx starts it, so
 * changes sync while the kids use the app). The engine code is loaded lazily.
 * Null when sync isn't enabled in this build.
 */
export function getSyncService(): Promise<SyncService | null> {
  if (!SYNC_ENABLED) return Promise.resolve(null);
  if (!service) {
    service = getDataStore().then(async (store) => {
      if (!isSyncStore(store)) return null;
      const { createSyncService } = await import('./service');
      return createSyncService({ store });
    });
    // Allow a retry if opening failed.
    service.catch((error: unknown) => {
      console.error('[sync] could not start', error);
      service = null;
    });
  }
  return service;
}
