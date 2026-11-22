import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readButtonState, readRecord, readSteps, waitingBooks } from '../readFlow';

// A child's "I read this!" (src/books/readFlow.ts, ReadSheet.tsx, useReadAction.tsx).

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('the read sheet', () => {
  it('asks a child how they read it, then (if their reads need checking) who checks it; a grown-up just reads', () => {
    expect(readSteps({ kind: 'child', needs_check: true })).toEqual(['how', 'check']);
    expect(readSteps({ kind: 'child', needs_check: false })).toEqual(['how']);
    expect(readSteps({ kind: 'grown_up', needs_check: false })).toEqual([]);
    expect(readSteps({ kind: 'grown_up', needs_check: true })).toEqual([]);
  });

  it('records: no check needed → confirmed; Confirm now → confirmed with the PIN; Send → pending', () => {
    expect(readRecord('self', 'none')).toEqual({ how: 'self', status: 'confirmed' });
    expect(readRecord('help', 'confirm-now')).toEqual({ how: 'help', status: 'confirmed', confirmedBy: 'pin' });
    expect(readRecord('self', 'send')).toEqual({ how: 'self', status: 'pending' });
  });

  it('Send is the default (first, highlighted); Back and tapping outside record nothing', () => {
    const sheet = read('ReadSheet.tsx');
    expect(sheet.indexOf('t.send}')).toBeLessThan(sheet.indexOf('t.confirmNow}'));
    expect(sheet).toMatch(/title=\{t\.send\}[^>]*primary/);
    expect(sheet).toContain('<Sheet title={heading} onClose={onCancel}>');
    expect(sheet).toContain('onClick={onCancel}');
  });

  it('Confirm now asks for the household PIN (or the gate), which opens neither grown-up mode nor the 2-minute window', () => {
    const sheet = read('ReadSheet.tsx');
    expect(sheet).toContain('<GrownUpCheck');
    for (const opener of ['unlockPinActions', 'unlockGrownUp', 'requireGrownUp', 'runAsGrownUp']) expect(sheet).not.toContain(opener);
  });

  it('a pending read gets a quiet toast with Undo and no confetti; a counted one gets confetti', () => {
    const hook = read('useReadAction.tsx');
    const pendingBranch = hook.indexOf("if (event.status === 'pending') {");
    expect(pendingBranch).toBeGreaterThan(0);
    expect(hook.indexOf('toast({ message: strings.reads.sentToast, action: undoAction });')).toBeGreaterThan(pendingBranch);
    expect(hook.indexOf('confettiBurst(ask.burstAt);')).toBeGreaterThan(hook.indexOf('return;', pendingBranch));
  });
});

describe('a book waiting for a grown-up', () => {
  const events = [
    { reader_id: 'ada', isbn: 'A', status: 'pending' as const },
    { reader_id: 'ada', isbn: 'B', status: 'confirmed' as const },
    { reader_id: 'ben', isbn: 'C', status: 'pending' as const },
  ];

  it("is one with a pending read for this child (not another child's)", () => {
    expect([...waitingBooks(events, 'ada')]).toEqual(['A']);
    expect([...waitingBooks(events, 'ben')]).toEqual(['C']);
    expect(waitingBooks([], 'ada').size).toBe(0);
  });

  it('its read button says "Waiting for a grown-up" and is off; otherwise first / again by confirmed reads', () => {
    expect(readButtonState(0, true)).toEqual({ kind: 'waiting', disabled: true });
    expect(readButtonState(3, true)).toEqual({ kind: 'waiting', disabled: true });
    expect(readButtonState(0, false)).toEqual({ kind: 'first', disabled: false });
    expect(readButtonState(2, false)).toEqual({ kind: 'again', disabled: false });
    expect(readButtonState(2, false, true)).toEqual({ kind: 'again', disabled: true });
  });

  it('the hook ignores a tap on a waiting book', () => {
    expect(read('useReadAction.tsx')).toContain('if (!store || waiting.has(isbn)) return;');
  });
});
