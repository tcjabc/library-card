import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookSheet, type BookSheetMode } from '../books/BookSheet';
import { BookLookupError, lookupIsbn, normaliseIsbn } from '../books/lookup';
import {
  configuredAdapter,
  useDataQuery,
  type Book,
  newNoIsbnBookKey,
  type DataStore,
  type HomeItem,
  type Household,
} from '../data';
import { useGrownUpSession } from '../grownups/useGrownUpSession';
import { href } from '../router';
import { BookScanner } from '../scan/BookScanner';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { useToast } from '../ui/Toast';
import { LibrariesPanel } from './LibrariesPanel';
import { LoansPanel } from './LoansPanel';
import { ReadersPanel } from './ReadersPanel';
import { SelfTestPanel } from './SelfTestPanel';
import './DevPage.css';

/**
 * Temporary grown-up tools (#/dev) until the PIN-protected parent area
 * (Phase 5): readers and cards, adding books to Home, fixing books.
 */

type Lookup =
  | { state: 'idle' }
  | { state: 'searching'; isbn: string }
  | { state: 'found'; book: Book; inHome: boolean }
  | { state: 'message'; text: string; retryIsbn?: string; manualIsbn?: string };

interface HomeEntry {
  item: HomeItem;
  book: Book | null;
}

type SheetState = { mode: BookSheetMode; addToHome: boolean } | null;

const t = strings.dev;

const householdQuery = (s: DataStore) => s.getCurrentHousehold();

export default function DevPage() {
  const { data: household, store, error } = useDataQuery(householdQuery, ['households']);

  return (
    <main className="page page--wide dev">
      <header className="stack">
        <a href={href('/')} className="small">
          ← {t.back}
        </a>
        <h1>{t.title}</h1>
        <p className="muted">{t.intro}</p>
        <p className="muted small">{fmt(t.adapter, { name: store?.adapterName ?? configuredAdapter })}</p>
      </header>

      {error && (
        <p className="alert alert--danger" role="alert">
          {fmt(t.storageError, { message: error.message })}
        </p>
      )}

      {store && household && (
        <>
          <ReadersPanel store={store} household={household} />
          <BooksPanel store={store} household={household} />
          <LibrariesPanel store={store} household={household} />
          <LoansPanel store={store} household={household} />
          <SelfTestPanel />
        </>
      )}
    </main>
  );
}

