import { describe, expect, it } from 'vitest';
import {
  BOUNCE,
  BURST_MS,
  CAP_MS,
  DROP_HEIGHT,
  FIRST_MS,
  GRAVITY,
  HIGHLIGHT_MS,
  MIN_REBOUND,
  PILE_FALLOFF,
  SPIN_DEG,
  SQUASH,
  STAGGER_MS,
  TAIL_MS,
  WEIGHT,
  addFallers,
  bookMass,
  dropActive,
  dropCamera,
  dropDelays,
  dropLift,
  dropSpin,
  fallTime,
  gravityFor,
  highlightAlpha,
  impactImpulse,
  landingSpeed,
  landedCount,
  markerAlpha,
  pileOffset,
  spinYaw,
  squashScale,
  startDrop,
  stepDrop,
  thud,
  vibrationMs,
  waiting,
  type DropWorld,
  type Impact,
} from '../dropMotion';

// New books falling onto the pile (src/staircase/dropMotion.ts).

const THIN = () => 28;

/** Run a world in 16 ms frames until it's still (or `maxMs`), collecting the landings with their times. */
function run(world: DropWorld, maxMs = 10000, each?: (w: DropWorld) => void): (Impact & { at: number })[] {
  const out: (Impact & { at: number })[] = [];
  for (let t = 0; t < maxMs && dropActive(world); t += 16) {
    for (const hit of stepDrop(world, 16, THIN)) out.push({ ...hit, at: world.t });
    each?.(world);
  }
  return out;
}

describe('the constants', () => {
  it('are the mock-up’s defaults', () => {
    expect(WEIGHT).toBe(5);
    expect(GRAVITY).toBe(2200);
    expect(gravityFor(5)).toBe(700 + 300 * 5);
    expect(DROP_HEIGHT).toBe(420);
    expect(BOUNCE).toBe(0.15);
    expect(SQUASH).toBe(0.5);
    expect(STAGGER_MS).toBe(260);
    expect(FIRST_MS).toBe(120);
    expect(SPIN_DEG).toBe(60);
  });
});

describe('the plan', () => {
  it('lets the first book go after 120 ms, then one every 260 ms', () => {
    expect(dropDelays(0)).toEqual([]);
    expect(dropDelays(1)).toEqual([120]);
    expect(dropDelays(3)).toEqual([120, 380, 640]);
    expect(dropDelays(8)).toEqual([120, 380, 640, 900, 1160, 1420, 1680, 1940]);
  });

  it('more than 8: the older ones in a quick 50 ms burst, then the last 8 at 260 ms', () => {
    const nine = dropDelays(9);
    expect(nine).toHaveLength(9);
    expect(nine.slice(1).map((d, k) => d - nine[k])).toEqual(Array(8).fill(STAGGER_MS));
    const twelve = dropDelays(12);
    const gaps = twelve.slice(1).map((d, k) => d - twelve[k]);
    expect(gaps.slice(0, 3)).toEqual([BURST_MS, BURST_MS, BURST_MS]);
    expect(gaps.slice(3)).toEqual(Array(8).fill(STAGGER_MS));
  });

  it('keeps the whole drop to about 4 seconds, in order', () => {
    for (const n of [8, 9, 20, 25, 40]) {
      const d = dropDelays(n);
      expect(d[0]).toBe(FIRST_MS);
      for (let k = 1; k < n; k++) expect(d[k]).toBeGreaterThan(d[k - 1]);
      expect(d[n - 1] + fallTime() * 1000 + TAIL_MS).toBeLessThanOrEqual(CAP_MS + 1e-6);
    }
    // 40 books: the whole thing, bounces and spring included, is still at about 4 s.
    const world = startDrop(100, 140);
    run(world);
    expect(world.t).toBeLessThan(CAP_MS + 1000);
  });
});

