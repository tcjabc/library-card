import { useEffect, useState, type FormEvent } from 'react';
import type { DataStore } from '../../data';
import { fmt, strings } from '../../strings';
import type { SyncService } from '../../sync/service';
import { formatWait, NO_PIN_ATTEMPTS, writePinAttempts } from '../pinAttempts';
import { WordsInput } from '../sync/WordsInput';
import { allWordsKnown, emptyWords } from '../sync/wordsLogic';
import { NewPin } from './NewPin';

const t = strings.grownups.pin;

/** How long a local-only household waits before its PIN goes. */
export const FORGOT_LOCAL_WAIT_MS = 60_000;

interface ForgotPinProps {
  store: DataStore;
  /** The sync service when this device syncs a household: the 12 words prove it's the household's. */
  service: SyncService | null;
  /** The new PIN is set, or the PIN was removed. */
  onDone: (outcome: 'changed' | 'removed') => void;
  onCancel: () => void;
}

/**
 * Forgot the PIN. Syncing: type the household's 12 words (they must be this device's
 * household), then choose a new PIN. Local-only: the gate was passed; wait a minute (with a
 * countdown, cancellable), then the PIN is removed. Loaded only when needed (the word list).
 */
export default function ForgotPin({ store, service, onDone, onCancel }: ForgotPinProps) {
  return service ? <ForgotWithWords store={store} service={service} onDone={onDone} /> : <ForgotByWaiting store={store} onDone={onDone} onCancel={onCancel} />;
}

function ForgotWithWords({ store, service, onDone }: Pick<ForgotPinProps, 'store' | 'onDone'> & { service: SyncService }) {
  const [typed, setTyped] = useState(emptyWords);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [matched, setMatched] = useState(false);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (!allWordsKnown(typed) || checking) return;
    setChecking(true);
    setProblem(null);
    const ok = await service.checkRecoveryWords(typed.join(' ')).catch(() => false);
    setChecking(false);
    if (ok) setMatched(true);
    else setProblem(t.forgotWrongWords);
  };

  if (matched) {
    return (
      <NewPin
        onSave={async (pin) => {
          await store.setHouseholdPin(pin);
          writePinAttempts(NO_PIN_ATTEMPTS);
          onDone('changed');
        }}
      />
    );
  }
  return (
    <form className="stack" onSubmit={(e) => void check(e)} noValidate>
      <p>{t.forgotWords}</p>
      <WordsInput words={typed} onChange={setTyped} />
      {problem && (
        <p className="alert alert--danger" role="alert">
          {problem}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={!allWordsKnown(typed) || checking}>
          {checking ? t.forgotChecking : t.forgotCheck}
        </button>
      </div>
    </form>
  );
}

function ForgotByWaiting({ store, onDone, onCancel }: Pick<ForgotPinProps, 'store' | 'onDone' | 'onCancel'>) {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (until === null) return;
    let done = false;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until && !done) {
        done = true;
        clearInterval(id);
        store.clearHouseholdPin().then(
          () => {
            writePinAttempts(NO_PIN_ATTEMPTS);
            onDone('removed');
          },
          (error: unknown) => {
            console.error('[pin] remove failed', error);
            setFailed(true);
            setUntil(null);
          },
        );
      }
    }, 250);
    return () => clearInterval(id);
  }, [until, store, onDone]);

  return (
    <div className="stack">
      <p>{t.forgotLocal}</p>
      {until === null ? (
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => setUntil(Date.now() + FORGOT_LOCAL_WAIT_MS)}>
            {t.forgotLocalStart}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            {strings.common.cancel}
          </button>
        </div>
      ) : (
        <>
          <p className="gate__countdown" role="timer" aria-live="polite">
            {fmt(t.forgotLocalCountdown, { time: formatWait(Math.max(0, until - now)) })}
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={onCancel}>
              {strings.common.cancel}
            </button>
          </div>
        </>
      )}
      {failed && (
        <p className="alert alert--danger" role="alert">
          {t.failed}
        </p>
      )}
    </div>
  );
}
