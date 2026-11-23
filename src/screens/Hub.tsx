import { useCallback, useState } from 'react';
import { NoteEditor } from '../notes/NoteEditor';
import { useDataQuery, type DataStore, type Reader } from '../data';
import { useToday } from '../lib/clock';
import { dueStatus, needsAttention } from '../library/due';
import { href, navigate } from '../router';
import { clearActiveReader } from '../session/activeReader';
import { fmt, strings } from '../strings';
import { GrownUpsLink } from './GrownUpsLink';
import { useCompletionCheckOnOpen, useJourneyStatus } from './journeys/useJourneyStatus';

/** #/hub — the reader's home screen. */
export function Hub({ reader }: { reader: Reader }) {
  const t = strings.hub;
  const countQuery = useCallback((s: DataStore) => s.countHouseholdReads(reader.household_id), [reader.household_id]);
  const { data: familyReads } = useDataQuery(countQuery, ['read_events']);
  const loansQuery = useCallback((s: DataStore) => s.listActiveLoans(reader.id), [reader.id]);
  // A grown-up's space: children's reads waiting for a grown-up.
  const grownUp = reader.kind === 'grown_up';
  const toCheckQuery = useCallback(
    (s: DataStore) => (grownUp ? s.listPendingReads(reader.household_id).then((list) => list.length) : Promise.resolve(0)),
    [grownUp, reader.household_id],
  );
  const { data: toCheck = 0 } = useDataQuery(toCheckQuery, ['read_events']);
  const { data: loans } = useDataQuery(loansQuery, ['loans']);
  const today = useToday();
  const dueCount = (loans ?? []).filter((loan) => needsAttention(dueStatus(loan.due_date, today))).length;
  const { status, loading: journeyLoading, store } = useJourneyStatus(reader.id);
  const [writing, setWriting] = useState(false);
  useCompletionCheckOnOpen(store, reader.id);

  const notMe = () => {
    clearActiveReader();
    navigate('/');
  };

  return (
    <main className="page page--kid">
      <header className="hub__header">
        <span className="avatar avatar--lg" aria-hidden="true">
          {reader.avatar}
        </span>
        <h1 className="kid-title">{fmt(t.greeting, { name: reader.display_name })}</h1>
      </header>

      {toCheck > 0 && (
        <a className="btn btn--primary btn--big hub__to-check" href={href('/check')}>
          <span aria-hidden="true">📝</span> {toCheck === 1 ? strings.reads.hubBannerOne : fmt(strings.reads.hubBanner, { count: toCheck })}
        </a>
      )}
      <nav className="tile-grid" aria-label={t.navLabel}>
        <a className="tile tile--shelf" href={href('/shelf')}>
          <span className="tile__emoji" aria-hidden="true">📚</span>
          <span className="tile__label">{t.shelf}</span>
        </a>
        <a
          className="tile tile--library"
          href={href('/library')}
          aria-label={dueCount > 0 ? fmt(dueCount === 1 ? t.libraryDueOne : t.libraryDue, { count: dueCount }) : undefined}
        >
          <span className="tile__emoji" aria-hidden="true">🏛️</span>
          <span className="tile__label">{t.library}</span>
          {dueCount > 0 && (
            <span className="tile__badge" aria-hidden="true">
              {dueCount}
            </span>
          )}
        </a>
        <a
          className="tile tile--journey"
          href={href(status ? '/journey' : '/journeys')}
          aria-label={
            status
              ? fmt(t.journeyLabel, { journey: status.journey.title, progress: status.progress, steps: status.journey.steps })
              : undefined
          }
        >
          <span className="tile__emoji" aria-hidden="true">{status?.journey.emoji ?? '🗺️'}</span>
          <span className="tile__label">{t.journey}</span>
          {!journeyLoading && (
            <span className="tile__detail">
              {status ? fmt(t.journeyProgress, { progress: status.progress, steps: status.journey.steps }) : t.journeyPick}
            </span>
          )}
        </a>
        <a className="tile tile--staircase" href={href('/staircase')}>
          <span className="tile__emoji" aria-hidden="true">🪜</span>
          <span className="tile__label">{t.staircase}</span>
          {familyReads !== undefined && (
            <span className="tile__detail">{fmt(familyReads === 1 ? t.familyReadsOne : t.familyReads, { count: familyReads.toLocaleString() })}</span>
          )}
        </a>
      </nav>

      {grownUp && (
        <button type="button" className="btn btn--big" onClick={() => setWriting(true)}>
          <span aria-hidden="true">✏️</span> {strings.notes.write}
        </button>
      )}
      <button type="button" className="btn btn--big btn--quiet hub__not-me" onClick={notMe}>
        {t.notMe}
      </button>
      <GrownUpsLink className="hub__grown-ups" />
      {writing && store && <NoteEditor store={store} householdId={reader.household_id} note={null} authorId={reader.id} onClose={() => setWriting(false)} />}
    </main>
  );
}
