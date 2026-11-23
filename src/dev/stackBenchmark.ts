/**
 * Dev only: the book stack benchmark's pure parts (unit-tested): the set-ups it runs, its fixed
 * scroll, the frame maths and the text it copies. The runner (runStackBenchmark.ts) drives the
 * canvas stack through these.
 */
import { PX_PER_BOOK } from '../staircase/camera';
import { FAN_CAP, type StackOverrides } from '../staircase/drawBudget';
import { TWIST_DEG } from '../staircase/stackProjection';
import { fmt, strings } from '../strings';

const t = strings.dev;

// ---- Set-ups ----

export type LabelMode = 'prewarmed' | 'on-demand';

export interface BenchConfig {
  scale: number;
  labels: LabelMode;
  overlays: boolean;
  plainAvatars: boolean;
  settle: boolean;
  twist: number;
}

export const BENCH_SCALES = [1, 1.5, 2] as const;
/** The scale the two extra set-ups (plain avatars, settle on) use. */
export const BENCH_EXTRA_SCALE = 1.5;

/**
 * Every set-up, in the order they run: each scale (lowest first) × labels prewarmed then on
 * demand × overlays on then off, then plain avatars and settle on at 1.5×. All at the default
 * twist, settle off unless said.
 */
export function benchConfigs(): BenchConfig[] {
  const base = { plainAvatars: false, settle: false, twist: TWIST_DEG };
  const out: BenchConfig[] = [];
  for (const scale of BENCH_SCALES) {
    for (const labels of ['prewarmed', 'on-demand'] as const) {
      for (const overlays of [true, false]) out.push({ ...base, scale, labels, overlays });
    }
  }
  out.push({ ...base, scale: BENCH_EXTRA_SCALE, labels: 'on-demand', overlays: true, plainAvatars: true });
  out.push({ ...base, scale: BENCH_EXTRA_SCALE, labels: 'on-demand', overlays: true, settle: true });
  return out;
}

/** What the stack is told for a set-up: everything fixed, adaptive resolution off. */
export function overridesFor(config: BenchConfig): StackOverrides {
  return {
    scale: config.scale,
    adaptive: false,
    overlays: config.overlays,
    plainAvatars: config.plainAvatars,
    settle: config.settle,
    twist: config.twist,
    labelCache: benchLabelCache(),
  };
}

/** After the benchmark: no overrides, so the stack is back on the reader's own twist, settle and resolution. */
export const RESTORED: StackOverrides | null = null;

// ---- The fixed scroll ----

/** A firm flick's speed, held steady: about 1,700 scroll px a second. */
export const BENCH_BOOKS_PER_SECOND = 30;
/** Down this long, hold, then back up this long (ms). */
export const BENCH_LEG_MS = 3000;
export const BENCH_HOLD_MS = 400;
export const BENCH_RUN_MS = 2 * BENCH_LEG_MS + BENCH_HOLD_MS;
/** How many books down the pile the scroll goes. */
export const BENCH_BOOKS_VISITED = (BENCH_BOOKS_PER_SECOND * BENCH_LEG_MS) / 1000;

/** Where the scroll is (scrollTop, px) `ms` into a run: down at a steady speed, a short hold, back up. */
export function benchScrollAt(ms: number, px: number = PX_PER_BOOK): number {
  const speed = (BENCH_BOOKS_PER_SECOND * px) / 1000;
  const far = speed * BENCH_LEG_MS;
  const at = Math.max(0, ms);
  if (at <= BENCH_LEG_MS) return speed * at;
  if (at <= BENCH_LEG_MS + BENCH_HOLD_MS) return far;
  return Math.max(0, far - speed * (at - BENCH_LEG_MS - BENCH_HOLD_MS));
}

/** Whether the run is holding still at `ms` (the runner doesn't write scrollTop then, so a settle can happen). */
export function benchHolding(ms: number): boolean {
  return ms > BENCH_LEG_MS && ms <= BENCH_LEG_MS + BENCH_HOLD_MS;
}

/** The books (indexes, oldest first) a run can show, for prewarming their labels: the top of the pile, down past the farthest point. */
export function benchBooks(count: number, cap: number = FAN_CAP): { from: number; to: number } {
  const top = Math.max(0, count - 1);
  return { from: Math.max(0, top - Math.ceil(BENCH_BOOKS_VISITED) - cap - 1), to: count };
}

/**
 * The label cache size while benchmarking: every book a run can show, plus a little room, so
 * prewarmed labels aren't pushed out mid-run (the normal cache holds 100).
 */
