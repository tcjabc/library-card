/**
 * Asks the browser to keep this site's storage (books, readers, cover photos)
 * even when the device is short of space. Browsers may say no or ask the
 * user; either way nothing is shown to kids and nothing else changes.
 */
export async function requestPersistentStorage(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<boolean> {
  try {
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
