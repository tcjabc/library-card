/**
 * Sealing cover photos for the relay: AES-GCM-256 with the household's blob key (vendor/crypto.js
 * deriveBlobKeys), bound to the photo's relay id, and padded so the relay learns only a size
 * bucket. The relay id is blobId(blobIdKey, sha256): the same photo always gets the same id in one
 * household, and the id reveals nothing without the household key.
 *
 * Sealed layout:  iv (12) | AES-GCM( plaintext ) incl. its 16-byte tag
 * Plaintext:      "LCP1" | type length (1) | type (UTF-8) | photo length (4, big-endian) | photo | zeros
 * The total is a multiple of BUCKET_BYTES and at most MAX_SEALED_BYTES (the relay's limit).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAGIC = enc.encode('LCP1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Sealed sizes are rounded up to this, so the relay sees size buckets, not exact sizes. */
export const BUCKET_BYTES = 16 * 1024;
/** The relay's largest photo (relay/src/room-logic.js maxBlobBytes). */
export const MAX_SEALED_BYTES = 512 * 1024;

export class PhotoTooLargeError extends Error {
  readonly code = 'too_large';
  constructor(size: number) {
    super(`A photo of ${size} bytes doesn't fit the relay's ${MAX_SEALED_BYTES}-byte limit once sealed.`);
  }
}

export class PhotoCheckError extends Error {
  readonly code = 'bad_photo';
}

const aad = (id: string) => enc.encode(`library-card/v1/blob|${id}`);

/** The sealed size for a photo of `size` bytes with a type of `typeBytes` bytes. */
export function sealedSize(size: number, typeBytes: number): number {
  const raw = IV_BYTES + MAGIC.length + 1 + typeBytes + 4 + size + TAG_BYTES;
  return Math.ceil(raw / BUCKET_BYTES) * BUCKET_BYTES;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seal a photo for the relay under its id. Rejects with PhotoTooLargeError past the relay's limit. */
export async function sealPhoto(blobKey: CryptoKey, id: string, photo: Uint8Array, type: string): Promise<Uint8Array> {
  const typeBytes = enc.encode(type.slice(0, 100));
  const total = sealedSize(photo.byteLength, typeBytes.byteLength);
  if (total > MAX_SEALED_BYTES) throw new PhotoTooLargeError(photo.byteLength);
  const plain = new Uint8Array(total - IV_BYTES - TAG_BYTES); // zero padded
  let at = 0;
  plain.set(MAGIC, at);
  at += MAGIC.length;
  plain[at++] = typeBytes.byteLength;
  plain.set(typeBytes, at);
  at += typeBytes.byteLength;
  new DataView(plain.buffer).setUint32(at, photo.byteLength);
  at += 4;
  plain.set(photo, at);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id) }, blobKey, plain as BufferSource),
  );
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv, 0);
  out.set(sealed, IV_BYTES);
  return out;
}

/**
 * Open a sealed photo and check it is the photo its hash names. Rejects with PhotoCheckError when
 * it can't be opened under this id and key, is malformed, or its SHA-256 isn't `expectedHash`.
 */
export async function openPhoto(
  blobKey: CryptoKey,
  id: string,
  sealed: Uint8Array,
  expectedHash: string,
): Promise<{ bytes: Uint8Array; type: string }> {
  if (sealed.byteLength < IV_BYTES + TAG_BYTES + MAGIC.length + 5) throw new PhotoCheckError('The photo is too short.');
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.subarray(0, IV_BYTES) as BufferSource, additionalData: aad(id) },
        blobKey,
        sealed.subarray(IV_BYTES) as BufferSource,
      ),
    );
  } catch {
    throw new PhotoCheckError('The photo could not be opened with this household’s key.');
  }
  if (MAGIC.some((b, i) => plain[i] !== b)) throw new PhotoCheckError('Not a Library Card photo.');
  let at = MAGIC.length;
  const typeLength = plain[at++];
  const type = dec.decode(plain.subarray(at, at + typeLength));
  at += typeLength;
  const size = new DataView(plain.buffer, plain.byteOffset).getUint32(at);
  at += 4;
  if (at + size > plain.byteLength) throw new PhotoCheckError('The photo is cut short.');
  const bytes = plain.slice(at, at + size);
  if ((await sha256Hex(bytes)) !== expectedHash) throw new PhotoCheckError('The photo doesn’t match its hash.');
  return { bytes, type };
}
