import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { currentBuildInfo, formatVersionLine } from '../grownups/version';
import { href } from '../router';
import { bookRenders } from '../staircase/bookRenders';
import type { CentreBook, CentreTag, DrawStats, StackBench, StackDrop } from '../staircase/CanvasStack';
import { thud, vibrationMs } from '../staircase/dropMotion';
import { playThud, vibrateLanding } from '../staircase/dropSound';
import { useActiveReader } from '../session/activeReader';
import { MAX_DROP, pretendAway } from '../staircase/stackSeen';
import { currentTimeZone } from '../lib/timezone';
import { stackMarkers } from '../staircase/stackItems';
import { useStackCovers, writeStackCovers } from '../staircase/coverSetting';
import { useStackGap, writeStackGap } from '../staircase/gapSetting';
import { useStackShapes, writeStackShapes } from '../staircase/shapeSetting';
import { useStackSky, writeStackSky } from '../staircase/skySetting';
import { useStackGround, writeStackGround } from '../staircase/groundSetting';
import { useStackClouds, writeStackClouds } from '../staircase/cloudsSetting';
import { useStackForeground, writeStackForeground } from '../staircase/foregroundSetting';
import { useStackDecor, writeStackDecor } from '../staircase/decorSetting';
import { useStackSlow, writeStackSlow } from '../staircase/slowSetting';
import { DECOR_LEVELS, type Decor } from '../staircase/drawBudget';
import { coverReportLines, latestCoverReport, type CoverReport } from '../staircase/coverDiagnostics';
import { AREA, STANDARD_DEPTH, STANDARD_WIDTH, STRENGTH, VARIETY, WIDTH_RANGE, ASPECT_RANGE } from '../staircase/bookShapes';
import { GAP_UP_PX, GAP_DOWN_PX } from '../staircase/eyeGap';
import { GAP_DOWN, GAP_RAMP, GAP_UP, fakeStackItems, generateFakeStack, spineHue } from '../staircase/stackModel';
import { MAX_TWIST_DEG, TWIST_DEG } from '../staircase/stackProjection';
import { fmt, strings } from '../strings';
import {
  FRAME_MS,
  drawStats,
  framesPerSecond,
  missedFrames,
  rendersPerSecond,
  sampleStats,
  type DrawSample,
  type Frame,
  type SampleStats,
} from './frameStats';
import { BenchControls, BenchResults, BenchRunning } from './StackBenchmarkPanel';
import { usePretendCovers } from './pretendCovers';
import { useStackBenchmark } from './useStackBenchmark';
import { formatBenchResult } from './stackBenchmark';
import './StackDevPage.css';

/**
 * #/dev/stack — the Family Staircase as a 3D pile of pretend books (stage 1 prototype), with a
 * small panel measuring how smoothly it scrolls. Behind the same gate as the other developer
 * tools. Pretend data only: nothing is read from or written to storage. The canvas mode is the
 * Family Staircase's own component, given pretend books with dates over several years, so the
 * month lines and book-number flags are measured too.
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
const COUNTS = [1, 7, 11, 40, 100, 1000, 3000] as const;
/** "Replay new-book drop": 1 to this many books. */
const MAX_REPLAY = 50;
const SEED = 'dev-book-stack';
/** A scroll counts as going on this long after its last scroll event (ms). */
const SCROLL_IDLE_MS = 150;
/** FPS is over the last this many ms of scrolling. */
const FPS_WINDOW_MS = 2000;
const READOUT_EVERY_MS = 500;

