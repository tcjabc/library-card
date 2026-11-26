import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLOUD_ALPHA,
  CLOUD_ASPECT,
  CLOUD_BAR,
  CLOUD_BASE,
  CLOUD_CELL_BOOKS,
  CLOUD_MIN_ALT,
  CLOUD_SHAPES,
  CLOUD_THIN_FROM,
  EYE_ALPHA,
  EYE_FADE_PX,
  MAX_CLOUDS,
  PARALLAX,
  cellClouds,
  cellsInView,
  cloudBaseY,
  cloudDensity,
  eyeLineFade,
  placeClouds,
  shapeTop,
  type CloudView,
} from '../clouds';
import { DECOR_LEVELS, type Decor } from '../drawBudget';
import { bookLift } from '../eyeGap';
import { pileCentres } from '../stackProjection';
import { ALTITUDE_BOOK, SCENE_RISE, contrast, groundContactY, horizonY, lineStyle, mix, parseColour, skyColour, skyT, type Rgba } from '../scenery';

const SEED = 'household-test-1';
const PHONE = { width: 390, height: 660 };
const REACH = 70;

/** A view whose eye line is `alt` books above the horizon. */
function viewAt(alt: number, over: Partial<CloudView> = {}): CloudView {
  const height = over.height ?? PHONE.height;
  return {
    seed: SEED,
    width: PHONE.width,
    height,
    horizon: height / 2 + alt * SCENE_RISE * ALTITUDE_BOOK,
    ground: true,
    decor: 'full',
    reduced: false,
    eyeReach: REACH,
    ...over,
  };
}

describe('where the clouds are: seeded by household and altitude cell', () => {
  it('the same seed gives the same clouds, a different household different ones', () => {
    for (let cell = 0; cell < 40; cell++) expect(cellClouds(SEED, cell)).toEqual(cellClouds(SEED, cell));
    const mine = Array.from({ length: 40 }, (_, cell) => cellClouds(SEED, cell));
    const theirs = Array.from({ length: 40 }, (_, cell) => cellClouds('another-household', cell));
    expect(theirs).not.toEqual(mine);
  });

  it('each cell has 0 to 2 clouds, inside the cell', () => {
    const counts = new Set<number>();
    for (let cell = 0; cell < 200; cell++) {
      const clouds = cellClouds(SEED, cell);
      expect(clouds.length).toBeLessThanOrEqual(2);
      counts.add(clouds.length);
      for (const c of clouds) {
        expect(c.alt).toBeGreaterThanOrEqual(cell * CLOUD_CELL_BOOKS);
        expect(c.alt).toBeLessThan((cell + 1) * CLOUD_CELL_BOOKS);
        expect(c.across).toBeGreaterThanOrEqual(0);
        expect(c.across).toBeLessThan(1);
        expect(c.shape).toBeGreaterThanOrEqual(0);
        expect(c.shape).toBeLessThan(CLOUD_SHAPES.length);
      }
    }
    expect([...counts].sort()).toEqual([0, 1, 2]);
  });

  it('a pile growing never moves a cloud: the same camera altitude shows the same clouds whatever the pile size', () => {
    // Placement only knows where the horizon is (the camera's altitude), never how many books there are.
    const horizonFor = (count: number, s: number) => {
      const centres = pileCentres(Array.from({ length: count }, () => 28));
      return horizonY(groundContactY(centres, s, bookLift(0, s, true), PHONE.height / 2));
    };
    for (const s of [0, 20, 60, 99]) {
      const small = placeClouds({ ...viewAt(0), horizon: horizonFor(100, s) });
      const big = placeClouds({ ...viewAt(0), horizon: horizonFor(1000, s) });
      expect(big).toEqual(small);
    }
    expect(placeClouds({ ...viewAt(0), horizon: horizonFor(1000, 60) }).length).toBeGreaterThan(0);
  });

  it(`no clouds below ${CLOUD_MIN_ALT} books`, () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', SEED]) {
      for (const c of cellClouds(seed, 0)) expect(c.alt).toBeGreaterThanOrEqual(CLOUD_MIN_ALT);
    }
  });

  it(`thins out above sky t ${CLOUD_THIN_FROM} (space), none at t 1`, () => {
    expect(cloudDensity(0.5)).toBe(1);
    expect(cloudDensity(CLOUD_THIN_FROM)).toBe(1);
    expect(cloudDensity(0.9)).toBeCloseTo(0.5, 6);
    expect(cloudDensity(1)).toBe(0);
    const perCell = (fromAlt: number, toAlt: number) => {
      let clouds = 0;
      let cells = 0;
      for (let s = 0; s < 60; s++) {
        for (let cell = Math.floor(fromAlt / CLOUD_CELL_BOOKS); cell < Math.floor(toAlt / CLOUD_CELL_BOOKS); cell++) {
          clouds += cellClouds(`seed-${s}`, cell).length;
          cells += 1;
        }
      }
      return clouds / cells;
    };
    const low = perCell(20, 200);
    const high = perCell(500, 900);
    expect(skyT(200)).toBeLessThan(CLOUD_THIN_FROM);
    expect(skyT(500)).toBeGreaterThan(0.89);
    expect(low).toBeGreaterThan(0.75);
    expect(high).toBeLessThan(low * 0.5);
    expect(perCell(1000, 1300)).toBe(0);
  });
});

