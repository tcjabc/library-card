import { useState } from 'react';
import { fmt, strings } from '../strings';

type Results = { name: string; pass: boolean; detail?: string }[];

const t = strings.dev;

type Adapter = 'local' | 'sync';

/** Runs the storage self-test against throwaway databases, on the local or the sync adapter. */
export function SelfTestPanel() {
  const [results, setResults] = useState<Results | null>(null);
  const [ranOn, setRanOn] = useState<Adapter | null>(null);
  const [running, setRunning] = useState<Adapter | null>(null);

  const run = async (adapter: Adapter) => {
    setRunning(adapter);
    try {
      const { runLocalSelfTest } = await import('../data/selftest');
      setResults(await runLocalSelfTest(adapter));
      setRanOn(adapter);
    } finally {
      setRunning(null);
    }
  };

  const failed = results?.filter((r) => !r.pass).length ?? 0;

  return (
    <section className="stack card">
      <h2>{t.selfTestHeading}</h2>
      <p className="muted small">{t.selfTestIntro}</p>
      <div className="row">
        <button type="button" className="btn" onClick={() => void run('local')} disabled={running !== null}>
          {running === 'local' ? t.selfTestRunning : t.selfTestRun}
        </button>
        <button type="button" className="btn" onClick={() => void run('sync')} disabled={running !== null}>
          {running === 'sync' ? t.selfTestRunning : t.selfTestRunSync}
        </button>
      </div>
      {results && (
        <>
          <p className={failed ? 'alert alert--danger' : 'alert'} role="status" data-testid="selftest-summary">
            {fmt(t.selfTestSummary, { passed: results.length - failed, total: results.length, adapter: ranOn ?? 'local' })}
          </p>
          <ul className="selftest small">
            {results.map((r) => (
              <li key={r.name} className={r.pass ? 'selftest__pass' : 'selftest__fail'}>
                {r.pass ? '✓' : '✗'} {r.name}
                {!r.pass && r.detail ? ` — ${r.detail}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