/** "Version 1.8.5 · abc1234 · built …", as in Settings > About: the first line of every result. */
function versionLine(): string {
  return formatVersionLine(currentBuildInfo(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export default function StackDevPage() {
  const [count, setCount] = useState<number>(1000);
  const [mode, setMode] = useState<StackMode>('canvas');
  const [twist, setTwist] = useState<number>(TWIST_DEG);
  const [settle, setSettle] = useState(true);
  const [raster, setRaster] = useState(false);
  const entries = useMemo(() => generateFakeStack(count, SEED), [count]);
  const covers = useStackCovers();
  const gap = useStackGap();
  const coverShapes = useStackShapes();
  const sky = useStackSky();
  const ground = useStackGround();
  const clouds = useStackClouds();
  const foreground = useStackForeground();
  const decor = useStackDecor();
  const slow = useStackSlow();
  const pretendCovers = usePretendCovers(covers);
  const items = useMemo(() => {
    const plain = fakeStackItems(entries, SEED);
    if (!pretendCovers || pretendCovers.length === 0) return plain;
    return plain.map((item) => ({ ...item, cover: pretendCovers[spineHue(item.isbn) % pretendCovers.length] }));
  }, [entries, pretendCovers]);
  const markers = useMemo(
    () =>
      stackMarkers(items, currentTimeZone(), {
        locale: strings.app.locale,
        first: strings.staircase.stackFlagFirst,
        number: strings.staircase.stackFlagNumber,
      }),
    [items],
  );
  const scroller = useRef<HTMLDivElement | null>(null);
  const meter = useScrollMeter(scroller);
  const { reset } = meter;
  const onScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
  }, []);
  const benchHandle = useRef<StackBench | null>(null);
  const onBench = useCallback((handle: StackBench | null) => {
    benchHandle.current = handle;
  }, []);
  const version = useMemo(() => versionLine(), []);
  const benchmark = useStackBenchmark(benchHandle, version, reset);
  const [drop, setDrop] = useState<StackDrop | null>(null);
  const { watch } = meter;
  const replay = useCallback(
    (count: number) => {
      const n = Math.min(MAX_REPLAY, Math.max(1, Math.floor(count)));
      const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Measure the drop's frames like a scroll's.
      watch(5000);
      setDrop((d) => ({ id: (d?.id ?? 0) + 1, count: n, kind: reduced || n > MAX_DROP ? 'highlight' : 'fall' }));
    },
    [watch],
  );

  // A new pile starts its counts afresh.
  useEffect(() => reset(), [count, mode, twist, settle, raster, covers, gap, coverShapes, sky, ground, clouds, foreground, decor, slow, reset]);
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
            // A fresh canvas when "Measure raster" changes: Chrome may move a canvas that's been
            // read back to the CPU, and keep it there.
            key={`${count}-${raster}`}
            items={items}
            markers={markers}
            seed={SEED}
            twist={twist}
            settle={settle}
            inset
            describeCentre={describeCentre}
            label={label}
            onScroller={onScroller}
            onScroll={meter.onScroll}
            measureRaster={raster}
            onDraw={meter.onDraw}
            onBench={onBench}
            covers={covers}
            coverShapes={coverShapes}
            gap={gap}
            sky={sky}
            ground={ground}
            clouds={clouds}
            foreground={foreground}
            decor={decor}
            pretendSlow={slow}
            drop={drop}
            onLanding={landed}
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
      {benchmark.state === 'running' ? (
        <BenchRunning progress={benchmark.progress} onCancel={benchmark.cancel} />
      ) : (
        <MeasurePanel
          version={version}
          bench={
            <BenchControls
              canRun={mode === 'canvas'}
              hasLast={benchmark.last !== null}
              status={benchmark.status}
              onStart={() => void benchmark.start()}
              onOpenLast={benchmark.openLast}
            />
          }
          benchText={benchmark.last ? formatBenchResult(benchmark.last) : null}
          count={count}
          mode={mode}
          twist={twist}
          settle={settle}
          onCount={setCount}
          onMode={setMode}
          onTwist={setTwist}
          onSettle={setSettle}
          raster={raster}
          onRaster={setRaster}
          covers={covers}
          onCovers={writeStackCovers}
          gap={gap}
          onGap={writeStackGap}
          coverShapes={coverShapes}
          onCoverShapes={writeStackShapes}
          sky={sky}
          onSky={writeStackSky}
          ground={ground}
          onGround={writeStackGround}
          clouds={clouds}
          onClouds={writeStackClouds}
          foreground={foreground}
          onForeground={writeStackForeground}
          decor={decor}
          onDecor={writeStackDecor}
          slow={slow}
          onSlow={writeStackSlow}
          onReplay={replay}
          readout={meter.readout}
          onReset={reset}
        />
      )}
      {benchmark.state === 'results' && benchmark.shown && (
        <BenchResults result={benchmark.shown} version={currentBuildInfo().version} onClose={benchmark.close} />
      )}
    </main>
  );
}

