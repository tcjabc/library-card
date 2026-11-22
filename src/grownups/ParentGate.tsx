import { useCallback, useEffect, useId, useState } from 'react';
import { fmt, strings } from '../strings';
import { NumberPad } from '../ui/NumberPad';
import {
  NO_ATTEMPTS,
  afterWrongAnswer,
  isLockedOut,
  lockoutSecondsLeft,
  readAttempts,
  writeAttempts,
  type Attempts,
} from './attempts';
import { newGateQuestion, type GateQuestion } from './question';

/**
 * "Grown-ups only" check: a multiplication question in words, answered on an
 * on-screen number pad (no device keyboard pops up). A wrong answer gets a
 * gentle message and a new question; three wrong in a row means a 30-second
 * wait. The strike count and wait survive a reload (sessionStorage), so a
 * reload can't skip the wait.
 */

const MAX_DIGITS = 2;

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
  const [attempts, setAttempts] = useState<Attempts>(() => readAttempts());
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const questionId = useId();

  const locked = isLockedOut(attempts, now);
  const secondsLeft = lockoutSecondsLeft(attempts, now);

  // Countdown while locked out; unlocks itself with a fresh question.
  useEffect(() => {
    if (attempts.lockedUntil === null) return;
    const until = attempts.lockedUntil;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) {
        clearInterval(id);
        writeAttempts(NO_ATTEMPTS);
        setAttempts(NO_ATTEMPTS);
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
      writeAttempts(NO_ATTEMPTS);
      onPass();
      return;
    }
    const next = afterWrongAnswer(attempts, Date.now());
    writeAttempts(next);
    setAttempts(next);
    setNow(Date.now());
    setEntry('');
    setMessage(next.lockedUntil ? null : t.wrong);
    setQuestion((q) => newGateQuestion(q));
  }, [locked, entry, question.answer, attempts, onPass, t.wrong]);

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

      {/* A hardware keyboard works too (desktop, accessibility); no text field is used. */}
      <NumberPad onDigit={press} onErase={erase} onSubmit={submit} disabled={locked} canErase={Boolean(entry)} canSubmit={Boolean(entry)} />

      {onCancel && (
        <button type="button" className="btn btn--quiet gate__cancel" onClick={onCancel}>
          {t.cancel}
        </button>
      )}
    </div>
  );
}
