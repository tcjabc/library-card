import { fmt, strings } from '../../strings';
import type { LocalCounts, SyncState } from '../../sync/service';

const t = strings.grownups.sync;

/** The status line's main words for a state. */
export const stateText = (state: SyncState): string => t.state[state];

/** "Last synced 14:05" today, "Last synced 3 Mar 2026, 14:05" before. */
export function lastSyncedText(at: string | null, now: Date = new Date()): string {
  if (!at) return t.notSynced;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return t.notSynced;
  const time =
    date.toDateString() === now.toDateString()
      ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return fmt(t.lastSynced, { time });
}

export const waitingText = (count: number): string => fmt(count === 1 ? t.waiting.one : t.waiting.other, { count });

export const countsText = (counts: LocalCounts): string => fmt(t.counts, { ...counts });

export const totalCount = (counts: LocalCounts): number => Object.values(counts).reduce((a, b) => a + b, 0);

/** A message for a failed sync action, never the raw error (it could mention internals). */
export function actionErrorText(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'busy') return t.busyElsewhere;
  if (typeof code === 'string' && Object.hasOwn(t.join.errors, code)) return t.join.errors[code as keyof typeof t.join.errors];
  // Bad words (WordsError) carry a message written for people.
  if (error instanceof Error && error.name === 'Error' && ['empty', 'count', 'unknown', 'checksum'].includes(String(code))) return error.message;
  return t.failed;
}
