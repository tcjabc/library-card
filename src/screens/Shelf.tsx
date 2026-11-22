import { useCallback, useState } from 'react';
import { ReadBadge, ReadButton } from '../books/ReadButton';
import { useReadAction } from '../books/useReadAction';
import { useDataQuery, type Book, type DataStore, type HomeItem, type ReadSummary, type Reader } from '../data';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { BackToHub } from './BackToHub';

/**
 * #/shelf — the household's Home books. Each tap of "I read this!" / "Read
 * again!" adds one read event for the active reader, with an Undo toast.
 * There is deliberately no way to clear all reads here.
 */

type Filter = 'all' | 'read' | 'unread';

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
  const [filter, setFilter] = useState<Filter>('all');

  const query = useCallback((s: DataStore) => loadShelf(s, reader), [reader]);
  const { data: entries, store, loading } = useDataQuery(query, SHELF_TABLES);
  const { read, pending, sheet, waiting } = useReadAction(store, reader);

  const all = entries ?? [];
  const readCount = all.filter((e) => e.summary).length;
  const visible = all.filter((e) => (filter === 'all' ? true : filter === 'read' ? e.summary : !e.summary));

  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: fmt(t.filterAll, { count: all.length }) },
    { id: 'read', label: fmt(t.filterRead, { count: readCount }) },
    { id: 'unread', label: fmt(t.filterUnread, { count: all.length - readCount }) },
  ];

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
            <div className="empty-state">
              <p className="kid-lead">{filter === 'read' ? t.emptyRead : t.emptyUnread}</p>
            </div>
          ) : (
            <ul className="shelf-grid">
              {visible.map((entry) => {
                const title = entry.book?.title ?? t.thisBook;
                const count = entry.summary?.count ?? 0;
                return (
                  <li key={entry.item.id} className={`shelf-book${count ? ' shelf-book--read' : ''}`}>
                    <div className="shelf-book__cover">
                      <BookCover title={title} coverUrl={entry.book?.cover_url ?? null} />
                      <ReadBadge count={count} />
                    </div>
                    <p className="shelf-book__title">{title}</p>
                    <ReadButton
                      title={title}
                      count={count}
                      disabled={pending.has(entry.item.isbn)}
                      waiting={waiting.has(entry.item.isbn)}
                      onRead={(e) => read(entry.item.isbn, title, count > 0, e)}
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
