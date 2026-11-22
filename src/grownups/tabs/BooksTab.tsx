import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { BookList } from '../../books/BookList';
import { BookSheet, type BookSheetMode } from '../../books/BookSheet';
import { BookLookupError, lookupIsbn, normaliseIsbn } from '../../books/lookup';
import { isNoIsbnBookKey, newNoIsbnBookKey, useDataQuery, type Book, type DataStore, type HomeItem, type Household, type ReadSummary, type Reader } from '../../data';
import { CollectionEditor } from '../../collections/CollectionEditor';
import { CollectionForm } from '../../collections/CollectionForm';
import { loadCollections, type CollectionView } from '../../collections/load';
import { setCover } from '../../collections/setDisplay';
import { BookScanner } from '../../scan/BookScanner';
import { fmt, strings } from '../../strings';
import { BookCover } from '../../ui/BookCover';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { Sheet } from '../../ui/Sheet';
import { MoreMenu, type MoreMenuItem } from '../../ui/MoreMenu';
import { useToast } from '../../ui/Toast';
import { ViewToggle } from '../../ui/ViewToggle';
import { BOOK_FILTERS, BOOK_SORTS, filterBooks, readersByBook, sortBooks, type BookFilter, type BookSort } from '../booksView';
import { findSameTitle, formatTimestampDate, matchesBookSearch } from '../helpers';
import { useGrownUpSession } from '../useGrownUpSession';
import { useGrownUpView } from '../views';
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
  /** Who has read it, in the household's reader order. */
  readBy: Reader[];
  addedAt: string;
  coverUrl: string | null;
}

interface BooksData {
  entries: HomeEntry[];
  readers: Reader[];
  summaries: ReadSummary[];
  collections: CollectionView[];
  /** Every read of each book, by anyone. */
  reads: Map<string, number>;
}

/** A collection in the Books grid or list, with the fields sorting and filtering use. */
interface SetItem {
  kind: 'set';
  key: string;
  view: CollectionView;
  title: string;
  addedAt: string;
  reads: number;
  coverUrl: string | null;
  /** The titles of its books that matched the search (to show why the set is there). */
  matched: string[];
}
type BookItem = HomeEntry & { kind: 'book'; key: string };
type Item = BookItem | SetItem;

async function loadBooks(store: DataStore, householdId: string): Promise<BooksData> {
  const [items, readers, summaries] = await Promise.all([
    store.listHomeItems(householdId),
    store.listReaders(householdId),
    store.listHouseholdReadSummaries(householdId),
  ]);
  const [bookList, collections] = await Promise.all([store.getBooks(items.map((i) => i.isbn)), loadCollections(store, householdId, items)]);
  const books = new Map(bookList.map((b) => [b.isbn, b]));
  const reads = new Map<string, number>();
  for (const s of summaries) reads.set(s.isbn, (reads.get(s.isbn) ?? 0) + s.count);
  const readBy = readersByBook(summaries, readers);
  const entries = items.map((item) => {
    const book = books.get(item.isbn) ?? null;
    return {
      item,
      book,
      title: book?.title ?? item.isbn,
      reads: reads.get(item.isbn) ?? 0,
      readBy: readBy.get(item.isbn) ?? [],
      addedAt: item.added_at,
      coverUrl: book?.cover_url ?? null,
    };
  });
  return { entries, readers, summaries, collections, reads };
}