describe('falling and landing', () => {
  it('a 420-unit fall at g = 2200 takes 0.618 s and lands at 1,359 units/s', () => {
    expect(fallTime()).toBeCloseTo(Math.sqrt((2 * 420) / 2200), 10);
    expect(fallTime() * 1000).toBeCloseTo(618, 0);
    expect(landingSpeed()).toBeCloseTo(1359.4, 1);
    const world = startDrop(10, 11);
    const hits = run(world);
    expect(hits[0].at).toBeGreaterThan(FIRST_MS + 618 - 17);
    expect(hits[0].at).toBeLessThan(FIRST_MS + 618 + 17);
    expect(hits[0].speed).toBeCloseTo(landingSpeed(), -1);
  });

  it('bounces once (1,359 × 0.15 = 204 > 130), then stops (204 × 0.15 = 31 < 130)', () => {
    expect(landingSpeed() * BOUNCE).toBeGreaterThan(MIN_REBOUND);
    const world = startDrop(10, 11);
    const hits = run(world);
    expect(hits).toHaveLength(2);
    expect(hits[0].first).toBe(true);
    expect(hits[1].first).toBe(false);
    expect(hits[1].speed).toBeCloseTo(landingSpeed() * BOUNCE, -1);
    expect(hits[1].speed * BOUNCE).toBeLessThan(MIN_REBOUND);
    expect(world.fallers[0].state).toBe('resting');
    expect(world.fallers[0].h).toBe(0);
  });

  it('books land in order, oldest new book first, each once as its first landing', () => {
    for (const n of [3, 9, 20]) {
      const hits = run(startDrop(50, 50 + n)).filter((h) => h.first);
      expect(hits.map((h) => h.index)).toEqual(Array.from({ length: n }, (_, k) => 50 + k));
    }
  });

  it('never passes through the book below: at every step each book is at or above the one under it', () => {
    for (const n of [2, 3, 8, 9, 12, 40]) {
      const world = startDrop(0, n);
      run(world, 10000, (w) => {
        for (let k = 1; k < w.fallers.length; k++) {
          const below = w.fallers[k - 1];
          const above = w.fallers[k];
          if (above.state === 'waiting') continue;
          expect(below.state).not.toBe('waiting');
          expect(above.h).toBeGreaterThanOrEqual(below.h - 1e-9);
        }
      });
      expect(world.fallers.every((f) => f.state === 'resting' && f.h === 0)).toBe(true);
    }
  });

  it('a book isn’t there until it’s let go, then turns in by up to 60°, unwinding as it falls', () => {
    const world = startDrop(5, 7);
    expect(waiting(world, 5)).toBe(true);
    expect(dropLift(world, 5)).toBe(0);
    stepDrop(world, FIRST_MS + 1, THIN);
    expect(waiting(world, 5)).toBe(false);
    expect(waiting(world, 6)).toBe(true);
    expect(dropLift(world, 5)).toBeGreaterThan(DROP_HEIGHT - 2);
    expect(dropSpin(world, 5)).toBeGreaterThan(SPIN_DEG - 1);
    expect(spinYaw(DROP_HEIGHT)).toBe(SPIN_DEG);
    expect(spinYaw(DROP_HEIGHT / 2)).toBe(SPIN_DEG / 2);
    expect(spinYaw(0)).toBe(0);
    run(world);
    expect(dropSpin(world, 5)).toBe(0);
    expect(landedCount(world)).toBe(2);
  });

  it('more books arriving during a drop go after the ones waiting, in order', () => {
    const world = startDrop(10, 12);
    stepDrop(world, 200, THIN);
    addFallers(world, 12, 14);
    expect(world.fallers.map((f) => f.index)).toEqual([10, 11, 12, 13]);
    const d = world.fallers.map((f) => f.delay);
    for (let k = 1; k < d.length; k++) expect(d[k]).toBeGreaterThan(d[k - 1]);
    expect(run(world).filter((h) => h.first).map((h) => h.index)).toEqual([10, 11, 12, 13]);
  });
});

