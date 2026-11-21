// Types for qr-scan.js (vendored from Peek Budget and cut down; see VENDORED.md). Hand-written.

/** The message for a QR code that isn't a recovery code. */
export declare const notRecoveryMessage: () => string;
/** The 12 recovery words in a scanned QR text, normalised, or null. Never throws. */
export declare function recoveryFromQr(text: unknown): Promise<string | null>;
