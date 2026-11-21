import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { newNoIsbnBookKey, type Book, type DataStore } from '../data';
import { BookScanner } from '../scan/BookScanner';
import { fmt, strings } from '../strings';
import { BookSheet, type BookSheetMode } from './BookSheet';
import { BookLookupError, lookupIsbn, normaliseIsbn } from './lookup';

/**
 * Finds the book in hand: scan its barcode, type the ISBN, or "No barcode?"
 * (title + photo, with a noisbn-… key). Uses the same rules as adding Home
 * books: a found book with a cover is ready; no cover or not found opens the
 * add/fix sheet. Calls onBook with a book that is saved in the store.
 */

type State =
  | { kind: 'scan' }
  | { kind: 'looking'; isbn: string }
  | { kind: 'message'; text: string; isbn?: string };

export function BookFinder({ store, onBook }: { store: DataStore; onBook: (book: Book) => void }) {
  const t = strings.bookFinder;
  const [state, setState] = useState<State>({ kind: 'scan' });
  const [sheet, setSheet] = useState<BookSheetMode | null>(null);
  const [typed, setTyped] = useState('');
  const [showTyping, setShowTyping] = useState(false);
  const inputId = useId();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const find = useCallback(
    async (isbn: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setState({ kind: 'looking', isbn });
      try {
        const book = await lookupIsbn(isbn, { store, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!book) {
          setState({ kind: 'scan' });
          setSheet({ kind: 'new', isbn });
        } else if (!book.cover_url) {
          setState({ kind: 'scan' });
          setSheet({ kind: 'add-cover', book });
        } else {
          onBook(book);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const invalid = error instanceof BookLookupError && error.code === 'invalid_isbn';
        setState({ kind: 'message', text: invalid ? strings.lookup.invalidIsbn : strings.lookup.network, isbn: invalid ? undefined : isbn });
      }
    },
    [store, onBook],
  );

  const onTyped = (event: FormEvent) => {
    event.preventDefault();
    const isbn = normaliseIsbn(typed);
    if (!isbn) {
      setState({ kind: 'message', text: strings.lookup.invalidIsbn });
      return;
    }
    void find(isbn);
  };

  return (
    <div className="stack book-finder">
      {state.kind === 'scan' && !sheet && <BookScanner mode="book" onIsbn={(isbn) => void find(isbn)} />}
      {state.kind === 'looking' && <p className="kid-lead center-text">{fmt(strings.lookup.searching, { isbn: state.isbn })}</p>}
      {state.kind === 'message' && (
        <div className="alert stack">
          <p>{state.text}</p>
          <div className="row">
            {state.isbn && (
              <button type="button" className="btn" onClick={() => void find(state.isbn!)}>
                {strings.common.retry}
              </button>
            )}
            {state.isbn && (
              <button type="button" className="btn" onClick={() => setSheet({ kind: 'new', isbn: state.isbn! })}>
                {strings.grownups.books.addManually}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setState({ kind: 'scan' })}>
              {t.scanAgain}
            </button>
          </div>
        </div>
      )}

      <div className="row book-finder__alternatives">
        <button type="button" className="btn" onClick={() => setSheet({ kind: 'new', isbn: newNoIsbnBookKey() })}>
          {t.noBarcode}
        </button>
        <button type="button" className="btn btn--quiet" aria-expanded={showTyping} onClick={() => setShowTyping((v) => !v)}>
          {t.typeIsbn}
        </button>
      </div>
      {showTyping && (
        <form className="row" onSubmit={onTyped}>
          <label htmlFor={inputId} className="visually-hidden">
            {t.typeIsbn}
          </label>
          <input
            id={inputId}
            className="input"
            inputMode="numeric"
            autoComplete="off"
            placeholder={strings.grownups.books.manualPlaceholder}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!typed.trim()}>
            {strings.grownups.books.manualSubmit}
          </button>
        </form>
      )}

      {sheet && (
        <BookSheet
          key={sheet.kind === 'new' ? sheet.isbn : sheet.book.isbn}
          mode={sheet}
          store={store}
          saveLabel={t.useThisBook}
          onSaved={(book) => {
            setSheet(null);
            onBook(book);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
