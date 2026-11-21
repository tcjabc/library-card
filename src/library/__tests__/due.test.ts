import { describe, expect, it } from 'vitest';
import { DUE_SOON_DAYS, dueDateIn, dueStatus, needsAttention } from '../due';

// Runs in America/New_York (vitest.config.ts): DST starts 2026-03-08.

describe('dueDateIn', () => {
  it('is today + N calendar days', () => {
    expect(dueDateIn(30, '2026-01-15')).toBe('2026-02-14');
    expect(dueDateIn(21, '2026-03-01')).toBe('2026-03-22'); // across the DST change
    expect(dueDateIn(30, '2026-12-15')).toBe('2027-01-14');
    expect(dueDateIn(0, '2026-05-05')).toBe('2026-05-05');
  });
});

describe('dueStatus', () => {
  const today = '2026-03-07';

  it('due soon is today and the next two days (3 days including today)', () => {
    expect(DUE_SOON_DAYS).toBe(3);
    expect(dueStatus('2026-03-07', today)).toBe('soon');
    expect(dueStatus('2026-03-08', today)).toBe('soon'); // the short DST day
    expect(dueStatus('2026-03-09', today)).toBe('soon');
    expect(dueStatus('2026-03-10', today)).toBe('later');
  });

  it('overdue is any day before today', () => {
    expect(dueStatus('2026-03-06', today)).toBe('overdue');
    expect(dueStatus('2025-12-31', today)).toBe('overdue');
  });

  it('no due date is "none"', () => {
    expect(dueStatus(null, today)).toBe('none');
  });

  it('only overdue and due soon need attention', () => {
    expect(['overdue', 'soon', 'later', 'none'].map((s) => needsAttention(s as never))).toEqual([true, true, false, false]);
  });
});
