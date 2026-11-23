/**
 * Dev only: runs the book stack benchmark in the page (loaded only when someone taps "Run
 * benchmark"). It checks the device with a fixed canvas workload, then drives the canvas stack
 * through every set-up with a fixed programmatic scroll, timing each frame, and checks the device
 * again. Whatever happens (finished, cancelled or an error), the stack is put back as it was.
 */
import type { DrawStats, StackBench } from '../staircase/CanvasStack';
import { addBreakdown, breakdownAverages, emptyBreakdown } from './frameStats';
import {
  BENCH_RUN_MS,
  benchBooks,
  benchConfigs,
  benchHolding,
  benchScrollAt,
  calibrationScore,
  droppedFrames,
  fpsOf,
  overridesFor,
  summarize,
  type BenchConfig,
  type BenchDevice,
  type BenchResult,
  type BenchRow,
} from './stackBenchmark';

export type BenchProgress =
  | { kind: 'calibrate'; when: 'start' | 'end' }
  | { kind: 'config'; index: number; total: number; config: BenchConfig };

export interface BenchRunOptions {
  bench: StackBench;
  /** The version line (as in Settings > About). */
  version: string;
  onProgress: (progress: BenchProgress) => void;
  isCancelled: () => boolean;
}

/** Rest before each set-up (ms) and warm-up frames drawn before timing starts. */
const REST_MS = 1000;
const WARMUP_FRAMES = 10;
/** The device check: frames drawn, and the first few left out (they include setting up). */
const CALIBRATION_FRAMES = 120;
const CALIBRATION_SKIP = 5;
/** The device check's fixed workload per frame. */
const CAL_RECTS = 300;
const CAL_IMAGES = 60;
const CAL_SHAPES = 80;

class Cancelled extends Error {}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function supportsLongTasks(): boolean {
  return typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask');
}

async function readDevice(): Promise<BenchDevice> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
  };
  let battery: BenchDevice['battery'] = null;
  try {
    const b = await nav.getBattery?.();
    if (b) battery = { level: b.level, charging: b.charging };
  } catch {
    // Not available here.
  }
  return {
    cores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null,
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    battery,
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    agent: nav.userAgent,
  };
}

async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    return (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    return null;
  }
}

