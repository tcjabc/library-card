import { useCallback } from 'react';
import { useDataQuery, useDataStore, type DataStore, type Reader } from '../data';
import { ParentGate } from '../grownups/ParentGate';
import { PinPrompt } from '../grownups/pin/PinPrompt';
import { signInStep } from '../session/grownUpReader';
import { strings } from '../strings';

const t = strings.grownUpSignIn;

interface GrownUpSignInProps {
  reader: Reader;
  onPass: () => void;
  onCancel: () => void;
}

/**
 * A grown-up reader proves they are one before their space opens: the household PIN (the same
 * prompt and wrong-try counter as everywhere), or the multiplication gate if the household has
 * no PIN. Passing here only signs them in as a reader: it doesn't open the grown-up area or the
 * 2-minute window for guarded Settings actions.
 */
export function GrownUpSignIn({ reader, onPass, onCancel }: GrownUpSignInProps) {
  const query = useCallback((s: DataStore) => s.getCurrentHousehold(), []);
  const { data: household } = useDataQuery(query, ['households']);
  const { store } = useDataStore();

  if (!household || !store) return <p className="muted">{strings.common.loading}</p>;
  const step = signInStep(reader.kind, household.parent_pin_hash !== null);

  if (step === 'pin') {
    return (
      <div className="stack">
        <PinPrompt store={store} reason={t.pinReason} onPass={onPass} />
        <div className="row row--center">
          <button type="button" className="btn btn--quiet" onClick={onCancel}>
            {t.cancel}
          </button>
        </div>
      </div>
    );
  }
  // 'gate' (and a child, who never gets here: their card is enough).
  return <ParentGate reason={t.gateReason} onPass={onPass} onCancel={onCancel} />;
}
