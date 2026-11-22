import type { MouseEvent } from 'react';
import { ReadBadge, ReadButton } from '../../books/ReadButton';
import type { Book, Loan, Reader } from '../../data';
import { DueChip } from '../../library/DueChip';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';

interface LoanCardProps {
  loan: Loan;
  book: Book | null;
  /** The active reader's reads of this book (the read button records for them). */
  readCount: number;
  today: string;
  busy: boolean;
  /** Shown as an avatar on the cover ("My house"). */
  borrower?: Reader | null;
  onRead: (click: MouseEvent<HTMLButtonElement>) => void;
  /** Renewed / Returned: only passed for the active reader's own current loans. */
  onRenew?: () => void;
  onReturn?: () => void;
}

/**
 * One library book: cover (with the borrower's avatar in "My house"), title, due chip, read button,
 * and Renewed / Returned when it's the active reader's own current loan.
 */
export function LoanCard({ loan, book, readCount, today, busy, borrower, onRead, onRenew, onReturn }: LoanCardProps) {
  const t = strings.library;
  const title = book?.title ?? strings.shelf.thisBook;
  const active = loan.returned_at === null;
  return (
    <li className={`shelf-book loan-card${active ? '' : ' loan-card--returned'}`}>
      <div className="shelf-book__cover">
        <BookCover title={title} coverUrl={book?.cover_url ?? null} />
        {borrower && (
          <span className="avatar loan-card__borrower" role="img" aria-label={fmt(t.borrowedBy, { name: borrower.display_name })}>
            {borrower.avatar}
          </span>
        )}
        <ReadBadge count={readCount} />
      </div>
      <p className="shelf-book__title">{title}</p>
      {active && <DueChip due={loan.due_date} today={today} />}
      <ReadButton title={title} count={readCount} disabled={busy} onRead={onRead} />
      {active && (onRenew || onReturn) && (
        <div className="loan-card__actions">
          {onRenew && (
            <button type="button" className="btn btn--small-kid" disabled={busy} onClick={onRenew}>
              <span aria-hidden="true">🔄</span> {t.renewed}
            </button>
          )}
          {onReturn && (
            <button type="button" className="btn btn--small-kid" disabled={busy} onClick={onReturn}>
              <span aria-hidden="true">📥</span> {t.returned}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
