import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bookLift } from '../eyeGap';
import {
  GROUND_DEPTH,
  GROUND_FULL_HEIGHT,
  GROUND_SCALE_MIN,
  HORIZON_HAZE,
  SCENE_DROP,
  SCENE_RISE,
  SHADOW_FADE_HEIGHT,
  SKY_BUCKETS,
  SKY_SAMPLES,
  SKY_STOP_T,
  SkyGradients,
  altitudeAt,
  contrast,
  groundContactY,
  groundInView,
  groundShadowFootprint,
  groundSize,
  horizonY,
  lineInk,
  mix,
  parseColour,
  shadowInView,
  shadowStrength,
  skyAltitude,
  skyColour,
  skyStops,
  skyT,
  viewSky,
  type Rgba,
} from '../scenery';
import { pileCentres } from '../stackProjection';

const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe('skyT: absolute, logarithmic altitude', () => {
  it('is 0 at the horizon, about a third at 10 books, two thirds at 100 and 1 at 1,000', () => {
    expect(skyT(0)).toBe(0);
    close(skyT(10), Math.log(11) / Math.log(1001));
    expect(skyT(10)).toBeCloseTo(0.347, 3);
    expect(skyT(100)).toBeCloseTo(0.668, 3);
    expect(skyT(1000)).toBe(1);
  });

  it('clamps: nothing below the horizon, space above 1,000 books, and nonsense is the horizon', () => {
    expect(skyT(-5)).toBe(0);
    expect(skyT(5000)).toBe(1);
    expect(skyT(Number.NaN)).toBe(0);
  });

  it('skyAltitude is its inverse', () => {
    for (const alt of [0, 1, 10, 55, 100, 999]) close(skyAltitude(skyT(alt)), alt, 6);
    expect(skyAltitude(2)).toBeCloseTo(1000, 6);
  });

  it('puts the four sky colours at 0, 10, 100 and 1,000 books', () => {
    expect(SKY_STOP_T).toEqual([0, skyT(10), skyT(100), 1]);
  });
});

/** A phone's pile area: 390 × 660 px, the eye line in the middle. */
const VIEW = { width: 390, height: 660, originY: 330 };

/** The view's sky for a pile of `count` 28 px books with the camera at `s` (gap on). */
function viewFor(count: number, s: number) {
  const centres = pileCentres(Array.from({ length: count }, () => 28));
  const contact = groundContactY(centres, s, bookLift(0, s, true), VIEW.originY);
  const horizon = horizonY(contact);
  return { contact, horizon, sky: viewSky(horizon, VIEW.height, true) };
}

