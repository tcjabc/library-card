import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { libraryCardTitle, makeStripSvg } from '../../cards/makeStrip';
import { STRIPS_PER_PAGE } from '../../cards/stripLayout';
import { CARD_TEMPLATES, DEFAULT_TEMPLATE, isCardTemplate, type CardTemplate } from '../../cards/templates';
import { useDataQuery, type DataStore, type Library, type LibraryCard, type Reader } from '../../data';
import { fileNamePart, saveBlob } from '../../lib/download';
import { useHashQuery } from '../../router';
import { fmt, strings } from '../../strings';
import { useToast } from '../../ui/Toast';
import { LibraryCardsSection } from '../cards/LibraryCardsSection';
import { paginate } from '../helpers';
import type { TabProps } from './types';
import './cards-print.css';

const t = strings.grownups.cards;

/** Remembered on this device only: the last design picked. */
const TEMPLATE_KEY = 'library-card:card-template';
const NO_BARCODE = 'none';
/** Stands in for each strip's id prefix, so one drawing serves the preview and the print copy. */
const ID_SLOT = '__strip__';

function loadTemplate(): CardTemplate {
  try {
    const saved = window.localStorage.getItem(TEMPLATE_KEY);
    return isCardTemplate(saved) ? saved : DEFAULT_TEMPLATE;
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

function saveTemplate(template: CardTemplate): void {
  try {
    window.localStorage.setItem(TEMPLATE_KEY, template);
  } catch {
    // Remembering is a convenience only.
  }
}

interface Entry {
  reader: Reader;
  card: LibraryCard | null;
}

/**
 * Grown-ups > Cards: each reader's library card barcodes, then the fold-over cards to print (or
 * download). The printable pages are rendered into document.body (outside the app), and the
 * print stylesheet hides everything else.
 */
export function CardsTab({ store, household }: TabProps) {
  const toast = useToast();
  const only = useHashQuery().get('reader');
  const query = useCallback(
    async (s: DataStore) => {
      const [readers, libraries, cards] = await Promise.all([
        s.listReaders(household.id),
        s.listLibraries(household.id),
        s.listHouseholdLibraryCards(household.id),
      ]);
      return { readers, libraries, cards };
    },
    [household.id],
  );
  const { data } = useDataQuery(query, ['readers', 'libraries', 'library_cards']);
  const readers = useMemo(() => data?.readers ?? [], [data]);
  const libraries = useMemo(() => data?.libraries ?? [], [data]);
  const cards = useMemo(() => data?.cards ?? [], [data]);

  // null = everyone (the default); otherwise the ids picked.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(() => (only ? new Set([only]) : null));
  const [template, setTemplate] = useState<CardTemplate>(loadTemplate);
  /** The back chosen per reader: a card id or NO_BARCODE. Unset: their newest card. */
  const [backChoice, setBackChoice] = useState<ReadonlyMap<string, string>>(() => new Map());

  const chosen = readers.filter((r) => picked === null || picked.has(r.id));
  const entries: Entry[] = chosen.map((reader) => {
    const theirs = cards.filter((c) => c.reader_id === reader.id);
    const choice = backChoice.get(reader.id);
    const card = choice === NO_BARCODE ? null : (theirs.find((c) => c.id === choice) ?? theirs[0] ?? null);
    return { reader, card };
  });
  const pages = paginate(entries, STRIPS_PER_PAGE);
  const strips = useStrips(entries, libraries, template);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current ?? readers.map((r) => r.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size === readers.length ? null : next;
    });

  const pickTemplate = (value: CardTemplate) => {
    setTemplate(value);
    saveTemplate(value);
  };

  const download = async (entry: Entry, kind: 'svg' | 'png') => {
    try {
      const svg = await makeStripSvg({ reader: entry.reader, card: entry.card, libraries, template });
      const { stripPngBlob, stripSvgBlob } = await import('../../cards/exportStrip');
      const blob = kind === 'svg' ? stripSvgBlob(svg) : await stripPngBlob(svg);
      const file = `library-card-${fileNamePart(entry.reader.display_name)}.${kind}`;
      saveBlob(blob, file);
      toast({ message: fmt(t.downloaded, { file }) });
    } catch (error) {
      console.error('[cards] download failed', error);
      toast({ message: t.downloadFailed });
    }
  };

  return (
    <>
      <LibraryCardsSection store={store} household={household} readers={readers} libraries={libraries} cards={cards} />

      <section className="stack card">
        <h2>{t.heading}</h2>
        <p>{t.intro}</p>
        <p className="alert">
          <span aria-hidden="true">✂️ </span>
          {t.laminate}
        </p>
        {data && readers.length === 0 && <p className="muted">{t.none}</p>}

        {readers.length > 0 && (
          <>
            <div className="stack">
              <p className="field-label" id="card-design-label">
                {t.design}
              </p>
              <div className="chip-row chip-row--dense" role="group" aria-labelledby="card-design-label">
                {CARD_TEMPLATES.map((value) => (
                  <button key={value} type="button" className="chip" aria-pressed={template === value} onClick={() => pickTemplate(value)}>
                    {t.templates[value]}
                  </button>
                ))}
              </div>
              <p className="small muted">{t.designHelp}</p>
            </div>

            <fieldset className="grownups__picker">
              <legend className="field-label">{t.pick}</legend>
              <label className="grownups__check">
                <input type="checkbox" checked={picked === null} onChange={() => setPicked(picked === null ? new Set() : null)} />
                {t.all}
              </label>
              {readers.map((r) => (
                <label key={r.id} className="grownups__check">
                  <input type="checkbox" checked={picked === null || picked.has(r.id)} onChange={() => toggle(r.id)} />
                  <span aria-hidden="true">{r.avatar}</span> {r.display_name}
                </label>
              ))}
            </fieldset>

            {entries
              .filter(({ reader }) => cards.filter((c) => c.reader_id === reader.id).length > 1)
              .map(({ reader, card }) => (
                <BackPicker
                  key={reader.id}
                  reader={reader}
                  cards={cards.filter((c) => c.reader_id === reader.id)}
                  libraries={libraries}
                  value={card?.id ?? NO_BARCODE}
                  onChange={(value) => setBackChoice((current) => new Map(current).set(reader.id, value))}
                />
              ))}

            <div className="row">
              <button type="button" className="btn btn--primary" disabled={entries.length === 0} onClick={() => window.print()}>
                🖨️ {entries.length === 1 ? t.printOne : fmt(t.print, { count: entries.length })}
              </button>
              {entries.length === 0 && <span className="small muted">{t.nothingPicked}</span>}
            </div>
            {entries.length > 0 && (
              <>
                <p className="small muted">{t.printTip}</p>
                <p className="small muted">{t.pdfHint}</p>
              </>
            )}
          </>
        )}
      </section>

      {entries.length > 0 && (
        <section className="stack card">
          <h2>{t.filesHeading}</h2>
          <p>{t.filesIntro}</p>
          <p className="alert">
            <span aria-hidden="true">🔒 </span>
            {t.filesPrivacy}
          </p>
          <ul className="dev-list">
            {entries.map((entry) => (
              <li key={entry.reader.id} className="dev-list__row">
                <p>
                  <span aria-hidden="true">{entry.reader.avatar}</span> {entry.reader.display_name}
                </p>
                <div className="row">
                  <button type="button" className="btn btn--small" onClick={() => void download(entry, 'svg')}>
                    ⬇️ {t.downloadSvg}
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => void download(entry, 'png')}>
                    ⬇️ {t.downloadPng}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pages.length > 0 && (
        <section className="stack" aria-label={t.preview}>
          <h2>{t.preview}</h2>
          {strips.status === 'drawing' && <p className="muted">{t.drawing}</p>}
          {strips.status === 'failed' && <p className="alert alert--danger">{t.drawFailed}</p>}
          {strips.status === 'ready' &&
            pages.map((page, i) => (
              <figure key={i} className="card-preview">
                <figcaption className="small muted">{fmt(t.page, { page: i + 1, pages: pages.length })}</figcaption>
                <ScaledPage>
                  <StripPage entries={page} strips={strips.svgs} prefix={`p${i}`} />
                </ScaledPage>
              </figure>
            ))}
        </section>
      )}

      {createPortal(
        <div className="print-root">
          {strips.status === 'ready' && pages.map((page, i) => <StripPage key={i} entries={page} strips={strips.svgs} prefix={`x${i}`} />)}
        </div>,
        document.body,
      )}
    </>
  );
}

function BackPicker({
  reader,
  cards,
  libraries,
  value,
  onChange,
}: {
  reader: Reader;
  cards: readonly LibraryCard[];
  libraries: readonly Library[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `card-back-${reader.id}`;
  return (
    <div className="stack">
      <label htmlFor={id} className="field-label">
        {fmt(t.backFor, { name: reader.display_name })}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {cards.map((card) => (
          <option key={card.id} value={card.id}>
            {(libraryCardTitle(card, libraries) ?? strings.grownups.libraryCards.untitled) + ` · ${card.value}`}
          </option>
        ))}
        <option value={NO_BARCODE}>{t.noBarcode}</option>
      </select>
    </div>
  );
}

type Strips = { status: 'drawing' } | { status: 'failed' } | { status: 'ready'; svgs: ReadonlyMap<string, string> };

/** Draws every chosen reader's strip (async: QR codes, barcodes, avatars), redrawn when anything shown changes. */
function useStrips(entries: readonly Entry[], libraries: readonly Library[], template: CardTemplate): Strips {
  // Everything that shows on a strip, so an unrelated change doesn't redraw.
  const key = JSON.stringify([
    template,
    entries.map(({ reader, card }) => [
      reader.id,
      reader.avatar,
      reader.card_token,
      card && [card.id, card.value, card.format, libraryCardTitle(card, libraries)],
    ]),
  ]);
  const latest = useRef({ entries, libraries, template });
  useLayoutEffect(() => {
    latest.current = { entries, libraries, template };
  });
  const [result, setResult] = useState<{ key: string; strips: Strips } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { entries: list, libraries: libs, template: design } = latest.current;
    Promise.all(list.map(({ reader, card }) => makeStripSvg({ reader, card, libraries: libs, template: design, idPrefix: ID_SLOT })))
      .then((svgs) => {
        if (!cancelled) setResult({ key, strips: { status: 'ready', svgs: new Map(list.map(({ reader }, i) => [reader.id, svgs[i]])) } });
      })
      .catch((error: unknown) => {
        console.error('[cards] drawing failed', error);
        if (!cancelled) setResult({ key, strips: { status: 'failed' } });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return result?.key === key ? result.strips : { status: 'drawing' };
}

/** One A4 sheet of fold-over cards, at real size. */
function StripPage({ entries, strips, prefix }: { entries: readonly Entry[]; strips: ReadonlyMap<string, string>; prefix: string }) {
  return (
    <div className="strip-sheet">
      <span className="strip-sheet__fold-label strip-sheet__fold-label--top" aria-hidden="true">
        {t.fold}
      </span>
      {entries.map(({ reader }, i) => (
        <div
          key={reader.id}
          className="strip-sheet__strip"
          role="img"
          aria-label={fmt(t.cardAlt, { name: reader.display_name })}
          // Our own drawing (every text in it is XML-escaped); ids made unique per strip.
          dangerouslySetInnerHTML={{ __html: (strips.get(reader.id) ?? '').replaceAll(ID_SLOT, `${prefix}s${i}`) }}
        />
      ))}
      <span className="strip-sheet__fold-label strip-sheet__fold-label--bottom" aria-hidden="true">
        {t.fold}
      </span>
    </div>
  );
}

/** Shows a real-size A4 page shrunk to the width available (screen preview only). */
function ScaledPage({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const box = outer.current;
    const page = inner.current;
    if (!box || !page) return;
    const measure = () => {
      const s = Math.min(1, box.clientWidth / page.offsetWidth);
      setScale(s);
      setHeight(page.offsetHeight * s);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outer} className="card-preview__frame" style={{ height }}>
      <div ref={inner} className="card-preview__page" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
