// Vendored from Peek Budget js/qr-scan.js (tcjabc/substracker, commit f0385ee) and cut down for
// Library Card to the text check only (recoveryFromQr and its message): scanning itself uses the
// app's own Scanner (src/scan/Scanner.tsx), so jsQR, the camera code and the phone scanner are gone.
// See VENDORED.md.
//
// The recovery-words QR code (shown by Show recovery words on another device) holds the 12 words
// as plain text, separated by spaces.

import { parseRecovery, splitWords, WORD_COUNT } from './words.js';
import { t } from './i18n.js';

/** What a QR code that isn't a recovery code is called (in the language in use). */
export const notRecoveryMessage = () => t('sync.scan.notRecovery');

/**
 * The recovery words in a scanned QR text, normalised to "word word …" (lowercase, single spaces),
 * or null if the text isn't exactly 12 recovery words with a valid checksum. Never throws.
 */
export async function recoveryFromQr(text) {
  if (typeof text !== 'string' || text.length > 300) return null;
  if (!/^\s*[A-Za-z]+(?:\s+[A-Za-z]+)*\s*$/.test(text)) return null; // letters and whitespace only
  const words = splitWords(text);
  if (words.length !== WORD_COUNT) return null;
  const norm = words.join(' ');
  try { await parseRecovery(norm); } catch { return null; }
  return norm;
}
