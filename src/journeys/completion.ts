import type { DataStore, Id, ReaderJourney } from '../data';
import { loadJourney } from './resolve';
import { isComplete, journeyProgress } from './progress';

/**
 * Finishes the reader's active journey if enough books have been read. Run
 * after every read (Shelf, Library Books), and while the hub, the gallery or the
 * journey screen is open (watchJourneyCompletion: on opening and after every
 * change to reads), so a journey completed elsewhere (another tab, another
 * device, a read a grown-up confirmed) is still caught. The celebration follows from the completion
 * itself (journeys/celebration.ts), on this device and on every synced one.
 *
 * Completion is permanent: undoing a read afterwards never un-completes it.
 * Returns the completed journey, or null if nothing changed.
 */
export async function checkJourneyCompletion(
  store: DataStore,
  readerId: Id,
  onComplete: (readerId: Id, journeyId: string) => void = () => {},
): Promise<ReaderJourney | null> {
  const active = await store.getActiveJourney(readerId);
  if (!active) return null;
  const journey = await loadJourney(store, active.journey_id);
  if (!journey) return null; // a journey removed from the config: leave it alone
  const summaries = await store.listReadSummaries(readerId);
  if (!isComplete(journeyProgress(summaries, active.started_at, journey.steps), journey.steps)) return null;
  const done = await store.completeJourney(active.id);
  onComplete(readerId, active.journey_id);
  return done;
}

/**
 * Runs the completion check now and again after every change to the reader's
 * reads or journeys (in this tab, another tab or another device), until the
 * returned stop function is called. Checks never overlap: a change during a
 * check runs one more check after it. Failures are logged, never thrown.
 */
export function watchJourneyCompletion(
  store: DataStore,
  readerId: Id,
  onComplete: (readerId: Id, journeyId: string) => void = () => {},
): () => void {
  let stopped = false;
  let running = false;
  let again = false;
  const run = async () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await checkJourneyCompletion(store, readerId, onComplete);
      } while (again && !stopped);
    } catch (error: unknown) {
      console.error('[journey] completion check failed', error);
    } finally {
      running = false;
    }
  };
  void run();
  const unsubscribe = store.subscribe((change) => {
    if (change.tables.includes('read_events') || change.tables.includes('reader_journeys')) void run();
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}
