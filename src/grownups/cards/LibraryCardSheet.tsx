import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { drawBarcodeCanvas } from '../../cards/barcodeDraw';
import { barcodeWidth } from '../../cards/stripLayout';
import {
  LIBRARY_CARD_FORMATS,
  checkLibraryCardBarcode,
  cleanLibraryCardLabel,
  sameLibraryCardValue,
  type DataStore,
  type Household,
  type Library,
  type LibraryCard,
  type LibraryCardFormat,
  type Reader,
} from '../../data';
import { BookScanner } from '../../scan/BookScanner';
import type { ScanFormat } from '../../scan/Scanner';
import { detectInPhoto, detectStill } from '../../scan/stillImage';
import { fmt, strings } from '../../strings';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

const t = strings.grownups.libraryCards;
const FORMATS = LIBRARY_CARD_FORMATS as readonly ScanFormat[];
const isIsbn = (value: string, format: string) => format === 'ean_13' && /^97[89]/.test(value);

/** A redrawn barcode, for the number and type in `key`. */
type Drawn = { key: string } & ({ status: 'ok'; url: string; canvas: HTMLCanvasElement; thin: boolean } | { status: 'failed' });
/** A "Test it" result, for the number and type in `key`. */
type Test = { key: string } & ({ status: 'testing' } | { status: 'pass' } | { status: 'fail'; value: string | null });

interface LibraryCardSheetProps {
  store: DataStore;
  household: Household;
  reader: Reader;
  libraries: readonly Library[];
  /** null: add a new one. */
  card: LibraryCard | null;
  onClose: () => void;
}