/**
 * Grown-ups > Books: the Home books, as a Grid of covers (the default) or a compact List; search,
 * sort and quick filters; add, fix, remove and per-reader reads (from a book's sheet, its ⋯ menu,
 * or the List row's buttons).
 */
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
  const [details, setDetails] = useState<HomeEntry | null>(null);
  const [sort, setSort] = useState<BookSort>('recent');
  const [filter, setFilter] = useState<BookFilter>('all');
  const [view, setView] = useGrownUpView('books');
  const [openSet, setOpenSet] = useState<string | null>(null);
  const [newSet, setNewSet] = useState<{ title?: string; isbn?: string | null; cover_url?: string | null } | null>(null);
  const searchId = useId();
  const sortId = useId();

  const query = useCallback((s: DataStore) => loadBooks(s, household.id), [household.id]);
  const { data } = useDataQuery(query, ['home_items', 'books', 'covers', 'readers', 'read_events', 'collections']);
  const entries = data?.entries ?? [];
  // A set's books are listed inside it, not loose (a book whose set is gone stays loose).
  const setIds = new Set((data?.collections ?? []).map((v) => v.collection.id));
  const items: Item[] = [
    ...entries.filter((e) => !setIds.has(e.book?.collection_id ?? '')).map((e): BookItem => ({ ...e, kind: 'book', key: e.item.id })),
    ...(data?.collections ?? []).map((v): SetItem => ({
      kind: 'set',
      key: `set:${v.collection.id}`,
      view: v,
      title: v.collection.title,
      addedAt: v.members.reduce((latest, m) => {
        const at = entries.find((e) => e.item.isbn === m.isbn)?.addedAt ?? '';
        return at > latest ? at : latest;
      }, ''),
      reads: v.members.reduce((n, m) => n + (data?.reads.get(m.isbn) ?? 0), 0),
      coverUrl: setCover(v.collection, v.slots),
      matched: [],
    })),
  ];
  // Search finds a set by its title or any of its books (which are then named on it).
  const searched = items.flatMap((it): Item[] => {
    if (it.kind === 'book') return matchesBookSearch({ title: it.title, authors: it.book?.authors ?? [] }, search) ? [it] : [];
    if (matchesBookSearch({ title: it.title, authors: [] }, search)) return [it];
    const matched = it.view.members.filter((m) => matchesBookSearch(m, search)).map((m) => m.title);
    return matched.length ? [{ ...it, matched }] : [];
  });
  const visible = sortBooks(filterBooks(searched, filter), sort);
  const narrowed = visible.length !== items.length;

  const fix = (entry: HomeEntry) =>
    setSheet({ mode: entry.book ? { kind: 'fix', book: entry.book } : { kind: 'new', isbn: entry.item.isbn }, addToHome: false });
  const setActions = (it: SetItem): MoreMenuItem[] => [{ label: strings.collections.editDetails, onSelect: () => setOpenSet(it.view.collection.id) }];
  const actions = (entry: HomeEntry): MoreMenuItem[] => [
    { label: t.fix, onSelect: () => fix(entry) },
    { label: t.reads, onSelect: () => setReadsOf(entry) },
    { label: t.remove, onSelect: () => setRemoving(entry), danger: true },
  ];

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
          <h2>{narrowed ? fmt(t.headingFiltered, { count: visible.length, total: items.length }) : fmt(t.heading, { count: items.length })}</h2>
          <div className="row">
            <button type="button" className="btn" onClick={() => setNewSet({})}>
              📦 {strings.collections.newCollection}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              {adding ? t.doneAdding : `📷 ${t.scanToAdd}`}
            </button>
          </div>
        </div>
        {adding && (
          <AddBooks
            store={store}
            household={household}
            onSheet={setSheet}
            saved={saved}
            onAddAsSet={(book) => setNewSet({ title: book.title, isbn: /^\d{13}$/.test(book.isbn) ? book.isbn : null, cover_url: book.cover_url })}
          />
        )}

        {items.length > 0 && (
          <div className="stack grownups__tools">
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
            <div className="row grownups__tools-row">
              <label htmlFor={sortId} className="small muted">
                {t.sortLabel}
              </label>
              <select id={sortId} className="input input--select" value={sort} onChange={(e) => setSort(e.target.value as BookSort)}>
                {BOOK_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t.sorts[s]}
                  </option>
                ))}
              </select>
              <ViewToggle view={view} onChange={setView} label={strings.grownups.viewLabel} dense />
            </div>
            <div className="chip-row chip-row--dense" role="group" aria-label={t.filterLabel}>
              {BOOK_FILTERS.map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {t.filters[f]}
                </button>
              ))}
            </div>
          </div>
        )}
        {data && items.length === 0 && <p className="muted">{t.empty}</p>}
        {items.length > 0 && visible.length === 0 && (
          <p className="muted">{filter === 'all' ? fmt(t.noMatch, { query: search.trim() }) : t.noneInFilter}</p>
        )}

        {view === 'grid' ? (
          <ul className="gu-grid gu-grid--books">
            {visible.map((entry) =>
              entry.kind === 'set' ? (
                <li key={entry.key} className="gu-tile">
                  <button type="button" className="gu-tile__open" onClick={() => setOpenSet(entry.view.collection.id)}>
                    <span className="shelf-book__cover">
                      <BookCover title={entry.title} coverUrl={entry.coverUrl} seed={entry.view.collection.id} fit="whole" />
                      <span className="set-badge">{strings.collections.setBadge}</span>
                    </span>
                    <span className="gu-tile__title">{entry.title}</span>
                    <span className="gu-readby gu-readby--none">{setLine(entry)}</span>
                  </button>
                  <MoreMenu className="gu-tile__more" label={fmt(strings.grownups.moreFor, { name: entry.title })} items={setActions(entry)} />
                </li>
              ) : (
              <li key={entry.item.id} className="gu-tile">
                <button type="button" className="gu-tile__open" onClick={() => setDetails(entry)}>
                  <BookCover title={entry.title} coverUrl={entry.coverUrl} seed={entry.item.isbn} fit="whole" />
                  <span className="gu-tile__title">{entry.title}</span>
                  <ReadBy readers={entry.readBy} />
                </button>
                <MoreMenu className="gu-tile__more" label={fmt(t.moreFor, { title: entry.title })} items={actions(entry)} />
              </li>
              ),
            )}
          </ul>
        ) : (
          <BookList
            className="gu-list"
            items={visible}
            keyOf={(entry) => entry.key}
            renderRow={(entry) =>
              entry.kind === 'set' ? (
                <div className="gu-row">
                  <BookCover title={entry.title} coverUrl={entry.coverUrl} seed={entry.view.collection.id} fit="row" />
                  <div className="gu-row__body">
                    <p className="gu-row__title">
                      <span className="set-badge set-badge--inline">{strings.collections.setBadge}</span> {entry.title}
                    </p>
                    <p className="small muted gu-row__sub">{setLine(entry)}</p>
                  </div>
                  <button type="button" className="btn btn--small" onClick={() => setOpenSet(entry.view.collection.id)}>
                    {strings.collections.editDetails}
                  </button>
                </div>
              ) : (
              <div className="gu-row">
                <BookCover title={entry.title} coverUrl={entry.coverUrl} seed={entry.item.isbn} fit="row" />
                <div className="gu-row__body">
                  <p className="gu-row__title">{entry.title}</p>
                  <p className="small muted gu-row__sub">
                    {[entry.book?.authors.join(', '), readsLabel(entry.reads)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="row gu-row__actions">
                  <button type="button" className="btn btn--small" onClick={() => fix(entry)}>
                    {t.fixShort}
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => setReadsOf(entry)}>
                    {t.reads}
                  </button>
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => setRemoving(entry)}>
                    {t.remove}
                  </button>
                </div>
                <MoreMenu className="gu-row__more" label={fmt(t.moreFor, { title: entry.title })} items={actions(entry)} />
              </div>
              )
            }
          />
        )}
      </section>

      {openSet && <CollectionEditor key={openSet} store={store} household={household} collectionId={openSet} onClose={() => setOpenSet(null)} />}
      {newSet && (
        <CollectionForm
          store={store}
          household={household}
          collection={null}
          initial={newSet}
          onSaved={(c) => {
            setNewSet(null);
            setOpenSet(c.id);
          }}
          onOpenExisting={(id) => {
            setNewSet(null);
            setOpenSet(id);
          }}
          onClose={() => setNewSet(null)}
        />
      )}

      {details && (
        <BookDetails
          entry={entries.find((e) => e.item.id === details.item.id) ?? details}
          onAction={(action) => {
            const entry = details;
            setDetails(null);
            if (action === 'fix') fix(entry);
            else if (action === 'reads') setReadsOf(entry);
            else setRemoving(entry);
          }}
          onClose={() => setDetails(null)}
        />
      )}

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

