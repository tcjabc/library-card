import { useCallback, useState } from 'react';
import { NOTE_EVERYONE, noteViewId, useDataQuery, type DataStore, type Household, type NoteView, type ParentNote, type Reader } from '../data';
import { formatTimestampDate } from '../grownups/helpers';
import { useGrownUpSession } from '../grownups/useGrownUpSession';
import { useGrownUpView } from '../grownups/views';
import { fmt, strings } from '../strings';
import { ConfirmSheet } from '../ui/ConfirmSheet';
import { MoreMenu } from '../ui/MoreMenu';
import { useToast } from '../ui/Toast';
import { ViewToggle } from '../ui/ViewToggle';
import { NoteEditor } from './NoteEditor';

const t = strings.notes;

async function loadNotes(store: DataStore, householdId: string) {
  const [notes, views, readers] = await Promise.all([store.listNotes(householdId), store.listNoteViews(householdId), store.listReaders(householdId)]);
  return { notes, views: new Map(views.map((v) => [v.id, v])), readers };
}

/** A note's first words, for labels ("Move “You’re a star…” up"). */
const short = (text: string) => (text.length > 30 ? `${text.slice(0, 29)}…` : text);

/**
 * Grown-ups → Readers → Notes: every parent note with whom it's for, when it shows and, per child,
 * "Waiting" or "Seen <date>" (with "Show again"); write, edit, reorder and delete. A List, or a
 * Grid of cards with the actions in ⋯.
 */
export function NotesSection({ store, household }: { store: DataStore; household: Household }) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const query = useCallback((s: DataStore) => loadNotes(s, household.id), [household.id]);
  const { data } = useDataQuery(query, ['parent_notes', 'note_views', 'readers']);
  const [view, setView] = useGrownUpView('notes');
  const [editing, setEditing] = useState<ParentNote | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ParentNote | null>(null);

  const notes = data?.notes ?? [];
  const readers = data?.readers ?? [];
  const children = readers.filter((r) => r.kind === 'child');
  const nameOf = (id: string) => readers.find((r) => r.id === id);
  const forWhom = (note: ParentNote) => (note.target === NOTE_EVERYONE ? children : children.filter((c) => c.id === note.target));

  const move = (note: ParentNote, step: -1 | 1) => {
    const ids = notes.map((n) => n.id);
    const at = ids.indexOf(note.id);
    const to = at + step;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    void store.reorderNotes(household.id, ids).catch(() => toast({ message: t.failed }));
  };
  const showAgain = (note: ParentNote, child: Reader) =>
    void store
      .showAgain(note.id, child.id)
      .then(() => toast({ message: fmt(t.shownAgain, { name: child.display_name }) }))
      .catch(() => toast({ message: t.failed }));

  const meta = (note: ParentNote) => {
    const target = note.target === NOTE_EVERYONE ? t.everyone : (nameOf(note.target)?.display_name ?? '?');
    const author = note.author_id ? nameOf(note.author_id) : null;
    return [target, t.triggers[note.trigger], author ? fmt(t.byLine, { name: author.display_name }) : null].filter(Boolean).join(' · ');
  };

  /** Per child: "Waiting" or "Seen <date>", with "Show again". */
  const status = (note: ParentNote) => (
    <ul className="note-status">
      {forWhom(note).map((child) => {
        const seen: NoteView | undefined = data?.views.get(noteViewId(note.id, child.id));
        return (
          <li key={child.id} className="note-status__row">
            <span>
              <span aria-hidden="true">{child.avatar}</span> {child.display_name}: {seen ? fmt(t.seen, { date: formatTimestampDate(seen.seen_at) }) : t.waiting}
            </span>
            {seen && (
              <button
                type="button"
                className="btn btn--small btn--quiet"
                aria-label={fmt(t.showAgainLabel, { text: short(note.text), name: child.display_name })}
                onClick={() => showAgain(note, child)}
              >
                {t.showAgain}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  const body = (note: ParentNote) => (
    <>
      <p className="note-row__text">
        {note.sticker && <span aria-hidden="true">{note.sticker} </span>}
        {note.text}
      </p>
      <p className="small muted">{meta(note)}</p>
      {status(note)}
    </>
  );

  return (
    <section className="stack card" aria-labelledby="notes-heading">
      <div className="row grownups__section-head">
        <h2 id="notes-heading">{fmt(t.heading, { count: notes.length })}</h2>
        <div className="row">
          {notes.length > 0 && <ViewToggle view={view} onChange={setView} label={strings.grownups.viewLabel} dense />}
          <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
            <span aria-hidden="true">✏️</span> {t.write}
          </button>
        </div>
      </div>
      <p className="small muted">{t.intro}</p>
      {data && notes.length === 0 && <p className="muted">{t.none}</p>}

      {view === 'grid' ? (
        <ul className="gu-grid">
          {notes.map((note, i) => (
            <li key={note.id} className="gu-card">
              {body(note)}
              <MoreMenu
                label={fmt(t.moreFor, { text: short(note.text) })}
                items={[
                  { label: t.edit, onSelect: () => setEditing(note) },
                  ...(i > 0 ? [{ label: t.moveUp, onSelect: () => move(note, -1) }] : []),
                  ...(i < notes.length - 1 ? [{ label: t.moveDown, onSelect: () => move(note, 1) }] : []),
                  { label: t.delete, onSelect: () => setDeleting(note), danger: true },
                ]}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="dev-list">
          {notes.map((note, i) => (
            <li key={note.id} className="dev-list__row note-row">
              <div className="stack note-row__body">{body(note)}</div>
              <div className="row">
                <button type="button" className="btn btn--small" onClick={() => setEditing(note)}>
                  {t.edit}
                </button>
                <button type="button" className="btn btn--small" aria-label={fmt(t.moveUpLabel, { text: short(note.text) })} disabled={i === 0} onClick={() => move(note, -1)}>
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={fmt(t.moveDownLabel, { text: short(note.text) })}
                  disabled={i === notes.length - 1}
                  onClick={() => move(note, 1)}
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => setDeleting(note)}>
                  {t.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <NoteEditor
          key={editing === 'new' ? 'new' : editing.id}
          store={store}
          householdId={household.id}
          note={editing === 'new' ? null : editing}
          authorId={null}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmSheet
          title={t.deleteTitle}
          confirmLabel={t.deleteConfirm}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            runAsGrownUp(async () => {
              await store.deleteNote(deleting.id);
              setDeleting(null);
              toast({ message: t.deleted });
            }, strings.gate.reasonDeleteNote)
          }
        >
          <p className="note-row__text">{deleting.text}</p>
          <p>{t.deleteBody}</p>
        </ConfirmSheet>
      )}
    </section>
  );
}