/** A small seeded sequence in [0, 1), so the device check draws the same thing every time. */
function sequence(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/**
 * The device canvas score: a fixed workload (rectangles, a cached texture drawn turned, filled
 * parallelograms) on a canvas laid over the pile at the same pixel size as the stack's, for
 * CALIBRATION_FRAMES frames. The same work every time, so it shows how fast the device is now.
 */
async function calibrate(bench: StackBench, isCancelled: () => boolean): Promise<{ averageMs: number; fps: number } | null> {
  const host = bench.scroller();
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  const { scale } = bench.canvasSize();
  const root = getComputedStyle(document.documentElement);
  const saturation = root.getPropertyValue('--book-spine-saturation').trim();
  const lightness = root.getPropertyValue('--book-spine-lightness').trim();
  const background = root.getPropertyValue('--color-bg').trim();
  const canvas = document.createElement('canvas');
  canvas.className = 'stack-dev__calibration';
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  document.body.append(canvas);
  try {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const texture = document.createElement('canvas');
    texture.width = Math.round(160 * scale);
    texture.height = Math.round(32 * scale);
    const tctx = texture.getContext('2d');
    if (tctx) {
      for (let i = 0; i < 8; i++) {
        tctx.fillStyle = `hsl(${i * 45}, ${saturation}, ${lightness})`;
        tctx.fillRect((i * texture.width) / 8, 0, texture.width / 8, texture.height);
      }
    }
    const rand = sequence(20261123);
    const w = rect.width;
    const h = rect.height;
    const rects = Array.from({ length: CAL_RECTS }, () => ({ x: rand() * w, y: rand() * h, w: 20 + rand() * 120, h: 10 + rand() * 30, hue: Math.floor(rand() * 360) }));
    const images = Array.from({ length: CAL_IMAGES }, () => ({ x: rand() * w, y: rand() * h, a: rand() * Math.PI }));
    const shapes = Array.from({ length: CAL_SHAPES }, () => ({ x: rand() * w, y: rand() * h, ux: 40 + rand() * 120, uy: rand() * 40 - 20, vx: rand() * 30 - 15, vy: 20 + rand() * 30, hue: Math.floor(rand() * 360) }));
    const intervals: number[] = [];
    let last = await nextFrame();
    for (let frame = 0; frame < CALIBRATION_FRAMES; frame++) {
      if (isCancelled()) throw new Cancelled();
      const shift = (frame * 3) % 60;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
      for (const r of rects) {
        ctx.fillStyle = `hsl(${r.hue}, ${saturation}, ${lightness})`;
        ctx.fillRect((r.x + shift) % w, r.y, r.w, r.h);
      }
      for (const img of images) {
        const a = img.a + frame * 0.02;
        ctx.setTransform(scale * Math.cos(a), scale * Math.sin(a), -scale * Math.sin(a), scale * Math.cos(a), ((img.x + shift) % w) * scale, img.y * scale);
        ctx.drawImage(texture, 0, 0, 160, 32);
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const s of shapes) {
        const x = (s.x + shift) % w;
        ctx.beginPath();
        ctx.moveTo(x, s.y);
        ctx.lineTo(x + s.ux, s.y + s.uy);
        ctx.lineTo(x + s.ux + s.vx, s.y + s.uy + s.vy);
        ctx.lineTo(x + s.vx, s.y + s.vy);
        ctx.closePath();
        ctx.fillStyle = `hsl(${s.hue}, ${saturation}, ${lightness})`;
        ctx.fill();
      }
      const now = await nextFrame();
      intervals.push(now - last);
      last = now;
    }
    return calibrationScore(intervals.slice(CALIBRATION_SKIP));
  } finally {
    canvas.remove();
  }
}

/** One set-up: fix it, rest, warm up, then the timed scroll down and back. */
async function runConfig(bench: StackBench, config: BenchConfig, isCancelled: () => boolean): Promise<BenchRow> {
  const check = () => {
    if (isCancelled()) throw new Cancelled();
  };
  bench.setOverrides(overridesFor(config));
  bench.jumpTo(0);
  bench.clearLabels();
  if (config.labels === 'prewarmed') {
    const { from, to } = benchBooks(bench.count());
    bench.prewarm(from, to);
  }
  await sleep(REST_MS);
  check();
  for (let i = 0; i < WARMUP_FRAMES; i++) {
    await nextFrame();
    bench.drawNow();
  }
  check();

  const intervals: number[] = [];
  const js: number[] = [];
  let totals = emptyBreakdown();
  let faces = 0;
  let ops = 0;
  let draws = 0;
  let width = 0;
  let height = 0;
  bench.listen((s: DrawStats) => {
    js.push(s.ms + s.cameraMs);
    totals = addBreakdown(totals, s);
    faces += s.faces;
    ops += s.ops;
    draws += 1;
    width = s.width;
    height = s.height;
  });
  let longCount = 0;
  let longMs = 0;
  const observer = supportsLongTasks()
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longCount += 1;
          longMs += entry.duration;
        }
      })
    : null;
  observer?.observe({ type: 'longtask' });
  const el = bench.scroller();
  try {
    const start = await nextFrame();
    let last = start;
    for (;;) {
      const now = await nextFrame();
      intervals.push(now - last);
      last = now;
      const at = now - start;
      if (at >= BENCH_RUN_MS) break;
      if (el && !benchHolding(at)) el.scrollTop = benchScrollAt(at);
      check();
    }
  } finally {
    bench.listen(null);
    if (observer) {
      for (const entry of observer.takeRecords()) {
        longCount += 1;
        longMs += entry.duration;
      }
      observer.disconnect();
    }
  }
  if (width === 0) ({ width, height } = bench.canvasSize());
  return {
    config,
    width,
    height,
    frames: intervals.length,
    fps: fpsOf(intervals),
    dropped: droppedFrames(intervals),
    interval: summarize(intervals),
    js: summarize(js),
    breakdown: breakdownAverages(totals),
    faces: draws > 0 ? faces / draws : 0,
    ops: draws > 0 ? ops / draws : 0,
    longTasks: observer ? { count: longCount, ms: longMs } : null,
  };
}

/**
 * The whole benchmark. Resolves with the result (cancelled: true if stopped part-way, with the
 * rows done so far); rejects only on an unexpected error. Either way the stack is restored first.
 */
export async function runStackBenchmark({ bench, version, onProgress, isCancelled }: BenchRunOptions): Promise<BenchResult> {
  const rows: BenchRow[] = [];
  const result: BenchResult = {
    version,
    at: '',
    device: await readDevice(),
    calibration: { start: null, end: null },
    rows,
    cancelled: false,
  };
  const wake = await requestWakeLock();
  try {
    onProgress({ kind: 'calibrate', when: 'start' });
    result.calibration.start = await calibrate(bench, isCancelled);
    const configs = benchConfigs();
    for (let i = 0; i < configs.length; i++) {
      onProgress({ kind: 'config', index: i, total: configs.length, config: configs[i] });
      rows.push(await runConfig(bench, configs[i], isCancelled));
    }
    bench.setOverrides(null);
    onProgress({ kind: 'calibrate', when: 'end' });
    result.calibration.end = await calibrate(bench, isCancelled);
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    result.cancelled = true;
  } finally {
    bench.listen(null);
    bench.setOverrides(null);
    try {
      await wake?.release();
    } catch {
      // Already released.
    }
  }
  result.at = new Date().toISOString();
  return result;
}
