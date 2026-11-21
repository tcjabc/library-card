import { useCallback, useId, useState, type FormEvent } from 'react';
import { findStickerDuplicates, useDataQuery, type Book, type DataStore, type Library, type Loan, type Reader } from '../../data';
import { useToday } from '../../lib/clock';
import { isCalendarDate } from '../../lib/dates';
import { DueChip } from '../../library/DueChip';
import { navigate, useHashQuery } from '../../router';
import { fmt, strings } from '../../strings';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { formatTimestampDate, sortActiveLoans, sortReturnedLoans, tabPath } from '../helpers';
import { useGrownUpSession } from '../useGrownUpSession';
import type { TabProps } from './types';

const t = strings.grownups.loans;

interface LoansData {
  active: Loan[];
  returned: Loan[];
  readers: Reader[];
  libraries: Library[];
  books: Map<string, Book>;
  duplicates: Map<string, string>;
}

async function loadLoans(store: DataStore, householdId: string): Promise<LoansData> {
  const [all, readers, libraries] = await Promise.all([
    store.listLoans(householdId),
    store.listReaders(householdId),
    store.listLibraries(householdId),
  ]);
  const active = all.filter((loan) => loan.returned_at === null);
  const books = await store.getBooks([...new Set(all.map((l) => l.isbn))]);
  return {
    active,
    returned: sortReturnedLoans(all.filter((loan) => loan.returned_at !== null)),
    readers,
    libraries,
    books: new Map(books.map((b) => [b.isbn, b])),
    duplicates: findStickerDuplicates(active),
  };
}

/**
 * Grown-ups > Loans: every library book out, overdue first, for everyone or
 * one reader (#/grownups/loans?reader=<id>). Edit, delete, duplicate sticker
 * flags, and the returned history underneath.
 */
export function LoansTab({ store, household }: TabProps) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const today = useToday();
  const readerFilter = useHashQuery().get('reader');
  const [editing, setEditing] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState<{ loan: Loan; title: string } | null>(null);
  const query = useCallback((s: DataStore) => loadLoans(s, household.id), [household.id]);
  const { data } = useDataQuery(query, ['loans', 'readers', 'libraries', 'books']);

  const readerById = new Map((data?.readers ?? []).map((r) => [r.id, r]));
  const filterReader = readerFilter ? readerById.get(readerFilter) : undefined;
  const mine = (loan: Loan) => !filterReader || loan.reader_id === filterReader.id;
  const active = data ? sortActiveLoans(data.active.filter(mine), today) : [];
  const returned = data ? data.returned.filter(mine) : [];

  const titleOf = (loan: Loan) => data?.books.get(loan.isbn)?.title ?? loan.isbn;
  const libraryName = (loan: Loan) =>
    data?.libraries.find((lib) => lib.id === loan.library_id)?.name ?? loan.library_name ?? t.noLibrary;
  const describe = (loan: Loan) =>
    [
      readerById.get(loan.reader_id)?.display_name ?? '?',
      libraryName(loan),
      loan.sticker_barcode ? fmt(t.sticker, { sticker: loan.sticker_barcode }) : null,
      loan.renew_count ? fmt(t.renewals, { count: loan.renew_count }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const setFilter = (readerId: string | null) =>
    navigate(readerId ? tabPath('loans', { reader: readerId }) : tabPath('loans'), { replace: true });

  return (
    <>
      <section className="stack card">
        <h2>{fmt(t.heading, { count: active.length })}</h2>
        {data && data.readers.length > 1 && (
          <div className="chip-row chip-row--dense" role="group" aria-label={t.filterLabel}>
            <button type="button" className="chip" aria-pressed={!filterReader} onClick={() => setFilter(null)}>
              {t.everyone}
            </button>
            {data.readers.map((r) => (
              <button key={r.id} type="button" className="chip" aria-pressed={filterReader?.id === r.id} onClick={() => setFilter(r.id)}>
                {r.avatar} {r.display_name}
              </button>
            ))}
          </div>
        )}
        {data && active.length === 0 && <p className="muted">{filterReader ? fmt(t.noneFor, { name: filterReader.display_name }) : t.none}</p>}
        <ul className="dev-list">
          {active.map((loan) => {
            const title = titleOf(loan);
            return (
              <li key={loan.id} className="dev-list__row">
                <div className="stack">
                  <p className="grownups__item-title">{title}</p>
                  <p className="small muted">{describe(loan)}</p>
                  <div className="row">
                    <DueChip due={loan.due_date} today={today} />
                    {data?.duplicates.get(loan.id) && <span className="due-chip due-chip--overdue">{t.duplicate}</span>}
                  </div>
                </div>
                <div className="row">
                  <button type="button" className="btn btn--small" onClick={() => setEditing(loan)}>
                    {t.edit}
                  </button>
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => setDeleting({ loan, title })}>
                    {t.delete}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <details className="card grownups__history">
        <summary>{fmt(t.returnedHeading, { count: returned.length })}</summary>
        {returned.length === 0 ? (
          <p className="muted">{t.returnedNone}</p>
        ) : (
          <ul className="dev-list">
            {returned.map((loan) => (
              <li key={loan.id} className="dev-list__row">
                <div className="stack">
                  <p className="grownups__item-title">{titleOf(loan)}</p>
                  <p className="small muted">
                    {describe(loan)} · {fmt(t.returnedOn, { date: formatTimestampDate(loan.returned_at!) })}
                  </p>
                </div>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => setDeleting({ loan, title: titleOf(loan) })}>
                  {t.delete}
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      {editing && data && (
        <LoanForm key={editing.id} store={store} loan={editing} readers={data.readers} libraries={data.libraries} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmSheet
          title={fmt(t.deleteTitle, { title: deleting.title })}
          confirmLabel={t.deleteConfirm}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            runAsGrownUp(async () => {
              await store.deleteLoan(deleting.loan.id);
              setDeleting(null);
              toast({ message: fmt(t.deleted, { title: deleting.title }) });
            }, strings.gate.reasonDeleteLoan)
          }
        >
          <p>{t.deleteBody}</p>
        </ConfirmSheet>
      )}
    </>
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
