import { useEffect, type ReactNode } from 'react';
import type { Reader } from '../data';
import { navigate } from '../router';
import { strings } from '../strings';
import { useActiveReader } from './activeReader';

/** Renders children with the active reader, or sends the child back to the splash to scan a card. */
export function RequireReader({ children }: { children: (reader: Reader) => ReactNode }) {
  const { reader, loading } = useActiveReader();

  useEffect(() => {
    if (!loading && !reader) navigate('/', { replace: true });
  }, [loading, reader]);

  if (!reader) {
    return (
      <main className="page page--kid">
        <p className="muted">{strings.common.loading}</p>
      </main>
    );
  }
  return <>{children(reader)}</>;
}