describe('skyStops and the view’s sky', () => {
  it('samples SKY_SAMPLES points evenly down the view, each at its own altitude', () => {
    const stops = skyStops(skyT(20), skyT(0));
    expect(stops).toHaveLength(SKY_SAMPLES);
    expect(stops.map((s) => s.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    close(stops[0].t, skyT(20));
    close(stops[2].t, skyT(10));
    close(stops[4].t, 0);
    // t falls faster near the horizon: the log curve, not a straight line.
    expect(stops[2].t).toBeGreaterThan((stops[0].t + stops[4].t) / 2);
  });

  it('a pile of 1 on its base book: the horizon is in view, the sky runs from about 14 books up down to it', () => {
    const v = viewFor(1, 0);
    expect(v.sky).not.toBeNull();
    expect(v.sky!.bottom).toBeCloseTo(v.horizon, 6);
    expect(v.sky!.tBottom).toBe(0);
    expect(altitudeAt(0, v.horizon)).toBeGreaterThan(8);
    expect(altitudeAt(0, v.horizon)).toBeLessThan(10);
    expect(v.sky!.tTop).toBeGreaterThan(0.3);
    expect(v.sky!.tTop).toBeLessThan(0.36);
  });

  it('a pile of 11 at its newest book: the top of the view is about 20 books above the horizon', () => {
    const v = viewFor(11, 10);
    expect(v.sky!.tTop).toBeGreaterThan(skyT(15));
    expect(v.sky!.tTop).toBeLessThan(skyT(25));
    // Its ground is still in view, low on the screen: the sky ends at the horizon.
    expect(v.horizon).toBeGreaterThan(VIEW.originY);
    expect(v.sky!.bottom).toBeCloseTo(v.horizon, 6);
  });

  it('a pile of 100 at its newest book: an upper sky, nearly one colour across the view', () => {
    const v = viewFor(100, 99);
    expect(v.sky!.bottom).toBe(VIEW.height);
    expect(v.sky!.tTop).toBeGreaterThan(SKY_STOP_T[2]);
    expect(v.sky!.tTop - v.sky!.tBottom).toBeLessThan(0.05);
  });

  it('a pile of 1,000 at its newest book: the edge of space', () => {
    const v = viewFor(1000, 999);
    expect(v.sky!.tTop).toBe(1);
    expect(v.sky!.tBottom).toBeGreaterThan(0.99);
  });

  it('the same altitude has the same sky whatever the pile size (it never changes as the pile grows)', () => {
    expect(viewFor(11, 5).sky).toEqual(viewFor(1000, 5).sky);
  });

  it('no sky at all when the ground fills the view', () => {
    expect(viewSky(-10, VIEW.height, true)).toBeNull();
    // With the ground off the sky still runs to the bottom (the horizon's own colour below it).
    const off = viewSky(-10, VIEW.height, false);
    expect(off).toEqual({ tTop: 0, tBottom: 0, bottom: VIEW.height });
  });
});

describe('the ground', () => {
  it('meets the base book’s bottom: half a book below the eye line with the camera on it', () => {
    const v = viewFor(5, 0);
    close(v.contact, VIEW.originY + SCENE_RISE * 14);
  });

  it('moves 1:1 with the base book, its gap lift included', () => {
    const centres = pileCentres([28, 28, 28, 28]);
    const s = 2;
    const lift = bookLift(0, s, true);
    expect(lift).toBeLessThan(0);
    const withGap = groundContactY(centres, s, lift, VIEW.originY);
    const without = groundContactY(centres, s, 0, VIEW.originY);
    close(withGap - without, -SCENE_RISE * lift);
    // One book up the pile moves it down by one book on screen.
    close(groundContactY(centres, 3, lift, VIEW.originY) - withGap, SCENE_RISE * 28);
  });

  it('the horizon is sin 24° × GROUND_DEPTH above the contact line', () => {
    close(horizonY(500), 500 - SCENE_DROP * GROUND_DEPTH);
    expect(SCENE_DROP * GROUND_DEPTH).toBeCloseTo(122, 0);
    expect(horizonY(500, -4)).toBe(500);
  });

  it('groundSize: a portrait phone or a tablet gets all of GROUND_DEPTH, as before', () => {
    for (const h of [GROUND_FULL_HEIGHT, VIEW.height, 760, 1180]) {
      expect(groundSize(h)).toEqual({ depth: GROUND_DEPTH, haze: HORIZON_HAZE });
    }
  });

  it('groundSize: shorter views get less ground in proportion, clamped at GROUND_SCALE_MIN', () => {
    const k = 400 / GROUND_FULL_HEIGHT;
    expect(k).toBeGreaterThan(GROUND_SCALE_MIN);
    close(groundSize(400).depth, GROUND_DEPTH * k);
    close(groundSize(400).haze, HORIZON_HAZE * k);
    for (const h of [GROUND_FULL_HEIGHT * GROUND_SCALE_MIN, 200, 1]) {
      close(groundSize(h).depth, GROUND_DEPTH * GROUND_SCALE_MIN);
      close(groundSize(h).haze, HORIZON_HAZE * GROUND_SCALE_MIN);
    }
    // Nonsense heights (not yet measured) get the full ground.
    expect(groundSize(0).depth).toBe(GROUND_DEPTH);
    expect(groundSize(Number.NaN).depth).toBe(GROUND_DEPTH);
  });

  it('a phone on its side (289 px), on the base book: a clear band of sky above the horizon', () => {
    const height = 289;
    const centres = pileCentres([28]);
    const contact = groundContactY(centres, 0, bookLift(0, 0, true), height / 2);
    const fullBand = horizonY(contact);
    const band = horizonY(contact, groundSize(height).depth);
    expect(groundSize(height).depth).toBeLessThan(GROUND_DEPTH * 0.61);
    close(band - fullBand, SCENE_DROP * (GROUND_DEPTH - groundSize(height).depth));
    expect(fullBand).toBeLessThan(45);
    expect(band).toBeGreaterThan(80);
    expect(viewSky(band, height, true)!.bottom).toBe(band);
  });

  it('scrolls away as the camera climbs: the contact line leaves after about 11 books, the horizon after about 16', () => {
    const inView = (s: number) => groundInView(viewFor(1000, s).horizon, VIEW.height);
    const contactIn = (s: number) => shadowInView(viewFor(1000, s).contact, VIEW.height, 0);
    expect(contactIn(11)).toBe(true);
    expect(contactIn(12)).toBe(false);
    expect(inView(15)).toBe(true);
    expect(inView(16)).toBe(false);
    expect(inView(999)).toBe(false);
  });

  it('the shadow is the base book’s footprint at height 0, grown by the spread and turned with the book', () => {
    const square = groundShadowFootprint({ width: 190, depth: 124 }, 0, 400, 200);
    expect(square).toEqual([
      { x: 105, y: 400 - SCENE_DROP * 62 },
      { x: 295, y: 400 - SCENE_DROP * 62 },
      { x: 295, y: 400 + SCENE_DROP * 62 },
      { x: 105, y: 400 + SCENE_DROP * 62 },
    ]);
    const grown = groundShadowFootprint({ width: 190, depth: 124 }, 0, 400, 200, { across: 4, along: 14 }, 6);
    close(grown[1].x - grown[0].x, 198);
    close(grown[2].y - grown[1].y, SCENE_DROP * 152);
    // Moved towards the reader: its middle is below the contact point.
    close((grown[0].y + grown[2].y) / 2, 400 + SCENE_DROP * 6);
    // A quarter turn swaps the spine and the depth on screen.
    const turned = groundShadowFootprint({ width: 190, depth: 124 }, 90, 400, 200);
    const xs = turned.map((p) => p.x);
    const ys = turned.map((p) => p.y);
    close(Math.max(...xs) - Math.min(...xs), 124);
    close(Math.max(...ys) - Math.min(...ys), SCENE_DROP * 190);
    // A tall cover's shape and the camera's turn (-s × 10°) both show.
    const tall = groundShadowFootprint({ width: 207, depth: 114 }, -30, 400, 200);
    expect(tall[0]).not.toEqual(square[0]);
  });
});

describe('the shadow of a falling first book', () => {
  it('is full on the ground (and pressed into it), fades as the book is higher, gone from the drop height', () => {
    expect(shadowStrength(0)).toBe(1);
    expect(shadowStrength(-12)).toBe(1);
    expect(shadowStrength(SHADOW_FADE_HEIGHT / 2)).toBeCloseTo(0.25, 6);
    expect(shadowStrength(SHADOW_FADE_HEIGHT)).toBe(0);
    expect(shadowStrength(SHADOW_FADE_HEIGHT * 2)).toBe(0);
    expect(shadowStrength(100)).toBeGreaterThan(shadowStrength(200));
  });
});

describe('the sky gradient cache', () => {
  it('gives the same object for the same t buckets, and a new one a step on', () => {
    let made = 0;
    const cache = new SkyGradients(() => ({ id: ++made }));
    const a = cache.get(0.5, 0.2);
    expect(cache.get(0.5 + 0.4 / SKY_BUCKETS, 0.2 - 0.4 / SKY_BUCKETS)).toBe(a);
    expect(made).toBe(1);
    const b = cache.get(0.5 + 1 / SKY_BUCKETS, 0.2);
    expect(b).not.toBe(a);
    expect(made).toBe(2);
  });

  it('makes each gradient from the bucket’s own t (so one bucket always looks the same)', () => {
    const seen: number[][] = [];
    const cache = new SkyGradients((stops) => {
      seen.push(stops.map((s) => s.t));
      return {};
    });
    cache.get(0.5004, 0);
    cache.get(0.4996, 0.0001);
    expect(seen).toHaveLength(1);
    close(seen[0][0], 128 / SKY_BUCKETS, 9);
  });
});

describe('colours', () => {
  it('parses the tokens’ colour formats', () => {
    expect(parseColour('#e3f2fb')).toEqual({ r: 0xe3, g: 0xf2, b: 0xfb, a: 1 });
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('rgba(28, 52, 18, 0.35)')).toEqual({ r: 28, g: 52, b: 18, a: 0.35 });
    expect(parseColour('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColour('hsl(10, 20%, 30%)')).toBeNull();
  });

  it('mixes, and the sky runs through its four colours in order', () => {
    const k = (v: number): Rgba => ({ r: v, g: v, b: v, a: 1 });
    expect(mix(k(0), k(100), 0.25)).toEqual(k(25));
    const palette = [k(0), k(100), k(200), k(250)];
    expect(skyColour(0, palette)).toEqual(k(0));
    expect(skyColour(SKY_STOP_T[1], palette)).toEqual(k(100));
    expect(skyColour(SKY_STOP_T[2], palette).r).toBeCloseTo(200, 6);
    expect(skyColour(1, palette)).toEqual(k(250));
    expect(skyColour((SKY_STOP_T[1] + SKY_STOP_T[2]) / 2, palette).r).toBeCloseTo(150, 6);
  });
});

/** The theme's tokens, light and dark, from theme.css itself. */
function themeTokens(): { light: Map<string, string>; dark: Map<string, string> } {
  const css = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8');
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
  const read = (text: string) => new Map([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = read(css.slice(0, darkAt));
  return { light, dark: new Map([...light, ...read(css.slice(darkAt))]) };
}

describe('the month lines over the scenery (3:1 at least)', () => {
  const tokens = themeTokens();
  for (const [name, theme] of Object.entries(tokens)) {
    it(`${name}: one of the two inks always reaches 3:1 against the sky, the horizon and the ground`, () => {
      const colour = (token: string) => {
        const c = parseColour(theme.get(token) ?? '');
        expect(c, token).not.toBeNull();
        return c!;
      };
      const palette = ['--stack-sky-low', '--stack-sky-high', '--stack-sky-upper', '--stack-sky-space'].map(colour);
      const onLight = colour('--stack-line-on-light');
      const onDark = colour('--stack-line-on-dark');
      const behind: Rgba[] = [];
      for (let i = 0; i <= 100; i++) behind.push(skyColour(i / 100, palette));
      const far = colour('--stack-ground-far');
      const near = colour('--stack-ground');
      for (let i = 0; i <= 10; i++) behind.push(mix(far, near, i / 10));
      behind.push(colour('--stack-horizon'));
      for (const c of behind) {
        const ink = lineInk(c, onLight, onDark) === 'light' ? onLight : onDark;
        expect(contrast(ink, c)).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
