import type { CoverState } from './coverArt';
import { MAX_TRIES } from './coverColour';
import { COVER_MIN_PX } from './coverPlan';

/**
 * Developer tools' "Cover diagnostics": for each book of the Family Staircase's pile, where its
 * cover comes from, how loading it went, what this device has cached for it, and why its top face
 * is flat if it is. Local only, with the titles the pile shows anyway: in memory, and the last one
 * in this tab's sessionStorage ("library-card:cover-report", gone when the tab or app closes, never
 * synced or sent) so a reload keeps it. The pile registers while it is open (provideCoverReport)
 * and leaves its last report behind when it closes, for the developer tools page to show and copy.
 */

export const REPORT_KEY = 'library-card:cover-report';

export interface CoverReportBook {
  /** Its place in the pile: 1 is the oldest. */
  number: number;
  title: string;
  /** The book's key: its ISBN, or "noisbn-…". */
  key: string;
  hasCover: boolean;
  /** Drawn in the latest frame. */
  drawn: boolean;
  /** Its top face's thickness on screen in the latest frame (px); null when not drawn or its top face isn't showing. */
  topPx: number | null;
  /** The cover loader's state; null with covers off. */
  cover: CoverState | null;
}

export interface CoverReport {
  /** When it was taken (ms, Date.now()). */
  at: number;
  /** Oldest first, like the pile. */
  books: CoverReportBook[];
}

/** Why a book's top face is a flat colour, or null when it shows its cover. */
export type FlatReason = 'no cover' | 'covers off' | 'failed' | 'backoff' | 'outside draw range' | 'top face hidden' | 'LOD' | 'loading' | 'not requested';

export function flatReason(book: CoverReportBook): FlatReason | null {
  if (!book.hasCover) return 'no cover';
  if (!book.cover) return 'covers off';
  const { state } = book.cover;
  if (state === 'failed' || state === 'backoff') return state;
  if (!book.drawn) return 'outside draw range';
  if (book.topPx === null) return 'top face hidden';
  if (book.topPx < COVER_MIN_PX) return 'LOD';
  if (state === 'ready') return null;
  return state;
}

/** The words a report is written in (strings.dev). */
export interface CoverReportWords {
  coverDiagHeader: string;
  coverDiagLine: string;
  coverDiagSourcePhoto: string;
  coverDiagSourceOpenLibrary: string;
  coverDiagSourceCors: string;
  coverDiagSourceGoogle: string;
  coverDiagSourceGoogleWhy: string;
  coverDiagSourceNone: string;
  coverDiagCoversOff: string;
  coverDiagReady: string;
  coverDiagLoading: string;
  coverDiagNotRequested: string;
  coverDiagFailed: string;
  coverDiagBackoff: string;
  coverDiagColourYes: string;
  coverDiagColourNone: string;
  coverDiagColourNo: string;
  coverDiagShapeYes: string;
  coverDiagShapeNo: string;
  coverDiagTopCover: string;
  coverDiagTopFlat: string;
  coverDiagReasonNoCover: string;
  coverDiagReasonCoversOff: string;
  coverDiagReasonFailed: string;
  coverDiagReasonBackoff: string;
  coverDiagReasonOutside: string;
  coverDiagReasonHidden: string;
  coverDiagReasonLod: string;
  coverDiagReasonLoading: string;
  coverDiagReasonNotRequested: string;
}

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

function sourceText(cover: CoverState | null, w: CoverReportWords): string {
  if (!cover) return w.coverDiagCoversOff;
  switch (cover.source) {
    case 'photo':
      return w.coverDiagSourcePhoto;
    case 'openlibrary':
      return w.coverDiagSourceOpenLibrary;
    case 'cors':
      return w.coverDiagSourceCors;
    case 'google':
      return cover.openLibrary ? fill(w.coverDiagSourceGoogleWhy, { why: cover.openLibrary }) : w.coverDiagSourceGoogle;
    default:
      return w.coverDiagSourceNone;
  }
}

