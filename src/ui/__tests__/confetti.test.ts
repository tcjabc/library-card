import { describe, expect, it } from 'vitest';
import { isModal } from '../confetti';

// 1.26.0: confetti in a modal dialog on browsers without the `:modal` selector (Chrome 103).

describe('isModal', () => {
  it('asks the browser where it knows `:modal`', () => {
    expect(isModal({ matches: (s: string) => s === ':modal' } as unknown as Element)).toBe(true);
    expect(isModal({ matches: () => false } as unknown as Element)).toBe(false);
  });

  it('where `:modal` is unknown (matches throws, as on Chrome 103), an open dialog counts as modal instead of breaking the celebration', () => {
    const old = { matches: () => { throw new DOMException("':modal' is not a valid selector.", 'SyntaxError'); } } as unknown as Element;
    expect(isModal(old)).toBe(true);
  });
});
