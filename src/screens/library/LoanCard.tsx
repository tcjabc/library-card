import type { MouseEvent } from 'react';
import { ReadBadge, ReadButton } from '../../books/ReadButton';
import type { Book, Loan } from '../../data';
import { DueChip } from '../../library/DueChip';
import { strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';

interface LoanCardProps {
  loan: Loan;
  book: Book | null;
  readCount: number;
  today: string;
  busy: boolean;
  onRead: (click: MouseEvent<HTMLButtonElement>) => void;
  onRenew?: () => void;
  onReturn?: () => void;
}

/** One library book: cover, title, due chip, read button, and Renewed / Returned for active loans. */
export function LoanCard({ loan, book, readCount, today, busy, onRead, onRenew, onReturn }: LoanCardProps) {
  const t = strings.library;
  const title = book?.title ?? strings.shelf.thisBook;
  const active = loan.returned_at === null;
  return (
    <li className={`shelf-book loan-card${active ? '' : ' loan-card--returned'}`}>
      <div className="shelf-book__cover">
        <BookCover title={title} coverUrl={book?.cover_url ?? null} />
        <ReadBadge count={readCount} />
      </div>
      <p className="shelf-book__title">{title}</p>
      {active && <DueChip due={loan.due_date} today={today} />}
      <ReadButton title={title} count={readCount} disabled={busy} onRead={onRead} />
      {active && (
        <div className="loan-card__actions">
          <button type="button" className="btn btn--small-kid" disabled={busy} onClick={onRenew}>
            <span aria-hidden="true">🔄</span> {t.renewed}
          </button>
          <button type="button" className="btn btn--small-kid" disabled={busy} onClick={onReturn}>
            <span aria-hidden="true">📥</span> {t.returned}
          </button>
        </div>
      )}
    </li>
  );
}
