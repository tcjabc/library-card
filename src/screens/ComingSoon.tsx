import { useCallback, type ReactNode } from 'react';
import { useDataQuery, type DataStore, type Reader } from '../data';
import { fmt, strings } from '../strings';
import { BackToHub } from './BackToHub';

/** Placeholder for screens that arrive in later phases. */
export function ComingSoon({ title, emoji, children }: { title: string; emoji: string; children?: ReactNode }) {
  return (
    <main className="page page--kid">
      <BackToHub />
      <div className="center-stack">
        <p className="kid-emoji" aria-hidden="true">
          {emoji}
        </p>
        <h1 className="kid-title">{title}</h1>
        {children}
        <p className="kid-lead muted">{strings.comingSoon.body}</p>
      </div>
    </main>
  );
}

/** #/staircase — coming soon, but already shows the family's total. */
export function StaircaseSoon({ reader }: { reader: Reader }) {
  const t = strings.comingSoon;
  const query = useCallback((s: DataStore) => s.countHouseholdReads(reader.household_id), [reader.household_id]);
  const { data: count } = useDataQuery(query, ['read_events']);
  return (
    <ComingSoon title={strings.hub.staircase} emoji="🪜">
      {count !== undefined && (
        <p className="kid-stat">
          <span className="kid-stat__number">{count}</span>
          <span>{count === 1 ? t.staircaseCountOne : fmt(t.staircaseCount, { count })}</span>
        </p>
      )}
    </ComingSoon>
  );
}
