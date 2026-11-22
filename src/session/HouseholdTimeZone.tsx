import { useEffect } from 'react';
import { useDataQuery, type DataStore } from '../data';
import { setHouseholdTimeZone } from '../lib/timezone';

const householdQuery = (s: DataStore) => s.getCurrentHousehold();

/**
 * Keeps lib/timezone's household zone in step with households.time_zone (also when sync brings
 * a change from another device), so every "today" in the app is counted in that zone.
 */
export function HouseholdTimeZone() {
  const { data } = useDataQuery(householdQuery, ['households']);
  const zone = data?.time_zone ?? null;
  useEffect(() => {
    if (data) setHouseholdTimeZone(zone);
  }, [data, zone]);
  return null;
}
