import { describe, expect, it } from 'vitest';
import { getJourney, JOURNEYS } from '../../journeys/journeys';
import { POSTER_ART, POSTER_JOURNEYS } from '../art';
import { ART_LIMITS } from '../art/fit';
import { parsePath, pathPoints } from '../art/pathGeometry';
import { MM_PER_UNIT, POSTER_FRAME, POSTER_STROKES } from '../posterLayout';

// 1.23.0 (the Rocket) and 1.24.0 (the other seven): every poster's drawing is outline art inside
// the art column, clear of the slots.

const F = POSTER_FRAME;
const artHalfStroke = POSTER_STROKES.art / 2;
const circleHalfStroke = POSTER_STROKES.circle / 2;
/** The clear gap the art keeps from every slot circle, so they never look joined on paper: 1 mm. */
const CLEARANCE = 1 / MM_PER_UNIT;
/** Sampled outlines can miss a curve's very tip by a hair: allowed for in the bounds. */
const SAMPLING = 0.05;

/** Every point along a shape's outline (end points, curves and arcs sampled). */
const outline = (d: string) => pathPoints(parsePath(d)).map(([x, y]) => ({ x, y }));

describe('poster art', () => {
  it('all eight journeys have a poster, listed in gallery order', () => {
    for (const id of Object.keys(POSTER_ART)) expect(getJourney(id), id).toBeDefined();
    expect(POSTER_JOURNEYS.map((j) => j.id)).toEqual(JOURNEYS.map((j) => j.id));
    expect(POSTER_JOURNEYS).toHaveLength(8);
  });

  for (const [id, art] of Object.entries(POSTER_ART)) {
    describe(id, () => {
      it('is outline art: absolute path data only, filled with nothing or paper white, no text or colour', () => {
        expect(art.shapes.length).toBeGreaterThan(0);
        for (const shape of art.shapes) {
          expect(Object.keys(shape).every((key) => ['d', 'fill', 'dots', 'thin'].includes(key)), JSON.stringify(shape)).toBe(true);
          expect([undefined, 'paper']).toContain(shape.fill);
          expect([undefined, true]).toContain(shape.dots);
          expect([undefined, true]).toContain(shape.thin);
          expect(shape.d).toMatch(/^[MLHVCQAZ0-9.\s-]+$/);
        }
      });

      it('stays inside the art band (so inside the 9 mm margin) and at least 1 mm clear of every slot circle, strokes included', () => {
        for (const shape of art.shapes) {
          for (const p of outline(shape.d)) {
            expect(p.y - artHalfStroke + SAMPLING, `${id} top`).toBeGreaterThanOrEqual(F.slotTop);
            expect(p.y + artHalfStroke - SAMPLING, `${id} bottom`).toBeLessThanOrEqual(F.slotBottom);
            expect(Math.abs(p.x - F.centre), `${id} side`).toBeLessThanOrEqual(F.artHalf);
            // At least 1 mm short of the nearest a circle's outline comes to the centre line.
            expect(Math.abs(p.x - F.centre) + artHalfStroke + CLEARANCE - SAMPLING, `${id} near a circle`).toBeLessThanOrEqual(F.circleOffset - F.circleRadius - circleHalfStroke);
            expect(p.x).toBeGreaterThan(F.margin);
            expect(p.x).toBeLessThan(F.width - F.margin);
          }
        }
      });
    });
  }

  it('each fitted drawing is as large as fits: it fills the art band’s height or the column’s width', () => {
    for (const [id, art] of Object.entries(POSTER_ART)) {
      if (id === 'rocket_through_space') continue; // Drawn by hand into the band in 1.23.0.
      const points = art.shapes.flatMap((shape) => outline(shape.d));
      const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
      const reach = Math.max(...points.map((p) => Math.abs(p.x - F.centre)));
      const fillsHeight = height >= ART_LIMITS.bottom - ART_LIMITS.top - 2;
      const fillsWidth = reach >= ART_LIMITS.halfWidth - 1;
      expect(fillsHeight || fillsWidth, `${id}: height ${height.toFixed(1)}, reach ${reach.toFixed(1)}`).toBe(true);
      // Centred on the centre line and in the band.
      const top = Math.min(...points.map((p) => p.y));
      const bottom = Math.max(...points.map((p) => p.y));
      expect(Math.abs(top - ART_LIMITS.top - (ART_LIMITS.bottom - bottom)), id).toBeLessThan(1.5);
    }
  });

  it('only Rapunzel’s brick courses use the thin line', () => {
    const thin = Object.entries(POSTER_ART).flatMap(([id, art]) => art.shapes.filter((s) => s.thin).map(() => id));
    expect([...new Set(thin)]).toEqual(['rapunzel_tower']);
  });

  it('the Rocket’s art is still the hand-drawn 1.23.0 drawing', () => {
    const rocket = POSTER_ART.rocket_through_space;
    expect(rocket?.shapes).toHaveLength(17);
    expect(rocket?.shapes[2]).toEqual({ d: 'M397 220C364.5 259 359.3 318.8 367.1 368.2H426.9C434.7 318.8 429.5 259 397 220Z', fill: 'paper' });
  });
});
