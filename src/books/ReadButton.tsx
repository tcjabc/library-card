import type { MouseEvent } from 'react';
import { fmt, strings } from '../strings';
import { readButtonState } from './readFlow';

/**
 * "I read this!" (never read), "Read again!" (read before), or "⏳ Waiting for a grown-up" (a
 * read waiting to be checked: no more reads of this book until then).
 */
export function ReadButton({
  title,
  count,
  disabled,
  waiting = false,
  onRead,
}: {
  title: string;
  /** Confirmed reads only. */
  count: number;
  disabled?: boolean;
  waiting?: boolean;
  onRead: (click: MouseEvent<HTMLButtonElement>) => void;
}) {
  const t = strings.shelf;
  const state = readButtonState(count, waiting, disabled);
  if (state.kind === 'waiting') {
    return (
      <button type="button" className="btn read-toggle read-toggle--waiting" aria-label={fmt(strings.reads.waitingLabel, { title })} disabled>
        <span aria-hidden="true">⏳</span>
        {strings.reads.waiting}
      </button>
    );
  }
  const isRead = state.kind === 'again';
  return (
    <button
      type="button"
      className={`btn read-toggle${isRead ? ' read-toggle--on' : ''}`}
      aria-label={fmt(isRead ? t.readAgainLabel : t.readLabel, { title })}
      disabled={state.disabled}
      onClick={onRead}
    >
      <span aria-hidden="true">{isRead ? '🔁' : '⭐'}</span>
      {isRead ? t.readAgain : t.readFirst}
    </button>
  );
}

/** "Read N times", shown on a cover when a book was read more than once. */
export function ReadBadge({ count }: { count: number }) {
  if (count < 2) return null;
  return <span className="read-badge">{fmt(strings.shelf.readCount, { count })}</span>;
}
