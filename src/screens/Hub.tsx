import { useCallback } from 'react';
import { useDataQuery, type DataStore, type Reader } from '../data';
import { useToday } from '../lib/clock';
import { dueStatus, needsAttention } from '../library/due';
import { href, navigate } from '../router';
import { clearActiveReader } from '../session/activeReader';
import { fmt, strings } from '../strings';

/** #/hub — the reader's home screen. */
export function Hub({ reader }: { reader: Reader }) {
  const t = strings.hub;
  const countQuery = useCallback((s: DataStore) => s.countHouseholdReads(reader.household_id), [reader.household_id]);
  const { data: familyReads } = useDataQuery(countQuery, ['read_events']);
  const loansQuery = useCallback((s: DataStore) => s.listActiveLoans(reader.id), [reader.id]);
  const { data: loans } = useDataQuery(loansQuery, ['loans']);
  const today = useToday();
  const dueCount = (loans ?? []).filter((loan) => needsAttention(dueStatus(loan.due_date, today))).length;

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
        <a className="tile tile--journey" href={href('/journey')}>
          <span className="tile__emoji" aria-hidden="true">🗺️</span>
          <span className="tile__label">{t.journey}</span>
        </a>
        <a className="tile tile--staircase" href={href('/staircase')}>
          <span className="tile__emoji" aria-hidden="true">🪜</span>
          <span className="tile__label">{t.staircase}</span>
          {familyReads !== undefined && (
            <span className="tile__detail">{fmt(familyReads === 1 ? t.familyReadsOne : t.familyReads, { count: familyReads })}</span>
          )}
        </a>
      </nav>

      <button type="button" className="btn btn--big btn--quiet hub__not-me" onClick={notMe}>
        {t.notMe}
      </button>
    </main>
  );
}
