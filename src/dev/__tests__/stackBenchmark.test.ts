import { describe, expect, it } from 'vitest';
import { PX_PER_BOOK } from '../../staircase/camera';
import { FAN_CAP } from '../../staircase/drawBudget';
import { TWIST_DEG } from '../../staircase/stackProjection';
import {
  BENCH_BOOKS_VISITED,
  BENCH_EXTRA_SCALE,
  BENCH_HOLD_MS,
  BENCH_LEG_MS,
  BENCH_RUN_MS,
  RESTORED,
  benchBooks,
  benchConfigs,
  benchHolding,
  benchScrollAt,
  calibrationScore,
  configCode,
  configLabel,
  droppedFrames,
  alignColumns,
  benchFilename,
  formatBenchResult,
  fpsOf,
  localStamp,
  overallBreakdown,
  overridesFor,
  percentile,
  summarize,
  type BenchResult,
} from '../stackBenchmark';

// The book stack benchmark's pure parts (src/dev/stackBenchmark.ts).

describe('benchConfigs', () => {
  const configs = benchConfigs();

  it('runs 14 set-ups: the 3 × 2 × 2 matrix, then plain avatars and settle on at 1.5×', () => {
    expect(configs).toHaveLength(14);
    const matrix = configs.slice(0, 12).map((c) => `${c.scale} ${c.labels} ${c.overlays ? 'on' : 'off'}`);
    expect(matrix).toEqual([
      '1 prewarmed on',
      '1 prewarmed off',
      '1 on-demand on',
      '1 on-demand off',
      '1.5 prewarmed on',
      '1.5 prewarmed off',
      '1.5 on-demand on',
      '1.5 on-demand off',
      '2 prewarmed on',
      '2 prewarmed off',
      '2 on-demand on',
      '2 on-demand off',
    ]);
    expect(configs[12]).toMatchObject({ scale: BENCH_EXTRA_SCALE, labels: 'on-demand', overlays: true, plainAvatars: true, settle: false });
    expect(configs[13]).toMatchObject({ scale: BENCH_EXTRA_SCALE, labels: 'on-demand', overlays: true, plainAvatars: false, settle: true });
  });

  it('uses the default twist everywhere and settle off except the one settle set-up', () => {
    expect(configs.every((c) => c.twist === TWIST_DEG)).toBe(true);
    expect(configs.filter((c) => c.settle)).toHaveLength(1);
    expect(configs.filter((c) => c.plainAvatars)).toHaveLength(1);
  });

  it('fixes everything for the stack, adaptive resolution off; afterwards nothing is overridden', () => {
    expect(overridesFor(configs[5])).toEqual({ scale: 1.5, adaptive: false, overlays: false, plainAvatars: false, settle: false, twist: TWIST_DEG });
    expect(configs.map(overridesFor).every((o) => o.adaptive === false)).toBe(true);
    expect(RESTORED).toBeNull();
  });

  it('gives each set-up a short code for the table', () => {
    expect(configs.map(configCode).slice(0, 4)).toEqual(['1× pre ovl', '1× pre -', '1× dem ovl', '1× dem -']);
    expect(configCode(configs[12])).toBe('1.5× dem ovl +plain');
    expect(configCode(configs[13])).toBe('1.5× dem ovl +settle');
  });

  it('names each set-up', () => {
    expect(configLabel(configs[0])).toBe('1× · labels prewarmed · overlays on');
    expect(configLabel(configs[12])).toBe('1.5× · labels on demand · overlays on · plain avatars');
    expect(configLabel(configs[13])).toBe('1.5× · labels on demand · overlays on · settle on');
  });
});

