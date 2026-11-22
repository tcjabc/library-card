import type { MouseEvent } from 'react';
import { BookRow } from '../../books/BookList';
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
  /** A read of this book waits for a grown-up's check. */
  waiting?: boolean;
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
export function LoanCard({ loan, book, readCount, waiting = false, today, busy, borrower, onRead, onRenew, onReturn }: LoanCardProps) {
  const t = strings.library;
  const title = book?.title ?? strings.shelf.thisBook;
  const active = loan.returned_at === null;
  return (
    <li className={`shelf-book loan-card${active ? '' : ' loan-card--returned'}`}>
      <div className="shelf-book__cover">
        <BookCover title={title} coverUrl={book?.cover_url ?? null} seed={loan.isbn} fit="whole" />
        {borrower && (
          <span className="avatar loan-card__borrower" role="img" aria-label={fmt(t.borrowedBy, { name: borrower.display_name })}>
            {borrower.avatar}
          </span>
        )}
        <ReadBadge count={readCount} />
      </div>
      <p className="shelf-book__title" title={title}>
        {title}
      </p>
      {active && <DueChip due={loan.due_date} today={today} />}
      <ReadButton title={title} count={readCount} disabled={busy} waiting={waiting} onRead={onRead} />
      {active && (onRenew || onReturn) && (
        <div className="loan-card__actions">
          <LoanActions busy={busy} onRenew={onRenew} onReturn={onReturn} />
        </div>
      )}
    </li>
  );
}

/** The same library book as a List row: the due chip and (My house) the borrower after the read state. */
export function LoanRow({ loan, book, readCount, waiting = false, today, busy, borrower, onRead, onRenew, onReturn }: LoanCardProps) {
  const t = strings.library;
  const title = book?.title ?? strings.shelf.thisBook;
  const active = loan.returned_at === null;
  return (
    <BookRow
      isbn={loan.isbn}
      title={title}
      authors={book?.authors ?? []}
      coverUrl={book?.cover_url ?? null}
      count={readCount}
      waiting={waiting}
      busy={busy}
      onRead={onRead}
      returned={!active}
      info={
        <>
          {active && <DueChip due={loan.due_date} today={today} />}
          {borrower && (
            <span className="avatar avatar--sm" role="img" aria-label={fmt(t.borrowedBy, { name: borrower.display_name })}>
              {borrower.avatar}
            </span>
          )}
        </>
      }
      actions={active ? <LoanIconActions busy={busy} onRenew={onRenew} onReturn={onReturn} /> : undefined}
    />
  );
}

/**
 * Renewed / Returned in a List row: two big icon buttons beside the read button. Someone else's
 * loan (My house) keeps the two spaces empty, so the read buttons line up down the list.
 */
function LoanIconActions({ busy, onRenew, onReturn }: { busy: boolean; onRenew?: () => void; onReturn?: () => void }) {
  const t = strings.library;
  return (
    <>
      {!onRenew && <span className="book-row__icon-slot" aria-hidden="true" />}
      {!onReturn && <span className="book-row__icon-slot" aria-hidden="true" />}
      {onRenew && (
        <button type="button" className="btn book-row__icon" disabled={busy} aria-label={t.renewed} title={t.renewed} onClick={onRenew}>
          <span aria-hidden="true">🔄</span>
        </button>
      )}
      {onReturn && (
        <button type="button" className="btn book-row__icon" disabled={busy} aria-label={t.returned} title={t.returned} onClick={onReturn}>
          <span aria-hidden="true">✅</span>
        </button>
      )}
    </>
  );
}

function LoanActions({ busy, onRenew, onReturn }: { busy: boolean; onRenew?: () => void; onReturn?: () => void }) {
  const t = strings.library;
  return (
    <>
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
    </>
  );
}
