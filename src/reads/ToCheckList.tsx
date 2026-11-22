import { useCallback, useState } from 'react';
import { useDataQuery, type Book, type DataStore, type ReadEvent, type Reader } from '../data';
import { formatTimestampDate } from '../grownups/helpers';
import { checkJourneyCompletion } from '../journeys/completion';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { ConfirmSheet } from '../ui/ConfirmSheet';
import { useToast } from '../ui/Toast';

const t = strings.reads;

interface ToCheckListProps {
  householdId: string;
  /** Only this child's reads; null or undefined: everyone's. */
  readerId?: string | null;
  /** Who confirms: a grown-up reader's id (their own space) or "pin" (Grown-ups → Readers). */
  confirmedBy: string;
}

async function loadToCheck(store: DataStore, householdId: string) {
  const [events, readers] = await Promise.all([store.listPendingReads(householdId), store.listReaders(householdId)]);
  const books = await store.getBooks([...new Set(events.map((e) => e.isbn))]);
  return { events, readers: new Map(readers.map((r) => [r.id, r])), books: new Map(books.map((b) => [b.isbn, b])) };
}

/**
 * Reads waiting for a grown-up: the child, the book, by myself / with help, and when. ✓ Confirm
 * makes the read count (from when the child read it) and checks their journey, so a journey it
 * finishes celebrates the next time they're active; ✗ Not yet asks once, then deletes it. One at a
 * time on purpose (no "confirm all").
 */
export function ToCheckList({ householdId, readerId, confirmedBy }: ToCheckListProps) {
  const toast = useToast();
  const query = useCallback((s: DataStore) => loadToCheck(s, householdId), [householdId]);
  const { data, store } = useDataQuery(query, ['read_events', 'readers', 'books']);
  const [busy, setBusy] = useState<string | null>(null);
  const [notYet, setNotYet] = useState<ReadEvent | null>(null);

  const events = (data?.events ?? []).filter((e) => !readerId || e.reader_id === readerId);
  const nameOf = (e: ReadEvent) => data?.readers.get(e.reader_id)?.display_name ?? '?';
  const titleOf = (e: ReadEvent) => data?.books.get(e.isbn)?.title ?? strings.shelf.thisBook;

  const confirm = async (event: ReadEvent) => {
    if (!store) return;
    setBusy(event.id);
    try {
      await store.confirmRead(event.id, confirmedBy);
      // A confirmed read may finish the child's journey: the celebration follows next time they're active.
      await checkJourneyCompletion(store, event.reader_id).catch((error: unknown) => console.error('[reads] journey check failed', error));
      toast({ message: fmt(t.confirmed, { name: nameOf(event), title: titleOf(event) }) });
    } catch (error) {
      console.error('[reads] confirm failed', error);
      toast({ message: t.failed });
    } finally {
      setBusy(null);
    }
  };

  if (data && events.length === 0) return <p className="muted">{t.toCheckNone}</p>;

  return (
    <>
      <ul className="to-check">
        {events.map((event) => (
          <ToCheckItem
            key={event.id}
            event={event}
            reader={data?.readers.get(event.reader_id)}
            book={data?.books.get(event.isbn)}
            title={titleOf(event)}
            busy={busy === event.id}
            onConfirm={() => void confirm(event)}
            onNotYet={() => setNotYet(event)}
          />
        ))}
      </ul>
      {notYet && store && (
        <ConfirmSheet
          title={t.notYetTitle}
          confirmLabel={t.notYet}
          danger
          errorText={t.failed}
          onClose={() => setNotYet(null)}
          onConfirm={async () => {
            await store.rejectRead(notYet.id);
            toast({ message: fmt(t.sentBack, { title: titleOf(notYet) }) });
            setNotYet(null);
          }}
        >
          <p>{fmt(t.notYetBody, { name: nameOf(notYet), title: titleOf(notYet) })}</p>
        </ConfirmSheet>
      )}
    </>
  );
}

function ToCheckItem({
  event,
  reader,
  book,
  title,
  busy,
  onConfirm,
  onNotYet,
}: {
  event: ReadEvent;
  reader: Reader | undefined;
  book: Book | undefined;
  title: string;
  busy: boolean;
  onConfirm: () => void;
  onNotYet: () => void;
}) {
  const name = reader?.display_name ?? '?';
  return (
    <li className="to-check__item">
      <div className="to-check__cover">
        <BookCover title={title} coverUrl={book?.cover_url ?? null} />
      </div>
      <div className="stack to-check__body">
        <p className="to-check__who">
          <span aria-hidden="true">{reader?.avatar}</span> {name}
        </p>
        <p className="to-check__title">{title}</p>
        <p className="small muted">
          {event.how ? `${t.how[event.how]} · ` : ''}
          {fmt(t.readOn, { date: formatTimestampDate(event.read_at) })}
        </p>
        <div className="row">
          <button type="button" className="btn btn--small btn--primary" disabled={busy} aria-label={fmt(t.confirmLabel, { name, title })} onClick={onConfirm}>
            <span aria-hidden="true">✓</span> {t.confirm}
          </button>
          <button type="button" className="btn btn--small" disabled={busy} aria-label={fmt(t.notYetLabel, { name, title })} onClick={onNotYet}>
            <span aria-hidden="true">✗</span> {t.notYet}
          </button>
        </div>
      </div>
    </li>
  );
}
