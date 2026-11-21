import type { DataStore, Household } from '../../data';

/** What every grown-up tab gets from the area. */
export interface TabProps {
  store: DataStore;
  household: Household;
}
