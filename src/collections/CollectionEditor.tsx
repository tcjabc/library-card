import { useCallback, useId, useState, type FormEvent } from 'react';
import { BookFinder } from '../books/BookFinder';
import { matchesBookSearch } from '../lib/search';
import { MAX_VOLUME, newNoIsbnBookKey, useDataQuery, type Book, type DataStore, type Household } from '../data';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { ConfirmSheet } from '../ui/ConfirmSheet';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { useGrownUpSession } from '../grownups/useGrownUpSession';
import { CollectionForm } from './CollectionForm';
import { buildSlots, nextFreeVolume, quickAddPlan, stillToAdd } from './progress';

const t = strings.collections;

/** How books are being added: quick-add, scanning (into a given number, or the next free ones), or from Home. */
type Mode = { kind: 'list' } | { kind: 'quick' } | { kind: 'scan'; slot: number | null } | { kind: 'existing' };

async function loadEditor(store: DataStore, householdId: string, collectionId: string) {
  const [collection, members, home] = await Promise.all([
    store.getCollection(collectionId),
    store.listCollectionBooks(collectionId),
    store.listHomeItems(householdId),
  ]);
  const homeBooks = await store.getBooks(home.map((h) => h.isbn));
  return { collection, members, home, homeBooks };
}

interface CollectionEditorProps {
  store: DataStore;
  household: Household;
  collectionId: string;
  onClose: () => void;
}

/**
 * A set opened in Grown-ups → Books: its details, its books by number (numbers not added yet
 * shown, and tappable to scan into), several editions of a number (the first added is the main
 * one), changing a book's number, taking a book out (it stays), deleting the set (its books
 * stay); and adding books: quick-add (no barcodes), scanning, or Home books.
 */
