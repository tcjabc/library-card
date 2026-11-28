import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStore, type LocalDataStore } from '../adapters/local';
import { nextCelebration, resetCelebrationsForTests } from '../../journeys/celebration';
import { checkJourneyCompletion, watchJourneyCompletion } from '../../journeys/completion';
import { loadJourneyStatus } from '../../screens/journeys/useJourneyStatus';
import { customJourneyRef } from '../DataStore';

// Journey completion (src/journeys/completion.ts) against a real local store.
// It lives here because only src/data may open the adapter directly.

let store: LocalDataStore;
let dbName: string;
let readerId: string;

beforeEach(async () => {
  dbName = `completion-test-${crypto.randomUUID()}`;
  store = await createLocalStore(dbName);
  const household = await store.getCurrentHousehold();
  readerId = (await store.createReader({ household_id: household.id, display_name: 'Test', avatar: '🦊' })).id;
});

afterEach(async () => {
  resetCelebrationsForTests();
  await store.close();
  indexedDB.deleteDatabase(dbName);
});

async function addBooks(count: number, at: string): Promise<string[]> {
  const isbns: string[] = [];
  for (let i = 0; i < count; i++) {
    const isbn = `97800000000${String(i).padStart(2, '0')}`;
    await store.markRead(readerId, isbn, at);
    isbns.push(isbn);
  }
  return isbns;
}

describe('checkJourneyCompletion', () => {
  it('does nothing without an active journey', async () => {
    await addBooks(5, '2026-03-02T00:00:00.000Z');
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
    expect(nextCelebration(await store.listJourneyHistory(readerId), new Set())).toBeNull();
  });

  it('does nothing until every step is filled, then completes (which is what celebrates)', async () => {
    await store.startJourney(readerId, 'ocean_deep', '2026-03-01T00:00:00.000Z');
    await addBooks(4, '2026-03-02T00:00:00.000Z');
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();

    await store.markRead(readerId, '9780000000999', '2026-03-03T00:00:00.000Z');
    const done = await checkJourneyCompletion(store, readerId);
    expect(done?.completed_at).toBeTruthy();
    expect(nextCelebration(await store.listJourneyHistory(readerId), new Set())?.id).toBe(done?.id);
    expect(await store.getActiveJourney(readerId)).toBeNull();
    expect((await store.getReader(readerId))?.active_journey_id).toBeNull();
    expect(await store.countCompletedJourneys(readerId)).toEqual({ ocean_deep: 1 });

    // A second check finds nothing to do.
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
  });

  it('books read before the journey started do not count', async () => {
    await addBooks(5, '2026-02-01T00:00:00.000Z');
    await store.startJourney(readerId, 'ocean_deep', '2026-03-01T00:00:00.000Z');
    // Re-reading them after the start is still not a new book.
    for (let i = 0; i < 5; i++) await store.markRead(readerId, `97800000000${String(i).padStart(2, '0')}`, `2026-03-0${i + 2}T00:00:00.000Z`);
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
  });

  it('undoing the last read after completion keeps the journey completed', async () => {
    await store.startJourney(readerId, 'ocean_deep', '2026-03-01T00:00:00.000Z');
    const isbns = await addBooks(5, '2026-03-02T00:00:00.000Z');
    await checkJourneyCompletion(store, readerId);
    await store.undoLatestRead(readerId, isbns[4]);
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
    const [history] = await store.listJourneyHistory(readerId);
    expect(history.completed_at).toBeTruthy();
    expect(await store.countCompletedJourneys(readerId)).toEqual({ ocean_deep: 1 });
  });

  it('ignores a journey id that is no longer in the config', async () => {
    await store.startJourney(readerId, 'retired_journey', '2026-03-01T00:00:00.000Z');
    await addBooks(40, '2026-03-02T00:00:00.000Z');
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
  });
});

