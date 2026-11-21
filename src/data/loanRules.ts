import type { Id, Loan } from './DataStore';

/**
 * Duplicate library stickers. Two active loans can end up with the same
 * (library, sticker), for example when a book is scanned twice or when two
 * devices sync later. Nothing is deleted automatically: one loan "wins" and
 * the others are flagged for a grown-up to tidy up.
 */

export interface StickerResolution {
  winner: Loan;
  duplicates: Loan[];
}

/** The winner is the earliest borrowed_at, then the smallest id. */
export function pickStickerWinner(loans: readonly Loan[]): StickerResolution | null {
  if (loans.length === 0) return null;
  const sorted = [...loans].sort((a, b) => a.borrowed_at.localeCompare(b.borrowed_at) || a.id.localeCompare(b.id));
  return { winner: sorted[0], duplicates: sorted.slice(1) };
}

/** Grouping key for an active loan with a sticker, or null. */
export function stickerKey(loan: Loan): string | null {
  if (loan.returned_at !== null || !loan.sticker_barcode) return null;
  return `${loan.library_id ?? ''}\u0000${loan.sticker_barcode}`;
}

/**
 * Among active loans, the ones that duplicate another loan's (library,
 * sticker): a map from each duplicate's id to its winner's id.
 */
export function findStickerDuplicates(loans: readonly Loan[]): Map<Id, Id> {
  const groups = new Map<string, Loan[]>();
  for (const loan of loans) {
    const key = stickerKey(loan);
    if (key) groups.set(key, [...(groups.get(key) ?? []), loan]);
  }
  const out = new Map<Id, Id>();
  for (const group of groups.values()) {
    const resolved = pickStickerWinner(group);
    if (!resolved) continue;
    for (const dup of resolved.duplicates) out.set(dup.id, resolved.winner.id);
  }
  return out;
}
