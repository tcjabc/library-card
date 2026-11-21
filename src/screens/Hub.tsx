import { useCallback } from 'react';
import { useDataQuery, type DataStore, type Reader } from '../data';
import { href, navigate } from '../router';
import { clearActiveReader } from '../session/activeReader';
import { fmt, strings } from '../strings';

/** #/hub — the reader's home screen. */
export function Hub({ reader }: { reader: Reader }) {
  const t = strings.hub;
  const countQuery = useCallback((s: DataStore) => s.countHouseholdReads(reader.household_id), [reader.household_id]);
  const { data: familyReads } = useDataQuery(countQuery, ['read_events']);

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
        <a className="tile tile--library" href={href('/library')}>
          <span className="tile__emoji" aria-hidden="true">🏛️</span>
          <span className="tile__label">{t.library}</span>
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
