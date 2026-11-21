import { useContext } from 'react';
import { GrownUpContext } from './context';
import { endGrownUpSession, unlockGrownUp, useGrownUpUnlocked } from './session';

/**
 * Grown-up session state and actions.
 *
 *   const { unlocked, requireGrownUp } = useGrownUpSession();
 *   requireGrownUp(() => store.deleteSomething(id));   // asks only if locked
 */
export function useGrownUpSession() {
  const unlocked = useGrownUpUnlocked();
  const { requireGrownUp } = useContext(GrownUpContext);
  return { unlocked, requireGrownUp, unlock: unlockGrownUp, end: endGrownUpSession };
}