export function benchLabelCache(cap: number = FAN_CAP): number {
  return Math.ceil(BENCH_BOOKS_VISITED) + 2 * cap + 2 + 10;
}

// ---- Frame maths ----

/** The value below which `p` (0..1) of `values` fall (nearest rank), or NaN for none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(Math.min(1, Math.max(0, p)) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export interface Summary {
  average: number;
  p95: number;
  worst: number;
}

export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null;
  const total = values.reduce((a, b) => a + b, 0);
  return { average: total / values.length, p95: percentile(values, 0.95), worst: Math.max(...values) };
}

/** A frame interval longer than this (ms) counts as dropped. */
export const DROPPED_OVER_MS = 20;

export function droppedFrames(intervals: readonly number[], over: number = DROPPED_OVER_MS): number {
  return intervals.filter((dt) => dt > over).length;
}

/** Frames per second over a run of frame intervals (ms), or 0 for none. */
export function fpsOf(intervals: readonly number[]): number {
  const total = intervals.reduce((a, b) => a + b, 0);
  return total > 0 ? (intervals.length * 1000) / total : 0;
}

/** The device canvas score: average frame interval (ms) and the FPS it gives, from the calibration's frames. */
export function calibrationScore(intervals: readonly number[]): { averageMs: number; fps: number } | null {
  const usable = intervals.filter((dt) => dt > 0 && Number.isFinite(dt));
  if (usable.length === 0) return null;
  const averageMs = usable.reduce((a, b) => a + b, 0) / usable.length;
  return { averageMs, fps: 1000 / averageMs };
}

// ---- Results ----

export interface BenchRow {
  config: BenchConfig;
  /** The canvas's backing size (px). */
  width: number;
  height: number;
  frames: number;
  fps: number;
  dropped: number;
  interval: Summary | null;
  /** JS time per frame (drawing + camera), ms. */
  js: Summary | null;
  breakdown: { labelMs: number; booksMs: number; overlayMs: number; cameraMs: number; labels: number } | null;
  faces: number;
  ops: number;
  /** null where the browser can't report long tasks. */
  longTasks: { count: number; ms: number } | null;
}

export interface BenchDevice {
  cores: number | null;
  memoryGb: number | null;
  battery: { level: number; charging: boolean } | null;
  viewport: string;
  dpr: number;
  agent: string;
}

export interface BenchResult {
  version: string;
  /** When it finished (ISO). */
  at: string;
  device: BenchDevice;
  calibration: { start: { averageMs: number; fps: number } | null; end: { averageMs: number; fps: number } | null };
  rows: BenchRow[];
  cancelled: boolean;
}

const n1 = (v: number) => v.toFixed(1);
const n2 = (v: number) => v.toFixed(2);
const triple = (s: Summary | null) => (s === null ? '–' : `${n1(s.average)}/${n1(s.p95)}/${n1(s.worst)}`);
const pad2 = (v: number) => String(v).padStart(2, '0');