describe('the fixed scroll', () => {
  const far = (BENCH_BOOKS_VISITED * PX_PER_BOOK);

  it('goes down at six books a second, holds, and comes back to the top', () => {
    expect(benchScrollAt(0)).toBe(0);
    expect(benchScrollAt(1000)).toBeCloseTo(6 * PX_PER_BOOK, 9);
    expect(benchScrollAt(BENCH_LEG_MS)).toBeCloseTo(far, 9);
    expect(benchScrollAt(BENCH_LEG_MS + BENCH_HOLD_MS / 2)).toBeCloseTo(far, 9);
    expect(benchScrollAt(BENCH_LEG_MS + BENCH_HOLD_MS + 1000)).toBeCloseTo(far - 6 * PX_PER_BOOK, 9);
    expect(benchScrollAt(BENCH_RUN_MS)).toBeCloseTo(0, 9);
    expect(benchScrollAt(BENCH_RUN_MS + 500)).toBe(0);
    expect(benchScrollAt(-50)).toBe(0);
    expect(BENCH_RUN_MS).toBe(6400);
  });

  it('holds only in the middle', () => {
    expect(benchHolding(BENCH_LEG_MS - 1)).toBe(false);
    expect(benchHolding(BENCH_LEG_MS + 1)).toBe(true);
    expect(benchHolding(BENCH_LEG_MS + BENCH_HOLD_MS + 1)).toBe(false);
  });

  it('prewarms every book a run can show', () => {
    expect(benchBooks(1000, FAN_CAP)).toEqual({ from: 999 - 18 - FAN_CAP - 1, to: 1000 });
    expect(benchBooks(10, FAN_CAP)).toEqual({ from: 0, to: 10 });
  });
});

describe('frame maths', () => {
  it('takes nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 1)).toBe(100);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it('summarises average, p95 and worst', () => {
    expect(summarize([10, 20, 30, 40])).toEqual({ average: 25, p95: 40, worst: 40 });
    expect(summarize([])).toBeNull();
  });

  it('counts frames over 20 ms as dropped and works out FPS', () => {
    expect(droppedFrames([16.7, 16.6, 20, 20.1, 50])).toBe(2);
    expect(fpsOf([20, 20, 20, 20])).toBe(50);
    expect(fpsOf([])).toBe(0);
  });

  it('scores the device from its calibration frames, ignoring odd ones', () => {
    expect(calibrationScore([20, 25, 30, 25])).toEqual({ averageMs: 25, fps: 40 });
    expect(calibrationScore([0, Number.NaN, 40])).toEqual({ averageMs: 40, fps: 25 });
    expect(calibrationScore([])).toBeNull();
  });
});

