import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { blobId, deriveBlobKeys, deriveKeys, deriveOpIdKey, generateKey, opId, parseKey, seal } from '../vendor/crypto.js';
import { formatStamp } from '../vendor/sync-core.js';

/** Library Card's additions to the vendored crypto.js: blob keys, blob ids and deterministic op ids. */

const enc = new TextEncoder();
const IV = new Uint8Array(12).fill(7);
const PHOTO = 'a'.repeat(64);
const STAMP = formatStamp(Date.parse('2026-06-01T00:00:00.000Z'), 3, 'devA');

const encrypt = async (key: CryptoKey, text: string) =>
  Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: IV }, key, enc.encode(text))).toString('base64');

/** HKDF-SHA256 from the household key with our salt, computed here without the vendored code. */
async function hkdfBits(keyText: string, info: string, bits: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', parseKey(keyText) as BufferSource, 'HKDF', false, ['deriveBits']);
  const salt = enc.encode('library-card/sync/v1');
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, bits));
}

describe('deriveBlobKeys', () => {
  it('gives non-extractable AES-GCM-256 and HMAC-SHA256 keys', async () => {
    const { blobKey, blobIdKey } = await deriveBlobKeys(generateKey());
    expect([blobKey.extractable, blobIdKey.extractable]).toEqual([false, false]);
    expect(blobKey.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    expect(blobIdKey.algorithm).toMatchObject({ name: 'HMAC', hash: { name: 'SHA-256' }, length: 256 });
  });

  it('is stable: the same household key gives the same blob keys', async () => {
    const key = generateKey();
    const [a, b] = [await deriveBlobKeys(key), await deriveBlobKeys(key)];
    expect(await encrypt(a.blobKey, 'cover')).toBe(await encrypt(b.blobKey, 'cover'));
    expect(await blobId(a.blobIdKey, PHOTO)).toBe(await blobId(b.blobIdKey, PHOTO));
  });

  it('uses the info string "library-card/v1/blob-encryption"', async () => {
    const key = generateKey();
    const expected = await crypto.subtle.importKey('raw', (await hkdfBits(key, 'library-card/v1/blob-encryption', 256)) as BufferSource, 'AES-GCM', false, ['encrypt']);
    expect(await encrypt((await deriveBlobKeys(key)).blobKey, 'cover')).toBe(await encrypt(expected, 'cover'));
  });

  it('is distinct from the op key and from other households', async () => {
    const key = generateKey();
    const { blobKey } = await deriveBlobKeys(key);
    const { aesKey } = await deriveKeys(key);
    expect(await encrypt(blobKey, 'same text')).not.toBe(await encrypt(aesKey, 'same text'));
    // An op sealed with the op key can't be opened with the blob key.
    const env = await seal(aesKey, { id: 'op-1', rec: 'rec-1', f: 'name', v: 'x', t: STAMP, dev: 'devA' });
    const body = Buffer.from(env.c, 'base64');
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(0, 12) }, blobKey, body.subarray(12))).rejects.toThrow();
    const other = await deriveBlobKeys(generateKey());
    expect(await encrypt(blobKey, 'cover')).not.toBe(await encrypt(other.blobKey, 'cover'));
  });
});

describe('blobId', () => {
  it('is HMAC-SHA256 (info "library-card/v1/blob-id") of the photo hash bytes, as base64url', async () => {
    const key = generateKey();
    const raw = await hkdfBits(key, 'library-card/v1/blob-id', 256);
    const hmac = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = Buffer.from(await crypto.subtle.sign('HMAC', hmac, Buffer.from(PHOTO, 'hex'))).toString('base64url');
    const id = await blobId((await deriveBlobKeys(key)).blobIdKey, PHOTO);
    expect(id).toBe(expected);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is deterministic per household, and different for another photo or household', async () => {
    const key = generateKey();
    const { blobIdKey } = await deriveBlobKeys(key);
    const id = await blobId(blobIdKey, PHOTO);
    expect(await blobId(blobIdKey, PHOTO)).toBe(id);
    expect(await blobId(blobIdKey, 'b'.repeat(64))).not.toBe(id);
    expect(await blobId((await deriveBlobKeys(generateKey())).blobIdKey, PHOTO)).not.toBe(id);
  });

  it('does not reveal the photo hash', async () => {
    const hash = createHash('sha256').update('a cover photo').digest();
    const hex = hash.toString('hex');
    const id = await blobId((await deriveBlobKeys(generateKey())).blobIdKey, hex);
    for (const form of [hex, hash.toString('base64url'), hash.toString('base64'), hex.slice(0, 16)]) expect(id.includes(form)).toBe(false);
    // Nor a plain hash of the hash, which anyone could compute.
    expect(id).not.toBe(createHash('sha256').update(hash).digest('base64url'));
  });

  it('refuses anything but 64 lowercase hex characters', async () => {
    const { blobIdKey } = await deriveBlobKeys(generateKey());
    for (const bad of ['', 'A'.repeat(64), 'a'.repeat(63), `cover:${PHOTO}`, 42]) {
      await expect(blobId(blobIdKey, bad as string)).rejects.toThrow(/64 lowercase hex/);
    }
  });
});

