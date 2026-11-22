import { describe, expect, it } from 'vitest';
import { COVER_TARGET_BYTES, MAX_COVER_BYTES } from '../../data/DataStore';
import { MAX_SEALED_BYTES, sealedSize } from '../../sync/photos';
import { fitToBytes } from '../image';

// The cover photo resizer's size rule (src/lib/image.ts). Decoding and canvas need a browser,
// so the encoder is faked: its size grows with the edge and the quality, like JPEG's.

const KB = 1024;

/** A fake JPEG encoder: `bytesAt(edge, quality)`, recording every try. */
function fakeEncoder(bytesAt: (edge: number, quality: number) => number) {
  const tries: [number, number][] = [];
  const encode = async (edge: number, quality: number) => {
    tries.push([edge, quality]);
    return new Blob([new Uint8Array(Math.round(bytesAt(edge, quality)))], { type: 'image/jpeg' });
  };
  return { encode, tries };
}

/** Roughly how a busy photo behaves: bytes ∝ pixels × quality. */
const busyPhoto = (edge: number, quality: number) => edge * edge * 1.5 * quality;

describe('fitToBytes', () => {
  it('keeps the first try when it already fits', async () => {
    const { encode, tries } = fakeEncoder(() => 90 * KB);
    expect((await fitToBytes(encode, 800, 0.8, COVER_TARGET_BYTES)).size).toBe(90 * KB);
    expect(tries).toEqual([[800, 0.8]]);
  });

  it('lowers the quality first', async () => {
    const { encode, tries } = fakeEncoder(busyPhoto); // 800 px: 750 KB at 0.8, 469 KB at 0.5
    const blob = await fitToBytes(encode, 800, 0.8, COVER_TARGET_BYTES);
    expect(blob.size).toBeLessThanOrEqual(COVER_TARGET_BYTES);
    expect(tries).toEqual([[800, 0.8], [800, 0.7], [800, 0.6], [800, 0.5]]);
  });

  it('then the size, when even the lowest quality is too large', async () => {
    const { encode, tries } = fakeEncoder((edge, q) => busyPhoto(edge, q) * 2); // fits at 640 px, 0.4
    const blob = await fitToBytes(encode, 800, 0.8, COVER_TARGET_BYTES);
    expect(blob.size).toBeLessThanOrEqual(COVER_TARGET_BYTES);
    expect(tries.slice(0, 6)).toEqual([[800, 0.8], [800, 0.7], [800, 0.6], [800, 0.5], [800, 0.4], [640, 0.8]]);
    expect(tries.at(-1)).toEqual([640, 0.4]);
  });

  it('never returns a photo over the limit, whatever the photo', async () => {
    for (const scale of [0.25, 0.5, 1, 2, 3, 4]) {
      const { encode } = fakeEncoder((edge, q) => busyPhoto(edge, q) * scale);
      const blob = await fitToBytes(encode, 800, 0.8, COVER_TARGET_BYTES);
      expect(blob.size).toBeLessThanOrEqual(COVER_TARGET_BYTES);
    }
  });

  it('gives up rather than return one that is too large', async () => {
    const { encode, tries } = fakeEncoder(() => 600 * KB);
    await expect(fitToBytes(encode, 800, 0.8, COVER_TARGET_BYTES)).rejects.toThrow(/small enough/);
    expect(tries).toHaveLength(30);
  });

  it('a photo that would have passed the old 512 KB cap is re-encoded now', async () => {
    const { encode, tries } = fakeEncoder((edge, q) => (edge === 800 && q === 0.8 ? 500 * KB : 300 * KB));
    expect((await fitToBytes(encode, 800, 0.8, COVER_TARGET_BYTES)).size).toBe(300 * KB);
    expect(tries).toHaveLength(2);
  });
});

describe('the cover size cap and the relay', () => {
  it('every new cover fits the relay once sealed and padded', () => {
    expect(COVER_TARGET_BYTES).toBeLessThan(MAX_COVER_BYTES);
    // The largest type the resizer writes is image/jpeg; allow for a longer one too.
    for (const type of ['image/jpeg', 'image/webp', 'x'.repeat(100)]) {
      expect(sealedSize(COVER_TARGET_BYTES, type.length)).toBeLessThanOrEqual(MAX_SEALED_BYTES);
    }
  });

  it('the old cap did not always fit (why the cap is lower)', () => {
    expect(sealedSize(MAX_COVER_BYTES, 'image/jpeg'.length)).toBeGreaterThan(MAX_SEALED_BYTES);
  });
});
