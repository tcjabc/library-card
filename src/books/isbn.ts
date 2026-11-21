/**
 * ISBN validation and normalisation. The canonical form used everywhere in
 * the app is ISBN-13, digits only.
 */

/** Strips separators. Keeps a trailing X (ISBN-10 check digit). */
function clean(raw: string): string {
  return raw.replace(/[\s\-‐-―]/g, '').replace(/^ISBN(?:-1[03])?:?/i, '').toUpperCase();
}

export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = value[i] === 'X' ? 10 : Number(value[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidIsbn13(value: string): boolean {
  if (!/^97[89]\d{10}$/.test(value)) return false;
  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

export function isbn10To13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

/** Only 978-prefixed ISBN-13s have an ISBN-10 equivalent. */
export function isbn13To10(isbn13: string): string | null {
  if (!isbn13.startsWith('978')) return null;
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return `${core}${check === 10 ? 'X' : check}`;
}

/**
 * Returns the ISBN-13 for any valid ISBN-10 or ISBN-13 input (with or without
 * hyphens/spaces), or null if the input is not a valid ISBN.
 * EAN-13 barcodes that aren't books (no 978/979 prefix) return null.
 */
export function normaliseIsbn(raw: string): string | null {
  const value = clean(raw);
  if (value.length === 13) return isValidIsbn13(value) ? value : null;
  if (value.length === 10) return isValidIsbn10(value) ? isbn10To13(value) : null;
  return null;
}
