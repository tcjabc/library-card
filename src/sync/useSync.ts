import { useEffect, useState } from 'react';
import { getSyncService, SYNC_ENABLED } from './app';
import type { SyncService, SyncStatus } from './service';

export interface UseSync {
  /** Null while loading, and always when sync isn't enabled in this build. */
  service: SyncService | null;
  status: SyncStatus | null;
}

/** The sync service and its live status, for grown-up screens. */
export function useSync(): UseSync {
  const [state, setState] = useState<UseSync>({ service: null, status: null });

  useEffect(() => {
    if (!SYNC_ENABLED) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    getSyncService().then(
      (service) => {
        if (cancelled || !service) return;
        setState({ service, status: service.getStatus() });
        unsubscribe = service.subscribe((status) => setState({ service, status }));
      },
      () => {},
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return state;
}