/** A set's line on its tile or row: how many books, and (when searching) which of them matched. */
function setLine(it: SetItem): string {
  const c = strings.collections;
  const count = it.view.members.length === 1 ? c.booksCountOne : fmt(c.booksCount, { count: it.view.members.length });
  return it.matched.length ? `${count} · ${fmt(c.hasMatches, { titles: it.matched.slice(0, 3).join(', ') })}` : count;
}

function readsLabel(reads: number): string {
  return reads === 0 ? t.notRead : reads === 1 ? t.readOnce : fmt(t.readTimes, { count: reads });
}

/** The few readers shown as avatars on a tile; the rest as "+N". */
const AVATARS_SHOWN = 4;

/** A tile's tiny row of avatars of the readers who have read it, or "Not read yet". */
function ReadBy({ readers }: { readers: readonly Reader[] }) {
  if (readers.length === 0) return <span className="gu-readby gu-readby--none">{t.notRead}</span>;
  const shown = readers.slice(0, AVATARS_SHOWN);
  return (
    <span className="gu-readby">
      <span className="visually-hidden">{fmt(t.readBy, { names: readers.map((r) => r.display_name).join(', ') })}</span>
      {shown.map((r) => (
        <span key={r.id} className="gu-readby__avatar" aria-hidden="true" title={r.display_name}>
          {r.avatar}
        </span>
      ))}
      {readers.length > AVATARS_SHOWN && (
        <span className="gu-readby__more" aria-hidden="true">
          {fmt(t.moreReaders, { count: readers.length - AVATARS_SHOWN })}
        </span>
      )}
    </span>
  );
}

