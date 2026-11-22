import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalStore, DB_VERSION } from '../adapters/local';
import { createV3Database } from '../testing/fixtures';
import { isDatabaseUpgradeBlocked, onDatabaseUpgradeBlocked } from '../upgradeStatus';

// A new version of the app meets a tab still holding the old database version.

function openRaw(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('database upgrades and other tabs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('blocked by a tab that never lets go (frozen in the background): says "Updating…", then carries on by itself', async () => {
    const name = `lc-blocked-${Date.now()}`;
    await createV3Database(name);
    // The old tab: open at the old version, never answering "versionchange".
    const oldTab = await openRaw(name, 3);
    const seen: boolean[] = [];
    const off = onDatabaseUpgradeBlocked(() => seen.push(isDatabaseUpgradeBlocked()));

    let opened = false;
    const opening = createLocalStore(name).then((store) => {
      opened = true;
      return store;
    });
    await vi.waitFor(() => expect(isDatabaseUpgradeBlocked()).toBe(true));
    expect(opened).toBe(false); // waiting, not failing

    oldTab.close(); // the old tab goes (or comes back and reloads)
    const store = await opening;
    expect(isDatabaseUpgradeBlocked()).toBe(false);
    expect(seen).toEqual([true, false]);
    expect((await store.getHousehold('main'))?.id).toBe('main'); // upgraded, data kept
    await store.close();
    off();
  });

  it('our own connection closes itself (and reloads the page) when a newer version needs the database', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const name = `lc-versionchange-${Date.now()}`;
    const store = await createLocalStore(name);
    await store.getCurrentHousehold();

    // A newer version opens it in another tab: not blocked, because this connection lets go.
    const newer = await openRaw(name, DB_VERSION + 1);
    expect(newer.version).toBe(DB_VERSION + 1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isDatabaseUpgradeBlocked()).toBe(false);
    newer.close();
  });
});