interface Readout {
  /** FPS over the last 2 s of scrolling (the latest measured), or null before any scrolling. */
  fps: number | null;
  /** Book renders per second over the same frames, or null before any scrolling. */
  renders: number | null;
  /** Canvas only: draw time per frame (ms) over the same 2 s, or null before any drawing while scrolling. */
  draw: SampleStats | null;
  /** Canvas only: faces and canvas drawing calls per frame over the same 2 s. */
  faces: SampleStats | null;
  ops: SampleStats | null;
  /** Canvas only: the latest frame's backing size (px) and scale, or null before the first frame. */
  canvas: { width: number; height: number; scale: number } | null;
  /** Canvas, "Measure raster" on: the sampled flushes (ms) over the same 2 s. */
  raster: SampleStats | null;
  /** Canvas only: average ms per frame in each part, and labels prepared per frame (same 2 s). */
  breakdown: { labelMs: number; booksMs: number; overlayMs: number; cameraMs: number; labels: number } | null;
  /** Label cache rebuilds this visit (the latest frame's count). */
  rebuilds: number;
  /** Covers on: the cover pictures kept and their memory (bytes), at the latest frame. */
  coverPictures: { pictures: number; bytes: number } | null;
  /** The sky's t at the top and bottom of the view at the latest frame (null: no sky drawn), and whether ground was drawn. */
  sky: { top: number; bottom: number } | null;
  ground: boolean;
  /** Clouds drawn at the latest frame (backdrop or still, and foreground), and the decor then (null before the first frame). */
  clouds: number;
  cloudsFg: number;
  decor: DrawStats['decor'] | null;
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
  return { fps: null, renders: null, draw: null, faces: null, ops: null, canvas: null, raster: null, breakdown: null, rebuilds: 0, coverPictures: null, sky: null, ground: false, clouds: 0, cloudsFg: 0, decor: null, dropped: 0, longTasks: supportsLongTasks() ? 0 : null, longTaskMs: 0, nodes: 0, viewport: '', dpr: 1 };
}

