import { useCallback, useState, type MouseEvent } from 'react';
import {
  useDataQuery,
  type Book,
  type DataStore,
  type HomeItem,
  type ReadEvent,
  type ReadSummary,
  type Reader,
} from '../data';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { confettiBurst } from '../ui/confetti';
import { useToast } from '../ui/Toast';
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
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const query = useCallback((s: DataStore) => loadShelf(s, reader), [reader]);
  const { data: entries, store, loading } = useDataQuery(query, SHELF_TABLES);

  const withPending = async (isbn: string, work: () => Promise<void>) => {
    setPending((p) => new Set(p).add(isbn));
    try {
      await work();
    } catch (error) {
      console.error('[shelf] update failed', error);
      toast({ message: t.saveError });
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(isbn);
        return next;
      });
    }
  };

  /** Undo removes the reader's latest event for the book, which is the one just added. */
  const undo = (event: ReadEvent) => {
    if (!store) return;
    void withPending(event.isbn, async () => {
      const removed = await store.undoLatestRead(reader.id, event.isbn);
      // Another tab added a newer read meanwhile: put that back; ours stays.
      if (removed && removed.id !== event.id) await store.restoreReadEvent(removed);
    });
  };

  const read = (entry: ShelfEntry, click: MouseEvent<HTMLButtonElement>) => {
    if (!store) return;
    const { isbn } = entry.item;
    const title = entry.book?.title ?? t.thisBook;
    const again = entry.summary !== null;
    // Measure now: in the "Not read" filter the button disappears once the read is saved.
    const rect = click.currentTarget.getBoundingClientRect();
    const burstAt = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

    void withPending(isbn, async () => {
      const event = await store.markRead(reader.id, isbn);
      // null: a second tap within a few seconds, ignored on purpose.
      if (!event) return;
      confettiBurst(burstAt);
      toast({
        message: fmt(again ? t.markedAgainToast : t.markedToast, { title }),
        action: { label: t.undo, onAction: () => undo(event) },
      });
    });
  };

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
                const isRead = count > 0;
                return (
                  <li key={entry.item.id} className={`shelf-book${isRead ? ' shelf-book--read' : ''}`}>
                    <div className="shelf-book__cover">
                      <BookCover title={title} coverUrl={entry.book?.cover_url ?? null} />
                      {count > 1 && <span className="read-badge">{fmt(t.readCount, { count })}</span>}
                    </div>
                    <p className="shelf-book__title">{title}</p>
                    <button
                      type="button"
                      className={`btn read-toggle${isRead ? ' read-toggle--on' : ''}`}
                      aria-label={fmt(isRead ? t.readAgainLabel : t.readLabel, { title })}
                      disabled={pending.has(entry.item.isbn)}
                      onClick={(e) => read(entry, e)}
                    >
                      <span aria-hidden="true">{isRead ? '🔁' : '⭐'}</span>
                      {isRead ? t.readAgain : t.readFirst}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