/** Add or edit a reader's library card barcode: scan it, read it from a photo, or type it. */
export function LibraryCardSheet({ store, household, reader, libraries, card, onClose }: LibraryCardSheetProps) {
  const toast = useToast();
  const [value, setValue] = useState(card?.value ?? '');
  const [format, setFormat] = useState<LibraryCardFormat>(card?.format ?? 'code_128');
  const [libraryId, setLibraryId] = useState(card ? (card.library_id ?? '') : libraries.length === 1 ? libraries[0].id : '');
  const [label, setLabel] = useState(card?.label ?? '');
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawnState, setDrawn] = useState<Drawn | null>(null);
  const [testState, setTest] = useState<Test | null>(null);
  const ids = { value: useId(), format: useId(), library: useId(), label: useId(), photo: useId() };

  const check = checkLibraryCardBarcode(value, format);
  const problem = value.trim() && !check.ok ? t.problems[check.problem] : null;
  /** What is drawn and tested: the tidied number and its type (null while the number isn't valid). */
  const drawKey = check.ok ? `${format}:${check.value}` : null;
  const drawn = drawnState && drawnState.key === drawKey ? drawnState : null;
  const test = testState && testState.key === drawKey ? testState : null;

  // Redraw the barcode whenever the number or type changes (JsBarcode loads on first use).
  useEffect(() => {
    if (drawKey === null) return;
    let cancelled = false;
    const split = drawKey.indexOf(':');
    const drawFormat = drawKey.slice(0, split) as LibraryCardFormat;
    const css = getComputedStyle(document.documentElement);
    const colours = {
      dark: css.getPropertyValue('--color-qr-dark').trim() || '#000000',
      light: css.getPropertyValue('--color-qr-light').trim() || '#ffffff',
    };
    drawBarcodeCanvas(drawKey.slice(split + 1), drawFormat, colours).then(
      (canvas) => {
        if (cancelled) return;
        // The canvas draws 3 px per module, quiet zones included.
        const thin = barcodeWidth(canvas.width / 3).tooNarrow;
        setDrawn({ key: drawKey, status: 'ok', url: canvas.toDataURL('image/png'), canvas, thin });
      },
      () => !cancelled && setDrawn({ key: drawKey, status: 'failed' }),
    );
    return () => {
      cancelled = true;
    };
  }, [drawKey]);

  const applyFound = (found: string, foundFormat: ScanFormat) => {
    if (!(FORMATS as readonly string[]).includes(foundFormat)) return;
    setValue(found);
    setFormat(foundFormat as LibraryCardFormat);
    setNotice(fmt(t.found, { format: t.formats[foundFormat as LibraryCardFormat] }));
    setError(null);
  };

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setScanning(false);
    setNotice(null);
    setError(null);
    setReading(true);
    try {
      // The original file, never a shrunk copy; nothing from it is stored.
      const codes = await detectInPhoto(file, FORMATS);
      const usable = codes.find((c) => !isIsbn(c.rawValue, c.format));
      if (usable) applyFound(usable.rawValue.trim(), usable.format as ScanFormat);
      else setError(codes.length ? t.photoIsbn : t.photoNone);
    } catch (err) {
      console.error('[library cards] photo', err);
      setError(t.photoError);
    } finally {
      setReading(false);
    }
  };

  const runTest = async () => {
    if (drawn?.status !== 'ok' || !check.ok || drawKey === null) return;
    const key = drawKey;
    setTest({ key, status: 'testing' });
    try {
      const codes = await detectStill(drawn.canvas, [format]);
      const first = codes[0]?.rawValue ?? null;
      setTest(first !== null && sameLibraryCardValue(format, first, check.value) ? { key, status: 'pass' } : { key, status: 'fail', value: first });
    } catch (err) {
      console.error('[library cards] test', err);
      setTest({ key, status: 'fail', value: null });
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!check.ok) return setError(t.problems[check.problem]);
    const cleanLabel = cleanLibraryCardLabel(label);
    if (cleanLabel === 'too_long') return setError(t.labelTooLong);
    setBusy(true);
    try {
      const fields = { value: check.value, format, library_id: libraryId || null, label: cleanLabel };
      if (card) await store.updateLibraryCard(card.id, fields);
      else await store.addLibraryCard({ household_id: household.id, reader_id: reader.id, ...fields });
      toast({ message: t.saved });
      onClose();
    } catch (err) {
      console.error('[library cards] save', err);
      setError(t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={card ? t.editTitle : t.addTitle} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)} noValidate>
        <p className="muted">{fmt(t.forReader, { name: reader.display_name })}</p>

        <div className="row">
          <button type="button" className="btn" onClick={() => setScanning((v) => !v)} disabled={reading}>
            📷 {scanning ? t.stopScan : t.scan}
          </button>
          {/* No capture attribute: the grown-up can take a photo or pick one from the gallery. */}
          <label htmlFor={ids.photo} className="btn">
            🖼️ {t.usePhoto}
          </label>
          <input id={ids.photo} className="visually-hidden" type="file" accept="image/*" onChange={(e) => void onPhoto(e)} disabled={reading} />
        </div>
        <p className="small muted">{t.photoHelp}</p>
        {scanning && (
          <BookScanner
            mode="sticker"
            hint={t.scanHint}
            onSticker={(found, foundFormat) => {
              setScanning(false);
              applyFound(found, foundFormat);
            }}
          />
        )}
        {reading && <p className="muted" role="status">{t.reading}</p>}
        {notice && (
          <p className="alert" role="status">
            {notice}
          </p>
        )}

        <label htmlFor={ids.value} className="field-label">
          {t.value}
        </label>
        <input
          id={ids.value}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          aria-describedby={`${ids.value}-help`}
        />
        <p id={`${ids.value}-help`} className="small muted">
          {t.valueHelp}
        </p>

        <label htmlFor={ids.format} className="field-label">
          {t.format}
        </label>
        <select id={ids.format} className="input" value={format} onChange={(e) => setFormat(e.target.value as LibraryCardFormat)}>
          {LIBRARY_CARD_FORMATS.map((f) => (
            <option key={f} value={f}>
              {t.formats[f]}
            </option>
          ))}
        </select>
        {problem && <p className="small alert alert--danger">{problem}</p>}

        {drawn && (
          <div className="stack library-card-preview">
            <p className="field-label">{t.preview}</p>
            {drawn.status === 'ok' ? (
              <>
                <img className="library-card-preview__bars" src={drawn.url} alt={t.redrawAlt} />
                {drawn.thin && <p className="small alert">{t.thin}</p>}
                <div className="row">
                  <button type="button" className="btn btn--small" onClick={() => void runTest()} disabled={test?.status === 'testing'}>
                    {test?.status === 'testing' ? t.testing : t.test}
                  </button>
                  {test?.status === 'pass' && check.ok && (
                    <span className="small library-card-preview__pass" role="status">
                      ✅ {fmt(t.testPass, { value: check.value })}
                    </span>
                  )}
                  {test?.status === 'fail' && (
                    <span className="small library-card-preview__fail" role="status">
                      ❌ {test.value ? fmt(t.testWrong, { value: test.value }) : t.testFail}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="small alert alert--danger">{fmt(t.cantDraw, { format: t.formats[format] })}</p>
            )}
          </div>
        )}

        <label htmlFor={ids.library} className="field-label">
          {t.library}
        </label>
        <select id={ids.library} className="input" value={libraryId} onChange={(e) => setLibraryId(e.target.value)}>
          <option value="">{t.noLibrary}</option>
          {libraries.map((lib) => (
            <option key={lib.id} value={lib.id}>
              {lib.name}
            </option>
          ))}
        </select>

        <label htmlFor={ids.label} className="field-label">
          {t.label}
        </label>
        <input id={ids.label} className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" maxLength={100} />
        <p className="small muted">{t.labelHelp}</p>

        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy || !check.ok}>
            {strings.bookSheet.save}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {strings.common.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
