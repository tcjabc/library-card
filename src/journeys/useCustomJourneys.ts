import { useCallback } from 'react';
import { HOUSEHOLD_ID, useDataQuery, type CustomJourney, type DataStore } from '../data';

const EMPTY: readonly CustomJourney[] = [];

/**
 * The household's custom journeys, archived ones too, kept up to date (a change on this device,
 * another tab or another device). Empty until the first read, and on devices with none.
 */
export function useCustomJourneys(): readonly CustomJourney[] {
  const query = useCallback((s: DataStore) => s.listCustomJourneys(HOUSEHOLD_ID, { includeArchived: true }), []);
  const { data } = useDataQuery(query, ['custom_journeys']);
  return data ?? EMPTY;
}
