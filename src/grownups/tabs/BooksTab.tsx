import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { BookSheet, type BookSheetMode } from '../../books/BookSheet';
import { BookLookupError, lookupIsbn, normaliseIsbn } from '../../books/lookup';
import { isNoIsbnBookKey, newNoIsbnBookKey, useDataQuery, type Book, type DataStore, type HomeItem, type Household, type ReadSummary, type Reader } from '../../data';
import { BookScanner } from '../../scan/BookScanner';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { findSameTitle, formatTimestampDate, matchesBookSearch } from '../helpers';
import { useGrownUpSession } from '../useGrownUpSession';
import type { TabProps } from './types';

const t = strings.grownups.books;

type Lookup =
  | { state: 'idle' }
  | { state: 'searching'; isbn: string }
  | { state: 'found'; book: Book; inHome: boolean }
  | { state: 'message'; text: string; retryIsbn?: string; manualIsbn?: string };

type SheetState = { mode: BookSheetMode; addToHome: boolean } | null;

/** Home books with the title of a new no-barcode book, waiting for "Use that one" or "Add anyway". */
interface Duplicate {
  matches: HomeEntry[];
  choose: (choice: 'use' | 'add' | 'back') => void;
}

interface HomeEntry {
  item: HomeItem;
  book: Book | null;
  title: string;
  /** Every read of the book by anyone. */
  reads: number;
}

interface BooksData {
  entries: HomeEntry[];
  readers: Reader[];
  summaries: ReadSummary[];
}

async function loadBooks(store: DataStore, householdId: string): Promise<BooksData> {
  const [items, readers, summaries] = await Promise.all([
    store.listHomeItems(householdId),
    store.listReaders(householdId),
    store.listHouseholdReadSummaries(householdId),
  ]);
  const books = new Map((await store.getBooks(items.map((i) => i.isbn))).map((b) => [b.isbn, b]));
  const reads = new Map<string, number>();
  for (const s of summaries) reads.set(s.isbn, (reads.get(s.isbn) ?? 0) + s.count);
  const entries = items.map((item) => {
    const book = books.get(item.isbn) ?? null;
    return { item, book, title: book?.title ?? item.isbn, reads: reads.get(item.isbn) ?? 0 };
  });
  return { entries, readers, summaries };
}