function BooksPanel({ store, household }: { store: DataStore; household: Household }) {
  const toast = useToast();
  const { requireGrownUp } = useGrownUpSession();
  const [scanning, setScanning] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [manual, setManual] = useState('');
  const [sheet, setSheet] = useState<SheetState>(null);
  const lookupAbort = useRef<AbortController | null>(null);

  useEffect(() => () => lookupAbort.current?.abort(), []);

  const homeQuery = useCallback(
    async (s: DataStore): Promise<HomeEntry[]> => {
      const items = await s.listHomeItems(household.id);
      const books = await s.getBooks(items.map((i) => i.isbn));
      const byIsbn = new Map(books.map((b) => [b.isbn, b]));
      return items.map((item) => ({ item, book: byIsbn.get(item.isbn) ?? null }));
    },
    [household.id],
  );
  const { data: home = [] } = useDataQuery(homeQuery, ['home_items', 'books', 'covers']);

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
          // Nothing found: fall through to manual add.
          setLookup({ state: 'message', text: fmt(strings.lookup.notFound, { isbn }), manualIsbn: isbn });
          setSheet({ mode: { kind: 'new', isbn }, addToHome: true });
          return;
        }
        const inHome = (await store.getHomeItem(household.id, book.isbn)) !== null;
        setLookup({ state: 'found', book, inHome });
        // Found without a cover: offer a photo straight away.
        if (!book.cover_url && !inHome) setSheet({ mode: { kind: 'add-cover', book }, addToHome: true });
      } catch (error) {
        if (controller.signal.aborted) return;
        const text =
          error instanceof BookLookupError && error.code === 'invalid_isbn' ? strings.lookup.invalidIsbn : strings.lookup.network;
        const invalid = error instanceof BookLookupError && error.code === 'invalid_isbn';
        setLookup({ state: 'message', text, retryIsbn: invalid ? undefined : isbn, manualIsbn: invalid ? undefined : isbn });
      }
    },
    [store, household.id],
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

  const addToHome = async (book: Book) => {
    await store.putBook(book);
    await store.addHomeItem(household.id, book.isbn);
    setLookup({ state: 'found', book, inHome: true });
    toast({ message: fmt(t.addedToast, { title: book.title }) });
  };

  const onSheetSaved = async (book: Book) => {
    const addHome = sheet?.addToHome ?? false;
    setSheet(null);
    if (addHome) await addToHome(book);
    else {
      if (lookup.state === 'found' && lookup.book.isbn === book.isbn) setLookup({ ...lookup, book });
      toast({ message: fmt(t.fixedToast, { title: book.title }) });
    }
  };

  const removeFromHome = async (item: HomeItem) => {
    await store.removeHomeItem(item.id);
    if (lookup.state === 'found' && lookup.book.isbn === item.isbn) setLookup({ ...lookup, inHome: false });
  };

  const startScanning = () => {
    lookupAbort.current?.abort();
    setLookup({ state: 'idle' });
    setScanning(true);
  };

  return (
    <>
      <section className="stack card" aria-live="polite">
        <h2>{t.addHeading}</h2>
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
            <button type="button" className="btn btn--primary" onClick={startScanning}>
              {lookup.state === 'idle' ? t.startScan : t.scanAnother}
            </button>
          </div>
        )}

        <form className="row" onSubmit={onManualSubmit}>
          <label htmlFor="dev-isbn" className="small muted">
            {t.manualLabel}
          </label>
          <div className="row dev__manual">
            <input
              id="dev-isbn"
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
          <button type="button" className="btn" onClick={() => setSheet({ mode: { kind: 'new', isbn: newNoIsbnBookKey() }, addToHome: true })}>
            {strings.bookFinder.noBarcode}
          </button>
        </div>

        <LookupPanel
          lookup={lookup}
          onAdd={(book) => void addToHome(book)}
          onAddPhoto={(book) => setSheet({ mode: { kind: 'add-cover', book }, addToHome: lookup.state === 'found' && !lookup.inHome })}
          onRetry={(isbn) => void runLookup(isbn)}
          onManual={(isbn) => setSheet({ mode: { kind: 'new', isbn }, addToHome: true })}
        />
      </section>

      <section className="stack card">
        <h2>{fmt(t.homeHeading, { count: home.length })}</h2>
        {home.length === 0 ? (
          <p className="muted">{t.homeEmpty}</p>
        ) : (
          <ul className="cover-grid">
            {home.map(({ item, book }) => (
              <li key={item.id} className="dev__tile">
                <BookCover title={book?.title ?? item.isbn} coverUrl={book?.cover_url ?? null} />
                <p className="small dev__tile-title">{book?.title ?? item.isbn}</p>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() =>
                    setSheet({
                      mode: book ? { kind: 'fix', book } : { kind: 'new', isbn: item.isbn },
                      addToHome: false,
                    })
                  }
                >
                  {t.fixBook}
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--quiet"
                  onClick={() => requireGrownUp(() => void removeFromHome(item), strings.gate.reasonDelete)}
                >
                  {t.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sheet && (
        <BookSheet
          key={`${sheet.mode.kind}:${'isbn' in sheet.mode ? sheet.mode.isbn : sheet.mode.book.isbn}`}
          mode={sheet.mode}
          store={store}
          saveLabel={sheet.addToHome ? t.addToHome : undefined}
          onSaved={(book) => void onSheetSaved(book)}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

function LookupPanel({
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
        <article className="dev__result">
          <div className="dev__result-cover">
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
