/** The library chosen for the last loan on this device (localStorage; may be unavailable). */

const KEY = 'library-card:last-library';

export function getLastLibraryId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastLibraryId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice isn't remembered.
  }
}
