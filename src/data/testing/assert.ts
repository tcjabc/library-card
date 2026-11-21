import { isDataStoreError } from '../DataStore';

/**
 * Tiny assertions for the shared storage checks. They run both in the browser
 * (the self-test page) and under Vitest, so they can't use Vitest's expect().
 * A failure throws CheckFailure, which both runners report.
 */

export class CheckFailure extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'CheckFailure';
    if (detail !== undefined) this.detail = safeJson(detail);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function ok(condition: unknown, message: string, detail?: unknown): asserts condition {
  if (!condition) throw new CheckFailure(message, detail);
}

/** Deep equality through JSON (key order matters; fine for our plain records). */
export function equal<T>(actual: T, expected: T, message: string): void {
  const a = safeJson(actual);
  const e = safeJson(expected);
  if (a !== e) throw new CheckFailure(message, { actual, expected });
}

/** Resolves when `promise` rejects with a DataStoreError of `code`. */
export async function rejectsWithCode(promise: Promise<unknown>, code: string, message: string): Promise<void> {
  let outcome = 'resolved';
  try {
    await promise;
  } catch (error) {
    outcome = isDataStoreError(error) ? error.code : String(error);
  }
  if (outcome !== code) throw new CheckFailure(message, { expected: code, got: outcome });
}
