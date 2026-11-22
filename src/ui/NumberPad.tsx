import { useEffect, useLayoutEffect, useRef } from 'react';
import { strings } from '../strings';
import { padClock, padReady } from './pressGuard';

interface NumberPadProps {
  onDigit: (digit: string) => void;
  onErase: () => void;
  onSubmit: () => void;
  /** Every key off (a wait, or busy). */
  disabled?: boolean;
  canErase: boolean;
  canSubmit: boolean;
  submitLabel?: string;
}

/**
 * The big on-screen number pad of the "grown-ups only" gate and the household PIN prompt:
 * 1–9, erase, 0, OK, so no phone keyboard pops up. A hardware keyboard works too (digits,
 * Backspace, Enter). Mount one at a time: it listens on the window. Presses in the first moment
 * after it opens are ignored (pressGuard.ts), so the tap that opened it can't enter a digit.
 */
export function NumberPad({ onDigit, onErase, onSubmit, disabled = false, canErase, canSubmit, submitLabel }: NumberPadProps) {
  const t = strings.gate;
  const handlers = useRef({ onDigit, onErase, onSubmit, disabled, canErase, canSubmit });
  useEffect(() => {
    handlers.current = { onDigit, onErase, onSubmit, disabled, canErase, canSubmit };
  });
  // When the pad appeared (before the browser paints it, so before any tap can reach it).
  const openedAt = useRef(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    openedAt.current = padClock();
  }, []);
  /** Runs a key's action, unless the pad has only just opened. */
  const press = (action: () => void) => {
    if (padReady(openedAt.current)) action();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!padReady(openedAt.current)) return;
      const h = handlers.current;
      if (/^[0-9]$/.test(event.key)) {
        if (!h.disabled) h.onDigit(event.key);
      } else if (event.key === 'Backspace') {
        if (!h.disabled && h.canErase) h.onErase();
      } else if (event.key === 'Enter') {
        if (!h.disabled && h.canSubmit) h.onSubmit();
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="numpad" aria-label={t.padLabel}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
        <button key={k} type="button" className="btn numpad__key" onClick={() => press(() => onDigit(k))} disabled={disabled}>
          {k}
        </button>
      ))}
      <button type="button" className="btn numpad__key" onClick={() => press(onErase)} disabled={disabled || !canErase} aria-label={t.delete}>
        <span aria-hidden="true">⌫</span>
      </button>
      <button type="button" className="btn numpad__key" onClick={() => press(() => onDigit('0'))} disabled={disabled}>
        0
      </button>
      <button type="button" className="btn btn--primary numpad__key" onClick={() => press(onSubmit)} disabled={disabled || !canSubmit}>
        {submitLabel ?? t.ok}
      </button>
    </div>
  );
}
