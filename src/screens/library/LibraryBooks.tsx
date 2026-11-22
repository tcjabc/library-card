import { useCallback, useState, type ReactNode } from 'react';
import { BookList } from '../../books/BookList';
import { useBookView } from '../../books/bookView';
import { BookViewToggle } from '../../books/BookViewToggle';
import { useReadAction } from '../../books/useReadAction';
import { useDataQuery, type Book, type DataStore, type Loan, type Reader } from '../../data';
import { useToday } from '../../lib/clock';
import { formatCalendarDate } from '../../lib/dates';
import { getLibraryView, setLibraryView } from '../../library/libraryView';
import { loansInView, type LibraryView } from '../../library/loans';
import { isSearching, searchBooks } from '../../lib/search';
import { fmt, strings } from '../../strings';
import { NoSearchMatch, SearchBar } from '../../ui/SearchBar';
import { useToast } from '../../ui/Toast';
import { useReaderSearch } from '../../ui/useReaderSearch';
import { BackToHub } from '../BackToHub';
import { BorrowSheet } from './BorrowSheet';
import { LoanCard, LoanRow } from './LoanCard';
import { ReturnSheet } from './ReturnSheet';

/**
 * #/library — library books (public-library loans; Home Library books are on the Shelf), for the
 * active reader ("Mine") or the whole house ("My house"): what's out (soonest due first),
 * borrowing and returning by scan, and the books given back. Any card's "I read this!" records
 * the read for the active reader; Renewed / Returned only show on their own loans. "Find a book"
 * narrows both lists (what's out and the returned books) within Mine or My house.
 */

interface LibraryData {
  loans: Loan[];
  readers: Map<string, Reader>;
  books: Map<string, Book>;
  readCounts: Map<string, number>;
}

async function loadLibrary(store: DataStore, reader: Reader): Promise<LibraryData> {
  const [loans, readers, summaries] = await Promise.all([
    store.listLoans(reader.household_id),
    store.listReaders(reader.household_id),
    store.listReadSummaries(reader.id),
  ]);
  const books = await store.getBooks([...new Set(loans.map((loan) => loan.isbn))]);
  return {
    loans,
    readers: new Map(readers.map((r) => [r.id, r])),
    books: new Map(books.map((b) => [b.isbn, b])),
    readCounts: new Map(summaries.map((s) => [s.isbn, s.count])),
  };
}

const TABLES = ['loans', 'books', 'covers', 'read_events', 'libraries', 'readers'] as const;

export function LibraryBooks({ reader }: { reader: Reader }) {
  const t = strings.library;
  const toast = useToast();
  const today = useToday();
  const [sheet, setSheet] = useState<'borrow' | 'return' | null>(null);
  const [view, setView] = useState<LibraryView>(() => getLibraryView(reader.id));
  const [search, setSearch] = useReaderSearch(reader.id);
  const [bookView, setBookView] = useBookView('library', reader.id);
  const choose = (next: LibraryView) => {
    setView(next);
    setLibraryView(reader.id, next);
  };

  const query = useCallback((s: DataStore) => loadLibrary(s, reader), [reader]);
  const { data, store, loading } = useDataQuery(query, TABLES);
  const { read, pending, withPending, sheet: readSheet, waiting } = useReadAction(store, reader);

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

  const inView = loansInView(data?.loans ?? [], view, reader.id);
  const searchable = (loan: Loan) => ({ title: titleOf(loan), authors: data?.books.get(loan.isbn)?.authors ?? [] });
  const active = searchBooks(inView.active, search, searchable);
  const returned = searchBooks(inView.returned, search, searchable);
  const searching = isSearching(search);
  const anyLoans = inView.active.length + inView.returned.length > 0;
  const house = view === 'house';
  /** One card (or List row): the borrower's avatar in My house; Renewed / Returned only on the reader's own loans. */
  const card = (loan: Loan, Show: typeof LoanCard | typeof LoanRow = LoanCard) => {
    const count = data?.readCounts.get(loan.isbn) ?? 0;
    const own = loan.reader_id === reader.id;
    return (
      <Show
        key={loan.id}
        loan={loan}
        book={data?.books.get(loan.isbn) ?? null}
        readCount={count}
        waiting={waiting.has(loan.isbn)}
        today={today}
        busy={pending.has(loan.isbn)}
        borrower={house ? (data?.readers.get(loan.reader_id) ?? null) : null}
        onRead={(e) => read(loan.isbn, titleOf(loan), count > 0, e)}
        onRenew={own ? () => renew(loan) : undefined}
        onReturn={own ? () => giveBack(loan) : undefined}
      />
    );
  };

  return (
    <main className="page page--kid page--wide">
      <BackToHub />
      <header className="stack">
        <h1 className="kid-title">
          <span aria-hidden="true">🏛️</span> {t.title}
        </h1>
      </header>

      {anyLoans && <SearchBar value={search} onChange={setSearch} />}
      {anyLoans && <BookViewToggle view={bookView} onChange={setBookView} />}

      <div className="chip-row view-toggle" role="group" aria-label={t.viewLabel}>
        <button type="button" className="chip" aria-pressed={!house} onClick={() => choose('mine')}>
          {t.viewMine}
        </button>
        <button type="button" className="chip" aria-pressed={house} onClick={() => choose('house')}>
          {t.viewHouse}
        </button>
      </div>

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
      ) : searching && active.length === 0 ? (
        // Nothing out matches; the returned books that do are below.
        returned.length === 0 && <NoSearchMatch query={search} onClear={() => setSearch('')} />
      ) : active.length === 0 ? (
        <div className="empty-state">
          <p className="kid-emoji" aria-hidden="true">
            🏛️
          </p>
          <p className="kid-lead">{house ? t.emptyHouse : t.empty}</p>
        </div>
      ) : (
        <Loans loans={active} list={bookView === 'list'} label={house ? t.activeLabelHouse : t.activeLabel} show={card} />
      )}

      {returned.length > 0 && (
        // Opened while searching, so the matches show.
        <details className="returned-books" open={searching || undefined}>
          <summary className="returned-books__summary">{fmt(t.returnedHeading, { count: returned.length })}</summary>
          <Loans loans={returned} list={bookView === 'list'} show={card} />
        </details>
      )}

      {store && sheet === 'borrow' && <BorrowSheet store={store} reader={reader} today={today} onClose={() => setSheet(null)} />}
      {store && sheet === 'return' && <ReturnSheet store={store} reader={reader} onClose={() => setSheet(null)} />}
      {readSheet}
    </main>
  );
}

/** Loans as the grid of cards, or as List rows. */
function Loans({
  loans,
  list,
  label,
  show,
}: {
  loans: Loan[];
  list: boolean;
  label?: string;
  show: (loan: Loan, as?: typeof LoanCard | typeof LoanRow) => ReactNode;
}) {
  if (list) return <BookList items={loans} keyOf={(loan) => loan.id} renderRow={(loan) => show(loan, LoanRow)} label={label} />;
  return (
    <ul className="shelf-grid" aria-label={label}>
      {loans.map((loan) => show(loan))}
    </ul>
  );
}
