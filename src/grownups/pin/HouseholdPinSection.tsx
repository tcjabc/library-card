import type { DataStore, Household } from '../../data';
import { strings } from '../../strings';
import { useToast } from '../../ui/Toast';
import { usePinGuard } from './pinGuardContext';

const t = strings.grownups.pin;

/**
 * Grown-ups → Settings → Household PIN. No PIN: Set. A PIN: Change (asks the current one),
 * Remove (local-only households; asks the current one), and Forgot the PIN.
 */
export function HouseholdPinSection({ store, household }: { store: DataStore; household: Household }) {
  const guard = usePinGuard();
  const toast = useToast();
  const hasPin = Boolean(household.parent_pin_hash);

  const change = () =>
    void guard.runProtected('changePin', async () => {
      await guard.chooseNewPin({ title: t.changeTitle, done: t.changed });
    });

  const remove = () =>
    void guard.runProtected('removePin', async () => {
      await store.clearHouseholdPin();
      toast({ message: t.removed });
    });

  return (
    <section className="stack card" aria-labelledby="pin-heading">
      <h2 id="pin-heading">{t.heading}</h2>
      <p>{hasPin ? (guard.syncing ? t.introSynced : t.introLocal) : t.introNone}</p>
      {hasPin && guard.syncing && <p className="small muted">{t.syncKeeps}</p>}
      <div className="row">
        {hasPin ? (
          <>
            <button type="button" className="btn" onClick={change}>
              {t.change}
            </button>
            {!guard.syncing && (
              <button type="button" className="btn" onClick={remove}>
                {t.remove}
              </button>
            )}
            <button type="button" className="btn btn--quiet" onClick={() => void guard.forgotPin()}>
              {t.forgot}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => void guard.setUpPin()}>
            {t.set}
          </button>
        )}
      </div>
    </section>
  );
}
