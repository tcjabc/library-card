import { useCallback, useContext } from 'react';
import { GrownUpContext } from './context';
import { endGrownUpSession, unlockGrownUp, useGrownUpUnlocked } from './session';

/**
 * Grown-up session state and actions.
 *
 *   const { unlocked, requireGrownUp } = useGrownUpSession();
 *   requireGrownUp(() => store.deleteSomething(id));   // asks only if locked
 *   await runAsGrownUp(() => store.deleteSomething(id)); // the same, as a promise
 */
export function useGrownUpSession() {
  const unlocked = useGrownUpUnlocked();
  const { requireGrownUp } = useContext(GrownUpContext);
  /**
   * Like requireGrownUp, but resolves once the action has finished (or the
   * gate was closed instead), and rejects if the action fails. For confirm
   * sheets that show a busy state and errors.
   */
  const runAsGrownUp = useCallback(
    (action: () => Promise<void> | void, reason?: string) =>
      new Promise<void>((resolve, reject) => {
        requireGrownUp(
          () => {
            Promise.resolve().then(action).then(resolve, reject);
          },
          reason,
          resolve,
        );
      }),
    [requireGrownUp],
  );
  return { unlocked, requireGrownUp, runAsGrownUp, unlock: unlockGrownUp, end: endGrownUpSession };
}
