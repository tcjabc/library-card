import { useEffect, useState } from 'react';
import type { DataStore, DataTable } from './DataStore';
import { getDataStore } from './store';

/** The shared DataStore, or null while it opens. `error` is set if it can't open. */
export function useDataStore(): { store: DataStore | null; error: Error | null } {
  const [state, setState] = useState<{ store: DataStore | null; error: Error | null }>({ store: null, error: null });
  useEffect(() => {
    let cancelled = false;
    getDataStore().then(
      (store) => !cancelled && setState({ store, error: null }),
      (error: unknown) => !cancelled && setState({ store: null, error: toError(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export interface DataQueryResult<T> {
  /** Latest result. Kept while a refresh runs, so the UI doesn't flash. */
  data: T | undefined;
  error: Error | null;
  /** True until the first result for the current query arrives. */
  loading: boolean;
  store: DataStore | null;
}

/**
 * Runs `query` against the DataStore and re-runs it whenever data changes
 * (in this tab or another). Wrap `query` in useCallback: it re-runs when the
 * function identity changes.
 *
 *   const reads = useDataQuery(useCallback((s) => s.listReadSummaries(id), [id]), ['read_events']);
 *
 * `tables` limits re-runs to changes touching those tables (default: any change).
 * Pass `null` as the query to skip it (e.g. while an id is unknown).
 */
export function useDataQuery<T>(
  query: ((store: DataStore) => Promise<T>) | null,
  tables?: readonly DataTable[],
): DataQueryResult<T> {
  const { store, error: storeError } = useDataStore();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ query: unknown; data: T | undefined; error: Error | null }>({
    query: undefined,
    data: undefined,
    error: null,
  });
  const tablesKey = tables ? [...tables].sort().join(',') : '';

  useEffect(() => {
    if (!store) return;
    const watched = tablesKey ? new Set(tablesKey.split(',')) : null;
    return store.subscribe((change) => {
      if (!watched || change.tables.some((t) => watched.has(t))) setVersion((v) => v + 1);
    });
  }, [store, tablesKey]);

  useEffect(() => {
    if (!store || !query) return;
    let cancelled = false;
    query(store).then(
      (data) => !cancelled && setResult({ query, data, error: null }),
      (error: unknown) => !cancelled && setResult((prev) => ({ query, data: prev.data, error: toError(error) })),
    );
    return () => {
      cancelled = true;
    };
  }, [store, query, version]);

  return {
    data: result.query === query ? result.data : undefined,
    error: storeError ?? (result.query === query ? result.error : null),
    loading: !storeError && query !== null && result.query !== query,
    store,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