describe('how they move: parallax', () => {
  it(`each cloud's factor is in ${PARALLAX[0]}–${PARALLAX[1]}`, () => {
    for (let cell = 0; cell < 300; cell++) {
      for (const c of cellClouds(SEED, cell)) {
        expect(c.factor).toBeGreaterThanOrEqual(PARALLAX[0]);
        expect(c.factor).toBeLessThanOrEqual(PARALLAX[1]);
      }
    }
  });

  it('a cloud moves its factor of every scroll, and sits at the eye line when the camera is at its altitude', () => {
    const height = 660;
    const at = (horizon: number) => cloudBaseY(50, 0.3, horizon, height);
    expect(at(1000) - at(900)).toBeCloseTo(30, 9);
    expect(cloudBaseY(50, 0.3, height / 2 + 50 * SCENE_RISE * ALTITUDE_BOOK, height)).toBeCloseTo(height / 2, 9);
    // Factor 1 is the world itself.
    expect(cloudBaseY(50, 1, 900, height)).toBeCloseTo(900 - 50 * SCENE_RISE * ALTITUDE_BOOK, 9);
  });

  it('on screen the backdrop moves 0.25–0.35 of the pile; with reduced motion, 1:1', () => {
    const scroll = 12;
    for (const alt of [30, 60, 120]) {
      const a = placeClouds(viewAt(alt));
      const b = placeClouds({ ...viewAt(alt), horizon: viewAt(alt).horizon + scroll });
      expect(a.length).toBe(b.length);
      a.forEach((c, k) => {
        const moved = b[k].y - c.y;
        expect(moved).toBeGreaterThanOrEqual(PARALLAX[0] * scroll - 1e-9);
        expect(moved).toBeLessThanOrEqual(PARALLAX[1] * scroll + 1e-9);
      });
      const ra = placeClouds(viewAt(alt, { reduced: true }));
      const rb = placeClouds({ ...viewAt(alt, { reduced: true }), horizon: viewAt(alt).horizon + scroll });
      ra.forEach((c, k) => expect(rb[k].y - c.y).toBeCloseTo(scroll, 9));
    }
  });
});

