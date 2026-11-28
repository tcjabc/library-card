import { describe, expect, it } from 'vitest';
import { circle, ellipse, fitPosterArt, polygon, rect } from '../art/fit';
import { mapPath, parsePath, pathPoints, writePath } from '../art/pathGeometry';

// 1.24.0: reading the design canvas's path data and fitting it into a poster's art column.

const bounds = (d: string) => {
  const points = pathPoints(parsePath(d));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 100) / 100);
};

describe('path data', () => {
  it('reads relative commands, H/V, smooth curves (S, T) and repeated pairs, and writes them absolute', () => {
    expect(writePath(parsePath('M10 20l5 5h10v-5z'))).toBe('M10 20L15 25H25V20Z');
    // T reflects the last Q control point.
    expect(writePath(parsePath('M0 0q5 -10 10 0t10 0'))).toBe('M0 0Q5 -10 10 0Q15 10 20 0');
    expect(writePath(parsePath('M0 0C0 10 10 10 10 0S20 -10 20 0'))).toBe('M0 0C0 10 10 10 10 0C10 -10 20 -10 20 0');
    // Pairs after M are lines; relative after z starts from the subpath's start.
    expect(writePath(parsePath('M0 0 10 0 10 10zm5 5h1'))).toBe('M0 0L10 0L10 10ZM5 5H6');
    expect(writePath(parsePath('M10 10a5 5 0 0 1 10 0'))).toBe('M10 10A5 5 0 0 1 20 10');
  });

  it('refuses what it cannot read', () => {
    expect(() => parsePath('10 10')).toThrow();
    expect(() => parsePath('M0 0X5')).toThrow();
    expect(() => parsePath('M0 0Z 5 5')).toThrow();
  });

  it('measures the real ink, not control points: a circle, an ellipse, a wave, a rounded rectangle', () => {
    expect(bounds(circle(100, 100, 10))).toEqual([90, 90, 110, 110]);
    expect(bounds(ellipse(397, 248, 50, 20))).toEqual([347, 228, 447, 268]);
    // A q wave with its control 14 above peaks 7 above.
    expect(bounds('M0 100q8 -14 16 0')).toEqual([0, 93, 16, 100]);
    expect(bounds(rect(10, 10, 20, 10, 4))).toEqual([10, 10, 30, 20]);
    expect(writePath(parsePath(polygon('1,2 3,4 5,6')))).toBe('M1 2L3 4L5 6Z');
  });

  it('reads arcs as SVG draws them: too-small radii grow to fit, flags pick the side', () => {
    // As in the canvas's moon: radius 32 over an 80-unit chord grows to a radius-40 half-circle.
    expect(bounds('M410 186a32 32 0 1 1 0 80')).toEqual([410, 186, 450, 266]);
    // The 1.24.0 crescent: outer half-circle on the left (to x 370), inner arc bulging to x 391.2 (52 - √(52² - 40²) short of 410).
    const inner = pathPoints(parsePath('M410 266a52 52 0 0 1 0 -80'));
    expect(Math.min(...inner.map(([x]) => x))).toBeCloseTo(391.23, 1);
    expect(bounds('M410 186a40 40 0 1 0 0 80')).toEqual([370, 186, 410, 266]);
  });

  it('moves points and scales arc radii together', () => {
    const moved = mapPath(parsePath('M0 0A10 10 0 0 1 20 0'), (x, y) => [x * 2 + 1, y * 2 + 1], 2);
    expect(writePath(moved)).toBe('M1 1A20 20 0 0 1 41 1');
  });
});

describe('fitPosterArt', () => {
  it('scales about the centre line and centres the drawing in the art band, keeping its proportions', () => {
    // A 40 x 400 box centred on x 397: the band's height limits it (scale about 1.98).
    const [box] = fitPosterArt([{ d: rect(377, 100, 40, 400) }]).shapes;
    const [x0, y0, x1, y1] = bounds(box.d);
    expect((x0 + x1) / 2).toBeCloseTo(397, 1);
    expect((y0 + y1) / 2).toBeCloseTo(613.5, 1);
    expect((y1 - y0) / (x1 - x0)).toBeCloseTo(10, 1);
    expect(y0).toBeGreaterThanOrEqual(216.25);
    expect(y1).toBeLessThanOrEqual(1010.75);
  });

  it('a wide drawing is limited by the column instead, and keeps its shapes’ other fields', () => {
    const [box] = fitPosterArt([{ d: rect(297, 600, 200, 20), fill: 'paper', thin: true }]).shapes;
    const [x0, , x1] = bounds(box.d);
    expect(x1 - 397).toBeLessThan(59.97);
    expect(x1 - 397).toBeGreaterThan(58);
    expect(397 - x0).toBeCloseTo(x1 - 397, 1);
    expect(box.fill).toBe('paper');
    expect(box.thin).toBe(true);
  });
});
