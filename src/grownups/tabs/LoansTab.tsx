import { useCallback, useState } from 'react';
import { findStickerDuplicates, useDataQuery, type Book, type DataStore, type Library, type Loan, type Reader } from '../../data';
import { useToday } from '../../lib/clock';
import { DueChip } from '../../library/DueChip';
import { navigate, useHashQuery } from '../../router';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { MoreMenu } from '../../ui/MoreMenu';
import { useToast } from '../../ui/Toast';
import { ViewToggle } from '../../ui/ViewToggle';
import { formatTimestampDate, sortActiveLoans, sortReturnedLoans, tabPath } from '../helpers';
import { useGrownUpSession } from '../useGrownUpSession';
import { useGrownUpView } from '../views';
import { LoanEditor } from './LoanEditor';
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
 * one reader (#/grownups/loans?reader=<id>). Edit (every field, active or
 * returned), delete, duplicate sticker flags, and the returned history underneath. A List, or a
 * Grid of cards (one choice for both).
 */
export function LoansTab({ store, household }: TabProps) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const today = useToday();
  const readerFilter = useHashQuery().get('reader');
  const [editing, setEditing] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState<{ loan: Loan; title: string } | null>(null);
  const query = useCallback((s: DataStore) => loadLoans(s, household.id), [household.id]);
  const { data } = useDataQuery(query, ['loans', 'readers', 'libraries', 'books', 'covers']);
  const [view, setView] = useGrownUpView('loans');

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

  /** One loan as a Grid card: whole cover, title, borrower, library and sticker, due chip (or returned date); Edit / Delete in ⋯. */
  const card = (loan: Loan) => {
    const title = titleOf(loan);
    const reader = readerById.get(loan.reader_id);
    const book = data?.books.get(loan.isbn);
    const details = [
      libraryName(loan),
      loan.sticker_barcode ? fmt(t.sticker, { sticker: loan.sticker_barcode }) : null,
      loan.renew_count ? fmt(t.renewals, { count: loan.renew_count }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <li key={loan.id} className="gu-card gu-card--loan">
        <BookCover title={title} coverUrl={book?.cover_url ?? null} seed={loan.isbn} fit="whole" />
        <div className="stack grownups-book__body">
          <p className="gu-card__title">{title}</p>
          <p className="small">
            <span aria-hidden="true">{reader?.avatar}</span> {reader?.display_name ?? '?'}
          </p>
          <p className="small muted">{details}</p>
          {loan.returned_at === null ? (
            <div className="row">
              <DueChip due={loan.due_date} today={today} />
              {data?.duplicates.get(loan.id) && <span className="due-chip due-chip--overdue">{t.duplicate}</span>}
            </div>
          ) : (
            <p className="small muted">{fmt(t.returnedOn, { date: formatTimestampDate(loan.returned_at) })}</p>
          )}
        </div>
        <MoreMenu
          label={fmt(strings.grownups.moreFor, { name: title })}
          items={[
            { label: t.edit, onSelect: () => setEditing(loan) },
            { label: t.delete, onSelect: () => setDeleting({ loan, title }), danger: true },
          ]}
        />
      </li>
    );
  };

  return (
    <>
      <section className="stack card">
        <div className="row grownups__section-head">
          <h2>{fmt(t.heading, { count: active.length })}</h2>
          {data && data.active.length + data.returned.length > 0 && (
            <ViewToggle view={view} onChange={setView} label={strings.grownups.viewLabel} dense />
          )}
        </div>
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
        {view === 'grid' ? (
          active.length > 0 && <ul className="gu-grid">{active.map(card)}</ul>
        ) : (
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
        )}
      </section>

      <details className="card grownups__history">
        <summary>{fmt(t.returnedHeading, { count: returned.length })}</summary>
        {returned.length === 0 ? (
          <p className="muted">{t.returnedNone}</p>
        ) : view === 'grid' ? (
          <ul className="gu-grid">{returned.map(card)}</ul>
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
                <div className="row">
                  <button type="button" className="btn btn--small" onClick={() => setEditing(loan)}>
                    {t.edit}
                  </button>
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => setDeleting({ loan, title: titleOf(loan) })}>
                    {t.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>

      {editing && data && (
        <LoanEditor key={editing.id} store={store} loan={editing} readers={data.readers} libraries={data.libraries} onClose={() => setEditing(null)} />
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
