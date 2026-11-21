/**
 * Parent PIN hashing, shared by every adapter so the stored format is the same
 * everywhere. Format (one string, safe to store in any text column):
 *
 *   pbkdf2-sha256$<iterations>$<salt base64url>$<hash base64url>
 *
 * A short PIN can always be brute-forced by someone who has the hash, so this
 * keeps the PIN from being read casually; it is not strong protection. The
 * PIN gate is a "grown-ups only" door, not a security boundary.
 */

const SCHEME = 'pbkdf2-sha256';
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

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

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, ITERATIONS);
  return [SCHEME, ITERATIONS, toBase64Url(salt), toBase64Url(hash)].join('$');
}

/** False for a wrong PIN or a malformed stored value. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iterText, saltText, hashText] = stored.split('$');
  const iterations = Number(iterText);
  if (scheme !== SCHEME || !Number.isInteger(iterations) || iterations < 1 || !saltText || !hashText) {
    return false;
  }
  const expected = fromBase64Url(hashText);
  const actual = await derive(pin, fromBase64Url(saltText), iterations);
  if (actual.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
