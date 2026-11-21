// Types for i18n.js (Library Card's stand-in for Peek Budget's js/i18n.js). Hand-written.

/** Peek Budget message key -> dotted path in `strings` (e.g. "sync.error.401"). */
export declare const KEYS: Readonly<Record<string, string>>;

/** The text for a Peek Budget message key, with {placeholders} filled in; '' for an unknown key. */
export declare function t(key: string, params?: Record<string, string | number>): string;
