import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAD_OPEN_GUARD_MS, padAcceptsPress, padReady } from '../pressGuard';

// The number pad ignores presses just after it opens (src/ui/pressGuard.ts), so the tap that
// opened a PIN prompt or the gate can't enter a digit.

afterEach(() => vi.restoreAllMocks());

describe('padAcceptsPress', () => {
  it('ignores presses for about 300 ms after the pad opens', () => {
    expect(PAD_OPEN_GUARD_MS).toBe(300);
    expect(padAcceptsPress(1000, 1000)).toBe(false);
    expect(padAcceptsPress(1000, 1299)).toBe(false);
    expect(padAcceptsPress(1000, 1300)).toBe(true);
    expect(padAcceptsPress(1000, 5000)).toBe(true);
  });

  it('a pad that has not finished opening accepts nothing', () => {
    expect(padAcceptsPress(Number.POSITIVE_INFINITY, 1e12)).toBe(false);
  });

  it('padReady reads the clock', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    expect(padReady(9_900)).toBe(false);
    now.mockReturnValue(10_200);
    expect(padReady(9_900)).toBe(true);
  });
});

describe('the shared number pad uses it', () => {
  const pad = readFileSync(new URL('../NumberPad.tsx', import.meta.url), 'utf8');

  it('for every key it draws, and for a hardware keyboard', () => {
    const clicks = [...pad.matchAll(/onClick=\{([^}]*)\}/g)].map((m) => m[1]);
    expect(clicks).toHaveLength(4); // the 9 digits (one map), erase, 0, OK
    for (const click of clicks) expect(click).toMatch(/^\(\) => press\(/);
    expect(pad).toContain('if (!padReady(openedAt.current)) return;');
    expect(pad).toContain('openedAt.current = padClock();');
  });

  it('which both the household PIN prompt and the grown-ups gate are built on', () => {
    for (const file of ['../../grownups/pin/PinPad.tsx', '../../grownups/ParentGate.tsx']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).toContain('<NumberPad');
    }
  });
});
