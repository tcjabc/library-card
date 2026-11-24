import { describe, expect, it } from 'vitest';
import {
  FLICK_SPEED,
  SHEET_STATES,
  dragVisible,
  historyStep,
  isExpanded,
  nextSheetState,
  sheetBook,
  sheetHeights,
  snapState,
  type SheetHeights,
} from '../sheetState';
import { BIGGEST_BOOK } from '../stackModel';
import { eyeLineBooks, eyeLineReach } from '../stackProjection';

const H: SheetHeights = { collapsed: 76, half: 380, full: 820 };

describe('taps, Escape and Back', () => {
  it('a tap on the bar opens collapsed to half, and closes half or full', () => {
    expect(nextSheetState('collapsed', { type: 'tap' })).toBe('half');
    expect(nextSheetState('half', { type: 'tap' })).toBe('collapsed');
    expect(nextSheetState('full', { type: 'tap' })).toBe('collapsed');
  });

  it('Escape and Back close it from anywhere, and do nothing when it’s closed', () => {
    for (const state of SHEET_STATES) {
      expect(nextSheetState(state, { type: 'escape' })).toBe('collapsed');
      expect(nextSheetState(state, { type: 'back' })).toBe('collapsed');
    }
  });

  it('knows which states are open', () => {
    expect(SHEET_STATES.filter(isExpanded)).toEqual(['half', 'full']);
  });
});

describe('drags', () => {
  it('a slow drag comes to rest on the nearest state', () => {
    expect(snapState(100, 0, H)).toBe('collapsed');
    expect(snapState(300, 0, H)).toBe('half');
    expect(snapState(560, 0.1, H)).toBe('half');
    expect(snapState(700, -0.1, H)).toBe('full');
  });

  it('a flick up goes on to the next state up from where it let go', () => {
    expect(snapState(90, FLICK_SPEED, H)).toBe('half');
    expect(snapState(390, FLICK_SPEED, H)).toBe('full');
    expect(snapState(820, 2, H)).toBe('full');
  });

  it('a flick down goes on to the next state down', () => {
    expect(snapState(800, -FLICK_SPEED, H)).toBe('half');
    expect(snapState(370, -1, H)).toBe('collapsed');
    expect(snapState(76, -3, H)).toBe('collapsed');
  });

  it('drag events go through nextSheetState whatever the state was', () => {
    expect(nextSheetState('collapsed', { type: 'drag', visible: 400, velocity: 0, heights: H })).toBe('half');
    expect(nextSheetState('half', { type: 'drag', visible: 500, velocity: 1, heights: H })).toBe('full');
    expect(nextSheetState('full', { type: 'drag', visible: 600, velocity: -1, heights: H })).toBe('half');
    expect(nextSheetState('full', { type: 'drag', visible: 100, velocity: 0, heights: H })).toBe('collapsed');
  });

  it('the sheet follows the finger between collapsed and full, no further', () => {
    expect(dragVisible(76, 100, H)).toBe(176);
    expect(dragVisible(380, -1000, H)).toBe(76);
    expect(dragVisible(380, 1000, H)).toBe(820);
  });
});

describe('heights', () => {
  const book = eyeLineReach(BIGGEST_BOOK, 12);

  it('half stops just below the book at the eye line, which stays in view', () => {
    // A phone in portrait: a 790 px pile under a 64 px header, a 76 px bar.
    const h = sheetHeights({ page: 930, headerBottom: 64, view: 790, bar: 76, reach: book, minHalf: 160 });
    expect(h.collapsed).toBe(76);
    expect(h.full).toBe(930 - 64);
    const sheetTop = 930 - h.half;
    const eyeLine = 64 + 790 / 2;
    expect(sheetTop).toBeCloseTo(eyeLine + book, 6);
    expect(h.half).toBeGreaterThan(h.collapsed);
    expect(h.half).toBeLessThan(h.full);
  });

  it('a tablet on its side: still below the eye line', () => {
    const h = sheetHeights({ page: 800, headerBottom: 60, view: 664, bar: 76, reach: book, minHalf: 160 });
    expect(800 - h.half).toBeGreaterThan(60 + 664 / 2);
  });

  it('a screen too short for that still gets a usable half, never more than full', () => {
    const h = sheetHeights({ page: 360, headerBottom: 56, view: 228, bar: 76, reach: book, minHalf: 160 });
    expect(h.half).toBe(76 + 160);
    const tiny = sheetHeights({ page: 200, headerBottom: 56, view: 68, bar: 76, reach: book, minHalf: 160 });
    expect(tiny.half).toBe(tiny.full);
  });

  it('the reach is the room eyeLineBooks keeps above the eye line', () => {
    // K books of pitch above the eye line plus the reach fill at most half the view.
    const view = 790;
    const k = eyeLineBooks(view, BIGGEST_BOOK, 24);
    const pitch = (eyeLineReach(BIGGEST_BOOK, 0) - eyeLineReach({ ...BIGGEST_BOOK, thickness: 0 }, 0)) * 2;
    expect(k * pitch + eyeLineReach(BIGGEST_BOOK, 24)).toBeLessThanOrEqual(view / 2);
    expect((k + 1) * pitch + eyeLineReach(BIGGEST_BOOK, 24)).toBeGreaterThan(view / 2);
  });
});

describe('which book the sheet shows', () => {
  it('half (and collapsed) follow the book at the eye line; full keeps its book', () => {
    expect(sheetBook('half', 'b', 'a')).toBe('b');
    expect(sheetBook('collapsed', 'b', 'a')).toBe('b');
    expect(sheetBook('full', 'b', 'a')).toBe('a');
    expect(sheetBook('full', 'b', null)).toBe('b');
  });
});

describe('the history entry Back closes it with', () => {
  it('is pushed on opening and popped on closing another way', () => {
    expect(historyStep('collapsed', 'half', false)).toBe('push');
    expect(historyStep('collapsed', 'full', false)).toBe('push');
    expect(historyStep('half', 'collapsed', false)).toBe('pop');
    expect(historyStep('full', 'collapsed', false)).toBe('pop');
  });

  it('is left alone when Back closed it, or between half and full', () => {
    expect(historyStep('half', 'collapsed', true)).toBeNull();
    expect(historyStep('half', 'full', false)).toBeNull();
    expect(historyStep('full', 'half', false)).toBeNull();
    expect(historyStep('collapsed', 'collapsed', false)).toBeNull();
  });
});
