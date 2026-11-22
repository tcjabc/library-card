import { lazy, Suspense, useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { isNoIsbnBookKey, type Book, type DataStore } from '../data';
import { LibraryLookups } from '../library/LibraryLookups';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { Sheet } from '../ui/Sheet';
import type { CropResult } from './crop/CropScreen';
import { FULL, type Rect } from './crop/cropMath';

// Only loaded once a photo is taken.
const CropScreen = lazy(() => import('./crop/CropScreen'));

/**
 * Manual add / fix sheet. Three ways in:
 * - "new":       nothing was found for the ISBN; start from scratch.
 * - "add-cover": a book was found without a cover; details are pre-filled.
 * - "fix":       a grown-up wants to correct any book.
 * Saves the book once with putBook (after storing a new photo, if any).
 * A "new" book may use a "noisbn-…" key: a book without a barcode, added by
 * title and photo.
 * When nothing was found (or there is no cover), the household's libraries
 * are offered as "Look it up at …" links.
 *
 * Every photo taken or chosen goes through the crop screen (CropScreen) first; "Edit photo"
 * opens it again on a photo on this device (not on a catalogue cover, and not until a photo
 * synced from another device has arrived). Cancel there keeps the photo as it was.
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
  /**
   * Asked with the title before anything is saved (photo included): false keeps the sheet open
   * unsaved, or the caller closes it. E.g. a duplicate warning.
   */
  confirmSave?: (title: string) => Promise<boolean>;
  onSaved: (book: Book) => void;
  onClose: () => void;
}

/** What the crop screen opens with. */
interface Cropping {
  source: Blob;
  initial?: { turns: number; rect: Rect };
}

/** A local photo's URL (this adapter's blob: URLs), as opposed to a catalogue cover's https: URL. */
const isPhotoUrl = (url: string | null | undefined): url is string => !!url && url.startsWith('blob:');

export function BookSheet({ mode, store, saveLabel, confirmSave, onSaved, onClose }: BookSheetProps) {
  const t = strings.bookSheet;
  const original = mode.kind === 'new' ? null : mode.book;
  const isbn = mode.kind === 'new' ? mode.isbn : mode.book.isbn;

  const [title, setTitle] = useState(original?.title ?? '');
  const [authors, setAuthors] = useState(original?.authors.join(', ') ?? '');
  const [photo, setPhoto] = useState<(CropResult & { url: string }) | null>(null);
  const [cropping, setCropping] = useState<Cropping | null>(null);
  const [photoMissing, setPhotoMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const authorId = useId();
  const photoId = useId();

  // Revoke the preview URL when it is replaced or the sheet closes.
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  // A photo synced from another device that hasn't arrived yet can't be edited here.
  useEffect(() => {
    if (!original || isPhotoUrl(original.cover_url) || original.cover_url) return;
    let live = true;
    store
      .isCoverPhotoMissing(original.isbn)
      .then((missing) => live && setPhotoMissing(missing))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [store, original]);

  const onPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow choosing the same file again
    if (!file) return;
    setError(null);
    setCropping({ source: file });
  };

  const onCropped = (result: CropResult) => {
    setCropping(null);
    setPhoto({ ...result, url: URL.createObjectURL(result.blob) });
  };

  /** Crop the photo again: a new one from where it was left; a saved one from the whole of it. */
  const editPhoto = async () => {
    setError(null);
    if (photo) {
      setCropping({ source: photo.source, initial: { turns: photo.turns, rect: photo.rect } });
      return;
    }
    if (!isPhotoUrl(original?.cover_url)) return;
    try {
      const saved = await (await fetch(original.cover_url)).blob();
      setCropping({ source: saved, initial: { turns: 0, rect: FULL } });
    } catch (err) {
      console.error('[book sheet] could not open the photo', err);
      setError(t.photoError);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(t.titleRequired);
      return;
    }
    if (confirmSave && !(await confirmSave(cleanTitle))) return;
    setBusy(true);
    setError(null);
    try {
      // A new photo is stored by its content (cover:<hash>); the old one goes once no book uses it.
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

  const noIsbn = isNoIsbnBookKey(isbn);
  const heading = mode.kind === 'new' ? t.titleNew : mode.kind === 'add-cover' ? t.titleAddCover : t.titleFix;
  const previewUrl = photo?.url ?? original?.cover_url ?? null;
  const catalogueCover = !photo && !!original?.cover_url && !isPhotoUrl(original.cover_url);
  const canEdit = !!photo || isPhotoUrl(original?.cover_url);
  // A photo still on its way here is the household's photo all the same: taking one changes it.
  const photoLabel = catalogueCover ? t.takeInstead : previewUrl || photoMissing ? t.changePhoto : t.addPhoto;

  return (
    <Sheet title={heading} onClose={onClose}>
      <form className="stack book-sheet" onSubmit={onSubmit} noValidate>
        {mode.kind === 'new' && <p className="muted">{noIsbn ? t.introNoBarcode : t.introNew}</p>}
        {mode.kind === 'add-cover' && <p className="muted">{t.introAddCover}</p>}
        {!noIsbn && <p className="muted small">{fmt(t.isbn, { isbn })}</p>}
        {mode.kind !== 'fix' && !noIsbn && <LibraryLookups store={store} isbn={isbn} />}

        <div className="book-sheet__photo">
          <div className="book-sheet__preview">
            <BookCover title={title.trim() || t.untitled} coverUrl={previewUrl} />
          </div>
          <div className="stack">
            <label htmlFor={photoId} className={`btn ${mode.kind === 'add-cover' && !photo ? 'btn--accent' : ''}`}>
              📷 {photoLabel}
            </label>
            <input
              id={photoId}
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPhoto}
              disabled={busy}
            />
            {(canEdit || photoMissing) && (
              <button type="button" className="btn" disabled={busy || !canEdit} onClick={() => void editPhoto()}>
                <span aria-hidden="true">✂️</span> {t.editPhoto}
              </button>
            )}
            <p className="muted small">{photoMissing && !photo ? t.photoArriving : catalogueCover ? t.catalogueCover : t.photoHint}</p>
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
      {cropping && (
        <Suspense fallback={null}>
          <CropScreen source={cropping.source} initial={cropping.initial} onDone={onCropped} onCancel={() => setCropping(null)} />
        </Suspense>
      )}
    </Sheet>
  );
}
