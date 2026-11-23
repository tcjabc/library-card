import { useId } from 'react';
import { configuredAdapter, useDataQuery, type DataStore } from '../data';
import { tabPath } from '../grownups/helpers';
import { getPretendToday, setPretendToday, useToday } from '../lib/clock';
import { href } from '../router';
import { fmt, strings } from '../strings';
import { SelfTestPanel } from './SelfTestPanel';
import { StaircasePanel } from './StaircasePanel';
import '../grownups/grownups.css';
import './DevPage.css';

/**
 * #/dev — developer tools, reached from Grown-ups > Settings (behind the
 * same gate): a pretend date, staircase test data and the storage self-test.
 */

const t = strings.dev;

const householdQuery = (s: DataStore) => s.getCurrentHousehold();

export default function DevPage() {
  const { store, error } = useDataQuery(householdQuery, ['households']);

  return (
    <main className="page page--wide dev grownups-page">
      <header className="stack">
        <a href={href(tabPath('settings'))} className="btn btn--small back-link">
          <span aria-hidden="true">←</span> {t.back}
        </a>
        <h1>{t.title}</h1>
        <p className="muted">{t.intro}</p>
        <p className="muted small">{fmt(t.adapter, { name: store?.adapterName ?? configuredAdapter })}</p>
      </header>

      {error && (
        <p className="alert alert--danger" role="alert">
          {fmt(t.storageError, { message: error.message })}
        </p>
      )}

      <PretendTodayPanel />
      <StaircasePanel />
      <section className="stack card">
        <h2>{t.stackHeading}</h2>
        <p className="muted small">{t.stackIntro}</p>
        <div className="row">
          <a className="btn" href={href('/dev/stack')}>
            {t.stackOpen}
          </a>
        </div>
      </section>
      <SelfTestPanel />
    </main>
  );
}

/** Pretend it is another day (this tab only), to check due chips and the hub badge. */
function PretendTodayPanel() {
  const id = useId();
  const today = useToday();
  const pretending = getPretendToday();
  return (
    <section className="stack card">
      <h2>{t.pretendHeading}</h2>
      <div className="row pretend-today">
        <label htmlFor={id} className="small">
          {t.pretendToday}
        </label>
        <input
          id={id}
          className="input input--short"
          type="date"
          value={pretending ?? ''}
          onChange={(e) => setPretendToday(e.target.value || null)}
        />
        {pretending && (
          <button type="button" className="btn btn--small" onClick={() => setPretendToday(null)}>
            {fmt(t.pretendReset, { today: new Date().toLocaleDateString() })}
          </button>
        )}
      </div>
      {pretending && <p className="small muted">{today}</p>}
    </section>
  );
}
