import { describe, expect, it } from 'vitest';
import { JOURNEYS } from '../../journeys/journeys';
import { layoutSlots, MM_PER_UNIT, POSTER_FRAME, POSTER_STROKES, POSTER_TYPE, type PosterSlot } from '../posterLayout';

// 1.23.0: where each book's slot goes on a journey poster, for every length a journey could have.

const F = POSTER_FRAME;
const mm = (units: number) => units * MM_PER_UNIT;
const COUNTS = Array.from({ length: 26 }, (_, i) => i + 5); // 5..30
const DIRECTIONS = ['up', 'down'] as const;
/** Half a circle's outline: what a circle's stroke adds to its edge. */
const circleHalf = POSTER_STROKES.circle / 2;
/** A round line cap reaches half the line weight past the end. */
const capHalf = POSTER_STROKES.line / 2;

describe('layoutSlots', () => {
  it('the frame is A4 at 1 unit = 210/794 mm both ways, with a 9 mm margin and 9.5 mm circles', () => {
    expect(mm(F.width)).toBeCloseTo(210, 6);
    expect(mm(F.height)).toBeCloseTo(297, 0);
    expect(mm(F.margin)).toBeCloseTo(9, 6);
    expect(mm(F.circleRadius * 2)).toBeCloseTo(9.5, 1);
  });

  for (const direction of DIRECTIONS) {
    for (const count of COUNTS) {
      describe(`${count} books, ${direction}`, () => {
        const slots = layoutSlots(count, direction);

        it('one slot per book, numbered in order, alternating left and right from the left', () => {
          expect(slots.map((s) => s.book)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
          slots.forEach((s, i) => expect(s.side).toBe(i % 2 === 0 ? 'left' : 'right'));
          for (const s of slots) expect(s.cx).toBe(s.side === 'left' ? F.centre - F.circleOffset : F.centre + F.circleOffset);
        });

        it(direction === 'up' ? 'book 1 is at the bottom and each book climbs' : 'book 1 is at the top and each book goes deeper', () => {
          for (let i = 1; i < slots.length; i++) {
            if (direction === 'up') expect(slots[i].cy).toBeLessThan(slots[i - 1].cy);
            else expect(slots[i].cy).toBeGreaterThan(slots[i - 1].cy);
          }
          const ends = [slots[0].cy, slots[slots.length - 1].cy].sort((a, b) => a - b);
          expect(ends[0]).toBeGreaterThan(F.slotTop);
          expect(ends[1]).toBeLessThan(F.slotBottom);
        });

        it('evenly spread over the art band', () => {
          const pitch = (F.slotBottom - F.slotTop) / count;
          for (let i = 1; i < slots.length; i++) expect(Math.abs(slots[i].cy - slots[i - 1].cy)).toBeCloseTo(pitch, 6);
        });

        it('no two circles touch, and same-side slots are at least 12 mm apart', () => {
          for (let i = 0; i < slots.length; i++) {
            for (let j = i + 1; j < slots.length; j++) {
              const a = slots[i];
              const b = slots[j];
              expect(Math.hypot(a.cx - b.cx, a.cy - b.cy), `${a.book} and ${b.book}`).toBeGreaterThan(a.r + b.r + 2 * circleHalf);
            }
          }
          for (let i = 2; i < slots.length; i++) expect(mm(Math.abs(slots[i].cy - slots[i - 2].cy))).toBeGreaterThanOrEqual(12);
        });

        it('nothing in the art column: circles and lines stay outside ±artHalf of the centre', () => {
          for (const s of slots) {
            expect(Math.abs(s.cx - F.centre) - s.r).toBeGreaterThanOrEqual(F.artHalf);
            const nearest = s.side === 'left' ? s.line.x2 : s.line.x1;
            expect(Math.abs(nearest - F.centre) - capHalf).toBeGreaterThan(F.artHalf);
          }
        });

        it('every writing line is at least 60 mm long, beside its own circle and just below its centre', () => {
          for (const s of slots) {
            expect(s.line.x1).toBeLessThan(s.line.x2);
            expect(mm(s.line.x2 - s.line.x1), `book ${s.book}`).toBeGreaterThanOrEqual(60);
            if (s.side === 'left') expect(s.line.x2).toBeLessThan(s.cx - s.r);
            else expect(s.line.x1).toBeGreaterThan(s.cx + s.r);
            expect(s.line.y).toBeGreaterThan(s.cy);
            expect(s.line.y).toBeLessThan(s.cy + s.r);
          }
        });

        it('everything is inside the 9 mm safe margin, and clear of the label bands', () => {
          const inside = (s: PosterSlot) => {
            expect(s.line.x1 - capHalf).toBeGreaterThanOrEqual(F.margin);
            expect(s.line.x2 + capHalf).toBeLessThanOrEqual(F.width - F.margin);
            expect(s.cx - s.r - circleHalf).toBeGreaterThanOrEqual(F.margin);
            expect(s.cx + s.r + circleHalf).toBeLessThanOrEqual(F.width - F.margin);
            // Below the name line; above the bottom label's capitals.
            expect(s.cy - s.r - circleHalf).toBeGreaterThan(POSTER_TYPE.nameY + capHalf);
            expect(s.cy + s.r + circleHalf).toBeLessThan(POSTER_TYPE.endBottomY - POSTER_TYPE.endSize);
          };
          slots.forEach(inside);
        });
      });
    }
  }

  it('the START / FINISH labels sit over the art column, so they never meet a circle (about 0.7 em a capital, 6 letters)', () => {
    const halfWidth = (POSTER_TYPE.endSize * 0.7 * 6) / 2;
    expect(halfWidth).toBeLessThan(F.circleOffset - F.circleRadius - circleHalf);
  });

  for (const journey of JOURNEYS) {
    it(`${journey.id} (${journey.steps} books, ${journey.direction}): one slot per book, alternating, same-side lines ≥ 12 mm apart, lines ≥ 60 mm`, () => {
      const slots = layoutSlots(journey.steps, journey.direction);
      expect(slots).toHaveLength(journey.steps);
      slots.forEach((s, i) => expect(s.side).toBe(i % 2 === 0 ? 'left' : 'right'));
      for (let i = 2; i < slots.length; i++) expect(mm(Math.abs(slots[i].cy - slots[i - 2].cy))).toBeGreaterThanOrEqual(12);
      for (const s of slots) expect(mm(s.line.x2 - s.line.x1)).toBeGreaterThanOrEqual(60);
      // Only Ocean Deep starts at the top.
      expect(slots.length < 2 || (slots[0].cy < slots[1].cy) === (journey.id === 'ocean_deep')).toBe(true);
    });
  }

  it('the Rocket’s 30 slots are exactly as printed in 1.23.0', () => {
    const slots = layoutSlots(30, 'up');
    const round = (v: number) => Math.round(v * 1000) / 1000;
    expect([slots[0], slots[29]].map((s) => [s.book, s.side, s.cx, round(s.cy), s.r, round(s.line.x1), round(s.line.x2), round(s.line.y)])).toEqual([
      [1, 'left', 313, 998.717, 18, 40.029, 287, 1008.617],
      [30, 'right', 481, 228.283, 18, 507, 753.971, 238.183],
    ]);
  });

  it('every journey has a layout that fits (the longest, 30 books, is the tightest)', () => {
    for (const journey of JOURNEYS) {
      const slots = layoutSlots(journey.steps, journey.direction);
      expect(slots).toHaveLength(journey.steps);
    }
    const tightest = layoutSlots(30, 'up');
    expect(mm(Math.abs(tightest[2].cy - tightest[0].cy))).toBeCloseTo(14.05, 1);
  });
});
