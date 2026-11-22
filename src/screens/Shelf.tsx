import { useCallback, useState, type MouseEvent } from 'react';
import { BookList, BookRow } from '../books/BookList';
import { useBookView } from '../books/bookView';
import { BookViewToggle } from '../books/BookViewToggle';
import { ReadBadge, ReadButton } from '../books/ReadButton';
import { useReadAction } from '../books/useReadAction';
import { useDataQuery, type Book, type DataStore, type HomeItem, type ReadSummary, type Reader } from '../data';
import { filterShelf, type ShelfFilter } from '../books/shelfFilter';
import { isSearching } from '../lib/search';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { NoSearchMatch, SearchBar } from '../ui/SearchBar';
import { useReaderSearch } from '../ui/useReaderSearch';
import { BackToHub } from './BackToHub';

/**
 * #/shelf — the household's Home books, as a Grid of whole covers (the default) or a List, with
 * "Find a book" and the All / Read / Not read filters. Each tap of "I read this!" / "Read
 * again!" adds one read event for the active reader, with an Undo toast. There is deliberately
 * no way to clear all reads here.
 */

interface ShelfEntry {
  item: HomeItem;
  book: Book | null;
  summary: ReadSummary | null;
}

async function loadShelf(store: DataStore, reader: Reader): Promise<ShelfEntry[]> {
  const [items, summaries] = await Promise.all([
    store.listHomeItems(reader.household_id),
    store.listReadSummaries(reader.id),
  ]);
  const books = await store.getBooks(items.map((i) => i.isbn));
  const bookByIsbn = new Map(books.map((b) => [b.isbn, b]));
  const summaryByIsbn = new Map(summaries.map((s) => [s.isbn, s]));
  return items.map((item) => ({
    item,
    book: bookByIsbn.get(item.isbn) ?? null,
    summary: summaryByIsbn.get(item.isbn) ?? null,
  }));
}

const SHELF_TABLES = ['home_items', 'books', 'covers', 'read_events'] as const;

export function Shelf({ reader }: { reader: Reader }) {
  const t = strings.shelf;
  const [filter, setFilter] = useState<ShelfFilter>('all');
  const [search, setSearch] = useReaderSearch(reader.id);
  const [view, setView] = useBookView('shelf', reader.id);

  const query = useCallback((s: DataStore) => loadShelf(s, reader), [reader]);
  const { data: entries, store, loading } = useDataQuery(query, SHELF_TABLES);
  const { read, pending, sheet, waiting } = useReadAction(store, reader);

  const all = entries ?? [];
  const titleOf = (entry: ShelfEntry) => entry.book?.title ?? t.thisBook;
  const { found, readCount, visible } = filterShelf(
    all,
    search,
    filter,
    (e) => ({ title: titleOf(e), authors: e.book?.authors ?? [] }),
    (e) => e.summary !== null,
  );
  const searching = isSearching(search);

  const chips: { id: ShelfFilter; label: string }[] = [
    { id: 'all', label: fmt(t.filterAll, { count: found.length }) },
    { id: 'read', label: fmt(t.filterRead, { count: readCount }) },
    { id: 'unread', label: fmt(t.filterUnread, { count: found.length - readCount }) },
  ];

  const countOf = (entry: ShelfEntry) => entry.summary?.count ?? 0;
  const onRead = (entry: ShelfEntry, click: MouseEvent<HTMLElement>) => read(entry.item.isbn, titleOf(entry), countOf(entry) > 0, click);

  return (
    <main className="page page--kid page--wide">
      <BackToHub />
      <header className="stack">
        <h1 className="kid-title">
          <span aria-hidden="true">📚</span> {t.title}
        </h1>
      </header>

      {loading ? (
        <p className="muted">{strings.common.loading}</p>
      ) : all.length === 0 ? (
        <div className="empty-state">
          <p className="kid-emoji" aria-hidden="true">
            🫙
          </p>
          <p className="kid-lead">{t.emptyAll}</p>
        </div>
      ) : (
        <>
          <SearchBar value={search} onChange={setSearch} />
          <BookViewToggle view={view} onChange={setView} />

          <div className="chip-row" role="group" aria-label={t.filterLabel}>
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="chip"
                aria-pressed={filter === chip.id}
                onClick={() => setFilter(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            searching ? (
              <NoSearchMatch query={search} onClear={() => setSearch('')} />
            ) : (
              <div className="empty-state">
                <p className="kid-lead">{filter === 'read' ? t.emptyRead : t.emptyUnread}</p>
              </div>
            )
          ) : view === 'list' ? (
            <BookList
              items={visible}
              keyOf={(entry) => entry.item.id}
              renderRow={(entry) => (
                <BookRow
                  isbn={entry.item.isbn}
                  title={titleOf(entry)}
                  authors={entry.book?.authors ?? []}
                  coverUrl={entry.book?.cover_url ?? null}
                  count={countOf(entry)}
                  waiting={waiting.has(entry.item.isbn)}
                  busy={pending.has(entry.item.isbn)}
                  onRead={(e) => onRead(entry, e)}
                />
              )}
            />
          ) : (
            <ul className="shelf-grid">
              {visible.map((entry) => {
                const title = titleOf(entry);
                const count = countOf(entry);
                return (
                  <li key={entry.item.id} className={`shelf-book${count ? ' shelf-book--read' : ''}`}>
                    <div className="shelf-book__cover">
                      <BookCover title={title} coverUrl={entry.book?.cover_url ?? null} seed={entry.item.isbn} fit="whole" />
                      <ReadBadge count={count} />
                    </div>
                    <p className="shelf-book__title" title={title}>
                      {title}
                    </p>
                    <ReadButton
                      title={title}
                      count={count}
                      disabled={pending.has(entry.item.isbn)}
                      waiting={waiting.has(entry.item.isbn)}
                      onRead={(e) => onRead(entry, e)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {sheet}
    </main>
  );
}
