import { useCallback, useEffect } from 'react';
import { useDataQuery, type DataStore, type ReaderJourney } from '../../data';
import { watchJourneyCompletion } from '../../journeys/completion';
import { getJourney, type Journey } from '../../journeys/journeys';
import { filledSteps, journeyProgress, type FilledStep } from '../../journeys/progress';

export interface JourneyStatus {
  record: ReaderJourney;
  journey: Journey;
  /** Steps climbed, 0..journey.steps. */
  progress: number;
  filled: FilledStep[];
}

export const JOURNEY_TABLES = ['readers', 'reader_journeys', 'read_events'] as const;

/** The reader's active journey and progress, or null when there is none. */
export async function loadJourneyStatus(store: DataStore, readerId: string): Promise<JourneyStatus | null> {
  const record = await store.getActiveJourney(readerId);
  const journey = record ? getJourney(record.journey_id) : undefined;
  if (!record || !journey) return null;
  const summaries = await store.listReadSummaries(readerId);
  return {
    record,
    journey,
    progress: journeyProgress(summaries, record.started_at, journey.steps),
    filled: filledSteps(summaries, record.started_at, journey.steps),
  };
}

export function useJourneyStatus(readerId: string) {
  const query = useCallback((s: DataStore) => loadJourneyStatus(s, readerId), [readerId]);
  const { data, loading, store } = useDataQuery(query, JOURNEY_TABLES);
  return { status: data ?? null, loading, store };
}

/**
 * Runs the completion check while a screen is open: when it opens and after
 * every change to reads (a read synced from another device, a grown-up
 * confirming one elsewhere), so a journey finished elsewhere still celebrates
 * and the journey screen never sits at "0 more books to go!".
 */
export function useCompletionCheck(store: DataStore | null, readerId: string): void {
  useEffect(() => (store ? watchJourneyCompletion(store, readerId) : undefined), [store, readerId]);
}
