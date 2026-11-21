import type { MouseEvent } from 'react';
import { fmt, strings } from '../strings';

/** "I read this!" (never read) or "Read again!" (read before). */
export function ReadButton({
  title,
  count,
  disabled,
  onRead,
}: {
  title: string;
  count: number;
  disabled?: boolean;
  onRead: (click: MouseEvent<HTMLButtonElement>) => void;
}) {
  const t = strings.shelf;
  const isRead = count > 0;
  return (
    <button
      type="button"
      className={`btn read-toggle${isRead ? ' read-toggle--on' : ''}`}
      aria-label={fmt(isRead ? t.readAgainLabel : t.readLabel, { title })}
      disabled={disabled}
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