describe('deriveOpIdKey and opId', () => {
  it('opIdKey is a non-extractable HMAC-SHA256 key', async () => {
    const key = await deriveOpIdKey(generateKey());
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'HMAC', hash: { name: 'SHA-256' }, length: 256 });
    expect(key.usages).toEqual(['sign']);
  });

  it('is the first 128 bits of HMAC-SHA256(opIdKey, "rec|f|t") with info "library-card/v1/op-id", base64url, 22 characters', async () => {
    const household = generateKey();
    const raw = await hkdfBits(household, 'library-card/v1/op-id', 256);
    const hmac = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', hmac, enc.encode(`rec-1|title|${STAMP}`));
    const expected = Buffer.from(mac).subarray(0, 16).toString('base64url');
    const id = await opId(await deriveOpIdKey(household), 'rec-1', 'title', STAMP);
    expect(id).toBe(expected);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('is stable for the same household key and inputs', async () => {
    const household = generateKey();
    const [a, b] = [await deriveOpIdKey(household), await deriveOpIdKey(household)];
    expect(await opId(a, 'rec-1', 'title', STAMP)).toBe(await opId(b, 'rec-1', 'title', STAMP));
    expect(await opId(a, 'rec-1', 'title', STAMP)).toBe(await opId(a, 'rec-1', 'title', STAMP));
  });

  it('is different for a different household key', async () => {
    const [mine, theirs] = [await deriveOpIdKey(generateKey()), await deriveOpIdKey(generateKey())];
    const id = await opId(mine, 'rec-1', 'title', STAMP);
    expect(await opId(theirs, 'rec-1', 'title', STAMP)).not.toBe(id);
    expect(await opId(theirs, 'rec-1', 'title', STAMP)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('is different when the record, field or stamp changes', async () => {
    const key = await deriveOpIdKey(generateKey());
    const id = await opId(key, 'rec-1', 'title', STAMP);
    const others = await Promise.all([
      opId(key, 'rec-2', 'title', STAMP),
      opId(key, 'rec-1', 'authors', STAMP),
      opId(key, 'rec-1', 'title', formatStamp(Date.parse('2026-06-01T00:00:00.000Z'), 4, 'devA')),
      opId(key, 'rec-1', 'title', formatStamp(Date.parse('2026-06-01T00:00:00.000Z'), 3, 'devB')),
    ]);
    expect(new Set([id, ...others]).size).toBe(5);
  });

  it('can’t be checked without the household key: not a plain hash of the inputs', async () => {
    const id = await opId(await deriveOpIdKey(generateKey()), '9780000000002', 'title', STAMP);
    for (const text of [`9780000000002|title|${STAMP}`, `library-card/v1/op-id|9780000000002|title|${STAMP}`]) {
      expect(id).not.toBe(createHash('sha256').update(text).digest().subarray(0, 16).toString('base64url'));
    }
  });

  it('can’t be made ambiguous: a "|" in the record id still gives its own id', async () => {
    // Field names and stamps can't contain "|", so "a|b" + "c" never collides with "a" + "b|c".
    const key = await deriveOpIdKey(generateKey());
    expect(await opId(key, 'a|b', 'c', STAMP)).not.toBe(await opId(key, 'a', 'b', STAMP));
    await expect(opId(key, 'a', 'b|c', STAMP)).rejects.toThrow();
  });

  it('refuses a bad record id, field name or stamp', async () => {
    const key = await deriveOpIdKey(generateKey());
    for (const [rec, f, t] of [
      ['', 'title', STAMP],
      ['r'.repeat(65), 'title', STAMP],
      ['rec', '1title', STAMP],
      ['rec', 'title', 'not-a-stamp'],
    ]) {
      await expect(opId(key, rec, f, t)).rejects.toThrow(/record id, a field name and a stamp/);
    }
  });
});