/** A date as local "YYYY-MM-DD HH:MM". */
export function localStamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** The download's name: library-card-benchmark-<version>-<YYYYMMDD-HHMM>.txt (local time). */
export function benchFilename(version: string, date: Date): string {
  const safe = version.replace(/[^0-9A-Za-z.-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  return `library-card-benchmark-${safe}-${stamp}.txt`;
}

export function configLabel(config: BenchConfig): string {
  const parts = [
    fmt(t.benchScaleValue, { scale: config.scale }),
    config.labels === 'prewarmed' ? t.benchLabelsPrewarmed : t.benchLabelsOnDemand,
    config.overlays ? t.benchOverlaysOn : t.benchOverlaysOff,
  ];
  if (config.plainAvatars) parts.push(t.benchPlainAvatars);
  if (config.settle) parts.push(t.benchSettleOn);
  return parts.join(' · ');
}

/** The set-up's short code for the table, e.g. "1.5× dem ovl +plain" (the table note explains them). */
export function configCode(config: BenchConfig): string {
  const parts = [
    fmt(t.benchScaleValue, { scale: config.scale }),
    config.labels === 'prewarmed' ? t.benchCodePrewarmed : t.benchCodeOnDemand,
    config.overlays ? t.benchCodeOverlaysOn : t.benchCodeOverlaysOff,
  ];
  if (config.plainAvatars) parts.push(t.benchCodePlain);
  if (config.settle) parts.push(t.benchCodeSettle);
  return parts.join(' ');
}

function deviceLines(d: BenchDevice): string[] {
  const unknown = t.benchUnknown;
  return [
    `${t.measureViewport}: ${d.viewport} @ ${d.dpr}`,
    `${t.measureAgent}: ${d.agent}`,
    fmt(t.benchDevice, {
      cores: d.cores ?? unknown,
      memory: d.memoryGb === null ? unknown : fmt(t.benchMemoryValue, { gb: d.memoryGb }),
      battery:
        d.battery === null
          ? unknown
          : fmt(t.benchBatteryValue, { level: Math.round(d.battery.level * 100), charging: d.battery.charging ? t.benchCharging : t.benchNotCharging }),
    }),
  ];
}

function scoreText(score: { averageMs: number; fps: number } | null): string {
  return score === null ? t.benchUnknown : fmt(t.benchScoreValue, { fps: n1(score.fps), ms: n1(score.averageMs) });
}

/** Rows of cells as plain text with aligned columns (two spaces between). */
export function alignColumns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows.map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ').trimEnd());
}

/** Table 1, timings: set-up, canvas size, FPS, dropped, frame interval and JS time. */
function timingCells(row: BenchRow): string[] {
  return [configCode(row.config), `${row.width}×${row.height}`, n1(row.fps), String(row.dropped), triple(row.interval), triple(row.js)];
}

/** Table 2, where the time went: the breakdown, labels per frame, faces, ops and long tasks. */
function partCells(row: BenchRow): string[] {
  const b = row.breakdown;
  const cell = (v: number | undefined) => (b === null || v === undefined ? '–' : n2(v));
  return [
    configCode(row.config),
    cell(b?.labelMs),
    cell(b?.booksMs),
    cell(b?.overlayMs),
    cell(b?.cameraMs),
    cell(b?.labels),
    n1(row.faces),
    n1(row.ops),
    row.longTasks === null ? t.benchLongUnsupported : fmt(t.benchLongValue, { count: row.longTasks.count, ms: Math.round(row.longTasks.ms) }),
  ];
}

/** The breakdown averaged over every set-up that drew frames (weighted by frames), or null. */
export function overallBreakdown(rows: readonly BenchRow[]): NonNullable<BenchRow['breakdown']> | null {
  let frames = 0;
  const sum = { labelMs: 0, booksMs: 0, overlayMs: 0, cameraMs: 0, labels: 0 };
  for (const row of rows) {
    if (!row.breakdown || row.frames <= 0) continue;
    frames += row.frames;
    for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += row.breakdown[key] * row.frames;
  }
  if (frames === 0) return null;
  return { labelMs: sum.labelMs / frames, booksMs: sum.booksMs / frames, overlayMs: sum.overlayMs / frames, cameraMs: sum.cameraMs / frames, labels: sum.labels / frames };
}

/**
 * The benchmark as plain text, narrow enough for a tablet screenshot: version, date and time,
 * viewport, agent, device, the two calibration scores, a key, then two aligned tables (timings,
 * and where the time went), one row per set-up, and the overall breakdown.
 */
export function formatBenchResult(result: BenchResult): string {
  const overall = overallBreakdown(result.rows);
  const v = (x: number | undefined) => (x === undefined ? '–' : n2(x));
  const lines = [
    result.version,
    fmt(t.benchFinished, { at: localStamp(new Date(result.at)) }) + (result.cancelled ? ` ${t.benchWasCancelled}` : ''),
    ...deviceLines(result.device),
    fmt(t.benchCalibrationStart, { score: scoreText(result.calibration.start) }),
    fmt(t.benchCalibrationEnd, { score: scoreText(result.calibration.end) }),
    '',
    t.benchKeySetup,
    t.benchKeyTiming,
    t.benchKeyParts,
    t.benchKeyParts2,
    '',
    ...alignColumns([t.benchColumnsTiming.split('|'), ...result.rows.map(timingCells)]),
    '',
    ...alignColumns([t.benchColumnsParts.split('|'), ...result.rows.map(partCells)]),
    '',
    fmt(t.benchBreakdownAll, {
      labels: v(overall?.labelMs),
      books: v(overall?.booksMs),
      overlays: v(overall?.overlayMs),
      camera: v(overall?.cameraMs),
      perFrame: v(overall?.labels),
    }),
  ];
  return lines.join('\n');
}

/** Where the last result is kept on this device (cleared by "Reset this device", like the app's other keys). */
export const BENCH_STORAGE_KEY = 'library-card:dev-stack-benchmark';
