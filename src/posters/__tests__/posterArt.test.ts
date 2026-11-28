import { describe, expect, it } from 'vitest';
import { getJourney, JOURNEYS } from '../../journeys/journeys';
import { POSTER_ART, POSTER_JOURNEYS } from '../art';
import { MM_PER_UNIT, POSTER_FRAME, POSTER_STROKES } from '../posterLayout';

// 1.23.0: every poster's drawing is outline art inside the art column.

const F = POSTER_FRAME;
const artHalfStroke = POSTER_STROKES.art / 2;
const circleHalfStroke = POSTER_STROKES.circle / 2;
/** The clear gap the art keeps from every slot circle, so they never look joined on paper: 1 mm. */
const CLEARANCE = 1 / MM_PER_UNIT;

/**
 * Every point a path's outline can reach (a curve stays inside its control points; an arc inside
 * its end point ± its radii). Absolute commands only: anything else fails the test.
 */
function reach(d: string): { x: number; y: number }[] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const points: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => {
    const v = Number(tokens[i++]);
    if (Number.isNaN(v)) throw new Error(`a number expected in ${d}`);
    return v;
  };
  const isNum = () => i < tokens.length && !/[A-Za-z]/.test(tokens[i]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (!/^[MLHVCQAZ]$/.test(command)) throw new Error(`only absolute M L H V C Q A Z allowed, found "${command}" in ${d}`);
    if (command === 'Z') continue;
    do {
      if (command === 'M' || command === 'L') {
        x = num();
        y = num();
        points.push({ x, y });
      } else if (command === 'H') {
        x = num();
        points.push({ x, y });
      } else if (command === 'V') {
        y = num();
        points.push({ x, y });
      } else if (command === 'C' || command === 'Q') {
        const pairs = command === 'C' ? 3 : 2;
        for (let p = 0; p < pairs; p++) {
          const px = num();
          const py = num();
          points.push({ x: px, y: py });
          x = px;
          y = py;
        }
      } else if (command === 'A') {
        const rx = num();
        const ry = num();
        num();
        num();
        num();
        x = num();
        y = num();
        points.push({ x: x - rx, y: y - ry }, { x: x + rx, y: y + ry });
      }
    } while (isNum());
  }
  return points;
}

describe('poster art', () => {
  it('the registry holds only real journeys, and the posters section lists exactly those, in gallery order', () => {
    for (const id of Object.keys(POSTER_ART)) expect(getJourney(id), id).toBeDefined();
    expect(POSTER_JOURNEYS.map((j) => j.id)).toEqual(JOURNEYS.filter((j) => POSTER_ART[j.id]).map((j) => j.id));
    // 1.23.0 ships the pilot only.
    expect(POSTER_JOURNEYS.map((j) => j.id)).toEqual(['rocket_through_space']);
  });

  for (const [id, art] of Object.entries(POSTER_ART)) {
    describe(id, () => {
      it('is outline art: path data only, filled with nothing or paper white, no text or colour', () => {
        expect(art.shapes.length).toBeGreaterThan(0);
        for (const shape of art.shapes) {
          expect(Object.keys(shape).every((key) => ['d', 'fill', 'dots'].includes(key)), JSON.stringify(shape)).toBe(true);
          expect([undefined, 'paper']).toContain(shape.fill);
          expect([undefined, true]).toContain(shape.dots);
          expect(shape.d).toMatch(/^[MLHVCQAZ0-9.\s-]+$/);
        }
      });

      it('stays inside the art band and the art column, at least 1 mm clear of every slot circle (strokes included)', () => {
        for (const shape of art.shapes) {
          for (const p of reach(shape.d)) {
            expect(p.y - artHalfStroke, `${shape.d} top`).toBeGreaterThanOrEqual(F.slotTop);
            expect(p.y + artHalfStroke, `${shape.d} bottom`).toBeLessThanOrEqual(F.slotBottom);
            expect(Math.abs(p.x - F.centre), `${shape.d} side`).toBeLessThanOrEqual(F.artHalf);
            // At least 1 mm short of the nearest a circle's outline comes to the centre line.
            expect(Math.abs(p.x - F.centre) + artHalfStroke + CLEARANCE, `${shape.d} near a circle`).toBeLessThanOrEqual(F.circleOffset - F.circleRadius - circleHalfStroke);
          }
        }
      });
    });
  }
});
