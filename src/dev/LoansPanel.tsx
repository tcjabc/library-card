import { useCallback, useId, useState, type FormEvent } from 'react';
import {
  findStickerDuplicates,
  useDataQuery,
  type Book,
  type DataStore,
  type Household,
  type Library,
  type Loan,
  type Reader,
} from '../data';
import { useGrownUpSession } from '../grownups/useGrownUpSession';
import { getPretendToday, setPretendToday, useToday } from '../lib/clock';
import { isCalendarDate } from '../lib/dates';
import { DueChip } from '../library/DueChip';
import { fmt, strings } from '../strings';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';

const t = strings.dev.loans;

interface LoansData {
  loans: Loan[];
  readers: Map<string, Reader>;
  libraries: Library[];
  books: Map<string, Book>;
  duplicates: Map<string, string>;
}

async function loadLoans(store: DataStore, householdId: string): Promise<LoansData> {
  const [loans, readers, libraries] = await Promise.all([
    store.listLoans(householdId, { active: true }),
    store.listReaders(householdId),
    store.listLibraries(householdId),
  ]);
  const books = await store.getBooks([...new Set(loans.map((l) => l.isbn))]);
  return {
    loans,
    readers: new Map(readers.map((r) => [r.id, r])),
    libraries,
    books: new Map(books.map((b) => [b.isbn, b])),
    duplicates: findStickerDuplicates(loans),
  };
}

/** Grown-up tool: every active loan in the household, with edit, delete and duplicate flags. */
export function LoansPanel({ store, household }: { store: DataStore; household: Household }) {
  const toast = useToast();
  const { requireGrownUp } = useGrownUpSession();
  const today = useToday();
  const [editing, setEditing] = useState<Loan | null>(null);
  const query = useCallback((s: DataStore) => loadLoans(s, household.id), [household.id]);
  const { data } = useDataQuery(query, ['loans', 'readers', 'libraries', 'books']);

  const remove = (loan: Loan, title: string) =>
    requireGrownUp(async () => {
      await store.deleteLoan(loan.id);
      toast({ message: fmt(t.deleted, { title }) });
    }, strings.gate.reasonDeleteLoan);

  const libraryName = (loan: Loan) =>
    data?.libraries.find((lib) => lib.id === loan.library_id)?.name ?? loan.library_name ?? t.noLibrary;

  return (
    <section className="stack card">
      <h2>{fmt(t.heading, { count: data?.loans.length ?? 0 })}</h2>
      <PretendToday today={today} />
      {data && data.loans.length === 0 && <p className="muted">{t.none}</p>}
      <ul className="dev-list">
        {data?.loans.map((loan) => {
          const title = data.books.get(loan.isbn)?.title ?? loan.isbn;
          const duplicateOf = data.duplicates.get(loan.id);
          return (
            <li key={loan.id} className="dev-list__row">
              <div className="stack">
                <p className="reader-row__name">{title}</p>
                <p className="small muted">
                  {data.readers.get(loan.reader_id)?.display_name ?? '?'} · {libraryName(loan)}
                  {loan.sticker_barcode ? ` · ${fmt(t.sticker, { sticker: loan.sticker_barcode })}` : ''}
                  {loan.renew_count ? ` · ${fmt(t.renewals, { count: loan.renew_count })}` : ''}
                </p>
                <div className="row">
                  <DueChip due={loan.due_date} today={today} />
                  {duplicateOf && <span className="due-chip due-chip--overdue">{t.duplicate}</span>}
                </div>
              </div>
              <div className="row">
                <button type="button" className="btn btn--small" onClick={() => setEditing(loan)}>
                  {t.edit}
                </button>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => remove(loan, title)}>
                  {t.delete}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && data && (
        <LoanForm
          key={editing.id}
          store={store}
          loan={editing}
          readers={[...data.readers.values()]}
          libraries={data.libraries}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function LoanForm({
  store,
  loan,
  readers,
  libraries,
  onClose,
}: {
  store: DataStore;
  loan: Loan;
  readers: Reader[];
  libraries: Library[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [due, setDue] = useState(loan.due_date ?? '');
  const [libraryId, setLibraryId] = useState(loan.library_id ?? '');
  const [readerId, setReaderId] = useState(loan.reader_id);
  const [error, setError] = useState<string | null>(null);
  const ids = { due: useId(), library: useId(), reader: useId() };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (due && !isCalendarDate(due)) return setError(t.dueInvalid);
    try {
      await store.updateLoan(loan.id, { due_date: due || null, library_id: libraryId || null, reader_id: readerId });
      toast({ message: t.saved });
      onClose();
    } catch (err) {
      console.error('[loans] save failed', err);
      setError(strings.bookSheet.saveError);
    }
  };

  return (
    <Sheet title={t.editTitle} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)} noValidate>
        <label htmlFor={ids.due} className="field-label">
          {t.dueDate}
        </label>
        <input id={ids.due} className="input input--short" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
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
        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary">
            {strings.bookSheet.save}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {strings.common.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Pretend it is another day (this tab only), to check due chips and the hub badge. */
function PretendToday({ today }: { today: string }) {
  const id = useId();
  const pretending = getPretendToday();
  return (
    <div className="row pretend-today">
      <label htmlFor={id} className="small">
        {t.pretendToday}
      </label>
      <input
        id={id}
        className="input input--short"
        type="date"
        value={pretending ?? ''}
        onChange={(e) => setPretendToday(e.target.value || null)}
      />
      {pretending && (
        <button type="button" className="btn btn--small" onClick={() => setPretendToday(null)}>
          {fmt(t.pretendReset, { today })}
        </button>
      )}
    </div>
  );
}
