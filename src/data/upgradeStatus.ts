/**
 * Whether this page is waiting to open the database because another tab or window still holds an
 * older version open (IndexedDB "blocked"). Every connection closes itself (and reloads its page)
 * on "versionchange", but a tab the browser has frozen in the background can't run that until it
 * comes back, so the new version waits. The app shows "Updating…" meanwhile (UpdatingNotice) and
 * carries on by itself once the open goes through. UI-free, so the data layer can set it.
 */

let blocked = false;
const listeners = new Set<() => void>();

export function setDatabaseUpgradeBlocked(value: boolean): void {
  if (blocked === value) return;
  blocked = value;
  listeners.forEach((listener) => listener());
}

export const isDatabaseUpgradeBlocked = (): boolean => blocked;

/** Calls `listener` whenever it changes. Returns an unsubscribe function. */
export function onDatabaseUpgradeBlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
