import { useCallback, useState, type MouseEvent } from 'react';
import { BookList, BookRow } from '../books/BookList';
import { useBookView } from '../books/bookView';
import { ReadBadge, ReadButton } from '../books/ReadButton';
import { filterShelf, type ShelfFilter } from '../books/shelfFilter';
import { useReadAction } from '../books/useReadAction';
import { SetCard, SetRow, SetSheet } from '../collections/KidsSet';
import { loadCollections, progressOf, type CollectionView } from '../collections/load';
import { groupShelf, setSearchables, type ShelfItem } from '../collections/shelfItems';
import { useDataQuery, type Book, type DataStore, type HomeItem, type ReadSummary, type Reader } from '../data';
import { isSearching } from '../lib/search';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { NoSearchMatch, SearchBar } from '../ui/SearchBar';
import { useReaderSearch } from '../ui/useReaderSearch';
import { ViewToggle } from '../ui/ViewToggle';
import { BackToHub } from './BackToHub';

/**
 * #/shelf — the household's Home books, as a Grid of whole covers (the default) or a List, with
 * "Find a book" and the All / Read / Not read filters. A collection (box set or series) shows as
 * one card that opens its books, each with its own read button. Each tap of "I read this!" /
 * "Read again!" adds one read event for the active reader, with an Undo toast. There is
 * deliberately no way to clear all reads here.
 */

interface ShelfEntry {
  item: HomeItem;
  book: Book | null;
  summary: ReadSummary | null;
}

interface ShelfData {
  entries: ShelfEntry[];
  collections: CollectionView[];
  summaries: Map<string, ReadSummary>;
}

async function loadShelf(store: DataStore, reader: Reader): Promise<ShelfData> {
  const [items, summaries] = await Promise.all([store.listHomeItems(reader.household_id), store.listReadSummaries(reader.id)]);
  const [books, collections] = await Promise.all([store.getBooks(items.map((i) => i.isbn)), loadCollections(store, reader.household_id, items)]);
  const bookByIsbn = new Map(books.map((b) => [b.isbn, b]));
  const summaryByIsbn = new Map(summaries.map((s) => [s.isbn, s]));
  return {
    entries: items.map((item) => ({ item, book: bookByIsbn.get(item.isbn) ?? null, summary: summaryByIsbn.get(item.isbn) ?? null })),
    collections,
    summaries: summaryByIsbn,
  };
}

const SHELF_TABLES = ['home_items', 'books', 'covers', 'read_events', 'collections'] as const;

export function Shelf({ reader }: { reader: Reader }) {
  const t = strings.shelf;
  const [filter, setFilter] = useState<ShelfFilter>('all');
  const [search, setSearch] = useReaderSearch(reader.id);
  const [view, setView] = useBookView('shelf', reader.id);
  const [openSet, setOpenSet] = useState<string | null>(null);

  const query = useCallback((s: DataStore) => loadShelf(s, reader), [reader]);
  const { data, store, loading } = useDataQuery(query, SHELF_TABLES);
  const { read, pending, sheet, waiting } = useReadAction(store, reader);

  const all = data?.entries ?? [];
  const progress = progressOf(data?.collections ?? [], new Set(data?.summaries.keys() ?? []));
  const items = groupShelf(all, (e) => e.item.id, (e) => e.book?.collection_id, data?.collections ?? []);
  const titleOf = (entry: ShelfEntry) => entry.book?.title ?? t.thisBook;
  const { found, readCount, visible } = filterShelf(
    items,
    search,
    filter,
    (it) => (it.kind === 'set' ? setSearchables(it.view) : { title: titleOf(it.entry), authors: it.entry.book?.authors ?? [] }),
    // A set counts as read once it's complete (its trophy, or every book of a series).
    (it) => (it.kind === 'set' ? !!progress.get(it.view.collection.id)?.complete : it.entry.summary !== null),
  );
  const searching = isSearching(search);

  const chips: { id: ShelfFilter; label: string }[] = [
    { id: 'all', label: fmt(t.filterAll, { count: found.length }) },
    { id: 'read', label: fmt(t.filterRead, { count: readCount }) },
    { id: 'unread', label: fmt(t.filterUnread, { count: found.length - readCount }) },
  ];

  const countOf = (isbn: string) => data?.summaries.get(isbn)?.count ?? 0;
  const onRead = (isbn: string, title: string, click: MouseEvent<HTMLElement>) => read(isbn, title, countOf(isbn) > 0, click);
  const opened = data?.collections.find((v) => v.collection.id === openSet);

  const setProps = (it: Extract<ShelfItem<ShelfEntry>, { kind: 'set' }>) => ({
    collection: it.view.collection,
    slots: it.view.slots,
    progress: progress.get(it.view.collection.id)!,
    onOpen: () => setOpenSet(it.view.collection.id),
  });

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
          <ViewToggle view={view} onChange={setView} />

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
              keyOf={(it) => it.key}
              renderRow={(it) =>
                it.kind === 'set' ? (
                  <SetRow {...setProps(it)} />
                ) : (
                  <BookRow
                    isbn={it.entry.item.isbn}
                    title={titleOf(it.entry)}
                    authors={it.entry.book?.authors ?? []}
                    coverUrl={it.entry.book?.cover_url ?? null}
                    count={countOf(it.entry.item.isbn)}
                    waiting={waiting.has(it.entry.item.isbn)}
                    busy={pending.has(it.entry.item.isbn)}
                    onRead={(e) => onRead(it.entry.item.isbn, titleOf(it.entry), e)}
                  />
                )
              }
            />
          ) : (
            <ul className="shelf-grid">
              {visible.map((it) => {
                if (it.kind === 'set') return <SetCard key={it.key} {...setProps(it)} />;
                const { entry } = it;
                const title = titleOf(entry);
                const count = countOf(entry.item.isbn);
                return (
                  <li key={it.key} className={`shelf-book${count ? ' shelf-book--read' : ''}`}>
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
                      onRead={(e) => onRead(entry.item.isbn, title, e)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {opened && (
        <SetSheet
          collection={opened.collection}
          slots={opened.slots}
          progress={progress.get(opened.collection.id)!}
          countOf={countOf}
          waiting={waiting}
          pending={pending}
          onRead={(book, e) => onRead(book.isbn, book.title, e)}
          onClose={() => setOpenSet(null)}
        />
      )}
      {sheet}
    </main>
  );
}
