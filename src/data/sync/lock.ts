/**
 * Only one tab should run the sync engine (6d). A Web Lock: with ifAvailable (the default) the
 * first tab that asks runs `work` and the others get { ran: false } at once; with `wait: true` a
 * tab queues for the lock and runs `work` once the holder lets go (its work settles or the tab
 * closes), unless `signal` aborts first. Browsers without Web Locks (and Node tests) just run it.
 */

export const SYNC_LOCK_NAME = 'library-card-sync-engine';

interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
}

export type LockOutcome<T> = { ran: true; value: T } | { ran: false };

export interface SyncLockOptions {
  locks?: LockManagerLike;
  name?: string;
  /** Queue for the lock instead of giving up when another tab holds it. */
  wait?: boolean;
  /** Stop waiting (resolves { ran: false }). */
  signal?: AbortSignal;
}

export async function withSyncLock<T>(
  work: () => Promise<T>,
  { locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks, name = SYNC_LOCK_NAME, wait = false, signal }: SyncLockOptions = {},
): Promise<LockOutcome<T>> {
  if (signal?.aborted) return { ran: false };
  if (!locks || typeof locks.request !== 'function') return { ran: true, value: await work() };
  let outcome: LockOutcome<T> = { ran: false };
  try {
    await locks.request(name, wait ? (signal ? { signal } : {}) : { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      outcome = { ran: true, value: await work() };
    });
  } catch (error) {
    if (signal?.aborted && (error as { name?: string } | null)?.name === 'AbortError') return { ran: false };
    throw error;
  }
  return outcome;
}
