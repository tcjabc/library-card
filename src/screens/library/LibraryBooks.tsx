import { useCallback, useState } from 'react';
import { useReadAction } from '../../books/useReadAction';
import { useDataQuery, type Book, type DataStore, type Loan, type Reader } from '../../data';
import { useToday } from '../../lib/clock';
import { formatCalendarDate } from '../../lib/dates';
import { fmt, strings } from '../../strings';
import { useToast } from '../../ui/Toast';
import { BackToHub } from '../BackToHub';
import { BorrowSheet } from './BorrowSheet';
import { LoanCard } from './LoanCard';
import { ReturnSheet } from './ReturnSheet';

/**
 * #/library — the active reader's library books: what's out (soonest due
 * first) with Renewed / Returned, borrowing and returning by scan, and the
 * books given back, which can still be read again.
 */

interface LibraryData {
  active: Loan[];
  returned: Loan[];
  books: Map<string, Book>;
  readCounts: Map<string, number>;
}

async function loadLibrary(store: DataStore, reader: Reader): Promise<LibraryData> {
  const [active, returned, summaries] = await Promise.all([
    store.listActiveLoans(reader.id),
    store.listReturnedLoans(reader.id),
    store.listReadSummaries(reader.id),
  ]);
  const keys = [...new Set([...active, ...returned].map((loan) => loan.isbn))];
  const books = await store.getBooks(keys);
  return {
    active,
    returned,
    books: new Map(books.map((b) => [b.isbn, b])),
    readCounts: new Map(summaries.map((s) => [s.isbn, s.count])),
  };
}

const TABLES = ['loans', 'books', 'covers', 'read_events', 'libraries'] as const;

export function LibraryBooks({ reader }: { reader: Reader }) {
  const t = strings.library;
  const toast = useToast();
  const today = useToday();
  const [sheet, setSheet] = useState<'borrow' | 'return' | null>(null);

  const query = useCallback((s: DataStore) => loadLibrary(s, reader), [reader]);
  const { data, store, loading } = useDataQuery(query, TABLES);
  const { read, pending, withPending } = useReadAction(store, reader);

  const titleOf = (loan: Loan) => data?.books.get(loan.isbn)?.title ?? strings.shelf.thisBook;

  const renew = (loan: Loan) => {
    if (!store) return;
    const previous = loan.due_date;
    void withPending(loan.isbn, async () => {
      const renewed = await store.renewLoan(loan.id);
      toast({
        message: fmt(t.renewedToast, { date: renewed.due_date ? formatCalendarDate(renewed.due_date) : '' }),
        action: { label: strings.shelf.undo, onAction: () => void withPending(loan.isbn, async () => void (await store.unrenewLoan(loan.id, previous))) },
      });
    });
  };

  const giveBack = (loan: Loan) => {
    if (!store) return;
    void withPending(loan.isbn, async () => {
      await store.returnLoan(loan.id);
      toast({
        message: fmt(t.returnedToast, { title: titleOf(loan) }),
        action: { label: strings.shelf.undo, onAction: () => void withPending(loan.isbn, async () => void (await store.unreturnLoan(loan.id))) },
      });
    });
  };

  const active = data?.active ?? [];
  const returned = data?.returned ?? [];

  return (
    <main className="page page--kid page--wide">
      <BackToHub />
      <header className="stack">
        <h1 className="kid-title">
          <span aria-hidden="true">🏛️</span> {t.title}
        </h1>
      </header>

      <div className="action-row">
        <button type="button" className="btn btn--primary btn--big" disabled={!store} onClick={() => setSheet('borrow')}>
          <span aria-hidden="true">📷</span> {t.scanBook}
        </button>
        <button type="button" className="btn btn--big" disabled={!store} onClick={() => setSheet('return')}>
          <span aria-hidden="true">📥</span> {t.scanToReturn}
        </button>
      </div>

      {loading ? (
        <p className="muted">{strings.common.loading}</p>
      ) : active.length === 0 ? (
        <div className="empty-state">
          <p className="kid-emoji" aria-hidden="true">
            🏛️
          </p>
          <p className="kid-lead">{t.empty}</p>
        </div>
      ) : (
        <ul className="shelf-grid" aria-label={t.activeLabel}>
          {active.map((loan) => {
            const count = data?.readCounts.get(loan.isbn) ?? 0;
            return (
              <LoanCard
                key={loan.id}
                loan={loan}
                book={data?.books.get(loan.isbn) ?? null}
                readCount={count}
                today={today}
                busy={pending.has(loan.isbn)}
                onRead={(e) => read(loan.isbn, titleOf(loan), count > 0, e)}
                onRenew={() => renew(loan)}
                onReturn={() => giveBack(loan)}
              />
            );
          })}
        </ul>
      )}

      {returned.length > 0 && (
        <details className="returned-books">
          <summary className="returned-books__summary">{fmt(t.returnedHeading, { count: returned.length })}</summary>
          <ul className="shelf-grid">
            {returned.map((loan) => {
              const count = data?.readCounts.get(loan.isbn) ?? 0;
              return (
                <LoanCard
                  key={loan.id}
                  loan={loan}
                  book={data?.books.get(loan.isbn) ?? null}
                  readCount={count}
                  today={today}
                  busy={pending.has(loan.isbn)}
                  onRead={(e) => read(loan.isbn, titleOf(loan), count > 0, e)}
                />
              );
            })}
          </ul>
        </details>
      )}

      {store && sheet === 'borrow' && <BorrowSheet store={store} reader={reader} today={today} onClose={() => setSheet(null)} />}
      {store && sheet === 'return' && <ReturnSheet store={store} reader={reader} onClose={() => setSheet(null)} />}
    </main>
  );
}
