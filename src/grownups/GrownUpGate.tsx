import type { ReactNode } from 'react';
import { navigate } from '../router';
import { strings } from '../strings';
import { ParentGate } from './ParentGate';
import { useGrownUpSession } from './useGrownUpSession';

/** Wraps a grown-up screen: shows the gate until a grown-up session is unlocked. */
export function GrownUpGate({ children }: { children: ReactNode }) {
  const { unlocked, unlock } = useGrownUpSession();
  if (unlocked) return <>{children}</>;
  return (
    <main className="page page--kid gate-page">
      <h1 className="kid-title">{strings.gate.title}</h1>
      <ParentGate onPass={unlock} onCancel={() => navigate('/')} />
    </main>
  );
}
