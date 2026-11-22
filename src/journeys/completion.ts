import type { DataStore, Id, ReaderJourney } from '../data';
import { getJourney } from './journeys';
import { isComplete, journeyProgress } from './progress';

/**
 * Finishes the reader's active journey if enough books have been read. Run
 * after every read (Shelf, Library Books) and when the hub or journey screen
 * opens, so a journey completed elsewhere (another tab, a read added by a
 * grown-up) is still caught. The celebration follows from the completion
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
  const journey = getJourney(active.journey_id);
  if (!journey) return null; // a journey removed from the config: leave it alone
  const summaries = await store.listReadSummaries(readerId);
  if (!isComplete(journeyProgress(summaries, active.started_at, journey.steps), journey.steps)) return null;
  const done = await store.completeJourney(active.id);
  onComplete(readerId, active.journey_id);
  return done;
}