/** Grown-ups > Books: the Home books, searchable, with add, fix, remove and per-reader reads. */
export function BooksTab({ store, household }: TabProps) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [removing, setRemoving] = useState<HomeEntry | null>(null);
  const [readsOf, setReadsOf] = useState<HomeEntry | null>(null);
  const [saved, setSaved] = useState<{ book: Book; inHome: boolean } | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const searchId = useId();

  const query = useCallback((s: DataStore) => loadBooks(s, household.id), [household.id]);
  const { data } = useDataQuery(query, ['home_items', 'books', 'covers', 'readers', 'read_events']);
  const entries = data?.entries ?? [];
  const visible = entries.filter((e) => matchesBookSearch({ title: e.title, authors: e.book?.authors ?? [] }, search));

  /**
   * A new no-barcode book can't be matched by its key, so before it is added, look for Home books
   * with the same title. "Use that one" drops the new book; closing the warning goes back to it.
   */
  const checkDuplicate = (title: string) => {
    const matches = findSameTitle(title, entries);
    if (matches.length === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setDuplicate({
        matches,
        choose: (choice) => {
          setDuplicate(null);
          if (choice === 'use') setSheet(null);
          resolve(choice === 'add');
        },
      });
    });
  };
  const newNoBarcode = sheet !== null && sheet.addToHome && sheet.mode.kind === 'new' && isNoIsbnBookKey(sheet.mode.isbn);

  return (
    <>
      <section className="stack card">
        <div className="row grownups__section-head">
          <h2>{fmt(t.heading, { count: entries.length })}</h2>
          <button type="button" className="btn btn--primary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            {adding ? t.doneAdding : `📷 ${t.scanToAdd}`}
          </button>
        </div>
        {adding && <AddBooks store={store} household={household} onSheet={setSheet} saved={saved} />}

        {entries.length > 0 && (
          <div className="stack">
            <label htmlFor={searchId} className="visually-hidden">
              {t.searchLabel}
            </label>
            <input
              id={searchId}
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`🔎 ${t.searchPlaceholder}`}
              aria-label={t.searchLabel}
              autoComplete="off"
            />
          </div>
        )}
        {data && entries.length === 0 && <p className="muted">{t.empty}</p>}
        {entries.length > 0 && visible.length === 0 && <p className="muted">{fmt(t.noMatch, { query: search.trim() })}</p>}

        <ul className="grownups-books">
          {visible.map((entry) => (
            <li key={entry.item.id} className="grownups-book">
              <div className="grownups-book__cover">
                <BookCover title={entry.title} coverUrl={entry.book?.cover_url ?? null} />
              </div>
              <div className="stack grownups-book__body">
                <p className="grownups__item-title">{entry.title}</p>
                {entry.book && entry.book.authors.length > 0 && <p className="small muted">{entry.book.authors.join(', ')}</p>}
                <p className="small">{entry.reads === 0 ? t.notRead : entry.reads === 1 ? t.readOnce : fmt(t.readTimes, { count: entry.reads })}</p>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() =>
                      setSheet({ mode: entry.book ? { kind: 'fix', book: entry.book } : { kind: 'new', isbn: entry.item.isbn }, addToHome: false })
                    }
                  >
                    {t.fix}
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => setReadsOf(entry)}>
                    {t.reads}
                  </button>
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => setRemoving(entry)}>
                    {t.remove}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {sheet && (
        <BookSheet
          key={`${sheet.mode.kind}:${'isbn' in sheet.mode ? sheet.mode.isbn : sheet.mode.book.isbn}`}
          mode={sheet.mode}
          store={store}
          saveLabel={sheet.addToHome ? t.addToHome : undefined}
          confirmSave={newNoBarcode ? checkDuplicate : undefined}
          onSaved={(book) => {
            const addHome = sheet.addToHome;
            setSheet(null);
            void (async () => {
              if (addHome) await store.addHomeItem(household.id, book.isbn);
              const inHome = addHome || (await store.getHomeItem(household.id, book.isbn)) !== null;
              setSaved({ book, inHome });
              toast({ message: fmt(addHome ? t.addedToast : t.fixedToast, { title: book.title }) });
            })();
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {duplicate && (
        <Sheet title={fmt(t.duplicateTitle, { title: duplicate.matches[0].title })} onClose={() => duplicate.choose('back')}>
          <div className="stack">
            <p>{t.duplicateBody}</p>
            <ul className="grownups-books">
              {duplicate.matches.map((entry) => (
                <li key={entry.item.id} className="grownups-book">
                  <div className="grownups-book__cover">
                    <BookCover title={entry.title} coverUrl={entry.book?.cover_url ?? null} />
                  </div>
                  <div className="stack grownups-book__body">
                    <p className="grownups__item-title">{entry.title}</p>
                    {entry.book && entry.book.authors.length > 0 && <p className="small muted">{entry.book.authors.join(', ')}</p>}
                    <p className="small muted">{fmt(t.duplicateAdded, { date: formatTimestampDate(entry.item.added_at) })}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => duplicate.choose('use')}>
                {t.duplicateUse}
              </button>
              <button type="button" className="btn" onClick={() => duplicate.choose('add')}>
                {t.duplicateAdd}
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {removing && (
        <ConfirmSheet
          title={fmt(t.removeTitle, { title: removing.title })}
          confirmLabel={t.removeConfirm}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            runAsGrownUp(async () => {
              await store.removeHomeItem(removing.item.id);
              setRemoving(null);
              toast({ message: fmt(t.removed, { title: removing.title }) });
            }, strings.gate.reasonDelete)
          }
        >
          <p>{t.removeBody}</p>
        </ConfirmSheet>
      )}

      {readsOf && data && (
        <ReadsSheet
          store={store}
          entry={readsOf}
          readers={data.readers}
          summaries={data.summaries.filter((s) => s.isbn === readsOf.item.isbn)}
          onClose={() => setReadsOf(null)}
        />
      )}
    </>
  );
}

/** Each reader's reads of one book, with "Clear reads for <reader>". */
function ReadsSheet({
  store,
  entry,
  readers,
  summaries,
  onClose,
}: {
  store: DataStore;
  entry: HomeEntry;
  readers: Reader[];
  summaries: ReadSummary[];
  onClose: () => void;
}) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const [clearing, setClearing] = useState<{ reader: Reader; count: number } | null>(null);
  const byReader = new Map(summaries.map((s) => [s.reader_id, s]));
  const readersWithReads = readers.filter((r) => byReader.has(r.id));

  if (clearing) {
    const { reader, count } = clearing;
    return (
      <ConfirmSheet
        title={fmt(t.clearTitle, { name: reader.display_name, title: entry.title })}
        confirmLabel={t.clearConfirm}
        danger
        onClose={() => setClearing(null)}
        onConfirm={() =>
          runAsGrownUp(async () => {
            await store.clearReads(reader.id, entry.item.isbn);
            setClearing(null);
            toast({ message: fmt(t.cleared, { name: reader.display_name, title: entry.title }) });
          }, strings.gate.reasonClearReads)
        }
      >
        <p>{count === 1 ? fmt(t.clearBodyOne, { name: reader.display_name }) : fmt(t.clearBody, { name: reader.display_name, count })}</p>
      </ConfirmSheet>
    );
  }

  return (
    <Sheet title={fmt(t.readsTitle, { title: entry.title })} onClose={onClose}>
      {readersWithReads.length === 0 ? (
        <p className="muted">{t.readsNone}</p>
      ) : (
        <ul className="dev-list">
          {readersWithReads.map((reader) => {
            const s = byReader.get(reader.id)!;
            const first = formatTimestampDate(s.first_read_at);
            const last = formatTimestampDate(s.last_read_at);
            return (
              <li key={reader.id} className="dev-list__row">
                <div className="stack">
                  <p className="grownups__item-title">
                    <span aria-hidden="true">{reader.avatar}</span> {reader.display_name} ·{' '}
                    {s.count === 1 ? t.readsCountOne : fmt(t.readsCount, { count: s.count })}
                  </p>
                  <p className="small muted">{first === last ? fmt(t.onDate, { date: first }) : fmt(t.firstLast, { first, last })}</p>
                </div>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => setClearing({ reader, count: s.count })}>
                  {fmt(t.clearFor, { name: reader.display_name })}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

/** Scan or type an ISBN, look it up, and add it to Home (or add a book by hand). */
function AddBooks({
  store,
  household,
  onSheet,
  saved,
}: {
  store: DataStore;
  household: Household;
  onSheet: (sheet: SheetState) => void;
  /** The book the sheet last saved, so the lookup result shows its new cover. */
  saved: { book: Book; inHome: boolean } | null;
}) {
  const toast = useToast();
  const [scanning, setScanning] = useState(true);
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [manual, setManual] = useState('');
  const lookupAbort = useRef<AbortController | null>(null);
  const manualId = useId();

  useEffect(() => () => lookupAbort.current?.abort(), []);

  const runLookup = useCallback(
    async (isbn: string) => {
      lookupAbort.current?.abort();
      const controller = new AbortController();
      lookupAbort.current = controller;
      setLookup({ state: 'searching', isbn });
      try {
        const book = await lookupIsbn(isbn, { store, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!book) {
          // Nothing found: fall through to adding it by hand.
          setLookup({ state: 'message', text: fmt(strings.lookup.notFound, { isbn }), manualIsbn: isbn });
          onSheet({ mode: { kind: 'new', isbn }, addToHome: true });
          return;
        }
        const inHome = (await store.getHomeItem(household.id, book.isbn)) !== null;
        setLookup({ state: 'found', book, inHome });
        // Found without a cover: offer a photo straight away.
        if (!book.cover_url && !inHome) onSheet({ mode: { kind: 'add-cover', book }, addToHome: true });
      } catch (error) {
        if (controller.signal.aborted) return;
        const invalid = error instanceof BookLookupError && error.code === 'invalid_isbn';
        setLookup({
          state: 'message',
          text: invalid ? strings.lookup.invalidIsbn : strings.lookup.network,
          retryIsbn: invalid ? undefined : isbn,
          manualIsbn: invalid ? undefined : isbn,
        });
      }
    },
    [store, household.id, onSheet],
  );

  const onIsbn = useCallback(
    (isbn: string) => {
      setScanning(false);
      void runLookup(isbn);
    },
    [runLookup],
  );

  const onManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    const isbn = normaliseIsbn(manual);
    if (!isbn) {
      setLookup({ state: 'message', text: strings.lookup.invalidIsbn });
      return;
    }
    setScanning(false);
    void runLookup(isbn);
  };

  // A book saved in the sheet since it was looked up (e.g. a new photo) shows as saved.
  const shown: Lookup =
    lookup.state === 'found' && saved && saved.book.isbn === lookup.book.isbn
      ? { state: 'found', book: saved.book, inHome: saved.inHome || lookup.inHome }
      : lookup;

  const addToHome = async (book: Book) => {
    await store.putBook(book);
    await store.addHomeItem(household.id, book.isbn);
    setLookup({ state: 'found', book, inHome: true });
    toast({ message: fmt(t.addedToast, { title: book.title }) });
  };

  return (
    <div className="stack grownups__add" aria-live="polite">
      <h3>{t.addHeading}</h3>
      {scanning ? (
        <>
          <BookScanner onIsbn={onIsbn} />
          <div className="row">
            <button type="button" className="btn" onClick={() => setScanning(false)}>
              {t.stopScan}
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              lookupAbort.current?.abort();
              setLookup({ state: 'idle' });
              setScanning(true);
            }}
          >
            {lookup.state === 'idle' ? t.startScan : t.scanAnother}
          </button>
        </div>
      )}

      <form className="stack" onSubmit={onManualSubmit}>
        <label htmlFor={manualId} className="small muted">
          {t.manualLabel}
        </label>
        <div className="row">
          <input
            id={manualId}
            className="input"
            inputMode="numeric"
            autoComplete="off"
            placeholder={t.manualPlaceholder}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!manual.trim()}>
            {t.manualSubmit}
          </button>
        </div>
      </form>
      <div className="row">
        <button type="button" className="btn" onClick={() => onSheet({ mode: { kind: 'new', isbn: newNoIsbnBookKey() }, addToHome: true })}>
          {strings.bookFinder.noBarcode}
        </button>
      </div>

      <LookupResult
        lookup={shown}
        onAdd={(book) => void addToHome(book)}
        onAddPhoto={(book) => onSheet({ mode: { kind: 'add-cover', book }, addToHome: shown.state === 'found' && !shown.inHome })}
        onRetry={(isbn) => void runLookup(isbn)}
        onManual={(isbn) => onSheet({ mode: { kind: 'new', isbn }, addToHome: true })}
      />
    </div>
  );
}

function LookupResult({
  lookup,
  onAdd,
  onAddPhoto,
  onRetry,
  onManual,
}: {
  lookup: Lookup;
  onAdd: (book: Book) => void;
  onAddPhoto: (book: Book) => void;
  onRetry: (isbn: string) => void;
  onManual: (isbn: string) => void;
}) {
  switch (lookup.state) {
    case 'idle':
      return null;
    case 'searching':
      return <p className="muted">{fmt(strings.lookup.searching, { isbn: lookup.isbn })}</p>;
    case 'message':
      return (
        <div className="alert stack">
          <p>{lookup.text}</p>
          {(lookup.retryIsbn || lookup.manualIsbn) && (
            <div className="row">
              {lookup.retryIsbn && (
                <button type="button" className="btn" onClick={() => onRetry(lookup.retryIsbn!)}>
                  {strings.common.retry}
                </button>
              )}
              {lookup.manualIsbn && (
                <button type="button" className="btn" onClick={() => onManual(lookup.manualIsbn!)}>
                  {t.addManually}
                </button>
              )}
            </div>
          )}
        </div>
      );
    case 'found': {
      const { book, inHome } = lookup;
      const authors = book.authors.length ? book.authors.join(', ') : strings.common.unknownAuthor;
      return (
        <article className="grownups__result">
          <div className="grownups__result-cover">
            <BookCover title={book.title} coverUrl={book.cover_url} />
          </div>
          <div className="stack">
            <h3>{book.title}</h3>
            <p className="muted">{fmt(strings.common.byAuthors, { authors })}</p>
            <p className="muted small">
              {book.isbn} · {book.source}
            </p>
            <div className="row">
              <button type="button" className="btn btn--accent" disabled={inHome} onClick={() => onAdd(book)}>
                {inHome ? t.alreadyInHome : t.addToHome}
              </button>
              {!book.cover_url && (
                <button type="button" className="btn" onClick={() => onAddPhoto(book)}>
                  📷 {strings.bookSheet.addPhoto}
                </button>
              )}
            </div>
          </div>
        </article>
      );
    }
  }
}
