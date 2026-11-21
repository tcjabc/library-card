// Types for words.js (vendored verbatim from Peek Budget; see VENDORED.md). Hand-written.

export declare const WORD_COUNT: 12;

/** One problem with typed recovery words; `word` is the 1-based position when it's about one word. */
export interface WordProblem {
  word?: number;
  message: string;
}

export type WordsErrorCode = 'empty' | 'count' | 'unknown' | 'checksum' | 'key';

export declare class WordsError extends Error {
  constructor(code: WordsErrorCode, problems: WordProblem[]);
  code: WordsErrorCode;
  problems: WordProblem[];
}

/** The 12 words for 16 key bytes. */
export declare function bytesToWords(bytes: Uint8Array): Promise<string[]>;
/** The 12 words for a stored household key (22 characters of base64url). */
export declare function keyToWords(keyText: string): Promise<string[]>;
export declare function splitWords(text: unknown): string[];
export declare function closestWord(word: unknown): string | null;
export declare function wordProblems(text: unknown): WordProblem[];
/** The household key (stored form) from typed words or an old-style key. Rejects with WordsError. */
export declare function parseRecovery(text: unknown): Promise<string>;