describe('the landing’s weight', () => {
  it('mass from thickness (28 = 1), clamped; impulse from speed, at most 1.4 × mass', () => {
    expect(bookMass(28)).toBe(1);
    expect(bookMass(42)).toBe(1.5);
    expect(bookMass(5)).toBe(0.45);
    expect(bookMass(200)).toBe(2.5);
    expect(impactImpulse(700, 1)).toBe(0.5);
    expect(impactImpulse(5000, 1)).toBe(1.4);
    expect(impactImpulse(1400, 1.5)).toBe(1.5);
  });

  it('the pile’s spring is kicked down and settles exactly to zero; the loop stops', () => {
    const world = startDrop(10, 11);
    let pushed = 0;
    run(world, 10000, (w) => (pushed = Math.max(pushed, w.comp)));
    expect(pushed).toBeGreaterThan(1);
    expect(world.comp).toBe(0);
    expect(world.compV).toBe(0);
    expect(dropActive(world)).toBe(false);
  });

  it('the push is full at the landing book and above, fading down the pile below it', () => {
    const world = startDrop(10, 11);
    world.comp = 10;
    world.at = 20;
    expect(pileOffset(world, 20)).toBe(10);
    expect(pileOffset(world, 25)).toBe(10);
    expect(pileOffset(world, 20 - PILE_FALLOFF)).toBeCloseTo(10 / Math.E, 10);
    expect(pileOffset(world, 0)).toBeCloseTo(10 * Math.exp(-20 / PILE_FALLOFF), 10);
    expect(pileOffset(world, 19)).toBeGreaterThan(pileOffset(world, 18));
    world.comp = 0;
    expect(pileOffset(world, 5)).toBe(0);
    // Pushed down means lifted less.
    world.comp = 4;
    expect(dropLift(world, 3)).toBeLessThan(0);
  });

  it('squash: min(1, impulse) × 0.5 on landing, thinner and wider, fading by exp(-12 dt)', () => {
    const world = startDrop(10, 11);
    let first = 0;
    for (let t = 0; t < 2000 && first === 0; t += 4) {
      stepDrop(world, 4, THIN);
      first = world.squash.get(10) ?? 0;
    }
    const impulse = impactImpulse(landingSpeed(), 1);
    expect(first).toBeGreaterThan(Math.min(1, impulse) * SQUASH * Math.exp(-12 * 0.004) - 1e-6);
    expect(first).toBeLessThanOrEqual(Math.min(1, impulse) * SQUASH + 1e-9);
    expect(squashScale(0.5)).toEqual({ thickness: 1 - 0.45 * 0.5, footprint: 1 + 0.1 * 0.5 });
    run(world);
    expect(world.squash.size).toBe(0);
  });

  it('dust: 5–10 specks a landing, fading out in under a second', () => {
    const world = startDrop(10, 11);
    let most = 0;
    let longest = 0;
    run(world, 10000, (w) => {
      most = Math.max(most, w.dust.length);
      for (const d of w.dust) longest = Math.max(longest, d.life);
    });
    expect(most).toBeGreaterThanOrEqual(5);
    expect(most).toBeLessThanOrEqual(10);
    expect(longest).toBeLessThanOrEqual(0.85);
    expect(world.dust).toHaveLength(0);
  });

  it('markers: hidden until their book lands, then fading in; other books’ as usual', () => {
    const world = startDrop(10, 11);
    expect(markerAlpha(world, 10)).toBe(0);
    expect(markerAlpha(world, 9)).toBe(1);
    run(world);
    expect(markerAlpha(world, 10)).toBe(1);
  });
});

describe('the camera during a drop', () => {
  const K = 5;

  it('a short pile stays on its base book: the books fall above the eye line', () => {
    for (let landed = 1; landed <= K + 1; landed++) expect(dropCamera(landed, K)).toBe(0);
  });

  it('a tall pile follows the highest landed book up', () => {
    expect(dropCamera(40, K)).toBe(39);
    expect(dropCamera(41, K)).toBe(40);
  });

  it('a pile growing past K moves from the base book to the newest (eased by the camera, no jump in the rule)', () => {
    expect(dropCamera(K + 1, K)).toBe(0);
    expect(dropCamera(K + 2, K)).toBe(K + 1);
  });
});

describe('sound, vibration and the highlight', () => {
  it('the thud: 190 − 11 × weight − 14 × mass Hz down to 40, gain from the impulse × 0.6, noise at 0.6 of it', () => {
    const a = thud(1, 0.97);
    expect(a.f0).toBe(190 - 55 - 14);
    expect(a.f1).toBe(40);
    expect(a.sweep).toBe(0.2);
    expect(a.attack).toBe(0.006);
    expect(a.release).toBe(0.3);
    expect(a.gain).toBeCloseTo(0.97 * 0.6, 10);
    expect(a.noiseGain).toBeCloseTo(0.6 * a.gain, 10);
    expect(a.noiseLength).toBe(0.09);
    expect(a.lowpass).toBe(700 - 200);
    expect(thud(1, 3).gain).toBeCloseTo(0.6, 10);
    expect(thud(10, 1).f0).toBe(Math.max(60, 190 - 55 - 35));
    expect(thud(0.45, 0.2).gain).toBeLessThan(a.gain);
  });

  it('vibrates 15 ms for a soft landing up to 25 ms for a hard one', () => {
    expect(vibrationMs(0)).toBe(15);
    expect(vibrationMs(0.5)).toBe(20);
    expect(vibrationMs(1)).toBe(25);
    expect(vibrationMs(3)).toBe(25);
  });

  it('the highlight is one calm pulse of about 600 ms', () => {
    expect(HIGHLIGHT_MS).toBe(600);
    expect(highlightAlpha(0)).toBe(0);
    expect(highlightAlpha(300)).toBeCloseTo(1, 10);
    expect(highlightAlpha(600)).toBe(0);
    expect(highlightAlpha(900)).toBe(0);
  });
});