export function CollectionEditor({ store, household, collectionId, onClose }: CollectionEditorProps) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** A book waiting for its number (after a scan, or picked from Home). */
  const [asking, setAsking] = useState<{ book: Book; volume: string } | null>(null);
  const query = useCallback((s: DataStore) => loadEditor(s, household.id, collectionId), [household.id, collectionId]);
  const { data } = useDataQuery(query, ['collections', 'books', 'covers', 'home_items']);

  const collection = data?.collection;
  if (data && !collection) return null; // deleted (here or elsewhere)
  if (!data || !collection) return null;

  const addedAt = new Map(data.home.map((h) => [h.isbn, h.added_at]));
  const slots = buildSlots(data.members, collection.expected_count, (b) => addedAt.get(b.isbn) ?? null);
  const taken = data.members.map((m) => m.volume);
  const missing = stillToAdd(slots, collection.expected_count);
  const counter = collection.expected_count
    ? fmt(t.scanCounter, { count: slots.filter((s) => s.volume !== null && s.volume <= collection.expected_count! && s.books.length > 0).length, total: collection.expected_count })
    : fmt(t.scanCounterOpen, { count: data.members.length });

  /** Puts a saved book in the set as `volume`, at Home too. */
  const addMember = async (book: Book, volume: number) => {
    await store.addHomeItem(household.id, book.isbn);
    await store.setBookCollection(book.isbn, collection.id, volume);
    toast({ message: fmt(t.added, { title: book.title, volume }) });
  };

  const ask = (book: Book, slot: number | null) => setAsking({ book, volume: String(slot ?? nextFreeVolume(taken)) });

  return (
    <Sheet title={collection.title} onClose={onClose}>
      <div className="gu-details">
        <div className="gu-details__cover">
          <BookCover title={collection.title} coverUrl={collection.cover_url ?? slots.find((s) => s.books[0]?.cover_url)?.books[0]?.cover_url ?? null} seed={collection.id} fit="whole" />
        </div>
        <div className="stack gu-details__body">
          {collection.isbn && <p className="small muted">{fmt(strings.grownups.books.isbn, { isbn: collection.isbn })}</p>}
          <p className="small">{data.members.length === 1 ? t.booksCountOne : fmt(t.booksCount, { count: data.members.length })}</p>
          {missing > 0 && <p className="small alert">{missing === 1 ? t.stillToAddOne : fmt(t.stillToAdd, { count: missing })}</p>}
          <div className="row">
            <button type="button" className="btn btn--small" onClick={() => setEditing(true)}>
              {t.editDetails}
            </button>
            <button type="button" className="btn btn--small btn--quiet" onClick={() => setDeleting(true)}>
              {t.deleteSet}
            </button>
          </div>
        </div>
      </div>

      {mode.kind === 'list' && (
        <>
          {slots.length === 0 && <p className="muted">{t.noMembers}</p>}
          <ul className="gu-list gu-set-slots">
            {slots.map((slot) =>
              slot.books.length === 0 ? (
                <li key={`empty-${slot.volume}`}>
                  <button type="button" className="gu-set-slots__empty" onClick={() => setMode({ kind: 'scan', slot: slot.volume })}>
                    <span className="set-sheet__number" aria-hidden="true">
                      {slot.volume}
                    </span>
                    <span>{fmt(t.notAddedYet, { volume: slot.volume ?? '' })}</span>
                    <span aria-hidden="true">📷</span>
                  </button>
                </li>
              ) : (
                slot.books.map((book, i) => (
                  <li key={book.isbn}>
                    <MemberRow
                      key={`${book.isbn}:${book.volume}`}
                      book={book}
                      editions={i === 0 && slot.books.length > 1 ? slot.books.length : 0}
                      onNumber={(volume) => void store.setBookCollection(book.isbn, collection.id, volume).catch(() => toast({ message: t.failed }))}
                      onTakeOut={() =>
                        void store
                          .clearBookCollection(book.isbn)
                          .then(() => toast({ message: fmt(t.tookOut, { title: book.title }) }))
                          .catch(() => toast({ message: t.failed }))
                      }
                    />
                  </li>
                ))
              ),
            )}
          </ul>
          <div className="stack">
            <h3>{t.addBooksHeading}</h3>
            <div className="row">
              <button type="button" className="btn" onClick={() => setMode({ kind: 'quick' })}>
                {t.quickAdd}
              </button>
              <button type="button" className="btn" onClick={() => setMode({ kind: 'scan', slot: null })}>
                📷 {t.scanBooks}
              </button>
              <button type="button" className="btn" onClick={() => setMode({ kind: 'existing' })}>
                {t.addExisting}
              </button>
            </div>
          </div>
        </>
      )}

      {mode.kind === 'quick' && (
        <QuickAdd
          setTitle={collection.title}
          taken={taken}
          onAdd={async (plan) => {
            for (const { volume, title } of plan) {
              const book = await store.putBook({ isbn: newNoIsbnBookKey(), title, authors: [], cover_url: collection.cover_url, source: 'manual' });
              await store.addHomeItem(household.id, book.isbn);
              await store.setBookCollection(book.isbn, collection.id, volume);
            }
            toast({ message: fmt(t.quickAdded, { count: plan.length }) });
            setMode({ kind: 'list' });
          }}
          onCancel={() => setMode({ kind: 'list' })}
        />
      )}

      {mode.kind === 'scan' && !asking && (
        <div className="stack">
          <p className="grownups__item-title" aria-live="polite">
            {mode.slot ? fmt(t.notAddedYet, { volume: mode.slot }) : counter}
          </p>
          <BookFinder store={store} onBook={(book) => ask(book, mode.slot)} />
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => setMode({ kind: 'list' })}>
              {t.doneAdding}
            </button>
          </div>
        </div>
      )}

      {mode.kind === 'existing' && !asking && (
        <ExistingPicker
          books={data.homeBooks.filter((b) => !b.collection_id)}
          onPick={(book) => ask(book, null)}
          onDone={() => setMode({ kind: 'list' })}
        />
      )}

      {asking && (
        <NumberPrompt
          book={asking.book}
          initial={asking.volume}
          onAdd={async (volume) => {
            await addMember(asking.book, volume);
            setAsking(null);
            // Scanning into one number: done; otherwise carry on with the next book.
            if (mode.kind === 'scan' && mode.slot !== null) setMode({ kind: 'list' });
          }}
          onCancel={() => setAsking(null)}
        />
      )}

      {editing && (
        <CollectionForm store={store} household={household} collection={collection} onSaved={() => setEditing(false)} onClose={() => setEditing(false)} />
      )}
      {deleting && (
        <ConfirmSheet
          title={fmt(t.deleteTitle, { title: collection.title })}
          confirmLabel={t.deleteConfirm}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            runAsGrownUp(async () => {
              await store.deleteCollection(collection.id);
              toast({ message: fmt(t.deleted, { title: collection.title }) });
              onClose();
            }, strings.gate.reasonDeleteSet)
          }
        >
          <p>{t.deleteBody}</p>
        </ConfirmSheet>
      )}
    </Sheet>
  );
}