describe('watchJourneyCompletion: the check also runs on live updates', () => {
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it('completes the journey when a read arrives while the screen is open, without reopening it', async () => {
    await store.startJourney(readerId, 'ocean_deep', '2026-03-01T00:00:00.000Z');
    await addBooks(4, '2026-03-02T00:00:00.000Z');
    const completed: string[] = [];
    const stop = watchJourneyCompletion(store, readerId, (_, journeyId) => completed.push(journeyId));
    await settle();
    expect(completed).toEqual([]);
    expect(await store.getActiveJourney(readerId)).not.toBeNull();

    // The last book, read on another device or confirmed by a grown-up elsewhere: a live change.
    await store.markRead(readerId, '9780000000999', '2026-03-03T00:00:00.000Z');
    await settle();
    expect(completed).toEqual(['ocean_deep']);
    expect(await store.getActiveJourney(readerId)).toBeNull();
    stop();
  });

  it('checks once on start (a journey finished before the screen opened), and nothing after stopping', async () => {
    await store.startJourney(readerId, 'ocean_deep', '2026-03-01T00:00:00.000Z');
    await addBooks(5, '2026-03-02T00:00:00.000Z');
    const completed: string[] = [];
    const stop = watchJourneyCompletion(store, readerId, (_, id) => completed.push(id));
    await settle();
    expect(completed).toEqual(['ocean_deep']);
    stop();

    await store.startJourney(readerId, 'ocean_deep', '2026-03-04T00:00:00.000Z');
    await addBooks(5, '2026-03-05T00:00:00.000Z');
    await settle();
    expect(completed).toEqual(['ocean_deep']);
  });
});

describe('custom journeys complete at their own length (1.25.0)', () => {
  const custom = async (steps: number) =>
    store.createCustomJourney({ household_id: (await store.getCurrentHousehold()).id, theme: 'rocket_through_space', steps });

  for (const steps of [3, 30]) {
    it(`${steps} books: nothing until the ${steps}th, then complete`, async () => {
      const j = await custom(steps);
      await store.startJourney(readerId, customJourneyRef(j.id), '2026-03-01T00:00:00.000Z');
      await addBooks(steps - 1, '2026-03-02T00:00:00.000Z');
      expect(await checkJourneyCompletion(store, readerId)).toBeNull();
      expect((await loadJourneyStatus(store, readerId))?.progress).toBe(steps - 1);
      await store.markRead(readerId, '9780000000999', '2026-03-03T00:00:00.000Z');
      const done = await checkJourneyCompletion(store, readerId);
      expect(done?.journey_id).toBe(customJourneyRef(j.id));
      expect(done?.completed_at).not.toBeNull();
      expect(await store.getActiveJourney(readerId)).toBeNull();
    });
  }

  it('a raised length applies to a reader on it; an archived one still completes', async () => {
    const j = await custom(3);
    await store.startJourney(readerId, customJourneyRef(j.id), '2026-03-01T00:00:00.000Z');
    await addBooks(3, '2026-03-02T00:00:00.000Z');
    await store.updateCustomJourney(j.id, { steps: 5 }); // raised before the check ran
    await store.archiveCustomJourney(j.id);
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
    const status = await loadJourneyStatus(store, readerId);
    expect([status?.progress, status?.journey.steps, status?.journey.archived]).toEqual([3, 5, true]);
    await addBooks(5, '2026-03-04T00:00:00.000Z'); // the first 3 again are re-reads; 2 new books fill the 5
    expect((await checkJourneyCompletion(store, readerId))?.completed_at).not.toBeNull();
  });

  it('a custom ref whose journey this device doesn’t have is left alone, as an unknown id always was', async () => {
    await store.startJourney(readerId, 'custom:not-here', '2026-03-01T00:00:00.000Z');
    await addBooks(30, '2026-03-02T00:00:00.000Z');
    expect(await checkJourneyCompletion(store, readerId)).toBeNull();
    expect(await loadJourneyStatus(store, readerId)).toBeNull();
    expect((await store.getActiveJourney(readerId))?.journey_id).toBe('custom:not-here');
  });
});
