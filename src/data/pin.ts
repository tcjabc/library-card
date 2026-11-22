/**
 * Household PIN hashing, shared by every adapter so the stored format is the same
 * everywhere. Format (one string, safe to store in any text column, ≤ 100 characters):
 *
 *   pbkdf2-sha256$<iterations>$<salt base64url>$<hash base64url>
 *
 * The iteration count is part of the hash, so it can change later: old hashes keep
 * verifying with their own count. PIN_ITERATIONS (300,000) measured about 77 ms on a
 * Mi 9T (Chrome, 2019 mid-range) and about 45 ms on a desktop: cheap for a right PIN, while the
 * wrong-PIN waits (src/grownups/pinAttempts.ts) do the slowing down in the app.
 *
 * A 4–6 digit PIN can always be brute-forced by someone who has the hash, so this keeps the
 * PIN from being read casually; it is not strong protection. The hash only leaves the device
 * inside sync's encrypted records. The PIN is a "grown-ups only" door for a few household-wide
 * actions, not a security boundary: the 12 words are.
 */

const SCHEME = 'pbkdf2-sha256';
/** The cost new hashes get. */
export const PIN_ITERATIONS = 300_000;
/** Stored hashes outside this range are refused (a synced value can't make verifying hang). */
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 5_000_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export const PIN_MIN_DIGITS = 4;
export const PIN_MAX_DIGITS = 6;

/** 4 to 6 digits, nothing else. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
}

const HASH_PATTERN = /^pbkdf2-sha256\$(\d{1,8})\$([\w-]{16,64})\$([\w-]{16,128})$/;

/** The iteration count of a well-formed stored hash, or null. */
export function pinHashIterations(stored: unknown): number | null {
  if (typeof stored !== 'string') return null;
  const match = HASH_PATTERN.exec(stored);
  if (!match) return null;
  const iterations = Number(match[1]);
  return iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS ? iterations : null;
}

/** A stored value hashPin could have made (any allowed cost). */
export const isPinHash = (stored: unknown): stored is string => pinHashIterations(stored) !== null;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  if (!crypto.subtle) throw new Error('PIN hashing needs a secure (https) page.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

/** Hash a PIN with a fresh salt. `iterations` is for tests (and a later change of cost). */
export async function hashPin(pin: string, iterations: number = PIN_ITERATIONS): Promise<string> {
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS || !Number.isInteger(iterations)) {
    throw new RangeError(`PIN hash cost must be ${MIN_ITERATIONS}–${MAX_ITERATIONS} iterations.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, iterations);
  return [SCHEME, iterations, toBase64Url(salt), toBase64Url(hash)].join('$');
}

/** False for a wrong PIN or a malformed stored value. Uses the cost recorded in the hash. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const iterations = pinHashIterations(stored);
  if (iterations === null) return false;
  const [, , saltText, hashText] = stored.split('$');
  const expected = fromBase64Url(hashText);
  const actual = await derive(pin, fromBase64Url(saltText), iterations);
  if (actual.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
