/**
 * Only one tab should run the sync engine (6d). A Web Lock with ifAvailable: the first tab that
 * asks runs it; the others get { ran: false } and can try again later. Browsers without Web Locks
 * (and Node tests) just run it.
 */

export const SYNC_LOCK_NAME = 'library-card-sync-engine';

interface LockManagerLike {
  request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
}

export type LockOutcome<T> = { ran: true; value: T } | { ran: false };

export async function withSyncLock<T>(
  work: () => Promise<T>,
  { locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks, name = SYNC_LOCK_NAME }: { locks?: LockManagerLike; name?: string } = {},
): Promise<LockOutcome<T>> {
  if (!locks || typeof locks.request !== 'function') return { ran: true, value: await work() };
  let outcome: LockOutcome<T> = { ran: false };
  await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    outcome = { ran: true, value: await work() };
  });
  return outcome;
}
