import { useCallback, useEffect } from 'react';
import { useDataQuery, type DataStore, type ReaderJourney } from '../../data';
import { checkJourneyCompletion } from '../../journeys/completion';
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
 * Runs the completion check when a screen opens, so a journey finished
 * elsewhere (another tab, a read recorded before this check existed) still
 * celebrates.
 */
export function useCompletionCheckOnOpen(store: DataStore | null, readerId: string): void {
  useEffect(() => {
    if (!store) return;
    checkJourneyCompletion(store, readerId).catch((error: unknown) => console.error('[journey] completion check failed', error));
  }, [store, readerId]);
}
