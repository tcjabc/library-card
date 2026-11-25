import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoverState } from '../coverArt';
import { coverReportLines, flatReason, latestCoverReport, provideCoverReport, type CoverReport, type CoverReportBook } from '../coverDiagnostics';
import { COVER_MIN_PX } from '../coverPlan';
import { strings } from '../../strings';

const cover = (over: Partial<CoverState> = {}): CoverState => ({
  source: 'openlibrary',
  state: 'ready',
  reason: null,
  until: null,
  attempts: 0,
  openLibrary: null,
  colour: 'yes',
  shape: true,
  ...over,
});

const book = (over: Partial<CoverReportBook> = {}): CoverReportBook => ({
  number: 1,
  title: 'Moon Soup',
  key: '9780000000001',
  hasCover: true,
  drawn: true,
  topPx: 40,
  cover: cover(),
  ...over,
});

describe('why a top face is flat', () => {
  it('shows its cover when drawn, big enough and ready', () => {
    expect(flatReason(book())).toBeNull();
  });

  it('no cover, or covers switched off on this device', () => {
    expect(flatReason(book({ hasCover: false, cover: null }))).toBe('no cover');
    expect(flatReason(book({ cover: null }))).toBe('covers off');
  });

  it('a failed or waiting cover says so first, wherever the book is', () => {
    expect(flatReason(book({ cover: cover({ state: 'failed', reason: '404' }) }))).toBe('failed');
    expect(flatReason(book({ drawn: false, topPx: null, cover: cover({ state: 'backoff', reason: '429' }) }))).toBe('backoff');
  });

  it('then the drawing: outside the drawn range, the top face not showing, or too thin on screen (LOD)', () => {
    expect(flatReason(book({ drawn: false, topPx: null }))).toBe('outside draw range');
    expect(flatReason(book({ topPx: null }))).toBe('top face hidden');
    expect(flatReason(book({ topPx: COVER_MIN_PX - 0.5 }))).toBe('LOD');
    expect(flatReason(book({ topPx: COVER_MIN_PX }))).toBeNull();
  });

  it('else still on its way', () => {
    expect(flatReason(book({ cover: cover({ state: 'loading' }) }))).toBe('loading');
    expect(flatReason(book({ cover: cover({ state: 'not requested' }) }))).toBe('not requested');
  });
});

describe('the report as text (Copy)', () => {
  const time = (ms: number) => `t${ms}`;
  const report: CoverReport = {
    at: 1000,
    books: [
      book({ number: 1, title: 'Old Book', key: '9780000000001' }),
      book({ number: 2, title: 'Busy Park', key: '9789571234567', cover: cover({ source: 'google', openLibrary: '404', colour: 'no' }) }),
      book({ number: 3, title: 'Waiting', key: '9780000000003', cover: cover({ state: 'backoff', reason: '429', until: 5000, attempts: 1 }) }),
      book({ number: 4, title: 'Thin', key: 'noisbn-x', topPx: 3.24, cover: cover({ colour: 'none', shape: false }) }),
      book({ number: 5, title: 'Plain', key: '9780000000005', hasCover: false, cover: null }),
    ],
  };

  it('a header, then one line per book, newest first, with the source, state, caches and the top face', () => {
    const lines = coverReportLines(report, strings.dev, time);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('5 books');
    expect(lines[0]).toContain('t1000');
    expect(lines[1]).toBe('#5 Plain (9780000000005) · none · – · colour – · shape – · top: flat, no cover');
    expect(lines[2]).toBe('#4 Thin (noisbn-x) · Open Library · ready · colour cached (none usable) · shape not cached · top: flat, LOD (face 3.2 px)');
    expect(lines[3]).toBe('#3 Waiting (9780000000003) · Open Library · backoff until t5000 (429, try 1 of 3) · colour cached · shape cached · top: flat, backoff');
    expect(lines[4]).toBe('#2 Busy Park (9789571234567) · Google img (Open Library 404) · ready · colour not cached · shape cached · top: cover');
    expect(lines[5]).toBe('#1 Old Book (9780000000001) · Open Library · ready · colour cached · shape cached · top: cover');
  });

  it('a failure names its reason and tries', () => {
    const [, line] = coverReportLines({ at: 0, books: [book({ cover: cover({ state: 'failed', reason: '404', attempts: 1 }) })] }, strings.dev, time);
    expect(line).toContain('failed 404 (1 tries)');
    expect(line).toContain('top: flat, failed 404');
  });
});

describe('the pile’s latest report', () => {
  it('live while the pile is open, kept as it closes', () => {
    let n = 0;
    const close = provideCoverReport(() => ({ at: ++n, books: [] }));
    expect(latestCoverReport()?.at).toBe(1);
    expect(latestCoverReport()?.at).toBe(2);
    close();
    expect(latestCoverReport()?.at).toBe(3);
    expect(latestCoverReport()?.at).toBe(3);
  });

  it('a pile closing after another opened leaves the newer one in charge', () => {
    const closeA = provideCoverReport(() => ({ at: 10, books: [] }));
    const closeB = provideCoverReport(() => ({ at: 20, books: [] }));
    closeA();
    expect(latestCoverReport()?.at).toBe(20);
    closeB();
    expect(latestCoverReport()?.at).toBe(20);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the last one survives a reload in this tab (sessionStorage), and nothing is kept without it', async () => {
    const session = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) } });
    vi.resetModules();
    const before = await import('../coverDiagnostics');
    before.provideCoverReport(() => ({ at: 42, books: [book()] }))();
    expect(session.has(before.REPORT_KEY)).toBe(true);
    vi.resetModules();
    const after = await import('../coverDiagnostics');
    expect(after.latestCoverReport()).toEqual({ at: 42, books: [book()] });
    session.set(after.REPORT_KEY, 'not json');
    vi.resetModules();
    expect((await import('../coverDiagnostics')).latestCoverReport()).toBeNull();
  });
});
