import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCardQr } from '../../cards/useCardQr';
import { useDataQuery, type DataStore, type Reader } from '../../data';
import { useHashQuery } from '../../router';
import { fmt, strings } from '../../strings';
import { paginate } from '../helpers';
import type { TabProps } from './types';
import './cards-print.css';

const t = strings.grownups.cards;

/** 2 x 5 cards of 85.6 x 54 mm fill an A4 page (see cards-print.css). */
const CARDS_PER_PAGE = 10;

/**
 * Grown-ups > Cards: pick readers, check the preview, print. The printable
 * pages are rendered into document.body (outside the app), and the print
 * stylesheet hides everything else.
 */
export function CardsTab({ household }: TabProps) {
  const only = useHashQuery().get('reader');
  const query = useCallback((s: DataStore) => s.listReaders(household.id), [household.id]);
  const { data: readers } = useDataQuery(query, ['readers']);
  // null = everyone (the default); otherwise the ids picked.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(() => (only ? new Set([only]) : null));

  const all = readers ?? [];
  const chosen = all.filter((r) => picked === null || picked.has(r.id));
  const pages = paginate(chosen, CARDS_PER_PAGE);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current ?? all.map((r) => r.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size === all.length ? null : next;
    });

  return (
    <>
      <section className="stack card">
        <h2>{t.heading}</h2>
        <p>{t.intro}</p>
        <p className="alert">
          <span aria-hidden="true">✂️ </span>
          {t.laminate}
        </p>
        {readers && all.length === 0 && <p className="muted">{t.none}</p>}
        {all.length > 0 && (
          <fieldset className="grownups__picker">
            <legend className="field-label">{t.pick}</legend>
            <label className="grownups__check">
              <input type="checkbox" checked={picked === null} onChange={() => setPicked(picked === null ? new Set() : null)} />
              {t.all}
            </label>
            {all.map((r) => (
              <label key={r.id} className="grownups__check">
                <input type="checkbox" checked={picked === null || picked.has(r.id)} onChange={() => toggle(r.id)} />
                <span aria-hidden="true">{r.avatar}</span> {r.display_name}
              </label>
            ))}
          </fieldset>
        )}
        {all.length > 0 && (
          <div className="row">
            <button type="button" className="btn btn--primary" disabled={chosen.length === 0} onClick={() => window.print()}>
              🖨️ {chosen.length === 1 ? t.printOne : fmt(t.print, { count: chosen.length })}
            </button>
            {chosen.length === 0 && <span className="small muted">{t.nothingPicked}</span>}
          </div>
        )}
        {chosen.length > 0 && <p className="small muted">{t.printTip}</p>}
      </section>

      {pages.length > 0 && (
        <section className="stack" aria-label={t.preview}>
          <h2>{t.preview}</h2>
          {pages.map((page, i) => (
            <figure key={i} className="card-preview">
              <figcaption className="small muted">{fmt(t.page, { page: i + 1, pages: pages.length })}</figcaption>
              <ScaledPage>
                <CardPage readers={page} />
              </ScaledPage>
            </figure>
          ))}
        </section>
      )}

      {createPortal(
        <div className="print-root">
          {pages.map((page, i) => (
            <CardPage key={i} readers={page} />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** One A4 sheet of cards, at real size. */
function CardPage({ readers }: { readers: Reader[] }) {
  return (
    <div className="card-sheet">
      {readers.map((reader) => (
        <CardFace key={reader.id} reader={reader} />
      ))}
    </div>
  );
}

function CardFace({ reader }: { reader: Reader }) {
  const qr = useCardQr(reader.card_token);
  return (
    <article className="library-card">
      <div className="library-card__side">
        <p className="library-card__app">📚 {t.appName}</p>
        <p className="library-card__avatar" aria-hidden="true">
          {reader.avatar}
        </p>
        <p className="library-card__name">{reader.display_name}</p>
      </div>
      <div className="library-card__qr">{qr && <img src={qr} alt={fmt(t.qrAlt, { name: reader.display_name })} />}</div>
    </article>
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
