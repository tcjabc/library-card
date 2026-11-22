import { useCallback } from 'react';
import { useDataQuery, useDataStore, type DataStore } from '../data';
import { ParentGate } from '../grownups/ParentGate';
import { PinPrompt } from '../grownups/pin/PinPrompt';
import { strings } from '../strings';

interface GrownUpCheckProps {
  /** Above the PIN pad, e.g. "Enter the household PIN to confirm this read." */
  pinReason: string;
  /** Above the gate's question, when the household has no PIN. */
  gateReason: string;
  onPass: () => void;
  onCancel: () => void;
}

/**
 * "Is a grown-up here?" on a child's screen: the household PIN (the same prompt and wrong-try
 * counter as everywhere), or the multiplication gate if the household has no PIN. Passing only
 * answers this one question: it never opens grown-up mode or the 2-minute window for guarded
 * Settings actions.
 */
export function GrownUpCheck({ pinReason, gateReason, onPass, onCancel }: GrownUpCheckProps) {
  const query = useCallback((s: DataStore) => s.getCurrentHousehold(), []);
  const { data: household } = useDataQuery(query, ['households']);
  const { store } = useDataStore();

  if (!household || !store) return <p className="muted">{strings.common.loading}</p>;

  if (household.parent_pin_hash !== null) {
    return (
      <div className="stack">
        <PinPrompt store={store} reason={pinReason} onPass={onPass} />
        <div className="row row--center">
          <button type="button" className="btn btn--quiet" onClick={onCancel}>
            {strings.grownUpSignIn.cancel}
          </button>
        </div>
      </div>
    );
  }
  return <ParentGate reason={gateReason} onPass={onPass} onCancel={onCancel} />;
}
