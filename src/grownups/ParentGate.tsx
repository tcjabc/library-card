import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { fmt, strings } from '../strings';
import { newGateQuestion, type GateQuestion } from './question';

/**
 * "Grown-ups only" check: a multiplication question in words, answered on an
 * on-screen number pad (no device keyboard pops up). A wrong answer gets a
 * gentle message and a new question; three wrong in a row means a 30-second
 * wait. The strike count and wait survive a reload (sessionStorage), so a
 * reload can't skip the wait.
 */

const MAX_STRIKES = 3;
const LOCKOUT_MS = 30_000;
const MAX_DIGITS = 2;
const ATTEMPTS_KEY = 'library-card:gate-attempts';

interface Attempts {
  strikes: number;
  lockedUntil: number | null;
}

function readAttempts(): Attempts {
  try {
    const raw = window.sessionStorage.getItem(ATTEMPTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Attempts>;
      const lockedUntil = typeof parsed.lockedUntil === 'number' && parsed.lockedUntil > Date.now() ? parsed.lockedUntil : null;
      return { strikes: lockedUntil ? MAX_STRIKES : Number(parsed.strikes) || 0, lockedUntil };
    }
  } catch {
    // Ignore unreadable storage.
  }
  return { strikes: 0, lockedUntil: null };
}

function writeAttempts(attempts: Attempts): void {
  try {
    if (attempts.strikes === 0 && attempts.lockedUntil === null) window.sessionStorage.removeItem(ATTEMPTS_KEY);
    else window.sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  } catch {
    // Storage blocked: attempts only last for this screen.
  }
}

export interface ParentGateProps {
  onPass: () => void;
  onCancel?: () => void;
  /** Shown above the question, e.g. why the gate appeared. */
  reason?: string;
}

export function ParentGate({ onPass, onCancel, reason }: ParentGateProps) {
  const t = strings.gate;
  const [question, setQuestion] = useState<GateQuestion>(() => newGateQuestion());
  const [entry, setEntry] = useState('');
  const [attempts, setAttempts] = useState<Attempts>(readAttempts);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const questionId = useId();

  const locked = attempts.lockedUntil !== null && attempts.lockedUntil > now;
  const secondsLeft = locked ? Math.ceil((attempts.lockedUntil! - now) / 1000) : 0;

  // Countdown while locked out; unlocks itself with a fresh question.
  useEffect(() => {
    if (attempts.lockedUntil === null) return;
    const until = attempts.lockedUntil;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) {
        clearInterval(id);
        const cleared = { strikes: 0, lockedUntil: null };
        writeAttempts(cleared);
        setAttempts(cleared);
        setMessage(null);
        setQuestion((q) => newGateQuestion(q));
      }
    }, 250);
    return () => clearInterval(id);
  }, [attempts.lockedUntil]);

  const press = useCallback(
    (digit: string) => {
      if (locked) return;
      setEntry((e) => (e.length >= MAX_DIGITS ? e : e + digit));
    },
    [locked],
  );

  const erase = useCallback(() => setEntry((e) => e.slice(0, -1)), []);

  const submit = useCallback(() => {
    if (locked || entry === '') return;
    if (Number(entry) === question.answer) {
      writeAttempts({ strikes: 0, lockedUntil: null });
      onPass();
      return;
    }
    const strikes = attempts.strikes + 1;
    const next: Attempts =
      strikes >= MAX_STRIKES ? { strikes, lockedUntil: Date.now() + LOCKOUT_MS } : { strikes, lockedUntil: null };
    writeAttempts(next);
    setAttempts(next);
    setNow(Date.now());
    setEntry('');
    setMessage(next.lockedUntil ? null : t.wrong);
    setQuestion((q) => newGateQuestion(q));
  }, [locked, entry, question.answer, attempts.strikes, onPass, t.wrong]);

  // A hardware keyboard works too (desktop, accessibility); no text field is used.
  const handlers = useRef({ press, erase, submit });
  useEffect(() => {
    handlers.current = { press, erase, submit };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) handlers.current.press(event.key);
      else if (event.key === 'Backspace') handlers.current.erase();
      else if (event.key === 'Enter') handlers.current.submit();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="gate" role="group" aria-labelledby={questionId}>
      <p className="gate__label">
        <span aria-hidden="true">🔒</span> {reason ?? t.intro}
      </p>

      {locked ? (
        <div className="gate__wait" role="timer" aria-live="polite">
          <p className="gate__question" id={questionId}>
            {t.waitTitle}
          </p>
          <p className="gate__countdown">{secondsLeft}</p>
          <p>{secondsLeft === 1 ? t.waitOne : fmt(t.wait, { seconds: secondsLeft })}</p>
        </div>
      ) : (
        <>
          <p className="gate__question" id={questionId} aria-live="polite">
            {question.text}
          </p>
          <output className="gate__answer" aria-label={t.answerLabel} aria-live="polite">
            {entry || <span className="gate__placeholder">{t.answerPlaceholder}</span>}
          </output>
          <p className="gate__message" role="status">
            {message ?? ''}
          </p>
        </>
      )}

      <div className="numpad" aria-label={t.padLabel}>
        {keys.map((k) => (
          <button key={k} type="button" className="btn numpad__key" onClick={() => press(k)} disabled={locked}>
            {k}
          </button>
        ))}
        <button type="button" className="btn numpad__key" onClick={erase} disabled={locked || !entry} aria-label={t.delete}>
          <span aria-hidden="true">⌫</span>
        </button>
        <button type="button" className="btn numpad__key" onClick={() => press('0')} disabled={locked}>
          0
        </button>
        <button type="button" className="btn btn--primary numpad__key" onClick={submit} disabled={locked || !entry}>
          {t.ok}
        </button>
      </div>

      {onCancel && (
        <button type="button" className="btn btn--quiet gate__cancel" onClick={onCancel}>
          {t.cancel}
        </button>
      )}
    </div>
  );
}
