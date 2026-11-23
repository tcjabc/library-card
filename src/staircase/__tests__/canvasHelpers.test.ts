import { describe, expect, it } from 'vitest';
import { ELLIPSIS, LruCache, backingSize, canvasScale, cssLength, fitWithEllipsis, graphemes } from '../canvasHelpers';

// Small helpers for the canvas book stack (src/staircase/canvasHelpers.ts).

/** A pretend measureText: 1 px per Latin character, space or ellipsis, 2 per wide (CJK or emoji) character. */
const measure = (s: string) => graphemes(s).reduce((w, c) => w + (/[\x20-\x7e…]/.test(c) ? 1 : 2), 0);

describe('canvasScale and backingSize', () => {
  it('draws at the screen’s pixel ratio, at most 2x', () => {
    expect(canvasScale(1)).toBe(1);
    expect(canvasScale(1.5)).toBe(1.5);
    expect(canvasScale(2.625)).toBe(2);
    expect(canvasScale(3)).toBe(2);
    expect(canvasScale(0)).toBe(1);
    expect(canvasScale(Number.NaN)).toBe(1);
  });

  it('rounds the backing size to whole pixels, at least 1', () => {
    expect(backingSize(412, 2)).toBe(824);
    expect(backingSize(600, 1.5)).toBe(900);
    expect(backingSize(33.3, 2)).toBe(67);
    expect(backingSize(0, 2)).toBe(1);
    expect(backingSize(-10, 2)).toBe(1);
  });
});

describe('cssLength', () => {
  it('reads px, rem and bare numbers', () => {
    expect(cssLength('2px', 16)).toBe(2);
    expect(cssLength(' 0.625rem ', 16)).toBe(10);
    expect(cssLength('1rem', 20)).toBe(20);
    expect(cssLength('14', 16)).toBe(14);
  });

  it('is NaN for anything else', () => {
    expect(cssLength('', 16)).toBeNaN();
    expect(cssLength('calc(1px + 2px)', 16)).toBeNaN();
    expect(cssLength('10%', 16)).toBeNaN();
  });
});

describe('graphemes', () => {
  it('keeps emoji and CJK characters whole', () => {
    expect(graphemes('月亮湯')).toEqual(['月', '亮', '湯']);
    expect(graphemes('🦊a')).toEqual(['🦊', 'a']);
    expect(graphemes('👍🏽!')).toEqual(['👍🏽', '!']);
  });
});

describe('fitWithEllipsis', () => {
  it('leaves a title that fits alone', () => {
    expect(fitWithEllipsis('Moon Soup', 9, measure)).toBe('Moon Soup');
    expect(fitWithEllipsis('', 0, measure)).toBe('');
  });

  it('cuts a long title to the most that fits with an ellipsis, without a trailing space', () => {
    expect(fitWithEllipsis('The Cat Who Counted Clouds', 10, measure)).toBe(`The Cat W${ELLIPSIS}`);
    expect(fitWithEllipsis('The Cat Who Counted Clouds', 9, measure)).toBe(`The Cat${ELLIPSIS}`);
    expect(measure(fitWithEllipsis('The Cat Who Counted Clouds', 9, measure))).toBeLessThanOrEqual(9);
  });

  it('cuts CJK and emoji between whole characters', () => {
    const fitted = fitWithEllipsis('我的阿嬤是神探：夏天的祕密', 9, measure);
    expect(fitted).toBe(`我的阿嬤${ELLIPSIS}`);
    expect(fitWithEllipsis('🦊🦊🦊🦊', 5, measure)).toBe(`🦊🦊${ELLIPSIS}`);
  });

  it('is empty when not even the ellipsis fits', () => {
    expect(fitWithEllipsis('Pip', 0.5, measure)).toBe('');
  });
});

describe('LruCache', () => {
  it('drops the least recently used entry past its limit', () => {
    const cache = new LruCache<number, string>(2);
    cache.set(1, 'a');
    cache.set(2, 'b');
    expect(cache.get(1)).toBe('a'); // 1 is now the newest
    cache.set(3, 'c');
    expect(cache.has(2)).toBe(false);
    expect(cache.get(1)).toBe('a');
    expect(cache.get(3)).toBe('c');
    expect(cache.size).toBe(2);
  });

  it('replaces a key in place and can be cleared', () => {
    const cache = new LruCache<string, number>(3);
    cache.set('x', 1);
    cache.set('x', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('x')).toBe(2);
    expect(cache.get('missing')).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('keeps at least one entry', () => {
    const cache = new LruCache<number, number>(0);
    cache.set(1, 1);
    cache.set(2, 2);
    expect(cache.size).toBe(1);
    expect(cache.get(2)).toBe(2);
  });
});
