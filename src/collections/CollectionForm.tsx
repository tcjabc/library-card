import { lazy, Suspense, useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { normaliseIsbn } from '../books/isbn';
import type { CropResult } from '../books/crop/CropScreen';
import { collectionIdForIsbn, isDataStoreError, MAX_EXPECTED_COUNT, type Collection, type DataStore, type Household } from '../data';
import { BookScanner } from '../scan/BookScanner';
import { fmt, strings } from '../strings';
import { BookCover } from '../ui/BookCover';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';

const CropScreen = lazy(() => import('../books/crop/CropScreen'));

const t = strings.collections;

interface CollectionFormProps {
  store: DataStore;
  household: Household;
  /** The set to edit, or null for a new one. */
  collection: Collection | null;
  /** A new set's starting values (e.g. from a scanned box). */
  initial?: { title?: string; isbn?: string | null; cover_url?: string | null };
  onSaved: (collection: Collection) => void;
  /** A box ISBN that already has a set: open that one instead. */
  onOpenExisting?: (id: string) => void;
  onClose: () => void;
}

/**
 * New collection / Edit details (Grown-ups → Books): title, an optional box ISBN (typed or
 * scanned), an optional cover (a photo through the crop screen, or the catalogue's), and an
 * optional number of books (none: a series with progress but no trophy).
 */
export function CollectionForm({ store, household, collection, initial, onSaved, onOpenExisting, onClose }: CollectionFormProps) {
  const toast = useToast();
  const [title, setTitle] = useState(collection?.title ?? initial?.title ?? '');
  const [isbn, setIsbn] = useState(collection?.isbn ?? initial?.isbn ?? '');
  const [expected, setExpected] = useState(collection?.expected_count ? String(collection.expected_count) : '');
  const [photo, setPhoto] = useState<(CropResult & { url: string }) | null>(null);
  const [cropping, setCropping] = useState<Blob | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<{ text: string; existing?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { title: useId(), isbn: useId(), expected: useId(), photo: useId() };
  const coverUrl = photo?.url ?? collection?.cover_url ?? initial?.cover_url ?? null;

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  const onPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setCropping(file);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const cleanTitle = title.trim();
    if (!cleanTitle) return setError({ text: t.titleRequired });
    const box = isbn.trim() ? normaliseIsbn(isbn) : null;
    if (isbn.trim() && !box) return setError({ text: t.isbnInvalid });
    const count = expected.trim() ? Number(expected) : null;
    if (count !== null && (!Number.isInteger(count) || count < 1 || count > MAX_EXPECTED_COUNT)) return setError({ text: t.expectedInvalid });
    setBusy(true);
    try {
      const cover = photo ? await store.saveCoverImage(photo.blob) : coverUrl;
      const fields = { title: cleanTitle, isbn: box, expected_count: count, cover_url: cover };
      const saved = collection ? await store.updateCollection(collection.id, fields) : await store.createCollection({ household_id: household.id, ...fields });
      toast({ message: fmt(collection ? t.saved : t.created, { title: saved.title }) });
      onSaved(saved);
    } catch (err) {
      if (isDataStoreError(err, 'conflict') && box) setError({ text: t.conflict, existing: collectionIdForIsbn(box) });
      else {
        console.error('[collections] save failed', err);
        setError({ text: t.failed });
      }
      setBusy(false);
    }
  };

  return (
    <Sheet title={collection ? fmt(t.editTitle, { title: collection.title }) : t.newTitle} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)} noValidate>
        <label htmlFor={ids.title} className="field-label">
          {t.titleLabel}
        </label>
        <input id={ids.title} className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" maxLength={200} />

        <div className="book-sheet__photo">
          <div className="book-sheet__preview">
            <BookCover title={title.trim() || t.newTitle} coverUrl={coverUrl} seed={collection?.id ?? 'new'} fit="whole" />
          </div>
          <div className="stack">
            <p className="field-label">{t.cover}</p>
            <label htmlFor={ids.photo} className="btn">
              📷 {coverUrl ? strings.bookSheet.changePhoto : strings.bookSheet.addPhoto}
            </label>
            <input id={ids.photo} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={onPhoto} disabled={busy} />
          </div>
        </div>

        <label htmlFor={ids.isbn} className="field-label">
          {t.boxIsbn}
        </label>
        <div className="row">
          <input
            id={ids.isbn}
            className="input"
            inputMode="numeric"
            autoComplete="off"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            placeholder={strings.grownups.books.manualPlaceholder}
            aria-describedby={`${ids.isbn}-help`}
          />
          <button type="button" className="btn" onClick={() => setScanning((v) => !v)}>
            {scanning ? t.stopScan : `📷 ${t.scanBox}`}
          </button>
        </div>
        <p id={`${ids.isbn}-help`} className="small muted">
          {t.boxIsbnHelp}
        </p>
        {scanning && (
          <BookScanner
            mode="book"
            onIsbn={(value) => {
              setIsbn(value);
              setScanning(false);
            }}
          />
        )}

        <label htmlFor={ids.expected} className="field-label">
          {t.expected}
        </label>
        <input
          id={ids.expected}
          className="input input--short"
          inputMode="numeric"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          aria-describedby={`${ids.expected}-help`}
        />
        <p id={`${ids.expected}-help`} className="small muted">
          {t.expectedHelp}
        </p>

        {error && (
          <div className="alert alert--danger stack" role="alert">
            <p>{error.text}</p>
            {error.existing && onOpenExisting && (
              <div className="row">
                <button type="button" className="btn btn--small" onClick={() => onOpenExisting(error.existing!)}>
                  {t.openExisting}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? strings.common.saving : collection ? t.save : t.create}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
        </div>
      </form>
      {cropping && (
        <Suspense fallback={null}>
          <CropScreen
            source={cropping}
            onDone={(result) => {
              setCropping(null);
              setPhoto({ ...result, url: URL.createObjectURL(result.blob) });
            }}
            onCancel={() => setCropping(null)}
          />
        </Suspense>
      )}
    </Sheet>
  );
}
