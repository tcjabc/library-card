import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Decor } from '../../staircase/drawBudget';
import { LAUNCH_PALETTE_SIZE, fallbackEntry, launchBookColours, launchBookToken } from '../launchPalette';
import {
  LAUNCH_BOOKS,
  LAUNCH_CAP_MS,
  LAUNCH_SEEN_KEY,
  LAUNCH_TIMING,
  isSplashHash,
  launchEndsAt,
  launchMode,
  launchStep,
  type LaunchContext,
  type LaunchMode,
  type LaunchPhase,
} from '../launchRule';

// 1.22.0: the launch shelf in the splash header (docs/launch.md).

const cold: LaunchContext = { hash: '', navigationType: 'navigate', seen: false, decor: 'full', reducedMotion: false };

describe('launchMode: it plays only on a cold start at the splash', () => {
  it('a fresh launch at the splash builds the whole shelf', () => {
    expect(launchMode(cold)).toBe('full');
    expect(launchMode({ ...cold, hash: '#/' })).toBe('full');
    expect(launchMode({ ...cold, hash: '#' })).toBe('full');
  });

  it('every combination of hash, navigation type and session flag', () => {
    const hashes = ['', '#', '#/', '#/scan', '#/card/abc', '#/hub', '#/?x=1', '#/grownups/settings'];
    const types = ['navigate', 'reload', 'back_forward', 'prerender', null];
    for (const hash of hashes)
      for (const navigationType of types)
        for (const seen of [false, true]) {
          const expected = isSplashHash(hash) && (navigationType === 'navigate' || navigationType === null) && !seen ? 'full' : 'still';
          expect(launchMode({ ...cold, hash, navigationType, seen }), `${hash} ${navigationType} ${seen}`).toBe(expected);
        }
  });

  it('deep links never play it: a card link, the scanner, any other route', () => {
    for (const hash of ['#/card/token123', '#/scan', '#/scan?reader=r1', '#/journey', '#/dev']) expect(launchMode({ ...cold, hash })).toBe('still');
  });

  it('reloads (an update, "Check for updates", the database upgrade) and back/forward never replay it', () => {
    expect(launchMode({ ...cold, navigationType: 'reload' })).toBe('still');
    expect(launchMode({ ...cold, navigationType: 'back_forward' })).toBe('still');
  });

  it('once it has played in this tab (the session flag), never again', () => {
    expect(launchMode({ ...cold, seen: true })).toBe('still');
    expect(LAUNCH_SEEN_KEY.startsWith('library-card:')).toBe(true);
  });

  it('the motion rules: None or reduced motion show the finished shelf; Reduced fades the books in', () => {
    const decors: Decor[] = ['full', 'reduced', 'none'];
    const expect_: Record<Decor, LaunchMode> = { full: 'full', reduced: 'reduced', none: 'still' };
    for (const decor of decors) {
      expect(launchMode({ ...cold, decor })).toBe(expect_[decor]);
      expect(launchMode({ ...cold, decor, reducedMotion: true })).toBe('still');
    }
  });
});

describe('launchStep: idle → playing → done', () => {
  it('start plays, or is done at once for the finished shelf', () => {
    expect(launchStep('idle', { type: 'start', mode: 'full' })).toBe('playing');
    expect(launchStep('idle', { type: 'start', mode: 'reduced' })).toBe('playing');
    expect(launchStep('idle', { type: 'start', mode: 'still' })).toBe('done');
  });

  it('a skip or the end finishes it; done stays done; a second start changes nothing', () => {
    expect(launchStep('playing', { type: 'skip' })).toBe('done');
    expect(launchStep('playing', { type: 'end' })).toBe('done');
    expect(launchStep('playing', { type: 'start', mode: 'full' })).toBe('playing');
    const events = [{ type: 'start', mode: 'full' }, { type: 'skip' }, { type: 'end' }] as const;
    for (const event of events) expect(launchStep('done' as LaunchPhase, event)).toBe('done');
    expect(launchStep('idle', { type: 'skip' })).toBe('done');
  });
});

describe('timing', () => {
  it('Full is done by about 1.8 s and Reduced by about 0.6 s, both within the 2 s cap', () => {
    expect(launchEndsAt('full')).toBeLessThanOrEqual(LAUNCH_TIMING.total);
    expect(LAUNCH_TIMING.total).toBeLessThanOrEqual(LAUNCH_CAP_MS);
    expect(launchEndsAt('full')).toBeGreaterThan(1500);
    expect(launchEndsAt('reduced')).toBeLessThanOrEqual(600);
    expect(launchEndsAt('still')).toBe(0);
  });

  it('the plan’s phases: sides 0–250 ms, boards 150–450 ms, books from 350 ms, 60 ms apart, 420 ms each', () => {
    const t = LAUNCH_TIMING;
    expect(t.side).toBe(250);
    expect(t.boardsStart).toBe(150);
    expect(t.boardsStart + 2 * t.stagger + t.board).toBe(450);
    expect([t.booksStart, t.stagger, t.drop]).toEqual([350, 60, 420]);
    expect(t.booksStart + (LAUNCH_BOOKS - 1) * t.stagger + t.drop).toBe(launchEndsAt('full'));
  });

  it('the CSS tokens say the same as the constants', () => {
    const css = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8');
    const ms = (name: string) => {
      const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+)(ms|s);`));
      if (!m) throw new Error(`no --${name}`);
      return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
    };
    const t = LAUNCH_TIMING;
    expect(ms('duration-launch')).toBe(t.total);
    expect(ms('duration-launch-side')).toBe(t.side);
    expect(ms('duration-launch-board')).toBe(t.board);
    expect(ms('duration-launch-drop')).toBe(t.drop);
    expect(ms('duration-launch-fade')).toBe(t.fade);
    expect(ms('launch-boards-start')).toBe(t.boardsStart);
    expect(ms('launch-books-start')).toBe(t.booksStart);
    expect(ms('launch-stagger')).toBe(t.stagger);
    expect(ms('launch-fade-stagger')).toBe(t.fadeStagger);
  });
});

describe('launchBookColours: real colours later, tokens for now', () => {
  it('with nothing given, every book takes a palette token, all eight used, no two neighbours alike', () => {
    const colours = launchBookColours();
    expect(colours).toHaveLength(LAUNCH_BOOKS);
    expect(colours.every((c) => /^var\(--launch-book-[1-8]\)$/.test(c))).toBe(true);
    expect(new Set(colours).size).toBe(LAUNCH_PALETTE_SIZE);
    for (let i = 1; i < colours.length; i++) expect(colours[i]).not.toBe(colours[i - 1]);
  });

  it('given colours come first (valid hex only), the palette fills the rest', () => {
    const colours = launchBookColours(['#AA3311', 'red', '#123', '#00ff00']);
    expect(colours[0]).toBe('#aa3311');
    expect(colours[1]).toBe('#00ff00');
    expect(colours[2]).toBe(launchBookToken(fallbackEntry(2)));
    expect(launchBookColours(['#aa3311'], 3)).toHaveLength(3);
    expect(launchBookColours(Array(30).fill('#abcdef'))).toHaveLength(LAUNCH_BOOKS);
  });
});
