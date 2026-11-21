import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { MAX_COVER_BYTES, type Book, type DataStore } from '../data';
import { resizeImage } from '../lib/image';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { Sheet } from '../ui/Sheet';

/**
 * Manual add / fix sheet. Three ways in:
 * - "new":       nothing was found for the ISBN; start from scratch.
 * - "add-cover": a book was found without a cover; details are pre-filled.
 * - "fix":       a grown-up wants to correct any book.
 * Saves the book once with putBook (after storing a new photo, if any).
 */

export type BookSheetMode =
  | { kind: 'new'; isbn: string }
  | { kind: 'add-cover'; book: Book }
  | { kind: 'fix'; book: Book };

interface BookSheetProps {
  mode: BookSheetMode;
  store: DataStore;
  /** Label for the save button, e.g. "Add to Home". */
  saveLabel?: string;
  onSaved: (book: Book) => void;
  onClose: () => void;
}

const COVER_MAX_EDGE = 800;
const COVER_QUALITY = 0.8;

export function BookSheet({ mode, store, saveLabel, onSaved, onClose }: BookSheetProps) {
  const t = strings.bookSheet;
  const original = mode.kind === 'new' ? null : mode.book;
  const isbn = mode.kind === 'new' ? mode.isbn : mode.book.isbn;

  const [title, setTitle] = useState(original?.title ?? '');
  const [authors, setAuthors] = useState(original?.authors.join(', ') ?? '');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const authorId = useId();
  const photoId = useId();

  // Revoke the preview URL when it is replaced or the sheet closes.
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow choosing the same file again
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await resizeImage(file, COVER_MAX_EDGE, COVER_QUALITY, MAX_COVER_BYTES);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setError(t.photoError);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(t.titleRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const coverUrl = photo ? await store.saveCoverImage(photo.blob) : (original?.cover_url ?? null);
      const saved = await store.putBook({
        isbn,
        title: cleanTitle,
        authors: authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        cover_url: coverUrl,
        source: original?.source ?? 'manual',
      });
      onSaved(saved);
    } catch (err) {
      console.error('[book sheet] save failed', err);
      setError(t.saveError);
      setBusy(false);
    }
  };

  const heading = mode.kind === 'new' ? t.titleNew : mode.kind === 'add-cover' ? t.titleAddCover : t.titleFix;
  const previewUrl = photo?.url ?? original?.cover_url ?? null;

  return (
    <Sheet title={heading} onClose={onClose}>
      <form className="stack book-sheet" onSubmit={onSubmit} noValidate>
        {mode.kind === 'new' && <p className="muted">{t.introNew}</p>}
        {mode.kind === 'add-cover' && <p className="muted">{t.introAddCover}</p>}
        <p className="muted small">{fmt(t.isbn, { isbn })}</p>

        <div className="book-sheet__photo">
          <div className="book-sheet__preview">
            <BookCover title={title.trim() || t.untitled} coverUrl={previewUrl} />
          </div>
          <div className="stack">
            <label htmlFor={photoId} className={`btn ${mode.kind === 'add-cover' && !photo ? 'btn--accent' : ''}`}>
              📷 {previewUrl ? t.changePhoto : t.addPhoto}
            </label>
            <input
              id={photoId}
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void onPhoto(e)}
              disabled={busy}
            />
            <p className="muted small">{t.photoHint}</p>
          </div>
        </div>

        <label htmlFor={titleId} className="field-label">
          {t.titleLabel}
        </label>
        <input
          id={titleId}
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoComplete="off"
          required
          aria-invalid={error === t.titleRequired || undefined}
        />

        <label htmlFor={authorId} className="field-label">
          {t.authorLabel}
        </label>
        <input
          id={authorId}
          className="input"
          value={authors}
          onChange={(e) => setAuthors(e.target.value)}
          autoComplete="off"
          placeholder={t.authorPlaceholder}
        />

        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? strings.common.saving : (saveLabel ?? t.save)}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
