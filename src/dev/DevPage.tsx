import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookLookupError, lookupIsbn, normaliseIsbn } from '../books/lookup';
import { configuredAdapter, getDataStore, type Book, type DataStore, type HomeItem, type Household } from '../data';
import { href } from '../router';
import { Scanner, type ScanResult } from '../scan/Scanner';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import './DevPage.css';

/**
 * Temporary developer page (#/dev): scan an ISBN, look it up, add it to the
 * Home library. Exercises the Scanner, lookup and DataStore end to end.
 */

type Lookup =
  | { state: 'idle' }
  | { state: 'searching'; isbn: string }
  | { state: 'found'; book: Book; inHome: boolean }
  | { state: 'message'; text: string; retryIsbn?: string };

interface HomeEntry {
  item: HomeItem;
  book: Book | null;
}

const t = strings.dev;

// Module-level so React StrictMode's double effect can't create two households.
let devHousehold: Promise<Household> | null = null;
function ensureDevHousehold(store: DataStore): Promise<Household> {
  devHousehold ??= store
    .listHouseholds()
    .then((list) => list[0] ?? store.createHousehold({ name: t.defaultHouseholdName }))
    .catch((error: unknown) => {
      devHousehold = null;
      throw error;
    });
  return devHousehold;
}

export default function DevPage() {
  const [store, setStore] = useState<DataStore | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [home, setHome] = useState<HomeEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [manual, setManual] = useState('');
  const lookupAbort = useRef<AbortController | null>(null);

  const refreshHome = useCallback(async (s: DataStore, h: Household) => {
    const items = await s.listHomeItems(h.id);
    const books = await s.getBooks(items.map((i) => i.isbn));
    const byIsbn = new Map(books.map((b) => [b.isbn, b]));
    setHome(items.map((item) => ({ item, book: byIsbn.get(item.isbn) ?? null })));
  }, []);

  // Open the store and make sure there is a household to save into.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getDataStore();
        const h = await ensureDevHousehold(s);
        if (cancelled) return;
        setStore(s);
        setHousehold(h);
        await refreshHome(s, h);
      } catch (error) {
        if (!cancelled) setStorageError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
      lookupAbort.current?.abort();
    };
  }, [refreshHome]);

  const runLookup = useCallback(
    async (isbn: string) => {
      if (!store || !household) return;
      lookupAbort.current?.abort();
      const controller = new AbortController();
      lookupAbort.current = controller;
      setLookup({ state: 'searching', isbn });
      try {
        const book = await lookupIsbn(isbn, { store, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!book) {
          setLookup({ state: 'message', text: fmt(strings.lookup.notFound, { isbn }) });
          return;
        }
        const inHome = (await store.getHomeItem(household.id, book.isbn)) !== null;
        setLookup({ state: 'found', book, inHome });
      } catch (error) {
        if (controller.signal.aborted) return;
        const text =
          error instanceof BookLookupError && error.code === 'invalid_isbn'
            ? strings.lookup.invalidIsbn
            : strings.lookup.network;
        setLookup({ state: 'message', text, retryIsbn: isbn });
      }
    },
    [store, household],
  );

  const onScan = useCallback(
    (result: ScanResult) => {
      const isbn = normaliseIsbn(result.value);
      if (!isbn) {
        // Not a book (e.g. a grocery barcode). Keep scanning.
        setLookup({ state: 'message', text: strings.lookup.invalidIsbn });
        return;
      }
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
    if (!store || !household) return;
    await store.putBook(book);
    await store.addHomeItem(household.id, book.isbn);
    setLookup({ state: 'found', book, inHome: true });
    await refreshHome(store, household);
  };

  const removeFromHome = async (item: HomeItem) => {
    if (!store || !household) return;
    await store.removeHomeItem(item.id);
    if (lookup.state === 'found' && lookup.book.isbn === item.isbn) {
      setLookup({ ...lookup, inHome: false });
    }
    await refreshHome(store, household);
  };

  const startScanning = () => {
    lookupAbort.current?.abort();
    setLookup({ state: 'idle' });
    setScanning(true);
  };

  return (
    <main className="page">
      <header className="stack">
        <a href={href('/')} className="small">
          ← {t.back}
        </a>
        <h1>{t.title}</h1>
        <p className="muted">{t.intro}</p>
        <p className="muted small">{fmt(t.adapter, { name: store?.adapterName ?? configuredAdapter })}</p>
      </header>

      {storageError && (
        <p className="alert alert--danger" role="alert">
          {fmt(t.storageError, { message: storageError })}
        </p>
      )}

      <section className="stack" aria-live="polite">
        {scanning ? (
          <>
            <Scanner formats="ean_13" onResult={onScan} />
            <div className="row">
              <button type="button" className="btn" onClick={() => setScanning(false)}>
                {t.stopScan}
              </button>
            </div>
          </>
        ) : (
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={startScanning} disabled={!store}>
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
            <button type="submit" className="btn" disabled={!store || !manual.trim()}>
              {t.manualSubmit}
            </button>
          </div>
        </form>

        <LookupPanel
          lookup={lookup}
          onAdd={(book) => void addToHome(book)}
          onRetry={(isbn) => void runLookup(isbn)}
        />
      </section>

      <section className="stack">
        <h2>{fmt(t.homeHeading, { count: home.length })}</h2>
        {home.length === 0 ? (
          <p className="muted">{t.homeEmpty}</p>
        ) : (
          <ul className="cover-grid">
            {home.map(({ item, book }) => (
              <li key={item.id} className="dev__tile">
                <BookCover title={book?.title ?? item.isbn} coverUrl={book?.cover_url ?? null} />
                <p className="small dev__tile-title">{book?.title ?? item.isbn}</p>
                <button type="button" className="btn dev__remove" onClick={() => void removeFromHome(item)}>
                  {t.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function LookupPanel({
  lookup,
  onAdd,
  onRetry,
}: {
  lookup: Lookup;
  onAdd: (book: Book) => void;
  onRetry: (isbn: string) => void;
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
          {lookup.retryIsbn && (
            <div className="row">
              <button type="button" className="btn" onClick={() => onRetry(lookup.retryIsbn!)}>
                {strings.common.retry}
              </button>
            </div>
          )}
        </div>
      );
    case 'found': {
      const { book, inHome } = lookup;
      const authors = book.authors.length ? book.authors.join(', ') : strings.common.unknownAuthor;
      return (
        <article className="card dev__result">
          <div className="dev__result-cover">
            <BookCover title={book.title} coverUrl={book.cover_url} />
          </div>
          <div className="stack">
            <h2>{book.title}</h2>
            <p className="muted">{fmt(strings.common.byAuthors, { authors })}</p>
            <p className="muted small">
              {book.isbn} · {book.source}
            </p>
            <div className="row">
              <button type="button" className="btn btn--accent" disabled={inHome} onClick={() => onAdd(book)}>
                {inHome ? t.alreadyInHome : t.addToHome}
              </button>
            </div>
          </div>
        </article>
      );
    }
  }
}
