import { describe, expect, it } from 'vitest';
import { deriveKeys, parseKey } from '../vendor/crypto.js';
import { parseRecovery } from '../vendor/words.js';

/**
 * The vendored crypto uses Library Card's own domain strings, so the same 12
 * recovery words give a different room (and token, and keys) here than in Peek
 * Budget: one household's words can never open the other app's data. Peek's
 * value is computed here from its published constants, without importing Peek.
 */

const WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow'; // 16 bytes of 0x7f
const enc = new TextEncoder();

async function roomId(keyText: string, salt: string, info: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', parseKey(keyText) as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode(info) }, base, 128);
  return Buffer.from(bits).toString('hex');
}

describe('domain separation from Peek Budget', () => {
  it('the same 12 words derive a different room id than Peek Budget would', async () => {
    const key = await parseRecovery(WORDS);
    expect(key).toBe('f39_f39_f39_f39_f39_fw');
    const ours = (await deriveKeys(key)).roomId;
    const peek = await roomId(key, 'peek-budget/sync/v1', 'peek-budget/v1/room-id');
    expect(ours).not.toBe(peek);
    // Known answers, so a changed domain string can't slip through unnoticed.
    expect(peek).toBe('b994cf5d188b9582ee3f946132c675d8');
    expect(ours).toBe('f6efa33c2c46933f751458df87677c2f');
    expect(ours).toBe(await roomId(key, 'library-card/sync/v1', 'library-card/v1/room-id'));
  });

  it('the relay token differs from what Peek Budget would derive too', async () => {
    const key = await parseRecovery(WORDS);
    const base = await crypto.subtle.importKey('raw', parseKey(key) as BufferSource, 'HKDF', false, ['deriveBits']);
    const peekToken = Buffer.from(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('peek-budget/sync/v1'), info: enc.encode('peek-budget/v1/relay-token') },
        base,
        256,
      ),
    ).toString('base64url');
    expect((await deriveKeys(key)).token).not.toBe(peekToken);
  });
});
