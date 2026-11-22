import { afterEach, describe, expect, it } from 'vitest';
import { HOUSEHOLD_ID, isDataStoreError } from '../DataStore';
import { createLocalStore } from '../adapters/local';
import { hashPin } from '../pin';
import { createSyncStore } from '../sync/adapter';
import { rowToRecord } from '../sync/schema';
import { rawAll } from '../testing/fixtures';
import { generateKey } from '../../sync/vendor/crypto.js';

// The household PIN under sync (src/data/sync/adapter.ts, schema.ts). Here because only
// src/data may open the adapters directly.

const opened: { close(): Promise<void>; name: string }[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) {
    await s.close();
    indexedDB.deleteDatabase(s.name);
  }
});

async function syncStore() {
  const name = `pin-sync-${crypto.randomUUID()}`;
  const store = await createSyncStore(name);
  opened.push({ close: () => store.close(), name });
  return { store, name };
}

const pinRecordField = async (name: string) =>
  (await rawAll<{ id: string; fields: Record<string, unknown> }>(name, 'records')).find((r) => r.id === `households:${HOUSEHOLD_ID}`)?.fields
    .parent_pin_hash;

describe('clearing the PIN', () => {
  it('is refused with "blocked" while sync is on, and allowed again once it is off', async () => {
    const { store } = await syncStore();
    await store.setHouseholdPin('2468');
    await store.enableSync(generateKey());
    await expect(store.clearHouseholdPin()).rejects.toSatisfy((e) => isDataStoreError(e, 'blocked'));
    expect(await store.verifyHouseholdPin('2468')).toBe(true);
    // Changing is fine while syncing.
    await store.setHouseholdPin('1357');
    expect(await store.verifyHouseholdPin('1357')).toBe(true);
    // Sync off on this device: a local-only household may remove its PIN.
    await store.setConfig({ householdKey: '' });
    await store.clearHouseholdPin();
    expect(await store.verifyHouseholdPin('1357')).toBe(false);
  });

  it('the local adapter (never syncs) can always clear it', async () => {
    const name = `pin-local-${crypto.randomUUID()}`;
    const store = await createLocalStore(name);
    opened.push({ close: () => store.close(), name });
    await store.setHouseholdPin('2468');
    await store.clearHouseholdPin();
    expect((await store.getCurrentHousehold()).parent_pin_hash).toBeNull();
  });
});

describe('the PIN on the wire', () => {
  it('a set PIN syncs as its hash; an unset one is never sent', async () => {
    const hash = await hashPin('2468', 2000);
    const row = { id: HOUSEHOLD_ID, name: 'Home', time_zone: null };
    expect(rowToRecord('households', { ...row, parent_pin_hash: hash })?.fields).toMatchObject({ parent_pin_hash: hash });
    expect(rowToRecord('households', { ...row, parent_pin_hash: null })?.fields).not.toHaveProperty('parent_pin_hash');
  });

  it('turning sync on queues the PIN with the household', async () => {
    const { store } = await syncStore();
    await store.setHouseholdPin('2468');
    await store.enableSync(generateKey());
    const ops = await store.pendingOps();
    const pinOp = ops.find((op) => op.rec === `households:${HOUSEHOLD_ID}` && op.f === 'parent_pin_hash');
    expect(pinOp?.v).toBe((await store.getCurrentHousehold()).parent_pin_hash);
  });
});

describe('joining: this device’s PIN is set aside', () => {
  it('sets the PIN aside (row, record, queue) and puts it back', async () => {
    const { store, name } = await syncStore();
    await store.setHouseholdPin('2468');
    const hash = (await store.getCurrentHousehold()).parent_pin_hash;
    expect(await pinRecordField(name)).toBe(hash);

    const saved = await store.setAsideLocalPin();
    expect(saved?.hash).toBe(hash);
    expect((await store.getCurrentHousehold()).parent_pin_hash).toBeNull();
    expect(await pinRecordField(name)).toBeUndefined();
    // Turning sync on now sends no PIN of this device's.
    await store.enableSync(generateKey());
    expect((await store.pendingOps()).some((op) => op.f === 'parent_pin_hash')).toBe(false);
    await store.setConfig({ householdKey: '' });

    await store.putBackLocalPin(saved!);
    expect(await store.verifyHouseholdPin('2468')).toBe(true);
    expect(await pinRecordField(name)).toBe(hash);
  });

  it('nothing to set aside without a PIN', async () => {
    const { store } = await syncStore();
    await store.getCurrentHousehold();
    expect(await store.setAsideLocalPin()).toBeNull();
  });
});
