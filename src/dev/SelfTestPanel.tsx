import { useState } from 'react';
import { fmt, strings } from '../strings';

type Results = { name: string; pass: boolean; detail?: string }[];

const t = strings.dev;

/** Runs the local adapter's storage self-test against throwaway databases. */
export function SelfTestPanel() {
  const [results, setResults] = useState<Results | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const { runLocalSelfTest } = await import('../data/selftest');
      setResults(await runLocalSelfTest());
    } finally {
      setRunning(false);
    }
  };

  const failed = results?.filter((r) => !r.pass).length ?? 0;

  return (
    <section className="stack card">
      <h2>{t.selfTestHeading}</h2>
      <p className="muted small">{t.selfTestIntro}</p>
      <div className="row">
        <button type="button" className="btn" onClick={() => void run()} disabled={running}>
          {running ? t.selfTestRunning : t.selfTestRun}
        </button>
      </div>
      {results && (
        <>
          <p className={failed ? 'alert alert--danger' : 'alert'} role="status" data-testid="selftest-summary">
            {fmt(t.selfTestSummary, { passed: results.length - failed, total: results.length })}
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
