import { useCallback, useId, useState } from 'react';
import { PIN_MAX_DIGITS, PIN_MIN_DIGITS } from '../../data/pin';
import { fmt, strings } from '../../strings';
import { NumberPad } from '../../ui/NumberPad';

const t = strings.grownups.pin;

interface PinPadProps {
  /** The line above the dots ("Enter the household PIN"). */
  label: string;
  /** Why it's asked, above the label (with the lock). */
  reason?: string;
  /** Under the dots: a wrong PIN, a mismatch… */
  message?: string | null;
  /** Checking or saving: the pad is off and the message says so. */
  busy?: string | null;
  /** Called with 4–6 digits; the dots clear. */
  onSubmit: (pin: string) => void;
}

/**
 * Entering a household PIN: the gate's look (lock line, big pad) with masked dots, never the
 * digits. OK works from 4 digits; at most 6.
 */
export function PinPad({ label, reason, message, busy, onSubmit }: PinPadProps) {
  const [entry, setEntry] = useState('');
  const labelId = useId();
  const off = Boolean(busy);

  const press = useCallback((digit: string) => setEntry((e) => (e.length >= PIN_MAX_DIGITS ? e : e + digit)), []);
  const erase = useCallback(() => setEntry((e) => e.slice(0, -1)), []);
  const submit = useCallback(() => {
    if (entry.length < PIN_MIN_DIGITS) return;
    setEntry('');
    onSubmit(entry);
  }, [entry, onSubmit]);

  // Filled dots for the digits typed; hollow ones up to the shortest PIN.
  const slots = Math.max(entry.length, PIN_MIN_DIGITS);
  return (
    <div className="gate" role="group" aria-labelledby={labelId}>
      {reason && (
        <p className="gate__label">
          <span aria-hidden="true">🔒</span> {reason}
        </p>
      )}
      <p className="gate__question" id={labelId}>
        {label}
      </p>
      <div
        className="pin-dots"
        role="img"
        aria-live="polite"
        aria-label={entry.length ? fmt(t.dotsLabel, { count: entry.length }) : t.dotsEmpty}
      >
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={i < entry.length ? 'pin-dots__dot' : 'pin-dots__dot pin-dots__dot--empty'} />
        ))}
      </div>
      <p className="gate__message" role="status">
        {busy ?? message ?? ''}
      </p>
      <NumberPad
        onDigit={press}
        onErase={erase}
        onSubmit={submit}
        disabled={off}
        canErase={entry.length > 0}
        canSubmit={entry.length >= PIN_MIN_DIGITS}
      />
    </div>
  );
}
