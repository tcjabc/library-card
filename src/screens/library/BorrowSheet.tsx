import { useCallback, useMemo, useState } from 'react';
import { BookFinder } from '../../books/BookFinder';
import { ReadButton } from '../../books/ReadButton';
import { useReadAction } from '../../books/useReadAction';
import { DEFAULT_LOAN_DAYS, useDataQuery, type Book, type DataStore, type Library, type Loan, type Reader } from '../../data';
import { formatCalendarDate } from '../../lib/dates';
import { dueDateIn } from '../../library/due';
import { getLastLibraryId, setLastLibraryId } from '../../library/lastLibrary';
import { currentLoansOf } from '../../library/loans';
import { chooseLibrary } from '../../library/sticker';
import { BookScanner } from '../../scan/BookScanner';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import { confettiBurst } from '../../ui/confetti';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

/**
 * Borrowing a library book: find the book, scan the library's sticker (or
 * skip), check the library, then the loan is created with a due date of
 * today + the library's loan length. A book someone in the house has out
 * right now says so first ("Ada already borrowed this"), with "I read this!"
 * (for the active reader) and "Borrow it too" (a second loan). A book borrowed
 * and returned before just starts a new loan.
 */

type Step =
  | { kind: 'find' }
  | { kind: 'already'; book: Book; loan: Loan; borrower: string | null; readCount: number }
  | { kind: 'sticker'; book: Book }
  | { kind: 'confirm'; book: Book; sticker: string | null };

interface BorrowSheetProps {
  store: DataStore;
  reader: Reader;
  today: string;
  onClose: () => void;
}

export function BorrowSheet({ store, reader, today, onClose }: BorrowSheetProps) {
  const t = strings.borrow;
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: 'find' });
  const [choice, setChoice] = useState<string | null | undefined>(undefined); // undefined: use the helper's pick
  const [busy, setBusy] = useState(false);

  const librariesQuery = useCallback((s: DataStore) => s.listLibraries(reader.household_id), [reader.household_id]);
  const { data: libraries = [] } = useDataQuery(librariesQuery, ['libraries']);

  // The read sheet (how, and who checks it) closes this sheet once the read is recorded.
  const { read, sheet, waiting } = useReadAction(store, reader, { onRecorded: onClose });

  const onBook = useCallback(
    async (book: Book) => {
      const [loans, readers, summary] = await Promise.all([
        store.listLoans(reader.household_id, { active: true }),
        store.listReaders(reader.household_id),
        store.getReadSummary(reader.id, book.isbn),
      ]);
      const [first] = currentLoansOf(loans, book.isbn, reader.id);
      if (!first) return setStep({ kind: 'sticker', book });
      // The reader's own loan first; otherwise whoever has it (null: it's the reader's).
      const borrower = first.reader_id === reader.id ? null : (readers.find((r) => r.id === first.reader_id)?.display_name ?? '?');
      setStep({ kind: 'already', book, loan: first, borrower, readCount: summary?.count ?? 0 });
    },
    [store, reader.id, reader.household_id],
  );

  const sticker = step.kind === 'confirm' ? step.sticker : null;
  const suggested = useMemo(
    () => chooseLibrary(libraries, { sticker, lastUsedId: getLastLibraryId() }),
    [libraries, sticker],
  );
  const library: Library | null =
    choice === undefined ? suggested.library : (libraries.find((lib) => lib.id === choice) ?? null);
  const dueDate = dueDateIn(library?.default_loan_days ?? DEFAULT_LOAN_DAYS, today);

  const borrow = async (book: Book, button: HTMLElement) => {
    setBusy(true);
    const rect = button.getBoundingClientRect();
    try {
      await store.createLoan({
        household_id: reader.household_id,
        reader_id: reader.id,
        isbn: book.isbn,
        library_id: library?.id ?? null,
        sticker_barcode: sticker,
        due_date: dueDate,
      });
      if (library) setLastLibraryId(library.id);
      confettiBurst({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      onClose();
      toast({ message: fmt(t.dueBack, { date: formatCalendarDate(dueDate) }), durationMs: 5000 });
    } catch (error) {
      console.error('[borrow] failed', error);
      toast({ message: strings.shelf.saveError });
      setBusy(false);
    }
  };

  return (
    <Sheet title={t.title} onClose={onClose}>
      {step.kind === 'find' && (
        <div className="stack">
          <p className="kid-lead">{t.findIntro}</p>
          <BookFinder store={store} onBook={(book) => void onBook(book)} />
        </div>
      )}

      {step.kind === 'already' && (
        <div className="center-stack">
          <BookSummary book={step.book} />
          <p className="kid-lead">{step.borrower === null ? t.alreadyYou : fmt(t.alreadyOther, { name: step.borrower })}</p>
          {step.loan.due_date && <p className="muted">{fmt(t.alreadyDue, { date: formatCalendarDate(step.loan.due_date) })}</p>}
          <ReadButton
            title={step.book.title}
            count={step.readCount}
            waiting={waiting.has(step.book.isbn)}
            onRead={(e) => {
              // The read is for the reader using the app, whoever borrowed the book.
              read(step.book.isbn, step.book.title, step.readCount > 0, e);
            }}
          />
          {sheet}
          <button type="button" className="btn btn--big" onClick={() => setStep({ kind: 'sticker', book: step.book })}>
            <span aria-hidden="true">📚</span> {t.borrowToo}
          </button>
        </div>
      )}

      {step.kind === 'sticker' && (
        <div className="stack">
          <BookSummary book={step.book} />
          <p className="kid-lead">
            <span aria-hidden="true">🏷️ </span>
            {t.stickerIntro}
          </p>
          <BookScanner mode="sticker" onSticker={(value) => setStep({ kind: 'confirm', book: step.book, sticker: value })} />
          <div className="row">
            <button type="button" className="btn btn--big" onClick={() => setStep({ kind: 'confirm', book: step.book, sticker: null })}>
              {t.skip}
            </button>
          </div>
        </div>
      )}

      {step.kind === 'confirm' && (
        <div className="stack">
          <BookSummary book={step.book} />
          {libraries.length > 1 && (
            <div className="stack">
              <p className="field-label">{t.whichLibrary}</p>
              <div className="chip-row" role="group" aria-label={t.whichLibrary}>
                {libraries.map((lib) => (
                  <button
                    key={lib.id}
                    type="button"
                    className="chip"
                    aria-pressed={library?.id === lib.id}
                    onClick={() => setChoice(lib.id)}
                  >
                    {lib.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {libraries.length === 1 && library && <p className="muted">{fmt(t.fromLibrary, { library: library.name })}</p>}
          <p className="kid-lead">{fmt(t.dueBackPreview, { date: formatCalendarDate(dueDate) })}</p>
          {step.sticker && <p className="muted small">{fmt(t.stickerScanned, { sticker: step.sticker })}</p>}
          <div className="row">
            <button
              type="button"
              className="btn btn--accent btn--big"
              disabled={busy}
              onClick={(e) => void borrow(step.book, e.currentTarget)}
            >
              <span aria-hidden="true">📚</span> {t.borrowIt}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function BookSummary({ book }: { book: Book }) {
  return (
    <div className="book-summary">
      <div className="book-summary__cover">
        <BookCover title={book.title} coverUrl={book.cover_url} />
      </div>
      <p className="book-summary__title">{book.title}</p>
    </div>
  );
}