/** One book in the set: cover, title, its number (editable) and "Take out". */
function MemberRow({ book, editions, onNumber, onTakeOut }: { book: Book; editions: number; onNumber: (volume: number | null) => void; onTakeOut: () => void }) {
  const [value, setValue] = useState(book.volume ? String(book.volume) : '');
  const id = useId();
  // Reads the field itself (not the state), so a blur straight after typing still sees the new number.
  const commit = (text: string) => {
    const n = text.trim() ? Number(text) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > MAX_VOLUME)) return setValue(book.volume ? String(book.volume) : '');
    if (n !== (book.volume ?? null)) onNumber(n);
  };
  return (
    <div className="gu-row gu-member">
      <BookCover title={book.title} coverUrl={book.cover_url} seed={book.isbn} fit="row" />
      <div className="gu-row__body">
        <p className="gu-row__title">{book.title}</p>
        {editions > 1 && <span className="chip-tag">{fmt(t.editions, { count: editions })}</span>}
      </div>
      <div className="row gu-member__actions">
        <label htmlFor={id} className="visually-hidden">
          {fmt(t.numberLabel, { title: book.title })}
        </label>
        <input
          id={id}
          className="input input--number"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <button type="button" className="btn btn--small btn--quiet" aria-label={fmt(t.takeOutLabel, { title: book.title })} onClick={onTakeOut}>
          {t.takeOut}
        </button>
      </div>
    </div>
  );
}

/** "Which number is <title>?" with the next free number filled in. */
function NumberPrompt({ book, initial, onAdd, onCancel }: { book: Book; initial: string; onAdd: (volume: number) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const n = Number(value);
  const ok = Number.isInteger(n) && n >= 1 && n <= MAX_VOLUME;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ok) return;
    setBusy(true);
    try {
      await onAdd(n);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack grownups__add" onSubmit={(e) => void submit(e)}>
      <div className="gu-row">
        <BookCover title={book.title} coverUrl={book.cover_url} seed={book.isbn} fit="row" />
        <div className="gu-row__body">
          <label htmlFor={id} className="grownups__item-title">
            {fmt(t.whichNumberFor, { title: book.title })}
          </label>
        </div>
      </div>
      <input id={id} className="input input--short" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={!ok || busy}>
          {fmt(t.addAsNumber, { volume: ok ? n : '?' })}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {strings.common.cancel}
        </button>
      </div>
    </form>
  );
}

/** Quick-add: a count and optional titles, one book (no barcode) per number. */
function QuickAdd({
  setTitle,
  taken,
  onAdd,
  onCancel,
}: {
  setTitle: string;
  taken: readonly (number | null | undefined)[];
  onAdd: (plan: { volume: number; title: string }[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [count, setCount] = useState('');
  const [titles, setTitles] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = { count: useId(), titles: useId() };
  const plan = quickAddPlan(setTitle, Number(count) || 0, titles, taken);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (plan.length === 0) return;
    setBusy(true);
    try {
      await onAdd(plan);
    } catch (error) {
      console.error('[collections] quick-add failed', error);
      setBusy(false);
    }
  };
  return (
    <form className="stack grownups__add" onSubmit={(e) => void submit(e)}>
      <h3>{t.quickAdd}</h3>
      <label htmlFor={ids.count} className="field-label">
        {t.quickCount}
      </label>
      <input id={ids.count} className="input input--short" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
      <label htmlFor={ids.titles} className="field-label">
        {t.quickTitles}
      </label>
      <textarea id={ids.titles} className="input textarea" rows={4} value={titles} onChange={(e) => setTitles(e.target.value)} />
      {plan.length > 0 && <p className="small muted">{plan.map((p) => `${p.volume}. ${p.title}`).join(' · ')}</p>}
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={busy || plan.length === 0}>
          {busy ? strings.common.saving : fmt(t.quickAddButton, { count: plan.length })}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {strings.common.cancel}
        </button>
      </div>
    </form>
  );
}

/** Home books not in any set, searchable; "Add" asks for the number. */
function ExistingPicker({ books, onPick, onDone }: { books: readonly Book[]; onPick: (book: Book) => void; onDone: () => void }) {
  const [search, setSearch] = useState('');
  const id = useId();
  const shown = books.filter((b) => matchesBookSearch(b, search)).slice(0, 50);
  return (
    <div className="stack">
      <h3>{t.addExisting}</h3>
      {books.length === 0 ? (
        <p className="muted">{t.existingNone}</p>
      ) : (
        <>
          <label htmlFor={id} className="visually-hidden">
            {t.existingSearch}
          </label>
          <input id={id} className="input" type="search" placeholder={`🔎 ${t.existingSearch}`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="gu-list">
            {shown.map((book) => (
              <li key={book.isbn}>
                <div className="gu-row">
                  <BookCover title={book.title} coverUrl={book.cover_url} seed={book.isbn} fit="row" />
                  <div className="gu-row__body">
                    <p className="gu-row__title">{book.title}</p>
                    {book.authors.length > 0 && <p className="small muted gu-row__sub">{book.authors.join(', ')}</p>}
                  </div>
                  <button type="button" className="btn btn--small" onClick={() => onPick(book)}>
                    {t.addThis}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={onDone}>
          {t.doneAdding}
        </button>
      </div>
    </div>
  );
}
