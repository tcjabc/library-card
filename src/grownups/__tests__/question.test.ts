import { describe, expect, it } from 'vitest';
import { strings } from '../../strings';
import { newGateQuestion, numberWord } from '../question';

const SAMPLES = 5000;

describe('newGateQuestion', () => {
  it('uses factors 3 to 9 only: never ×0, ×1, ×2 or ×10', () => {
    const seen = new Set<number>();
    for (let i = 0; i < SAMPLES; i++) {
      const q = newGateQuestion();
      for (const f of [q.a, q.b]) {
        expect(f).toBeGreaterThanOrEqual(3);
        expect(f).toBeLessThanOrEqual(9);
        expect(Number.isInteger(f)).toBe(true);
        seen.add(f);
      }
    }
    // Every factor in range turns up, so the range really is 3-9.
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('writes the question in words and knows the answer', () => {
    for (let i = 0; i < 200; i++) {
      const q = newGateQuestion();
      expect(q.answer).toBe(q.a * q.b);
      expect(q.text).toBe(`What’s ${numberWord(q.a)} times ${numberWord(q.b)}?`);
      expect(q.text).not.toMatch(/\d/); // no digits for a child to copy
    }
  });

  it('never repeats the previous pair, in either order', () => {
    let previous = newGateQuestion();
    for (let i = 0; i < SAMPLES; i++) {
      const next = newGateQuestion(previous);
      const same = (next.a === previous.a && next.b === previous.b) || (next.a === previous.b && next.b === previous.a);
      expect(same).toBe(false);
      previous = next;
    }
  });
});

describe('numberWord', () => {
  it('uses the words from en.ts', () => {
    expect(numberWord(3)).toBe('three');
    expect(numberWord(9)).toBe('nine');
    expect(numberWord(7)).toBe(strings.numbers[7]);
  });

  it('falls back to digits outside the list', () => {
    expect(numberWord(42)).toBe('42');
  });
});
