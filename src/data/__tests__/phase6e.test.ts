import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOUSEHOLD_ID, isDataStoreError } from '../DataStore';
import { createLocalStore, type LocalDataStore } from '../adapters/local';
import { rowToRecord } from '../sync/schema';
import { isSyncStore } from '../sync/types';
import {
  celebrationsPaused,
  ensureCelebrationList,
  getCelebrated,
  markAllCompletionsCelebrated,
  markCelebrated,
  nextCelebration,
  pauseCelebrations,
  resetCelebrationsForTests,
} from '../../journeys/celebration';
import { checkJourneyCompletion } from '../../journeys/completion';

// Household time zone, photo sync leaving the local adapter alone, and celebrations per device.
// Here because only src/data may open the adapter directly. The test device is in New York.

/** 00:30 on 23 November in Taipei; 22 November in New York. */
const NEAR_MIDNIGHT = Date.parse('2026-11-22T16:30:00Z');

let store: LocalDataStore;
let dbName: string;
let clock: number;

beforeEach(async () => {
  dbName = `p6e-${crypto.randomUUID()}`;
  // A second per call: still the same date everywhere below, but no two stamps alike.
  clock = NEAR_MIDNIGHT;
  store = await createLocalStore(dbName, { now: () => (clock += 1000) });
});

afterEach(async () => {
  resetCelebrationsForTests();
  await store.close();
  indexedDB.deleteDatabase(dbName);
});

describe('household time zone', () => {
  it('starts unset; takes IANA zones only', async () => {
    const household = await store.getCurrentHousehold();
    expect(household.time_zone).toBeNull();
    expect((await store.updateHousehold(household.id, { time_zone: 'Asia/Taipei' })).time_zone).toBe('Asia/Taipei');
    await expect(store.updateHousehold(household.id, { time_zone: 'Moon/Base' })).rejects.toSatisfy((e) => isDataStoreError(e, 'invalid'));
    expect((await store.updateHousehold(household.id, { time_zone: null })).time_zone).toBeNull();
  });

  it('renewing a loan with no due date counts from today in the household’s zone', async () => {
    const household = await store.getCurrentHousehold();
    const reader = await store.createReader({ household_id: household.id, display_name: 'R', avatar: '🦊' });
    const library = await store.createLibrary({ household_id: household.id, name: 'Branch', default_loan_days: 14 });
    const loan = () => store.createLoan({ household_id: household.id, reader_id: reader.id, isbn: '9780000000002', library_id: library.id });

    expect((await store.renewLoan((await loan()).id)).due_date).toBe('2026-12-06'); // New York: the 22nd
    await store.updateHousehold(household.id, { time_zone: 'Asia/Taipei' });
    expect((await store.renewLoan((await loan()).id)).due_date).toBe('2026-12-07'); // Taipei: the 23rd
  });

  it('syncs when set; an unset zone is never sent (a Combine join can’t wipe it)', () => {
    const row = { id: HOUSEHOLD_ID, name: 'Home', parent_pin_hash: null };
    expect(rowToRecord('households', { ...row, time_zone: 'Asia/Taipei' })?.fields).toMatchObject({ time_zone: 'Asia/Taipei' });
    expect(rowToRecord('households', { ...row, time_zone: null })?.fields).not.toHaveProperty('time_zone');
  });
});

describe('the local adapter is unchanged by photo sync', () => {
  it('has no photo outbox or photo sync methods', async () => {
    expect(isSyncStore(store)).toBe(false);
    for (const name of ['photosToUpload', 'photoCounts', 'saveRemotePhoto', 'onMissingPhoto']) expect(store).not.toHaveProperty(name);
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toContain(dbName);
    expect(names).not.toContain(`${dbName}:sync-blobs`);
  });

  it('a book pointing at a photo that isn’t here shows no cover, as before', async () => {
    await store.putBook({ isbn: '9780000000002', title: 'T', authors: [], cover_url: `cover:${'b'.repeat(64)}`, source: 'manual' });
    expect((await store.getBook('9780000000002'))?.cover_url).toBeNull();
  });

  it('photo covers still save, show and back up', async () => {
    const url = await store.saveCoverImage(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1]) as BlobPart], { type: 'image/jpeg' }));
    await store.putBook({ isbn: '9780000000002', title: 'T', authors: [], cover_url: url, source: 'manual' });
    expect((await store.getBook('9780000000002'))?.cover_url).toBe(url);
    const backup = await store.exportBackup();
    expect(Object.keys(backup.covers)).toHaveLength(1);
  });
});

describe('celebrations: this device’s list of celebrated completions', () => {
  let readerId: string;

  beforeEach(async () => {
    await store.getCurrentHousehold();
    readerId = (await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'R', avatar: '🦊' })).id;
  });

  let n = 0;
  async function finishJourney(): Promise<string> {
    await store.startJourney(readerId, 'ocean_deep', '2026-03-01T00:00:00.000Z');
    for (let i = 0; i < 5; i++) await store.markRead(readerId, `97800000${String(++n).padStart(5, '0')}`, '2026-03-02T00:00:00.000Z');
    const done = await checkJourneyCompletion(store, readerId);
    expect(done?.completed_at).toBeTruthy();
    return done!.id;
  }
  const due = async () => nextCelebration(await store.listJourneyHistory(readerId), getCelebrated() ?? new Set())?.id ?? null;

  it('first run: completions that already exist never replay; a new one celebrates once', async () => {
    const old = await finishJourney();
    expect(getCelebrated()).toBeNull();
    await ensureCelebrationList(store);
    expect(getCelebrated()).toEqual(new Set([old]));
    expect(await due()).toBeNull();

    const fresh = await finishJourney();
    expect(await due()).toBe(fresh);
    markCelebrated(fresh);
    expect(await due()).toBeNull();
    // Making the list again (another tab) keeps it.
    await ensureCelebrationList(store);
    expect(await due()).toBeNull();
  });

  it('a completion that arrives later (another device, another tab) celebrates once', async () => {
    await ensureCelebrationList(store);
    const arrived = await finishJourney(); // the list didn't hear about it
    expect(await due()).toBe(arrived);
    markCelebrated(arrived);
    expect(await due()).toBeNull();
  });

  it('after a restore or a join, every completion is marked, so none replay', async () => {
    await ensureCelebrationList(store);
    await finishJourney();
    await finishJourney();
    await markAllCompletionsCelebrated(store);
    expect(await due()).toBeNull();
  });

  it('several completions celebrate oldest first, one at a time', async () => {
    await ensureCelebrationList(store);
    const first = await finishJourney();
    const second = await finishJourney();
    expect(await due()).toBe(first);
    markCelebrated(first);
    expect(await due()).toBe(second);
  });

  it('pausing holds celebrations until resumed', async () => {
    const resume = pauseCelebrations();
    const other = pauseCelebrations();
    expect(celebrationsPaused()).toBe(true);
    resume();
    resume(); // twice is harmless
    expect(celebrationsPaused()).toBe(true);
    other();
    expect(celebrationsPaused()).toBe(false);
  });
});