/** A Grid book opened: its cover and details, and the same actions as before (Fix this book, Reads, Remove). */
function BookDetails({ entry, onAction, onClose }: { entry: HomeEntry; onAction: (action: 'fix' | 'reads' | 'remove') => void; onClose: () => void }) {
  const authors = entry.book?.authors ?? [];
  return (
    <Sheet title={entry.title} onClose={onClose}>
      <div className="gu-details">
        <div className="gu-details__cover">
          <BookCover title={entry.title} coverUrl={entry.coverUrl} seed={entry.item.isbn} fit="whole" />
        </div>
        <div className="stack gu-details__body">
          {authors.length > 0 && <p>{fmt(strings.common.byAuthors, { authors: authors.join(', ') })}</p>}
          <p className="small muted">{isNoIsbnBookKey(entry.item.isbn) ? t.noBarcode : fmt(t.isbn, { isbn: entry.item.isbn })}</p>
          <p className="small muted">{fmt(t.added, { date: formatTimestampDate(entry.addedAt) })}</p>
          <p className="small">{readsLabel(entry.reads)}</p>
          {entry.readBy.length > 0 && (
            <p className="small">{fmt(t.readBy, { names: entry.readBy.map((r) => `${r.avatar} ${r.display_name}`).join(', ') })}</p>
          )}
        </div>
      </div>
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => onAction('fix')}>
          {t.fix}
        </button>
        <button type="button" className="btn" onClick={() => onAction('reads')}>
          {t.reads}
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => onAction('remove')}>
          {t.remove}
        </button>
      </div>
    </Sheet>
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
  onAddAsSet,
}: {
  store: DataStore;
  household: Household;
  onSheet: (sheet: SheetState) => void;
  /** The book the sheet last saved, so the lookup result shows its new cover. */
  saved: { book: Book; inHome: boolean } | null;
  /** A scanned box: make it a set (its title and cover) instead of one book. */
  onAddAsSet: (book: Book) => void;
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
        onAddAsSet={onAddAsSet}
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
  onAddAsSet,
}: {
  lookup: Lookup;
  onAdd: (book: Book) => void;
  onAddPhoto: (book: Book) => void;
  onRetry: (isbn: string) => void;
  onManual: (isbn: string) => void;
  onAddAsSet: (book: Book) => void;
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
                {inHome ? t.alreadyInHome : strings.collections.addAsOne}
              </button>
              <button type="button" className="btn" onClick={() => onAddAsSet(book)}>
                📦 {strings.collections.addAsSet}
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
