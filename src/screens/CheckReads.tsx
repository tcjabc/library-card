import { useEffect } from 'react';
import type { Reader } from '../data';
import { ToCheckList } from '../reads/ToCheckList';
import { navigate } from '../router';
import { strings } from '../strings';
import { BackToHub } from './BackToHub';

/** #/check — a grown-up reader's "Reads to check" (children's reads waiting for a grown-up). */
export function CheckReads({ reader }: { reader: Reader }) {
  const t = strings.reads;
  const grownUp = reader.kind === 'grown_up';

  useEffect(() => {
    // Only grown-ups check reads; a child landing here goes home.
    if (!grownUp) navigate('/hub', { replace: true });
  }, [grownUp]);

  if (!grownUp) return null;
  return (
    <main className="page page--kid">
      <BackToHub />
      <h1 className="kid-title">
        <span aria-hidden="true">📝</span> {t.toCheckHeading}
      </h1>
      <p className="muted">{t.toCheckIntro}</p>
      <ToCheckList householdId={reader.household_id} confirmedBy={reader.id} />
    </main>
  );
}