describe('how many', () => {
  const sweep = (over: Partial<CloudView>) => {
    const counts: number[] = [];
    for (const seed of ['a', 'b', 'c', SEED]) {
      for (let alt = 0; alt <= 1100; alt += 3) counts.push(placeClouds(viewAt(alt, { seed, ...over })).length);
    }
    return counts;
  };

  it('never more than MAX_CLOUDS a frame, by decor level, on a phone and a tall tablet', () => {
    for (const decor of DECOR_LEVELS) {
      for (const height of [289, 660, 1180]) {
        const most = Math.max(...sweep({ decor, height }));
        expect(most).toBeLessThanOrEqual(MAX_CLOUDS[decor]);
      }
    }
    expect(MAX_CLOUDS).toEqual({ full: 5, reduced: 3, none: 0 });
    expect(Math.max(...sweep({ decor: 'full', height: 1180 }))).toBe(5);
  });

  it('a phone sees a few clouds through the sky, reduced decor about half, none none', () => {
    const average = (decor: Decor) => {
      const counts: number[] = [];
      for (const seed of ['a', 'b', 'c', 'd', SEED]) for (let alt = 30; alt <= 250; alt += 2) counts.push(placeClouds(viewAt(alt, { seed, decor })).length);
      return counts.reduce((a, b) => a + b, 0) / counts.length;
    };
    const full = average('full');
    const reduced = average('reduced');
    expect(full).toBeGreaterThan(2);
    expect(full).toBeLessThan(5);
    expect(reduced).toBeGreaterThan(full * 0.35);
    expect(reduced).toBeLessThan(full * 0.65);
    expect(average('none')).toBe(0);
  });

  it('no cloud work with decor none, or with no cell in view (the camera on the ground with the ground filling the view)', () => {
    expect(placeClouds(viewAt(100, { decor: 'none' }))).toEqual([]);
    expect(cellsInView({ height: 660, horizon: -5000, reduced: false })).toBeNull();
  });

  it('none drawn wholly behind the horizon when the ground is drawn', () => {
    for (let alt = 0; alt <= 40; alt += 1) {
      const view = viewAt(alt - 8);
      for (const c of placeClouds(view)) expect(c.y).toBeLessThan(view.horizon);
    }
  });

  it('draws far clouds first', () => {
    for (let alt = 20; alt < 300; alt += 7) {
      const list = placeClouds(viewAt(alt));
      for (let k = 1; k < list.length; k++) expect(list[k].factor).toBeGreaterThanOrEqual(list[k - 1].factor);
    }
  });
});

describe('the eye line stays calm', () => {
  it(`a cloud crossing the band fades to ${EYE_ALPHA}, easing back over ${EYE_FADE_PX} px (a step with reduced motion)`, () => {
    const mid = 330;
    expect(eyeLineFade(300, 340, mid, REACH, false)).toBe(EYE_ALPHA);
    expect(eyeLineFade(mid + REACH + EYE_FADE_PX / 2, mid + REACH + 80, mid, REACH, false)).toBeCloseTo(EYE_ALPHA + (1 - EYE_ALPHA) / 2, 9);
    expect(eyeLineFade(100, mid - REACH - EYE_FADE_PX, mid, REACH, false)).toBe(1);
    expect(eyeLineFade(mid + REACH + 1, 600, mid, REACH, true)).toBe(1);
    expect(eyeLineFade(300, 340, mid, REACH, true)).toBe(EYE_ALPHA);
  });

  it('every placed cloud whose box crosses the band is faded', () => {
    let crossing = 0;
    for (let alt = 10; alt < 300; alt += 1) {
      for (const c of placeClouds(viewAt(alt))) {
        const mid = PHONE.height / 2;
        const top = c.y + shapeTop(CLOUD_SHAPES[c.shape]) * c.width;
        const bottom = c.y + CLOUD_BASE * c.width;
        if (top < mid + REACH && bottom > mid - REACH) {
          crossing += 1;
          expect(c.alpha).toBeLessThanOrEqual(CLOUD_ALPHA[1] * EYE_ALPHA + 1e-9);
        }
      }
    }
    expect(crossing).toBeGreaterThan(0);
  });
});