describe('formatBenchResult', () => {
  const at = new Date(2026, 10, 23, 15, 4);
  const result: BenchResult = {
    version: 'Version 1.8.5 · abc1234 · built 23 Nov 2026, 23:00',
    at: at.toISOString(),
    device: { cores: 8, memoryGb: 4, battery: { level: 0.82, charging: true }, viewport: '600 × 884', dpr: 2, agent: 'Test agent' },
    calibration: { start: { averageMs: 20, fps: 50 }, end: null },
    rows: [
      {
        config: benchConfigs()[0],
        width: 600,
        height: 884,
        frames: 300,
        fps: 48.25,
        dropped: 12,
        interval: { average: 20.7, p95: 33.4, worst: 50.1 },
        js: { average: 3.21, p95: 5.6, worst: 9.04 },
        breakdown: { labelMs: 0.5, booksMs: 2.25, overlayMs: 0.125, cameraMs: 0.05, labels: 0.333 },
        faces: 87,
        ops: 150,
        longTasks: { count: 2, ms: 130.4 },
      },
      {
        config: benchConfigs()[13],
        width: 900,
        height: 1326,
        frames: 100,
        fps: 30,
        dropped: 40,
        interval: null,
        js: null,
        breakdown: { labelMs: 2.5, booksMs: 0.25, overlayMs: 0.125, cameraMs: 0.05, labels: 1.333 },
        faces: 0,
        ops: 0,
        longTasks: null,
      },
    ],
    cancelled: true,
  };
  const lines = formatBenchResult(result).split('\n');

  it('starts with the version, date and time, viewport, agent, device and both scores', () => {
    expect(lines.slice(0, 7)).toEqual([
      result.version,
      'Benchmark run 2026-11-23 15:04 (cancelled part-way)',
      'Viewport: 600 × 884 @ 2',
      'User agent: Test agent',
      'Device: 8 cores, memory 4 GB, battery 82% (charging)',
      'Device canvas score, start: 50.0 FPS (20.0 ms a frame)',
      'Device canvas score, end: unknown',
    ]);
  });

  const timing = lines.slice(lines.indexOf('') + 6, lines.indexOf('') + 9);
  const parts = lines.slice(lines.indexOf('') + 10, lines.indexOf('') + 13);

  it('has a timing table, lined up, one row per set-up', () => {
    expect(timing[0].startsWith('Set-up')).toBe(true);
    expect(timing[1].startsWith('1× pre ovl ')).toBe(true);
    expect(timing[2].startsWith('1.5× dem ovl +settle ')).toBe(true);
    for (const header of ['Canvas px', 'FPS', 'Drop', 'Int a/p95/max', 'JS a/p95/max']) {
      const col = timing[0].indexOf(header);
      expect(col).toBeGreaterThan(0);
      for (const row of timing.slice(1)) expect(row[col - 1]).toBe(' ');
    }
    expect(timing[1]).toContain('600×884');
    expect(timing[1]).toContain(' 48.3 ');
    expect(timing[1]).toContain(' 12 ');
    expect(timing[1]).toContain('20.7/33.4/50.1');
    expect(timing[1].endsWith('3.2/5.6/9.0')).toBe(true);
    expect(timing[2].endsWith('–')).toBe(true);
  });

  it('has a table of where the time went, lined up the same way', () => {
    expect(parts[0].startsWith('Set-up')).toBe(true);
    for (const header of ['Lbl', 'Book', 'Ovl', 'Cam', 'Lbl/f', 'Faces', 'Ops', 'Long']) {
      const col = parts[0].indexOf(` ${header}`) + 1;
      expect(col).toBeGreaterThan(0);
      for (const row of parts.slice(1)) expect(row[col - 1]).toBe(' ');
    }
    for (const v of ['0.50', '2.25', '0.13', '0.05', '0.33', '87.0', '150.0']) expect(parts[1]).toContain(` ${v} `);
    expect(parts[1].endsWith('2 (130 ms)')).toBe(true);
    expect(parts[2].endsWith('unsupported')).toBe(true);
  });

  it('keeps every line but the agent narrow enough for a tablet screenshot', () => {
    for (const line of lines.filter((l) => !l.startsWith('User agent'))) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('ends with the breakdown averaged over all set-ups, weighted by frames', () => {
    expect(lines[lines.length - 1]).toBe('All set-ups, ms/frame: lbl 1.00, book 1.75, ovl 0.13, cam 0.05; lbl/f 0.58');
    expect(overallBreakdown([])).toBeNull();
  });

  it('says unknown for device details the browser keeps to itself', () => {
    const text = formatBenchResult({ ...result, cancelled: false, device: { ...result.device, cores: null, memoryGb: null, battery: null } }).split('\n');
    expect(text[1]).toBe('Benchmark run 2026-11-23 15:04');
    expect(text[4]).toBe('Device: unknown cores, memory unknown, battery unknown');
    expect(text[6]).toBe('Device canvas score, end: unknown');
  });
});

describe('benchFilename, localStamp and alignColumns', () => {
  it('names the download after the version and the local time', () => {
    expect(benchFilename('1.8.5', new Date(2026, 0, 5, 9, 7))).toBe('library-card-benchmark-1.8.5-20260105-0907.txt');
    expect(benchFilename('1.8.5 (abc)', new Date(2026, 10, 23, 23, 59))).toBe('library-card-benchmark-1.8.5-abc-20261123-2359.txt');
    expect(benchFilename('', new Date(2026, 10, 23, 0, 0))).toBe('library-card-benchmark-unknown-20261123-0000.txt');
  });

  it('stamps local time', () => {
    expect(localStamp(new Date(2026, 1, 3, 4, 5))).toBe('2026-02-03 04:05');
  });

  it('pads each column to its widest cell, two spaces apart', () => {
    expect(alignColumns([
      ['a', 'bb', 'c'],
      ['aaa', 'b', 'cc'],
    ])).toEqual(['a    bb  c', 'aaa  b   cc']);
  });
});