/** Times every frame while the pile is scrolling, counts late frames and long tasks. */
function useScrollMeter(scroller: RefObject<HTMLDivElement | null>) {
  const live = useRef({
    frames: [] as Frame[],
    /** Canvas draws while scrolling. */
    draws: [] as DrawSample[],
    /** Sampled raster flushes while the camera moves. */
    flushes: [] as DrawSample[],
    canvas: null as Readout['canvas'],
    rebuilds: 0,
    coverPictures: null as Readout['coverPictures'],
    sky: null as Readout['sky'],
    ground: false,
    clouds: 0,
    cloudsFg: 0,
    decor: null as Readout['decor'],
    lastBreakdown: null as Readout['breakdown'],
    last: 0,
    /** bookRenders() at the last frame. */
    lastRenders: 0,
    scrollingUntil: 0,
    dropped: 0,
    longTasks: 0,
    longTaskMs: 0,
    lastFps: null as number | null,
    lastRendersPerSec: null as number | null,
    lastDraw: null as SampleStats | null,
    lastFaces: null as SampleStats | null,
    lastOps: null as SampleStats | null,
    lastRaster: null as SampleStats | null,
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
      while (s.flushes.length > 0 && s.flushes[0].at <= now - FPS_WINDOW_MS) s.flushes.shift();
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
      const faces = sampleStats(s.draws, now, FPS_WINDOW_MS, (d) => d.faces);
      if (faces !== null) s.lastFaces = faces;
      const ops = sampleStats(s.draws, now, FPS_WINDOW_MS, (d) => d.ops);
      if (ops !== null) s.lastOps = ops;
      const raster = drawStats(s.flushes, now, FPS_WINDOW_MS);
      if (raster !== null) s.lastRaster = raster;
      const part = (key: 'labelMs' | 'booksMs' | 'overlayMs' | 'cameraMs' | 'labels') =>
        sampleStats(s.draws, now, FPS_WINDOW_MS, (d) => d[key])?.average ?? null;
      const parts = { labelMs: part('labelMs'), booksMs: part('booksMs'), overlayMs: part('overlayMs'), cameraMs: part('cameraMs'), labels: part('labels') };
      if (parts.booksMs !== null) {
        s.lastBreakdown = {
          labelMs: parts.labelMs ?? 0,
          booksMs: parts.booksMs,
          overlayMs: parts.overlayMs ?? 0,
          cameraMs: parts.cameraMs ?? 0,
          labels: parts.labels ?? 0,
        };
      }
      setReadout({
        fps: s.lastFps,
        renders: s.lastRendersPerSec,
        draw: s.lastDraw,
        faces: s.lastFaces,
        ops: s.lastOps,
        canvas: s.canvas,
        raster: s.lastRaster,
        breakdown: s.lastBreakdown,
        rebuilds: s.rebuilds,
        coverPictures: s.coverPictures,
        sky: s.sky,
        ground: s.ground,
        clouds: s.clouds,
        cloudsFg: s.cloudsFg,
        decor: s.decor,
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

  /** Count frames and draws for the next `ms` (a replayed drop), as while scrolling. */
  const watch = useCallback((ms: number) => {
    const s = live.current;
    s.scrollingUntil = Math.max(s.scrollingUntil, performance.now() + ms);
  }, []);

  const onScroll = useCallback(() => {
    live.current.scrollingUntil = performance.now() + SCROLL_IDLE_MS;
  }, []);

  /** A canvas draw: counted only while the pile is scrolling, like the frames; raster flushes whenever sampled. */
  const onDraw = useCallback((stats: DrawStats) => {
    const s = live.current;
    const now = performance.now();
    s.canvas = { width: stats.width, height: stats.height, scale: stats.scale };
    s.rebuilds = stats.rebuilds;
    s.coverPictures = stats.covers ?? null;
    s.sky = stats.sky;
    s.ground = stats.ground;
    s.clouds = stats.clouds;
    s.cloudsFg = stats.cloudsFg;
    s.decor = stats.decor;
    if (stats.raster !== undefined) s.flushes.push({ at: now, ms: stats.raster });
    if (now <= s.scrollingUntil + FRAME_MS) {
      s.draws.push({
        at: now,
        ms: stats.ms,
        faces: stats.faces,
        ops: stats.ops,
        labelMs: stats.labelMs,
        booksMs: stats.booksMs,
        overlayMs: stats.overlayMs,
        cameraMs: stats.cameraMs,
        labels: stats.labels,
      });
    }
  }, []);

  const reset = useCallback(() => {
    const s = live.current;
    s.frames = [];
    s.draws = [];
    s.flushes = [];
    s.lastDraw = null;
    s.lastFaces = null;
    s.lastOps = null;
    s.lastRaster = null;
    s.lastBreakdown = null;
    s.dropped = 0;
    s.longTasks = 0;
    s.longTaskMs = 0;
    s.lastFps = null;
    s.lastRendersPerSec = null;
  }, []);

  return { readout, onScroll, onDraw, reset, watch };
}

/** A landing on this page's pile: the same thud and vibration as on the Family Staircase. */
function landed({ mass, impulse }: { mass: number; impulse: number }): void {
  playThud(thud(mass, impulse));
  vibrateLanding(vibrationMs(impulse));
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** "Replay new-book drop" (this page's pile) and "Pretend I've been away" (the open card's reader, on the Family Staircase). */
function DropControls({ onReplay }: { onReplay: (count: number) => void }) {
  const id = useId();
  const [count, setCount] = useState(3);
  const [done, setDone] = useState<string | null>(null);
  const { reader } = useActiveReader();
  const n = Math.min(MAX_REPLAY, Math.max(1, Math.floor(count) || 1));
  const away = () => {
    const store = storage();
    if (!reader || !store) return;
    pretendAway(store, reader.id, n);
    setDone(fmt(t.dropAwayDone, { name: reader.display_name, count: n }));
  };
  return (
    <div className="stack-dev__controls">
      <p className="small">
        <strong>{t.dropHeading}</strong> {t.dropIntro}
      </p>
      <label className="stack-dev__slider" htmlFor={id}>
        <span>{t.dropCount}</span>
        <input
          id={id}
          className="input"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_REPLAY}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>
      <button type="button" className="chip" onClick={() => onReplay(n)}>
        {t.dropReplay}
      </button>
      <p className="small muted">{t.dropReplayNote}</p>
      <button type="button" className="chip" disabled={!reader} onClick={away}>
        {t.dropAway}
      </button>
      <p className="small muted" role="status">
        {done ?? (reader ? t.dropAwayNote : t.dropAwayNoReader)}
      </p>
    </div>
  );
}

/** "Cover diagnostics": the Family Staircase pile's covers on this device (coverDiagnostics.ts), to read or copy. */
function CoverDiagnostics({ version }: { version: string }) {
  const [report, setReport] = useState<CoverReport | null>(() => latestCoverReport());
  const [copied, setCopied] = useState<boolean | null>(null);
  const clock = useMemo(() => new Intl.DateTimeFormat(strings.app.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }), []);
  const lines = report ? coverReportLines(report, t, (ms) => clock.format(ms)) : null;
  const copy = async () => {
    if (lines) setCopied(await copyText([version, ...lines].join('\n')));
  };
  return (
    <div className="stack-dev__controls">
      <p className="small">
        <strong>{t.coverDiagHeading}</strong> {t.coverDiagIntro}
      </p>
      {lines ? <pre className="stack-dev__diag">{lines.join('\n')}</pre> : <p className="small muted">{t.coverDiagEmpty}</p>}
      <button
        type="button"
        className="chip"
        onClick={() => {
          setReport(latestCoverReport());
          setCopied(null);
        }}
      >
        {t.coverDiagRefresh}
      </button>
      <button type="button" className="chip" disabled={!lines} onClick={() => void copy()}>
        {t.coverDiagCopy}
      </button>
      <p className="small muted" role="status">
        {copied === true ? t.measureCopied : copied === false ? t.coverDiagCopyFailed : ''}
      </p>
    </div>
  );
}

function modeName(mode: StackMode): string {
  if (mode === 'canvas') return t.measureModeCanvas;
  return mode === 'lite' ? t.measureModeLite : t.measureMode3d;
}

function perFrame(stats: SampleStats | null): string {
  return stats === null ? t.measureFpsNone : fmt(t.measurePerFrameValue, { average: stats.average.toFixed(1), max: Math.round(stats.max) });
}

function readoutLines(
  readout: Readout,
  count: number,
  mode: StackMode,
  twist: number,
  settle: boolean,
  raster: boolean,
  covers: boolean,
  gap: boolean,
  coverShapes: boolean,
  sky: boolean,
  ground: boolean,
  clouds: boolean,
  foreground: boolean,
  slow: boolean,
): [string, string][] {
  const canvas = mode === 'canvas';
  const only = t.measureDrawCanvasOnly;
  const size = readout.canvas;
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
    [t.measureCovers, canvas ? (covers ? t.measureOn : t.measureOff) : t.measureDrawCanvasOnly],
    [t.measureGap, canvas ? (gap ? t.measureOn : t.measureOff) : t.measureDrawCanvasOnly],
    [t.measureShapes, canvas ? (coverShapes ? t.measureOn : t.measureOff) : t.measureDrawCanvasOnly],
    [t.measureSky, canvas ? (sky ? t.measureOn : t.measureOff) : t.measureDrawCanvasOnly],
    [
      t.measureSkyT,
      !canvas
        ? t.measureDrawCanvasOnly
        : readout.sky === null
          ? t.measureSkyNone
          : fmt(t.measureSkyTValue, { top: readout.sky.top.toFixed(3), bottom: readout.sky.bottom.toFixed(3) }),
    ],
    [t.measureGround, canvas ? (ground ? (readout.ground ? t.measureGroundShown : t.measureGroundAway) : t.measureOff) : t.measureDrawCanvasOnly],
    [t.measureClouds, canvas ? (clouds ? t.measureOn : t.measureOff) : t.measureDrawCanvasOnly],
    [t.measureForeground, canvas ? (foreground ? t.measureOn : t.measureOff) : t.measureDrawCanvasOnly],
    [
      t.measureDecorDrawn,
      !canvas
        ? t.measureDrawCanvasOnly
        : readout.decor === null
          ? t.measureFpsNone
          : fmt(t.measureDecorDrawnValue, {
              drawn: t.decorLevel[readout.decor.drawn],
              why: t.decorWhy[readout.decor.why],
              setting: t.decorLevel[readout.decor.setting],
              cap: t.decorLevel[readout.decor.cap],
            }),
    ],
    [t.measureCloudsDrawn, canvas ? String(readout.clouds) : t.measureDrawCanvasOnly],
    [t.measureForegroundDrawn, canvas ? String(readout.cloudsFg) : t.measureDrawCanvasOnly],
    [t.measureSlow, canvas ? (slow ? t.measureOn : t.measureOff) : t.measureDrawCanvasOnly],
    [
      t.measureShapeConstants,
      canvas
        ? fmt(t.measureShapeConstantsValue, {
            strength: STRENGTH,
            variety: VARIETY,
            width: STANDARD_WIDTH,
            depth: STANDARD_DEPTH,
            area: AREA.toLocaleString(),
            minWidth: WIDTH_RANGE[0],
            maxWidth: WIDTH_RANGE[1],
            minAspect: ASPECT_RANGE[0],
            maxAspect: ASPECT_RANGE[1],
          })
        : t.measureDrawCanvasOnly,
    ],
    [
      t.measureGapConstants,
      canvas
        ? fmt(t.measureGapConstantsValue, {
            up: GAP_UP,
            down: GAP_DOWN,
            upPx: Math.round(GAP_UP_PX),
            downPx: Math.round(GAP_DOWN_PX),
            from: GAP_RAMP[0],
            to: GAP_RAMP[1],
          })
        : t.measureDrawCanvasOnly,
    ],
    [t.measureFps, readout.fps === null ? t.measureFpsNone : readout.fps.toFixed(1)],
    [t.measureRenders, readout.renders === null ? t.measureFpsNone : readout.renders.toFixed(1)],
    [t.measureDraw, draw],
    [
      t.measureBreakdown,
      !canvas
        ? only
        : readout.breakdown === null
          ? t.measureFpsNone
          : fmt(t.measureBreakdownValue, {
              labels: readout.breakdown.labelMs.toFixed(2),
              books: readout.breakdown.booksMs.toFixed(2),
              overlays: readout.breakdown.overlayMs.toFixed(2),
              camera: readout.breakdown.cameraMs.toFixed(2),
            }),
    ],
    [t.measureLabels, !canvas ? only : readout.breakdown === null ? t.measureFpsNone : readout.breakdown.labels.toFixed(2)],
    [t.measureRebuilds, canvas ? String(readout.rebuilds) : only],
    [
      t.measureCoverPictures,
      !canvas
        ? only
        : readout.coverPictures === null
          ? t.measureFpsNone
          : fmt(t.measureCoverPicturesValue, {
              count: readout.coverPictures.pictures,
              size: (readout.coverPictures.bytes / (1024 * 1024)).toFixed(2),
            }),
    ],
    [t.measureFaces, canvas ? perFrame(readout.faces) : only],
    [t.measureOps, canvas ? perFrame(readout.ops) : only],
    [
      t.measureCanvas,
      !canvas || size === null ? only : fmt(t.measureCanvasValue, { width: size.width, height: size.height, scale: size.scale }),
    ],
    [
      t.measureRasterLine,
      !canvas
        ? only
        : !raster
          ? t.measureOff
          : readout.raster === null
            ? t.measureFpsNone
            : fmt(t.measureDrawValue, { average: readout.raster.average.toFixed(2), max: readout.raster.max.toFixed(2) }),
    ],
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
  /** The version line, first in the panel and in "Copy results". */
  version: string;
  /** The benchmark's controls, near the end of the panel. */
  bench: ReactNode;
  /** The last benchmark as text, added to "Copy results" when there is one. */
  benchText: string | null;
  count: number;
  mode: StackMode;
  twist: number;
  settle: boolean;
  onCount: (count: number) => void;
  onMode: (mode: StackMode) => void;
  onTwist: (twist: number) => void;
  onSettle: (settle: boolean) => void;
  raster: boolean;
  onRaster: (raster: boolean) => void;
  /** "Covers on the stack": this device's setting, also used by the Family Staircase. */
  covers: boolean;
  onCovers: (covers: boolean) => void;
  /** "Gap around the eye-line book": this device's setting, also used by the Family Staircase. */
  gap: boolean;
  onGap: (gap: boolean) => void;
  /** "Cover shapes": this device's setting, also used by the Family Staircase. */
  coverShapes: boolean;
  onCoverShapes: (on: boolean) => void;
  /** "Sky" and "Ground & horizon": this device's settings, also used by the Family Staircase. */
  sky: boolean;
  onSky: (on: boolean) => void;
  ground: boolean;
  onGround: (on: boolean) => void;
  /** "Clouds", the decor level and "Pretend slow frames": this device's settings, also used by the Family Staircase. */
  clouds: boolean;
  onClouds: (on: boolean) => void;
  foreground: boolean;
  onForeground: (on: boolean) => void;
  decor: Decor;
  onDecor: (decor: Decor) => void;
  slow: boolean;
  onSlow: (on: boolean) => void;
  /** "Replay new-book drop": the newest books fall onto the pile here again. */
  onReplay: (count: number) => void;
  readout: Readout;
  onReset: () => void;
}

/** Small and collapsible, over the pile: the controls, the live numbers and "Copy results". */
function MeasurePanel({
  version,
  bench,
  benchText,
  count,
  mode,
  twist,
  settle,
  onCount,
  onMode,
  onTwist,
  onSettle,
  raster,
  onRaster,
  covers,
  onCovers,
  gap,
  onGap,
  coverShapes,
  onCoverShapes,
  sky,
  onSky,
  ground,
  onGround,
  clouds,
  onClouds,
  foreground,
  onForeground,
  decor,
  onDecor,
  slow,
  onSlow,
  onReplay,
  readout,
  onReset,
}: MeasurePanelProps) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const coversNoteId = useId();
  const gapNoteId = useId();
  const shapesNoteId = useId();
  const skyNoteId = useId();
  const groundNoteId = useId();
  const cloudsNoteId = useId();
  const foregroundNoteId = useId();
  const decorNoteId = useId();
  const slowNoteId = useId();
  const lines = readoutLines(readout, count, mode, twist, settle, raster, covers, gap, coverShapes, sky, ground, clouds, foreground, slow);

  const copy = async () => {
    const parts = [version, t.stackTitle, ...lines.map(([label, value]) => `${label}: ${value}`)];
    if (benchText) parts.push('', benchText);
    const text = parts.join('\n');
    setCopied(await copyText(text));
  };

  return (
    <details className="stack-dev__panel">
      <summary className="stack-dev__summary">
        {readout.fps === null ? t.measureHeading : fmt(t.measureSummary, { fps: readout.fps.toFixed(1), dropped: readout.dropped })}
      </summary>
      <p className="stack-dev__version">{version}</p>
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
          <button type="button" className="chip" aria-pressed={raster} onClick={() => onRaster(!raster)}>
            {t.measureRasterChip}
          </button>
          <button type="button" className="chip" aria-pressed={covers} aria-describedby={coversNoteId} onClick={() => onCovers(!covers)}>
            {t.measureCovers}
          </button>
          <p id={coversNoteId} className="small muted">
            {t.measureCoversNote}
          </p>
          <button type="button" className="chip" aria-pressed={gap} aria-describedby={gapNoteId} onClick={() => onGap(!gap)}>
            {t.measureGap}
          </button>
          <p id={gapNoteId} className="small muted">
            {t.measureGapNote}
          </p>
          <button type="button" className="chip" aria-pressed={coverShapes} aria-describedby={shapesNoteId} onClick={() => onCoverShapes(!coverShapes)}>
            {t.measureShapes}
          </button>
          <p id={shapesNoteId} className="small muted">
            {t.measureShapesNote}
          </p>
          <button type="button" className="chip" aria-pressed={sky} aria-describedby={skyNoteId} onClick={() => onSky(!sky)}>
            {t.measureSky}
          </button>
          <p id={skyNoteId} className="small muted">
            {t.measureSkyNote}
          </p>
          <button type="button" className="chip" aria-pressed={ground} aria-describedby={groundNoteId} onClick={() => onGround(!ground)}>
            {t.measureGround}
          </button>
          <p id={groundNoteId} className="small muted">
            {t.measureGroundNote}
          </p>
          <button type="button" className="chip" aria-pressed={clouds} aria-describedby={cloudsNoteId} onClick={() => onClouds(!clouds)}>
            {t.measureClouds}
          </button>
          <p id={cloudsNoteId} className="small muted">
            {t.measureCloudsNote}
          </p>
          <button type="button" className="chip" aria-pressed={foreground} aria-describedby={foregroundNoteId} onClick={() => onForeground(!foreground)}>
            {t.measureForeground}
          </button>
          <p id={foregroundNoteId} className="small muted">
            {t.measureForegroundNote}
          </p>
          <div className="chip-row" role="group" aria-label={t.measureDecor} aria-describedby={decorNoteId}>
            {[...DECOR_LEVELS].reverse().map((level) => (
              <button key={level} type="button" className="chip" aria-pressed={decor === level} onClick={() => onDecor(level)}>
                {t.decorLevel[level]}
              </button>
            ))}
          </div>
          <p id={decorNoteId} className="small muted">
            {t.measureDecorNote}
          </p>
          <button type="button" className="chip" aria-pressed={slow} aria-describedby={slowNoteId} onClick={() => onSlow(!slow)}>
            {t.measureSlow}
          </button>
          <p id={slowNoteId} className="small muted">
            {t.measureSlowNote}
          </p>
        </div>
      )}
      {mode === 'canvas' && <DropControls onReplay={onReplay} />}
      <CoverDiagnostics version={version} />
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
      {bench}
    </details>
  );
}