describe('the cloud shapes', () => {
  it('fit their sprite and sit on a flat base (the end puffs reach it)', () => {
    expect(CLOUD_SHAPES).toHaveLength(6);
    for (const shape of CLOUD_SHAPES) {
      for (const p of shape) {
        expect(p.x - p.r).toBeGreaterThan(0);
        expect(p.x + p.r).toBeLessThan(1);
        expect(p.y - p.r).toBeGreaterThan(0);
      }
      const first = shape[0];
      const last = shape[shape.length - 1];
      expect(first.y + first.r).toBeGreaterThanOrEqual(CLOUD_BASE);
      expect(last.y + last.r).toBeGreaterThanOrEqual(CLOUD_BASE);
    }
    expect(CLOUD_BASE).toBeLessThan(CLOUD_ASPECT);
    expect(CLOUD_BAR).toBeLessThan(CLOUD_BASE);
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

describe('the markers over clouds (3:1 at least)', () => {
  const tokens = themeTokens();
  for (const [name, theme] of Object.entries(tokens)) {
    const colour = (token: string): Rgba => {
      const c = parseColour(theme.get(token) ?? '');
      expect(c, token).not.toBeNull();
      return c!;
    };
    const palette = ['--stack-sky-low', '--stack-sky-high', '--stack-sky-upper', '--stack-sky-space'].map(colour);
    const onLight = colour('--stack-line-on-light');
    const onDark = colour('--stack-line-on-dark');
    const cloud = colour('--stack-cloud');
    const shade = colour('--stack-cloud-shade');

    it(`${name}: a month line over a cloud takes an ink that reaches 3:1 against the sky and the cloud, or a casing in the other ink`, () => {
      for (let i = 0; i <= 100; i++) {
        const sky = skyColour(i / 100, palette);
        // A cloud at its strongest, and faded at the eye line, over this sky.
        const behind = [sky, cloud, shade, mix(sky, cloud, EYE_ALPHA * CLOUD_ALPHA[1])];
        const style = lineStyle(behind, onLight, onDark);
        const ink = style.ink === 'light' ? onLight : onDark;
        const other = style.ink === 'light' ? onDark : onLight;
        if (style.cased) {
          // The casing is the other ink: the dashes always stand out from it.
          expect(contrast(ink, other)).toBeGreaterThanOrEqual(3);
        } else {
          for (const b of behind) expect(contrast(ink, b)).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it(`${name}: the flags' and month labels' text sits on its own backing, so a cloud never touches its contrast`, () => {
      expect(contrast(colour('--color-on-milestone'), colour('--color-milestone'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colour('--color-text'), colour('--color-surface'))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('in the light theme, a cloud low in the sky needs no casing; one high up, in the deep blue, does', () => {
    const theme = tokens.light;
    const colour = (token: string) => parseColour(theme.get(token)!)!;
    const palette = ['--stack-sky-low', '--stack-sky-high', '--stack-sky-upper', '--stack-sky-space'].map(colour);
    const at = (t: number) =>
      lineStyle([skyColour(t, palette), colour('--stack-cloud'), colour('--stack-cloud-shade')], colour('--stack-line-on-light'), colour('--stack-line-on-dark'));
    // 'light': the ink for light backgrounds (the dark one).
    expect(at(0.3)).toEqual({ ink: 'light', cased: false });
    expect(at(0.95).cased).toBe(true);
  });

  it('in the dark theme the ink for dark backgrounds (the light one) reads over every sky and cloud: no casing', () => {
    const theme = tokens.dark;
    const colour = (token: string) => parseColour(theme.get(token)!)!;
    const palette = ['--stack-sky-low', '--stack-sky-high', '--stack-sky-upper', '--stack-sky-space'].map(colour);
    for (let i = 0; i <= 20; i++) {
      const style = lineStyle([skyColour(i / 20, palette), colour('--stack-cloud'), colour('--stack-cloud-shade')], colour('--stack-line-on-light'), colour('--stack-line-on-dark'));
      expect(style).toEqual({ ink: 'dark', cased: false });
    }
  });
});