function stateText(cover: CoverState, w: CoverReportWords, time: (ms: number) => string): string {
  switch (cover.state) {
    case 'ready':
      return w.coverDiagReady;
    case 'loading':
      return w.coverDiagLoading;
    case 'not requested':
      return w.coverDiagNotRequested;
    case 'failed':
      return fill(w.coverDiagFailed, { reason: cover.reason ?? '?', tries: cover.attempts });
    case 'backoff':
      return fill(w.coverDiagBackoff, { reason: cover.reason ?? '?', time: cover.until ? time(cover.until) : '?', tries: cover.attempts, max: MAX_TRIES });
  }
}

function reasonText(book: CoverReportBook, w: CoverReportWords): string {
  const reason = flatReason(book);
  switch (reason) {
    case null:
      return w.coverDiagTopCover;
    case 'no cover':
      return fill(w.coverDiagTopFlat, { why: w.coverDiagReasonNoCover });
    case 'covers off':
      return fill(w.coverDiagTopFlat, { why: w.coverDiagReasonCoversOff });
    case 'failed':
      return fill(w.coverDiagTopFlat, { why: fill(w.coverDiagReasonFailed, { reason: book.cover?.reason ?? '?' }) });
    case 'backoff':
      return fill(w.coverDiagTopFlat, { why: w.coverDiagReasonBackoff });
    case 'outside draw range':
      return fill(w.coverDiagTopFlat, { why: w.coverDiagReasonOutside });
    case 'top face hidden':
      return fill(w.coverDiagTopFlat, { why: w.coverDiagReasonHidden });
    case 'LOD':
      return fill(w.coverDiagTopFlat, { why: fill(w.coverDiagReasonLod, { px: Math.round((book.topPx ?? 0) * 10) / 10 }) });
    case 'loading':
      return fill(w.coverDiagTopFlat, { why: w.coverDiagReasonLoading });
    case 'not requested':
      return fill(w.coverDiagTopFlat, { why: w.coverDiagReasonNotRequested });
  }
}

/** One line per book, newest first, after a header line. `time` formats a Date.now() time (e.g. "14:03:12"). */
export function coverReportLines(report: CoverReport, w: CoverReportWords, time: (ms: number) => string): string[] {
  const lines = [fill(w.coverDiagHeader, { count: report.books.length, time: time(report.at) })];
  for (let i = report.books.length - 1; i >= 0; i--) {
    const b = report.books[i];
    lines.push(
      fill(w.coverDiagLine, {
        number: b.number,
        title: b.title,
        key: b.key,
        source: b.hasCover ? sourceText(b.cover, w) : w.coverDiagSourceNone,
        state: b.cover ? stateText(b.cover, w, time) : '–',
        colour: b.cover ? (b.cover.colour === 'yes' ? w.coverDiagColourYes : b.cover.colour === 'none' ? w.coverDiagColourNone : w.coverDiagColourNo) : '–',
        shape: b.cover ? (b.cover.shape ? w.coverDiagShapeYes : w.coverDiagShapeNo) : '–',
        top: reasonText(b, w),
      }),
    );
  }
  return lines;
}

// ---- The pile's latest report (memory only) ----

let live: (() => CoverReport) | null = null;
let last: CoverReport | null = null;

function keep(report: CoverReport): void {
  try {
    window.sessionStorage.setItem(REPORT_KEY, JSON.stringify(report));
  } catch {
    // No session storage: memory only.
  }
}

function kept(): CoverReport | null {
  try {
    const text = window.sessionStorage.getItem(REPORT_KEY);
    const report = text ? (JSON.parse(text) as CoverReport) : null;
    return report && typeof report.at === 'number' && Array.isArray(report.books) ? report : null;
  } catch {
    return null;
  }
}

/** The pile is open: `build` makes its report on demand. The returned function, called as it closes, keeps its last report. */
export function provideCoverReport(build: () => CoverReport): () => void {
  live = build;
  return () => {
    if (live !== build) return;
    try {
      last = build();
      keep(last);
    } catch {
      // Keep the one before.
    }
    live = null;
  };
}

/** The open pile's report now, or the last one left behind (null if the pile hasn't been opened in this visit). */
export function latestCoverReport(): CoverReport | null {
  if (live) return live();
  if (!last) last = kept();
  return last;
}
