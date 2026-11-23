import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { href } from '../router';
import { generateFakeStack } from '../staircase/stackModel';
import { fmt, strings } from '../strings';
import { FRAME_MS, framesPerSecond, missedFrames, type Frame } from './frameStats';
import './StackDevPage.css';

/**
 * #/dev/stack — the Family Staircase as a 3D pile of pretend books (stage 1 prototype), with a
 * small panel measuring how smoothly it scrolls. Behind the same gate as the other developer
 * tools. Pretend data only: nothing is read from or written to storage.
 */

const BookStack = lazy(() => import('../staircase/BookStack'));

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
  const [lite, setLite] = useState(false);
  const entries = useMemo(() => generateFakeStack(count, SEED), [count]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const meter = useScrollMeter(scroller);
  const { reset } = meter;
  const onScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
  }, []);

  // A new pile starts its counts afresh.
  useEffect(() => reset(), [count, lite, reset]);

  return (
    <main className="stack-dev">
      <header className="stack-dev__header">
        <a href={href('/dev')} className="btn btn--small back-link">
          <span aria-hidden="true">←</span> {t.stackBack}
        </a>
        <h1 className="stack-dev__title">{t.stackTitle}</h1>
      </header>
      <Suspense fallback={<p className="muted stack-dev__loading">{strings.common.loading}</p>}>
        <BookStack
          key={`${count}-${lite}`}
          entries={entries}
          seed={SEED}
          lite={lite}
          label={fmt(t.stackLabel, { count: count.toLocaleString() })}
          onScroller={onScroller}
          onScroll={meter.onScroll}
        />
      </Suspense>
      <MeasurePanel count={count} lite={lite} onCount={setCount} onLite={setLite} readout={meter.readout} onReset={reset} />
    </main>
  );
}

interface Readout {
  /** FPS over the last 2 s of scrolling (the latest measured), or null before any scrolling. */
  fps: number | null;
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
  return { fps: null, dropped: 0, longTasks: supportsLongTasks() ? 0 : null, longTaskMs: 0, nodes: 0, viewport: '', dpr: 1 };
}

/** Times every frame while the pile is scrolling, counts late frames and long tasks. */
function useScrollMeter(scroller: RefObject<HTMLDivElement | null>) {
  const live = useRef({
    frames: [] as Frame[],
    last: 0,
    scrollingUntil: 0,
    dropped: 0,
    longTasks: 0,
    longTaskMs: 0,
    lastFps: null as number | null,
  });
  const [readout, setReadout] = useState<Readout>(emptyReadout);

  useEffect(() => {
    const s = live.current;
    const longTasks = supportsLongTasks();
    let raf = 0;
    const tick = (now: number) => {
      if (s.last > 0 && now <= s.scrollingUntil + FRAME_MS) {
        const dt = now - s.last;
        s.frames.push({ at: now, dt });
        s.dropped += missedFrames(dt);
      }
      s.last = now;
      while (s.frames.length > 0 && s.frames[0].at <= now - FPS_WINDOW_MS) s.frames.shift();
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
      const fps = framesPerSecond(s.frames, performance.now(), FPS_WINDOW_MS);
      if (fps !== null) s.lastFps = fps;
      setReadout({
        fps: s.lastFps,
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

  const reset = useCallback(() => {
    const s = live.current;
    s.frames = [];
    s.dropped = 0;
    s.longTasks = 0;
    s.longTaskMs = 0;
    s.lastFps = null;
  }, []);

  return { readout, onScroll, reset };
}

function readoutLines(readout: Readout, count: number, lite: boolean): [string, string][] {
  return [
    [t.measureBooks, count.toLocaleString()],
    [t.measureMode, lite ? t.measureModeLite : t.measureMode3d],
    [t.measureFps, readout.fps === null ? t.measureFpsNone : readout.fps.toFixed(1)],
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
  lite: boolean;
  onCount: (count: number) => void;
  onLite: (lite: boolean) => void;
  readout: Readout;
  onReset: () => void;
}

/** Small and collapsible, over the pile: the controls, the live numbers and "Copy results". */
function MeasurePanel({ count, lite, onCount, onLite, readout, onReset }: MeasurePanelProps) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const lines = readoutLines(readout, count, lite);

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
        <button type="button" className="chip" aria-pressed={lite} onClick={() => onLite(!lite)}>
          {t.measureLite}
        </button>
      </div>
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
