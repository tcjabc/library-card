import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { href } from '../router';
import { bookRenders } from '../staircase/bookRenders';
import type { CentreBook, CentreTag } from '../staircase/CanvasStack';
import { generateFakeStack } from '../staircase/stackModel';
import { MAX_TWIST_DEG, TWIST_DEG } from '../staircase/stackProjection';
import { fmt, strings } from '../strings';
import { FRAME_MS, drawStats, framesPerSecond, missedFrames, rendersPerSecond, type DrawSample, type Frame } from './frameStats';
import './StackDevPage.css';

/**
 * #/dev/stack — the Family Staircase as a 3D pile of pretend books (stage 1 prototype), with a
 * small panel measuring how smoothly it scrolls. Behind the same gate as the other developer
 * tools. Pretend data only: nothing is read from or written to storage.
 */

const BookStack = lazy(() => import('../staircase/BookStack'));
const CanvasStack = lazy(() => import('../staircase/CanvasStack'));

/** Canvas = the fan of books drawn on one canvas (stage 2a); 3D and Lite = the old stage 1 modes. */
type StackMode = 'canvas' | '3d' | 'lite';
const MODES: readonly StackMode[] = ['canvas', '3d', 'lite'];
/** The twist slider's step (degrees). */
const TWIST_STEP = 0.5;

function describeCentre({ title, avatar, degrees }: CentreBook): CentreTag {
  return { book: fmt(t.stackCentreBook, { avatar, title }), turned: fmt(t.stackCentreTurned, { degrees }) };
}

const t = strings.dev;
const COUNTS = [100, 1000, 3000] as const;
const SEED = 'dev-book-stack';
/** A scroll counts as going on this long after its last scroll event (ms). */
const SCROLL_IDLE_MS = 150;
/** FPS is over the last this many ms of scrolling. */
const FPS_WINDOW_MS = 2000;
const READOUT_EVERY_MS = 500;

export default function StackDevPage() {
  const [count, setCount] = useState<number>(1000);
  const [mode, setMode] = useState<StackMode>('canvas');
  const [twist, setTwist] = useState<number>(TWIST_DEG);
  const [settle, setSettle] = useState(true);
  const entries = useMemo(() => generateFakeStack(count, SEED), [count]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const meter = useScrollMeter(scroller);
  const { reset } = meter;
  const onScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
  }, []);

  // A new pile starts its counts afresh.
  useEffect(() => reset(), [count, mode, twist, settle, reset]);
  const label = fmt(t.stackLabel, { count: count.toLocaleString() });

  return (
    <main className="stack-dev">
      <header className="stack-dev__header">
        <a href={href('/dev')} className="btn btn--small back-link">
          <span aria-hidden="true">←</span> {t.stackBack}
        </a>
        <h1 className="stack-dev__title">{t.stackTitle}</h1>
      </header>
      <Suspense fallback={<p className="muted stack-dev__loading">{strings.common.loading}</p>}>
        {mode === 'canvas' ? (
          <CanvasStack
            key={count}
            entries={entries}
            seed={SEED}
            twist={twist}
            settle={settle}
            inset
            describeCentre={describeCentre}
            label={label}
            onScroller={onScroller}
            onScroll={meter.onScroll}
            onDraw={meter.onDraw}
          />
        ) : (
          <BookStack
            key={`${count}-${mode}`}
            entries={entries}
            seed={SEED}
            lite={mode === 'lite'}
            label={label}
            onScroller={onScroller}
            onScroll={meter.onScroll}
          />
        )}
      </Suspense>
      <MeasurePanel
        count={count}
        mode={mode}
        twist={twist}
        settle={settle}
        onCount={setCount}
        onMode={setMode}
        onTwist={setTwist}
        onSettle={setSettle}
        readout={meter.readout}
        onReset={reset}
      />
    </main>
  );
}

interface Readout {
  /** FPS over the last 2 s of scrolling (the latest measured), or null before any scrolling. */
  fps: number | null;
  /** Book renders per second over the same frames, or null before any scrolling. */
  renders: number | null;
  /** Canvas only: draw time per frame (ms) over the same 2 s, or null before any drawing while scrolling. */
  draw: { average: number; max: number } | null;
  dropped: number;
  /** null where the browser can't report long tasks. */
  longTasks: number | null;
  longTaskMs: number;
  nodes: number;
  viewport: string;
  dpr: number;
}

