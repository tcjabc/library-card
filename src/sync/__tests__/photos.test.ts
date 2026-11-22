import { describe, expect, it } from 'vitest';
import { BUCKET_BYTES, MAX_SEALED_BYTES, PhotoCheckError, PhotoTooLargeError, openPhoto, sealPhoto, sealedSize, sha256Hex } from '../photos';
import { blobId, deriveBlobKeys, generateKey } from '../vendor/crypto.js';

// Sealing cover photos for the relay (src/sync/photos.ts).

const bytes = (n: number, seed = 1) => new Uint8Array(n).map((_, i) => (i * 31 + seed) % 256);

async function keys() {
  const { blobKey, blobIdKey } = await deriveBlobKeys(generateKey());
  return { blobKey, blobIdKey };
}

describe('sealPhoto / openPhoto', () => {
  it('round-trips a photo and its type under its id', async () => {
    const { blobKey, blobIdKey } = await keys();
    const photo = bytes(5000);
    const hash = await sha256Hex(photo);
    const id = await blobId(blobIdKey, hash);
    const sealed = await sealPhoto(blobKey, id, photo, 'image/jpeg');
    expect(await openPhoto(blobKey, id, sealed, hash)).toEqual({ bytes: photo, type: 'image/jpeg' });
  });

  it('pads to 16 KB buckets, so close sizes look the same to the relay', async () => {
    const { blobKey } = await keys();
    const small = await sealPhoto(blobKey, 'id', bytes(10), 'image/png');
    const medium = await sealPhoto(blobKey, 'id', bytes(10_000), 'image/png');
    const over = await sealPhoto(blobKey, 'id', bytes(BUCKET_BYTES), 'image/png');
    expect(small.byteLength).toBe(BUCKET_BYTES);
    expect(medium.byteLength).toBe(BUCKET_BYTES);
    expect(over.byteLength).toBe(2 * BUCKET_BYTES);
    for (const n of [1, 16_000, 100_000, 300_000]) {
      const sealed = await sealPhoto(blobKey, 'id', bytes(n), 'image/webp');
      expect(sealed.byteLength % BUCKET_BYTES).toBe(0);
      expect(sealed.byteLength).toBe(sealedSize(n, 'image/webp'.length));
    }
  });

  it('refuses a photo that would not fit the relay once sealed', async () => {
    const { blobKey } = await keys();
    const largest = MAX_SEALED_BYTES - 12 - 16 - 4 - 1 - 'image/jpeg'.length - 4;
    expect((await sealPhoto(blobKey, 'id', bytes(largest), 'image/jpeg')).byteLength).toBe(MAX_SEALED_BYTES);
    await expect(sealPhoto(blobKey, 'id', bytes(largest + 1), 'image/jpeg')).rejects.toBeInstanceOf(PhotoTooLargeError);
  });

  it('seals the same photo differently each time (random IV)', async () => {
    const { blobKey } = await keys();
    const a = await sealPhoto(blobKey, 'id', bytes(100), 'image/jpeg');
    const b = await sealPhoto(blobKey, 'id', bytes(100), 'image/jpeg');
    expect(a).not.toEqual(b);
  });

  it('rejects a photo whose hash is not the one asked for', async () => {
    const { blobKey } = await keys();
    const sealed = await sealPhoto(blobKey, 'id', bytes(100, 1), 'image/jpeg');
    const otherHash = await sha256Hex(bytes(100, 2));
    await expect(openPhoto(blobKey, 'id', sealed, otherHash)).rejects.toBeInstanceOf(PhotoCheckError);
  });

  it('rejects another id, another household, a changed byte and a short blob', async () => {
    const { blobKey } = await keys();
    const other = await keys();
    const photo = bytes(100);
    const hash = await sha256Hex(photo);
    const sealed = await sealPhoto(blobKey, 'id-1', photo, 'image/jpeg');
    await expect(openPhoto(blobKey, 'id-2', sealed, hash)).rejects.toBeInstanceOf(PhotoCheckError);
    await expect(openPhoto(other.blobKey, 'id-1', sealed, hash)).rejects.toBeInstanceOf(PhotoCheckError);
    const changed = sealed.slice();
    changed[40] ^= 1;
    await expect(openPhoto(blobKey, 'id-1', changed, hash)).rejects.toBeInstanceOf(PhotoCheckError);
    await expect(openPhoto(blobKey, 'id-1', sealed.subarray(0, 20), hash)).rejects.toBeInstanceOf(PhotoCheckError);
  });

  it('gives the same photo the same id in a household, and a different one elsewhere', async () => {
    const a = await keys();
    const b = await keys();
    const hash = await sha256Hex(bytes(100));
    expect(await blobId(a.blobIdKey, hash)).toBe(await blobId(a.blobIdKey, hash));
    expect(await blobId(a.blobIdKey, hash)).not.toBe(await blobId(b.blobIdKey, hash));
    expect(await blobId(a.blobIdKey, hash)).not.toContain(hash);
  });
});
