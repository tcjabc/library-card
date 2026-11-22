import { useCallback, useId, useState, type FormEvent } from 'react';
import { MAX_NOTE_TEXT, NOTE_EVERYONE, NOTE_TRIGGERS, useDataQuery, type DataStore, type NoteTrigger, type ParentNote } from '../data';
import { AvatarPicker } from '../readers/AvatarPicker';
import { fmt, strings } from '../strings';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';

const t = strings.notes;

interface NoteEditorProps {
  store: DataStore;
  householdId: string;
  /** The note to edit, or null to write a new one. */
  note: ParentNote | null;
  /** Who is writing: a grown-up reader's id (from their hub), or null (Grown-ups). Kept on an edit. */
  authorId: string | null;
  onClose: () => void;
}

/** Write or edit a parent note: for whom, when, a sticker and the text (500 characters at most). */
export function NoteEditor({ store, householdId, note, authorId, onClose }: NoteEditorProps) {
  const toast = useToast();
  const query = useCallback((s: DataStore) => s.listReaders(householdId), [householdId]);
  const { data: readers = [] } = useDataQuery(query, ['readers']);
  const children = readers.filter((r) => r.kind === 'child');
  const [target, setTarget] = useState(note?.target ?? NOTE_EVERYONE);
  const [trigger, setTrigger] = useState<NoteTrigger>(note?.trigger ?? 'after_book');
  const [sticker, setSticker] = useState(note?.sticker ?? '');
  const [text, setText] = useState(note?.text ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { for: useId(), when: useId(), text: useId(), count: useId() };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return setError(t.textRequired);
    setBusy(true);
    setError(null);
    try {
      const fields = { target, trigger, text, sticker: sticker || null };
      if (note) await store.updateNote(note.id, fields);
      else await store.createNote({ household_id: householdId, author_id: authorId, ...fields });
      toast({ message: t.saved });
      onClose();
    } catch (err) {
      console.error('[notes] save failed', err);
      setError(t.failed);
      setBusy(false);
    }
  };

  return (
    <Sheet title={note ? t.editTitle : t.writeTitle} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)} noValidate>
        <p className="field-label" id={ids.for}>
          {t.forLegend}
        </p>
        <div className="chip-row chip-row--dense" role="group" aria-labelledby={ids.for}>
          <button type="button" className="chip" aria-pressed={target === NOTE_EVERYONE} onClick={() => setTarget(NOTE_EVERYONE)}>
            {t.everyone}
          </button>
          {children.map((r) => (
            <button key={r.id} type="button" className="chip" aria-pressed={target === r.id} onClick={() => setTarget(r.id)}>
              <span aria-hidden="true">{r.avatar}</span> {r.display_name}
            </button>
          ))}
        </div>
        {children.length === 0 && <p className="small muted">{t.noChildren}</p>}

        <p className="field-label" id={ids.when}>
          {t.whenLegend}
        </p>
        <div className="chip-row chip-row--dense" role="group" aria-labelledby={ids.when}>
          {NOTE_TRIGGERS.map((value) => (
            <button key={value} type="button" className="chip" aria-pressed={trigger === value} onClick={() => setTrigger(value)}>
              {t.triggers[value]}
            </button>
          ))}
        </div>

        <AvatarPicker value={sticker} onChange={setSticker} legend={t.stickerLegend} noneLabel={t.noSticker} />

        <label htmlFor={ids.text} className="field-label">
          {t.textLabel}
        </label>
        <textarea
          id={ids.text}
          className="input textarea"
          rows={4}
          maxLength={MAX_NOTE_TEXT}
          value={text}
          placeholder={t.textPlaceholder}
          aria-describedby={ids.count}
          onChange={(e) => setText(e.target.value)}
        />
        <p id={ids.count} className="small muted note-editor__count" aria-live="polite">
          {fmt(t.counter, { count: text.length, max: MAX_NOTE_TEXT })}
        </p>

        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? strings.common.saving : t.save}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