function supportsLongTasks(): boolean {
  return typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask');
}

function emptyReadout(): Readout {
  return { fps: null, renders: null, draw: null, dropped: 0, longTasks: supportsLongTasks() ? 0 : null, longTaskMs: 0, nodes: 0, viewport: '', dpr: 1 };
}

/** Times every frame while the pile is scrolling, counts late frames and long tasks. */
function useScrollMeter(scroller: RefObject<HTMLDivElement | null>) {
  const live = useRef({
    frames: [] as Frame[],
    /** Canvas draws while scrolling. */
    draws: [] as DrawSample[],
    last: 0,
    /** bookRenders() at the last frame. */
    lastRenders: 0,
    scrollingUntil: 0,
    dropped: 0,
    longTasks: 0,
    longTaskMs: 0,
    lastFps: null as number | null,
    lastRendersPerSec: null as number | null,
    lastDraw: null as { average: number; max: number } | null,
  });
  const [readout, setReadout] = useState<Readout>(emptyReadout);

  useEffect(() => {
    const s = live.current;
    const longTasks = supportsLongTasks();
    let raf = 0;
    s.lastRenders = bookRenders();
    const tick = (now: number) => {
      const renders = bookRenders();
      if (s.last > 0 && now <= s.scrollingUntil + FRAME_MS) {
        const dt = now - s.last;
        s.frames.push({ at: now, dt, renders: renders - s.lastRenders });
        s.dropped += missedFrames(dt);
      }
      s.last = now;
      s.lastRenders = renders;
      while (s.frames.length > 0 && s.frames[0].at <= now - FPS_WINDOW_MS) s.frames.shift();
      while (s.draws.length > 0 && s.draws[0].at <= now - FPS_WINDOW_MS) s.draws.shift();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    let observer: PerformanceObserver | undefined;
    if (longTasks) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          s.longTasks += 1;
          s.longTaskMs += entry.duration;
        }
      });
      observer.observe({ type: 'longtask' });
    }

    const timer = window.setInterval(() => {
      const now = performance.now();
      const fps = framesPerSecond(s.frames, now, FPS_WINDOW_MS);
      if (fps !== null) s.lastFps = fps;
      const renders = rendersPerSecond(s.frames, now, FPS_WINDOW_MS);
      if (renders !== null) s.lastRendersPerSec = renders;
      const draw = drawStats(s.draws, now, FPS_WINDOW_MS);
      if (draw !== null) s.lastDraw = draw;
      setReadout({
        fps: s.lastFps,
        renders: s.lastRendersPerSec,
        draw: s.lastDraw,
        dropped: s.dropped,
        longTasks: longTasks ? s.longTasks : null,
        longTaskMs: Math.round(s.longTaskMs),
        nodes: scroller.current?.getElementsByTagName('*').length ?? 0,
        viewport: `${window.innerWidth} × ${window.innerHeight}`,
        dpr: window.devicePixelRatio,
      });
    }, READOUT_EVERY_MS);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      observer?.disconnect();
    };
  }, [scroller]);

  const onScroll = useCallback(() => {
    live.current.scrollingUntil = performance.now() + SCROLL_IDLE_MS;
  }, []);

  /** A canvas draw: counted only while the pile is scrolling, like the frames. */
  const onDraw = useCallback((ms: number) => {
    const s = live.current;
    const now = performance.now();
    if (now <= s.scrollingUntil + FRAME_MS) s.draws.push({ at: now, ms });
  }, []);

  const reset = useCallback(() => {
    const s = live.current;
    s.frames = [];
    s.draws = [];
    s.lastDraw = null;
    s.dropped = 0;
    s.longTasks = 0;
    s.longTaskMs = 0;
    s.lastFps = null;
    s.lastRendersPerSec = null;
  }, []);

  return { readout, onScroll, onDraw, reset };
}

function modeName(mode: StackMode): string {
  if (mode === 'canvas') return t.measureModeCanvas;
  return mode === 'lite' ? t.measureModeLite : t.measureMode3d;
}

