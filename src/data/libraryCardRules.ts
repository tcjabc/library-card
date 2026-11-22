import { LIBRARY_CARD_FORMATS, type LibraryCardFormat } from './DataStore';

/**
 * Library card barcodes: which values each barcode type can hold. Pure, so the store, the
 * "Add library card barcode" sheet and the tests share one set of rules.
 */

export const MAX_LIBRARY_CARD_VALUE = 200;
export const MAX_LIBRARY_CARD_LABEL = 100;

export type LibraryCardProblem =
  /** Nothing to draw. */
  | 'empty'
  | 'too_long'
  | 'unknown_format'
  /** A character this barcode type can't hold. */
  | 'characters'
  /** ITF holds digits in pairs. */
  | 'odd_length'
  /** EAN-13 needs 13 digits with a correct last (check) digit. */
  | 'check_digit'
  /** An EAN-13 starting 978 or 979 is a book's ISBN, not a library card. */
  | 'isbn';

export type LibraryCardCheck = { ok: true; value: string } | { ok: false; problem: LibraryCardProblem };

export const isLibraryCardFormat = (format: unknown): format is LibraryCardFormat =>
  typeof format === 'string' && (LIBRARY_CARD_FORMATS as readonly string[]).includes(format);

/** Printable ASCII (space to ~). */
const CODE_128 = /^[\x20-\x7e]+$/;
const CODE_39 = /^[0-9A-Z \-.$/+%]+$/;
/** Digits and - $ : / . +, with optional start and stop letters A–D (both or neither). */
const CODABAR = /^(?:[A-D][0-9\-$:/.+]+[A-D]|[0-9\-$:/.+]+)$/;

function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * Checks (and tidies) a library card value for its barcode type. The value is trimmed;
 * Code 39 and Codabar are upper-cased, and Code 39's "*" start/stop marks are dropped (scanners
 * leave them out).
 */
export function checkLibraryCardBarcode(raw: string, format: string): LibraryCardCheck {
  if (!isLibraryCardFormat(format)) return { ok: false, problem: 'unknown_format' };
  let value = raw.trim();
  if (format === 'code_39') value = value.replace(/^\*(.*)\*$/, '$1').toUpperCase();
  if (format === 'codabar') value = value.toUpperCase();
  if (!value) return { ok: false, problem: 'empty' };
  if (value.length > MAX_LIBRARY_CARD_VALUE) return { ok: false, problem: 'too_long' };

  switch (format) {
    case 'code_128':
      return CODE_128.test(value) ? { ok: true, value } : { ok: false, problem: 'characters' };
    case 'code_39':
      return CODE_39.test(value) ? { ok: true, value } : { ok: false, problem: 'characters' };
    case 'codabar':
      return CODABAR.test(value) ? { ok: true, value } : { ok: false, problem: 'characters' };
    case 'itf':
      if (!/^\d+$/.test(value)) return { ok: false, problem: 'characters' };
      return value.length % 2 === 0 ? { ok: true, value } : { ok: false, problem: 'odd_length' };
    case 'ean_13':
      if (!/^\d+$/.test(value)) return { ok: false, problem: 'characters' };
      if (value.length !== 13 || ean13CheckDigit(value.slice(0, 12)) !== Number(value[12])) {
        return { ok: false, problem: 'check_digit' };
      }
      return /^97[89]/.test(value) ? { ok: false, problem: 'isbn' } : { ok: true, value };
  }
}

/**
 * Whether a scanned value is the stored one. Codabar's start and stop letters are ignored
 * (a typed number has none; the redrawn barcode adds "A…A", and some scanners leave them out).
 */
export function sameLibraryCardValue(format: LibraryCardFormat, a: string, b: string): boolean {
  if (format === 'codabar') {
    const core = (v: string) => v.trim().toUpperCase().replace(/^[A-D]/, '').replace(/[A-D]$/, '');
    return core(a) === core(b);
  }
  if (format === 'code_39') return a.trim().toUpperCase() === b.trim().toUpperCase();
  return a.trim() === b.trim();
}

/** The label as stored: trimmed, null when empty. Over 100 characters is refused. */
export function cleanLibraryCardLabel(label: string | null | undefined): string | null | 'too_long' {
  const value = (label ?? '').trim();
  if (!value) return null;
  return value.length > MAX_LIBRARY_CARD_LABEL ? 'too_long' : value;
}
