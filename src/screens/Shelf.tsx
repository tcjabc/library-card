import { useCallback, useState, type MouseEvent } from 'react';
import { useDataQuery, type Book, type DataStore, type HomeItem, type Read, type Reader } from '../data';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { confettiBurst } from '../ui/confetti';
import { useToast } from '../ui/Toast';
import { BackToHub } from './BackToHub';

/** #/shelf — the household's Home books, with "I read this!" per reader. */

type Filter = 'all' | 'read' | 'unread';

interface ShelfEntry {
  item: HomeItem;
  book: Book | null;
  read: Read | null;
}

async function loadShelf(store: DataStore, reader: Reader): Promise<ShelfEntry[]> {
  const [items, reads] = await Promise.all([store.listHomeItems(reader.household_id), store.listReads(reader.id)]);
  const books = await store.getBooks(items.map((i) => i.isbn));
  const bookByIsbn = new Map(books.map((b) => [b.isbn, b]));
  const readByIsbn = new Map(reads.map((r) => [r.isbn, r]));
  return items.map((item) => ({
    item,
    book: bookByIsbn.get(item.isbn) ?? null,
    read: readByIsbn.get(item.isbn) ?? null,
  }));
}

const SHELF_TABLES = ['home_items', 'books', 'covers', 'reads'] as const;

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

  const toggleRead = (entry: ShelfEntry, event: MouseEvent<HTMLButtonElement>) => {
    if (!store) return;
    const { isbn } = entry.item;
    const title = entry.book?.title ?? t.thisBook;
    // Measure now: in the "Not read" filter the button disappears once the read is saved.
    const rect = event.currentTarget.getBoundingClientRect();
    const burstAt = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

    if (!entry.read) {
      void withPending(isbn, async () => {
        await store.markRead(reader.id, isbn);
        confettiBurst(burstAt);
        toast({ message: fmt(t.markedToast, { title }) });
      });
      return;
    }

    const previous = entry.read;
    void withPending(isbn, async () => {
      await store.unmarkRead(reader.id, isbn);
      toast({
        message: fmt(t.unmarkedToast, { title }),
        action: {
          label: t.undo,
          // Restore with the original date so streaks and journeys don't shift.
          onAction: () =>
            void withPending(isbn, async () => {
              await store.markRead(reader.id, isbn, previous.read_at);
            }),
        },
      });
    });
  };

  const all = entries ?? [];
  const readCount = all.filter((e) => e.read).length;
  const visible = all.filter((e) => (filter === 'all' ? true : filter === 'read' ? e.read : !e.read));

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
                const isRead = entry.read !== null;
                return (
                  <li key={entry.item.id} className={`shelf-book${isRead ? ' shelf-book--read' : ''}`}>
                    <BookCover title={title} coverUrl={entry.book?.cover_url ?? null} />
                    <p className="shelf-book__title">{title}</p>
                    <button
                      type="button"
                      className={`btn read-toggle${isRead ? ' read-toggle--on' : ''}`}
                      aria-pressed={isRead}
                      aria-label={fmt(isRead ? t.readLabelOn : t.readLabelOff, { title })}
                      disabled={pending.has(entry.item.isbn)}
                      onClick={(e) => toggleRead(entry, e)}
                    >
                      <span aria-hidden="true">{isRead ? '✅' : '⭐'}</span>
                      {isRead ? t.readOn : t.readOff}
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