function readoutLines(readout: Readout, count: number, mode: StackMode, twist: number, settle: boolean): [string, string][] {
  const canvas = mode === 'canvas';
  const draw =
    mode !== 'canvas'
      ? t.measureDrawCanvasOnly
      : readout.draw === null
        ? t.measureFpsNone
        : fmt(t.measureDrawValue, { average: readout.draw.average.toFixed(2), max: readout.draw.max.toFixed(2) });
  return [
    [t.measureBooks, count.toLocaleString()],
    [t.measureMode, modeName(mode)],
    [t.measureTwist, canvas ? fmt(t.measureDegrees, { degrees: twist }) : t.measureDrawCanvasOnly],
    [t.measureSettle, canvas ? (settle ? t.measureOn : t.measureOff) : t.measureDrawCanvasOnly],
    [t.measureFps, readout.fps === null ? t.measureFpsNone : readout.fps.toFixed(1)],
    [t.measureRenders, readout.renders === null ? t.measureFpsNone : readout.renders.toFixed(1)],
    [t.measureDraw, draw],
    [t.measureDropped, readout.dropped.toLocaleString()],
    [
      t.measureLongTasks,
      readout.longTasks === null ? t.measureUnsupported : fmt(t.measureLongTasksValue, { count: readout.longTasks, ms: readout.longTaskMs }),
    ],
    [t.measureNodes, readout.nodes.toLocaleString()],
    [t.measureDpr, String(readout.dpr)],
    [t.measureViewport, readout.viewport],
    [t.measureAgent, navigator.userAgent],
  ];
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'stack-dev__copy-area';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

interface MeasurePanelProps {
  count: number;
  mode: StackMode;
  twist: number;
  settle: boolean;
  onCount: (count: number) => void;
  onMode: (mode: StackMode) => void;
  onTwist: (twist: number) => void;
  onSettle: (settle: boolean) => void;
  readout: Readout;
  onReset: () => void;
}

/** Small and collapsible, over the pile: the controls, the live numbers and "Copy results". */
function MeasurePanel({ count, mode, twist, settle, onCount, onMode, onTwist, onSettle, readout, onReset }: MeasurePanelProps) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const lines = readoutLines(readout, count, mode, twist, settle);

  const copy = async () => {
    const text = [t.stackTitle, ...lines.map(([label, value]) => `${label}: ${value}`)].join('\n');
    setCopied(await copyText(text));
  };

  return (
    <details className="stack-dev__panel">
      <summary className="stack-dev__summary">
        {readout.fps === null ? t.measureHeading : fmt(t.measureSummary, { fps: readout.fps.toFixed(1), dropped: readout.dropped })}
      </summary>
      <div className="stack-dev__controls">
        <div className="chip-row" role="group" aria-label={t.measureBooks}>
          {COUNTS.map((n) => (
            <button key={n} type="button" className="chip" aria-pressed={count === n} onClick={() => onCount(n)}>
              {n.toLocaleString()}
            </button>
          ))}
        </div>
      </div>
      <div className="stack-dev__controls">
        <div className="chip-row" role="group" aria-label={t.measureMode}>
          {MODES.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={mode === m} onClick={() => onMode(m)}>
              {modeName(m)}
            </button>
          ))}
        </div>
      </div>
      {mode === 'canvas' && (
        <div className="stack-dev__controls">
          <label className="stack-dev__slider">
            <span>{fmt(t.measureTwistValue, { degrees: twist })}</span>
            <input
              type="range"
              min={0}
              max={MAX_TWIST_DEG}
              step={TWIST_STEP}
              value={twist}
              onChange={(e) => onTwist(Number(e.target.value))}
            />
          </label>
          <button type="button" className="chip" aria-pressed={settle} onClick={() => onSettle(!settle)}>
            {t.measureSettle}
          </button>
        </div>
      )}
      <dl className="stack-dev__readout">
        {lines.map(([label, value]) => (
          <div key={label} className="stack-dev__line">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="stack-dev__controls">
        <button type="button" className="btn btn--small" onClick={() => void copy()}>
          {t.measureCopy}
        </button>
        <button type="button" className="btn btn--small btn--quiet" onClick={onReset}>
          {t.measureReset}
        </button>
      </div>
      <p className="small muted" role="status">
        {copied === true ? t.measureCopied : copied === false ? t.measureCopyFailed : ''}
      </p>
    </details>
  );
}
