/**
 * Does a scanned text look like a household pairing code (12 words, as the
 * "Add a device" QR holds)? A cheap shape check with no word list, so the card
 * scanner can say "that's a grown-up code" without loading the sync code. The
 * real check (word list and checksum) is recoveryFromQr in vendor/qr-scan.js.
 */
export function looksLikePairingCode(text: string): boolean {
  return text.length <= 300 && /^\s*[A-Za-z]{3,8}(?:\s+[A-Za-z]{3,8}){11}\s*$/.test(text);
}
