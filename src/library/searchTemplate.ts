import { isValidIsbn10, isValidIsbn13, isbn13To10 } from '../books/isbn';

/**
 * Library catalogue search links. A grown-up pastes the URL of a search for
 * any book; the ISBN in it becomes a placeholder: {isbn} (ISBN-13) or
 * {isbn10} (when the catalogue was searched with an ISBN-10).
 */

export interface DetectedTemplate {
  template: string;
  /** Which form the pasted URL used. */
  form: 'isbn13' | 'isbn10';
  /** The ISBN as it appeared in the URL. */
  found: string;
}

/** An http(s) URL, or null. */
export function asWebUrl(text: string): URL | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** The ISBN digits of a match: encoded separators (%2D, %20) go before non-digits, or their 2 would count. */
const digitsOf = (s: string) => s.replace(/%2D|%20/gi, '').replace(/[^\dXx]/g, '').toUpperCase();

/**
 * The search template for a pasted catalogue URL, or null when it isn't a web
 * URL or holds no valid ISBN. ISBNs may contain hyphens or spaces (also
 * %20 / +). An ISBN-13 is preferred over an ISBN-10.
 */
export function searchTemplateFromUrl(text: string): DetectedTemplate | null {
  const url = asWebUrl(text);
  if (!url) return null;
  const raw = text.trim();
  const sep = '(?:-|%2D|%2d|%20|\\+|\\s)?';
  const isbn13 = new RegExp(`(?<![0-9])97[89](?:${sep}[0-9]){10}(?![0-9])`, 'g');
  const isbn10 = new RegExp(`(?<![0-9])[0-9](?:${sep}[0-9]){8}${sep}[0-9Xx](?![0-9])`, 'g');

  for (const [pattern, form, valid] of [
    [isbn13, 'isbn13', isValidIsbn13],
    [isbn10, 'isbn10', isValidIsbn10],
  ] as const) {
    for (const match of raw.matchAll(pattern)) {
      const found = match[0];
      if (!valid(digitsOf(found))) continue;
      const placeholder = form === 'isbn13' ? '{isbn}' : '{isbn10}';
      return { template: raw.split(found).join(placeholder), form, found };
    }
  }
  return null;
}

/**
 * The search URL for one book, or null for a book without an ISBN
 * ("noisbn-…") or a template without a placeholder.
 */
export function fillSearchTemplate(template: string, bookKey: string): string | null {
  if (!/^97[89]\d{10}$/.test(bookKey)) return null;
  if (!template.includes('{isbn}') && !template.includes('{isbn10}')) return null;
  const ten = isbn13To10(bookKey) ?? bookKey; // 979 ISBNs have no ISBN-10
  return template.split('{isbn}').join(encodeURIComponent(bookKey)).split('{isbn10}').join(encodeURIComponent(ten));
}

/** The ISBN "Test it" fills a template with (a well-known children's book). */
export const SAMPLE_ISBN = '9780064400558';
