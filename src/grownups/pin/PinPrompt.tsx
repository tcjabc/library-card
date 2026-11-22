import { useEffect, useState } from 'react';
import type { DataStore } from '../../data';
import { fmt, strings } from '../../strings';
import {
  NO_PIN_ATTEMPTS,
  afterWrongPin,
  formatWait,
  pinTriesLeft,
  pinWaitLeft,
  readPinAttempts,
  writePinAttempts,
  type PinAttempts,
} from '../pinAttempts';
import { PinPad } from './PinPad';

const t = strings.grownups.pin;

interface PinPromptProps {
  store: DataStore;
  reason: string;
  onPass: () => void;
  onForgot: () => void;
}

/**
 * "Enter the household PIN". Wrong PINs count on this device (pinAttempts.ts): after the 5th
 * comes a wait that doubles with each further wrong PIN, shown as a countdown with the pad off.
 */
export function PinPrompt({ store, reason, onPass, onForgot }: PinPromptProps) {
  const [attempts, setAttempts] = useState<PinAttempts>(() => readPinAttempts());
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waitLeft = pinWaitLeft(attempts, now);

  // Count down while waiting (a reload or another tab keeps the same wait).
  useEffect(() => {
    if (attempts.lockedUntil === null) return;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (attempts.lockedUntil !== null && current >= attempts.lockedUntil) {
        clearInterval(id);
        setMessage(null);
      }
    }, 250);
    return () => clearInterval(id);
  }, [attempts.lockedUntil]);

  const submit = async (pin: string) => {
    // Another tab may have counted wrong PINs meanwhile.
    const current = readPinAttempts();
    if (pinWaitLeft(current, Date.now()) > 0) {
      setAttempts(current);
      setNow(Date.now());
      return;
    }
    setBusy(true);
    setMessage(null);
    let right: boolean;
    try {
      right = await store.verifyHouseholdPin(pin);
    } catch (error) {
      console.error('[pin] verify failed', error);
      setBusy(false);
      setMessage(t.failed);
      return;
    }
    setBusy(false);
    if (right) {
      writePinAttempts(NO_PIN_ATTEMPTS);
      onPass();
      return;
    }
    const next = afterWrongPin(current, Date.now());
    writePinAttempts(next);
    setAttempts(next);
    setNow(Date.now());
    const left = pinTriesLeft(next);
    setMessage(next.lockedUntil ? null : left > 0 ? fmt(left === 1 ? t.triesLeft.one : t.triesLeft.other, { count: left }) : t.wrong);
  };

  return (
    <div className="stack">
      {waitLeft > 0 ? (
        <div className="gate">
          <div className="gate__wait" role="timer" aria-live="polite">
            <p className="gate__question">{t.waitTitle}</p>
            <p className="gate__countdown">{formatWait(waitLeft)}</p>
            <p>{fmt(t.wait, { time: formatWait(waitLeft) })}</p>
          </div>
        </div>
      ) : (
        <PinPad label={t.enter} reason={reason} message={message} busy={busy ? t.checking : null} onSubmit={(pin) => void submit(pin)} />
      )}
      <div className="row row--center">
        <button type="button" className="btn btn--quiet" onClick={onForgot}>
          {t.forgot}
        </button>
      </div>
    </div>
  );
}
