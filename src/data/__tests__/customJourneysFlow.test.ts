import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStore, type LocalDataStore } from '../adapters/local';
import { customJourneyRef, HOUSEHOLD_ID } from '../DataStore';
import { nextCelebration, resetCelebrationsForTests } from '../../journeys/celebration';
import { checkJourneyCompletion } from '../../journeys/completion';
import { journeySeenKey } from '../../journeys/journeySeen';
import { listedCustomJourneys, loadJourney, resolveJourney } from '../../journeys/resolve';
import { loadJourneyStatus } from '../../screens/journeys/useJourneyStatus';

// 1.26.0, end to end through a real local store: make a custom journey, start it, read to the
// end, celebrate, archive; what the screens read at each step. (Here because only src/data may
// open the adapter directly.)

let store: LocalDataStore;
let dbName: string;
let readerId: string;

beforeEach(async () => {
  dbName = `custom-flow-${crypto.randomUUID()}`;
  store = await createLocalStore(dbName);
  await store.getCurrentHousehold();
  readerId = (await store.createReader({ household_id: HOUSEHOLD_ID, display_name: 'Test Reader', avatar: '🦊' })).id;
});

afterEach(async () => {
  resetCelebrationsForTests();
  await store.close();
  indexedDB.deleteDatabase(dbName);
});

const read = async (count: number, from = 0) => {
  for (let i = from; i < from + count; i++) await store.markRead(readerId, `97800000001${String(i).padStart(2, '0')}`, '2026-04-02T00:00:00.000Z');
};

describe('a custom journey, from making it to its celebration', () => {
  it('create → start → read 3 → complete → celebration data → archive → history keeps its name and theme', async () => {
    const made = await store.createCustomJourney({ household_id: HOUSEHOLD_ID, theme: 'ocean_deep', steps: 3, name: 'Little dive' });
    const ref = customJourneyRef(made.id);
    // The gallery lists it; the reader starts it.
    expect(listedCustomJourneys(await store.listCustomJourneys(HOUSEHOLD_ID)).map((j) => j.title)).toEqual(['Little dive']);
    const record = await store.startJourney(readerId, ref, '2026-04-01T00:00:00.000Z');
    // The journey screen and hub: its title, theme, direction, length and stages.
    const status = await loadJourneyStatus(store, readerId);
    expect(status?.journey).toMatchObject({ id: ref, title: 'Little dive', theme: 'ocean_deep', direction: 'down', steps: 3, isCustom: true });
    expect(status?.journey.stages.map((s) => s.step)).toEqual([1, 2, 3]);
    // Its first visit settles like a new start: the seen step is kept per record.
    expect(journeySeenKey(readerId, record.id)).toBe(`library-card:journey-seen:${readerId}:${record.id}`);

    await read(2);
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
    await read(1, 2);
    const done = await checkJourneyCompletion(store, readerId);
    expect(done?.completed_at).not.toBeNull();
    expect(await loadJourneyStatus(store, readerId)).toBeNull(); // the journey screen goes to the gallery

    // The celebration: this record, with its title and "N books".
    const history = await store.listJourneyHistory(readerId);
    const due = nextCelebration(history, new Set());
    expect(due?.id).toBe(record.id);
    expect(resolveJourney(due!.journey_id, await store.listCustomJourneys(HOUSEHOLD_ID, { includeArchived: true }))).toMatchObject({ title: 'Little dive', steps: 3 });
    expect(await store.countCompletedJourneys(readerId)).toEqual({ [ref]: 1 });

    // Archived: gone from the lists, still in the history with its name and theme; completion stays.
    await store.archiveCustomJourney(made.id);
    expect(listedCustomJourneys(await store.listCustomJourneys(HOUSEHOLD_ID, { includeArchived: true }))).toEqual([]);
    expect(await loadJourney(store, ref)).toMatchObject({ title: 'Little dive', theme: 'ocean_deep', archived: true });
    await store.markRead(readerId, '9780000000199', '2026-04-09T00:00:00.000Z');
    expect((await store.listJourneyHistory(readerId))[0].completed_at).toBe(done?.completed_at);
  });

  it('a reader on a journey that gets archived keeps going and still sees it in the gallery; 30 books completes at 30', async () => {
    const made = await store.createCustomJourney({ household_id: HOUSEHOLD_ID, theme: 'rocket_through_space', steps: 30 });
    const ref = customJourneyRef(made.id);
    await store.startJourney(readerId, ref, '2026-04-01T00:00:00.000Z');
    await store.archiveCustomJourney(made.id);
    const status = await loadJourneyStatus(store, readerId);
    expect(status?.journey).toMatchObject({ title: 'Rocket Through Space · 30 books', archived: true });
    const all = await store.listCustomJourneys(HOUSEHOLD_ID, { includeArchived: true });
    expect(listedCustomJourneys(all, status?.journey.id).map((j) => j.id)).toEqual([ref]);
    expect(listedCustomJourneys(all)).toEqual([]);
    await read(29);
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
    await read(1, 29);
    expect((await checkJourneyCompletion(store, readerId))?.completed_at).not.toBeNull();
  });

  it('a backup keeps a custom journey and the reader on it', async () => {
    const made = await store.createCustomJourney({ household_id: HOUSEHOLD_ID, theme: 'skyscraper', steps: 7, name: 'Up we go' });
    const started = await store.startJourney(readerId, customJourneyRef(made.id), '2026-04-01T00:00:00.000Z');
    await read(2);
    const backup = await store.exportBackup();
    await store.resetDevice();
    await store.importBackup(JSON.parse(JSON.stringify(backup)));
    const status = await loadJourneyStatus(store, readerId);
    expect(status?.record.id).toBe(started.id);
    expect(status?.journey).toMatchObject({ title: 'Up we go', steps: 7 });
    expect(status?.progress).toBe(2);
  });
});
