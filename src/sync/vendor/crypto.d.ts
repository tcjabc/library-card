// Types for crypto.js (vendored from Peek Budget and changed; see VENDORED.md). Hand-written.

import type { Op } from './sync-core.js';

/** What deriveKeys() returns: the relay's room id (32 hex) and token (43 base64url), and the op key. */
export interface DerivedKeys {
  roomId: string;
  token: string;
  /** Non-extractable AES-GCM-256. */
  aesKey: CryptoKey;
}

/** A sealed op: its id, the wall part of its stamp, and base64(iv + ciphertext). */
export interface Envelope {
  id: string;
  wall: number;
  c: string;
}

/** Cover photo keys (addition): AES-GCM-256 to encrypt, HMAC-SHA256 to name. Both non-extractable. */
export interface BlobKeys {
  blobKey: CryptoKey;
  blobIdKey: CryptoKey;
}

/** A new household key: 16 random bytes as base64url (22 characters). */
export declare function generateKey(): string;
/** The 16 key bytes from the text form. Throws a plain message (without the key) otherwise. */
export declare function parseKey(text: unknown): Uint8Array;
export declare function deriveKeys(keyText: string): Promise<DerivedKeys>;

export declare class EnvelopeError extends Error {}
export declare function seal(aesKey: CryptoKey, op: Op): Promise<Envelope>;
export declare function open(aesKey: CryptoKey, envelope: unknown): Promise<Op>;

/** Addition: the cover photo keys for a household key. */
export declare function deriveBlobKeys(keyText: string): Promise<BlobKeys>;
/** Addition: HMAC-SHA256 of the photo's SHA-256 (64 lowercase hex), base64url, 43 characters. */
export declare function blobId(blobIdKey: CryptoKey, imageSha256Hex: string): Promise<string>;
/** Addition: the op-naming key for a household key (HKDF info "library-card/v1/op-id"). Non-extractable HMAC-SHA256. */
export declare function deriveOpIdKey(keyText: string): Promise<CryptoKey>;
/** Addition: the first 128 bits of HMAC-SHA256(opIdKey, "rec|f|t"), base64url, 22 characters. */
export declare function opId(opIdKey: CryptoKey, rec: string, f: string, t: string): Promise<string>;
