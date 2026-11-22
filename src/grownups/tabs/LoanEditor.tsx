import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { BookFinder } from '../../books/BookFinder';
import type { Book, DataStore, Library, Loan, Reader } from '../../data';
import { useToday } from '../../lib/clock';
import { isCalendarDate } from '../../lib/dates';
import { checkLoanDates, dateToTimestamp, timestampToDate, type LoanDateProblems } from '../../library/loans';
import { BookScanner } from '../../scan/BookScanner';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

const t = strings.grownups.loans;

interface LoanEditorProps {
  store: DataStore;
  loan: Loan;
  readers: Reader[];
  libraries: Library[];
  onClose: () => void;
}

/**
 * Grown-ups → Loans → Edit: every field of a library loan, active or returned. Changing the book,
 * the reader or anything else never touches reads (they belong to the reader, not the loan).
 */
export function LoanEditor({ store, loan, readers, libraries, onClose }: LoanEditorProps) {
  const toast = useToast();
  const today = useToday();
  const [isbn, setIsbn] = useState(loan.isbn);
  const [book, setBook] = useState<Book | null>(null);
  const [changingBook, setChangingBook] = useState(false);
  const [readerId, setReaderId] = useState(loan.reader_id);
  const [libraryId, setLibraryId] = useState(loan.library_id ?? '');
  const [borrowed, setBorrowed] = useState(timestampToDate(loan.borrowed_at));
  const [due, setDue] = useState(loan.due_date ?? '');
  const [sticker, setSticker] = useState(loan.sticker_barcode ?? '');
  const [scanningSticker, setScanningSticker] = useState(false);
  const [renewals, setRenewals] = useState(loan.renew_count);
  const [returned, setReturned] = useState(loan.returned_at !== null);
  const [returnedOn, setReturnedOn] = useState(loan.returned_at ? timestampToDate(loan.returned_at) : today);
  const [duplicate, setDuplicate] = useState<{ key: string; title: string | null } | null>(null);
  // Once Save was tried, the date messages follow every edit (no stale message after a fix).
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = {
    reader: useId(),
    library: useId(),
    borrowed: useId(),
    due: useId(),
    sticker: useId(),
    returned: useId(),
    problem: useId(),
  };

  useEffect(() => {
    let cancelled = false;
    void store.getBook(isbn).then((b) => !cancelled && setBook(b));
    return () => {
      cancelled = true;
    };
  }, [store, isbn]);

  // Warn (don't block) when another current loan from the same library has this sticker.
  const stickerKey = sticker.trim() && !returned ? `${libraryId}\u0000${sticker.trim()}` : null;
  useEffect(() => {
    if (!stickerKey) return;
    const value = stickerKey.split('\u0000')[1];
    let cancelled = false;
    void store.findActiveLoansBySticker(loan.household_id, value).then(async (found) => {
      const other = found.find((l) => l.id !== loan.id && (l.library_id ?? '') === libraryId);
      const title = other ? ((await store.getBook(other.isbn))?.title ?? other.isbn) : null;
      if (!cancelled) setDuplicate({ key: stickerKey, title });
    });
    return () => {
      cancelled = true;
    };
  }, [store, loan.household_id, loan.id, stickerKey, libraryId]);
  const duplicateOf = duplicate && duplicate.key === stickerKey ? duplicate.title : null;

  const leftoverName = !libraryId && loan.library_name ? loan.library_name : null;

  const datesValid = isCalendarDate(borrowed) && (!due || isCalendarDate(due)) && (!returned || isCalendarDate(returnedOn));
  const problems: LoanDateProblems & { invalid?: boolean } = !tried
    ? {}
    : !datesValid
      ? { invalid: true }
      : checkLoanDates({ borrowed, due: due || null, returned: returned ? returnedOn : null }, today);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!datesValid) return;
    if (Object.keys(checkLoanDates({ borrowed, due: due || null, returned: returned ? returnedOn : null }, today)).length) return;
    setSaving(true);
    setError(null);
    try {
      await store.updateLoan(loan.id, {
        isbn,
        reader_id: readerId,
        library_id: libraryId || null,
        // Choosing a library clears a leftover free-text name; "No library" keeps it.
        ...(libraryId ? { library_name: null } : {}),
        borrowed_at: dateToTimestamp(borrowed, loan.borrowed_at),
        due_date: due || null,
        sticker_barcode: sticker.trim() || null,
        renew_count: renewals,
        returned_at: returned ? dateToTimestamp(returnedOn, loan.returned_at) : null,
      });
      toast({ message: t.saved });
      onClose();
    } catch (err) {
      console.error('[loans] save failed', err);
      setError(strings.bookSheet.saveError);
      setSaving(false);
    }
  };

  const problemText = (key: keyof LoanDateProblems): string | null => {
    const p = problems[key];
    if (!p) return null;
    if (key === 'borrowed') return t.borrowedFuture;
    if (key === 'due') return t.dueBeforeBorrowed;
    return p === 'future' ? t.returnedFuture : t.returnedBeforeBorrowed;
  };

  return (
    <Sheet title={t.editTitle} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)} noValidate>
        <div className="stack">
          <p className="field-label">{t.book}</p>
          <div className="book-summary">
            <div className="book-summary__cover">
              <BookCover title={book?.title ?? isbn} coverUrl={book?.cover_url ?? null} />
            </div>
            <p className="book-summary__title">{book?.title ?? isbn}</p>
          </div>
          {changingBook ? (
            <ChangeBook
              store={store}
              householdId={loan.household_id}
              current={isbn}
              onPick={(picked) => {
                setIsbn(picked.isbn);
                setBook(picked);
                setChangingBook(false);
              }}
              onCancel={() => setChangingBook(false)}
            />
          ) : (
            <div className="row">
              <button type="button" className="btn" onClick={() => setChangingBook(true)}>
                {t.changeBook}
              </button>
              {isbn !== loan.isbn && <p className="small muted">{t.readsKept}</p>}
            </div>
          )}
        </div>

        <label htmlFor={ids.reader} className="field-label">
          {t.reader}
        </label>
        <select id={ids.reader} className="input" value={readerId} onChange={(e) => setReaderId(e.target.value)}>
          {readers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.avatar} {r.display_name}
            </option>
          ))}
        </select>

        <label htmlFor={ids.library} className="field-label">
          {t.library}
        </label>
        <select id={ids.library} className="input" value={libraryId} onChange={(e) => setLibraryId(e.target.value)}>
          <option value="">{t.noLibrary}</option>
          {libraries.map((lib) => (
            <option key={lib.id} value={lib.id}>
              {lib.name}
            </option>
          ))}
        </select>
        {leftoverName && <p className="small muted">{fmt(t.libraryNameKept, { name: leftoverName })}</p>}

        <DateField id={ids.borrowed} label={t.borrowedDate} value={borrowed} max={today} onChange={setBorrowed} problem={problemText('borrowed')} />
        <DateField id={ids.due} label={t.dueDate} hint={t.dueEmpty} value={due} onChange={setDue} problem={problemText('due')} />

        <div className="stack">
          <label htmlFor={ids.sticker} className="field-label">
            {t.stickerLabel}
          </label>
          <div className="row">
            <input
              id={ids.sticker}
              className="input"
              value={sticker}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setSticker(e.target.value)}
              aria-describedby={duplicateOf ? ids.problem : undefined}
            />
            <button type="button" className="btn" aria-expanded={scanningSticker} onClick={() => setScanningSticker((v) => !v)}>
              🏷️ {scanningSticker ? t.stickerStop : t.stickerScan}
            </button>
            {sticker && (
              <button type="button" className="btn btn--quiet" onClick={() => setSticker('')}>
                {t.stickerClear}
              </button>
            )}
          </div>
          {scanningSticker && (
            <BookScanner
              mode="sticker"
              onSticker={(value) => {
                setSticker(value);
                setScanningSticker(false);
              }}
            />
          )}
          {duplicateOf && (
            <p id={ids.problem} className="alert" role="status">
              {fmt(t.stickerDuplicate, { title: duplicateOf })}
            </p>
          )}
        </div>

        <div className="stack">
          <p className="field-label" id={`${ids.problem}-renew`}>
            {t.renewCount}
          </p>
          <div className="stepper" role="group" aria-labelledby={`${ids.problem}-renew`}>
            <button type="button" className="btn btn--round" aria-label={t.renewLess} disabled={renewals === 0} onClick={() => setRenewals((n) => Math.max(0, n - 1))}>
              −
            </button>
            <output className="stepper__value" aria-live="polite">
              {renewals}
            </output>
            <button type="button" className="btn btn--round" aria-label={t.renewMore} onClick={() => setRenewals((n) => n + 1)}>
              +
            </button>
          </div>
        </div>

        <div className="stack">
          <label className="grownups__check">
            <input
              type="checkbox"
              checked={returned}
              onChange={(e) => {
                setReturned(e.target.checked);
                if (e.target.checked && !loan.returned_at) setReturnedOn(today);
              }}
            />
            {t.returnedToggle}
          </label>
          {returned && (
            <DateField id={ids.returned} label={t.returnedDate} value={returnedOn} max={today} onChange={setReturnedOn} problem={problemText('returned')} />
          )}
          {!returned && loan.returned_at && <p className="small muted">{t.unreturnHint}</p>}
        </div>

        {problems.invalid && (
          <p className="alert alert--danger" role="alert">
            {t.dueInvalid}
          </p>
        )}
        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? strings.common.saving : strings.bookSheet.save}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {strings.common.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function DateField({
  id,
  label,
  hint,
  value,
  max,
  problem,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  max?: string;
  problem: string | null;
  onChange: (value: string) => void;
}) {
  const problemId = `${id}-problem`;
  return (
    <div className="stack">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {hint && <p className="small muted">{hint}</p>}
      <input
        id={id}
        className="input input--short"
        type="date"
        value={value}
        max={max}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {problem && (
        <p id={problemId} className="alert alert--danger" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Change a loan's book: pick one of the household's books (searchable), or scan / type / add one. */
function ChangeBook({
  store,
  householdId,
  current,
  onPick,
  onCancel,
}: {
  store: DataStore;
  householdId: string;
  current: string;
  onPick: (book: Book) => void;
  onCancel: () => void;
}) {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [query, setQuery] = useState('');
  const [finding, setFinding] = useState(false);
  const searchId = useId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The household's books: on the Home shelf or ever borrowed.
      const [home, loans] = await Promise.all([store.listHomeItems(householdId), store.listLoans(householdId)]);
      const keys = [...new Set([...home.map((h) => h.isbn), ...loans.map((l) => l.isbn)])];
      const found = await store.getBooks(keys);
      if (!cancelled) setBooks(found.sort((a, b) => a.title.localeCompare(b.title)));
    })();
    return () => {
      cancelled = true;
    };
  }, [store, householdId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (books ?? [])
      .filter((b) => b.isbn !== current)
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.authors.some((a) => a.toLowerCase().includes(q)) || b.isbn.includes(q))
      .slice(0, 30);
  }, [books, query, current]);

  return (
    <div className="stack card">
      {finding ? (
        <BookFinder store={store} onBook={onPick} />
      ) : (
        <>
          <label htmlFor={searchId} className="field-label">
            {t.pickBook}
          </label>
          <input id={searchId} className="input" type="search" value={query} autoComplete="off" onChange={(e) => setQuery(e.target.value)} placeholder={t.searchBooks} />
          {books && shown.length === 0 && <p className="small muted">{t.noBooksMatch}</p>}
          <ul className="dev-list">
            {shown.map((b) => (
              <li key={b.isbn} className="dev-list__row">
                <span>{b.title}</span>
                <button type="button" className="btn btn--small" onClick={() => onPick(b)}>
                  {t.useBook}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row">
        <button type="button" className="btn" aria-expanded={finding} onClick={() => setFinding((v) => !v)}>
          {finding ? t.pickInstead : t.scanOrAdd}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>
          {strings.common.cancel}
        </button>
      </div>
    </div>
  );
}
