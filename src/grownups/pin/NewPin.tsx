import { useState } from 'react';
import { strings } from '../../strings';
import { PinPad } from './PinPad';

const t = strings.grownups.pin;

interface NewPinProps {
  /** Above the pad, e.g. why a PIN is needed now. */
  intro?: string;
  /** Saves the PIN (the hash takes a moment). Throwing shows "didn't work". */
  onSave: (pin: string) => Promise<void>;
}

/** Choose a new household PIN: 4–6 digits, entered twice. */
export function NewPin({ intro, onSave }: NewPinProps) {
  const [first, setFirst] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (pin: string) => {
    if (first === null) {
      setFirst(pin);
      setMessage(null);
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setMessage(t.mismatch);
      return;
    }
    setSaving(true);
    try {
      await onSave(pin);
    } catch (error) {
      console.error('[pin] save failed', error);
      setFirst(null);
      setMessage(t.failed);
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      {intro && <p>{intro}</p>}
      <PinPad
        // A fresh pad for the second entry.
        key={first === null ? 'first' : 'again'}
        label={first === null ? t.choose : t.again}
        message={message}
        busy={saving ? t.saving : null}
        onSubmit={(pin) => void submit(pin)}
      />
    </div>
  );
}
