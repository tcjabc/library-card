# Vendored files

Sync for Library Card reuses parts of **Peek Budget** (MIT,
[LICENSES/peek-budget-MIT.txt](LICENSES/peek-budget-MIT.txt)):

- Source repository: `tcjabc/substracker`
- Commit: `f0385ee` (`f0385ee3d5d6b26c56e7ef594e50b5008d250b5d`)
- Files were read with `git show f0385ee:<path>`, so no checkout or line-ending
  conversion could change them. Peek Budget's repository was only read, never changed.

`.gitattributes` marks these files `-text`, so git never converts their line
endings. `src/sync/__tests__/vendored-hashes.test.ts` reads the table below and
fails if any file's SHA-256 differs from "Our SHA-256" (for verbatim files, that
is also the upstream hash). If you change a file on purpose, update its row.

## Files

| Our path | Upstream path | Upstream SHA-256 | Our SHA-256 | Status | Changes |
| --- | --- | --- | --- | --- | --- |
| `src/sync/vendor/sync-core.js` | `js/sync-core.js` | `d5074d2410242929a78823cc5083ab42af91863b5820ae26b96e4fbeb3e55d61` | `d5074d2410242929a78823cc5083ab42af91863b5820ae26b96e4fbeb3e55d61` | verbatim | None. |
| `src/sync/vendor/words.js` | `js/words.js` | `156e3d53d36d0143a02e1985fc4bb8fc2f259649cf54ef9856d11106c71f52f7` | `156e3d53d36d0143a02e1985fc4bb8fc2f259649cf54ef9856d11106c71f52f7` | verbatim | None. |
| `src/sync/vendor/wordlist.js` | `js/wordlist.js` | `fffe7e7095b0a4a6c8a14d02e589d5c1981127b4ecbe7e578c4d82d1db7f80b6` | `fffe7e7095b0a4a6c8a14d02e589d5c1981127b4ecbe7e578c4d82d1db7f80b6` | verbatim | None. The BIP-39 English list (licences: [LICENSES/bip39-wordlist-MIT.txt](LICENSES/bip39-wordlist-MIT.txt), [LICENSES/bip39-npm-ISC.txt](LICENSES/bip39-npm-ISC.txt)). |
| `src/sync/vendor/crypto.js` | `js/crypto.js` | `e7b2bd8cfeab443cbe2b71cec3cde231bc1724e93d176e7abf23ca4bfa6c8089` | `4a044ed5e37d598dd4487312d4751f586e34edd8d115fd2583c50fc7c36b7364` | changed | Domain strings only: HKDF salt `library-card/sync/v1`; info `library-card/v1/room-id`, `library-card/v1/relay-token`, `library-card/v1/op-encryption`; op AAD `library-card/v1/op\|<id>\|<wall>`. Added a three-line note at the top, one import line (`isFieldName`, `isRecordId`, `isStamp` from `./sync-core.js`) and, at the end, a marked additions section: `deriveBlobKeys` (info `library-card/v1/blob-encryption` and `library-card/v1/blob-id`), `blobId`, `deriveOpIdKey` (info `library-card/v1/op-id`) and `opId`, the first 128 bits of HMAC-SHA256(opIdKey, `rec\|f\|t`) as base64url (22 characters; keyed, because the relay sees op ids). Everything else is identical. |
| `src/sync/vendor/i18n.js` | `js/i18n.js` (replaced) | `bb94e0037b0ad9fdb9203e1ff82b9bfc6aec4752025c41a9369ccd8beeb5f798` | `d0ae5d9b4e001f7a09045b1d936865ae3ea210b12f7b6b6b3b541f4169224aed` | ours | Not vendored: a small shim with the same `t(key, params)` that maps the seven Peek message keys used by `words.js` and `crypto.js` to `strings.sync` in `src/strings/en.ts` (texts kept word for word). |
| `src/sync/__tests__/ported/sync-core.node.test.js` | `tests/sync-core.node.test.js` | `fe86021dc8acc6554ae1ad957d0eaac27307c0fcf2e57da0a8604c5f9d6ef500` | `1010a6fd3b91e69a04831ea6d2cec9f46d2d4b5f53e279c9df076fba8a614cee` | changed | Import paths only: `node:test` → `vitest`, `../js/` → `../../vendor/`. 16 tests. |
| `src/sync/__tests__/ported/words.node.test.js` | `tests/words.node.test.js` | `8d44adf4a075e6c9e30605fa3804819fed106d00a41e2cfa154f6367d926ddd1` | `da1499bf7abacec0e5672027ec897100a780a9984787494483a1445120c2f8f1` | changed | Import paths only, as above. 10 tests. |
| `src/sync/__tests__/ported/crypto.node.test.js` | `tests/crypto.node.test.js` | `6c0912f0e954bd2b2313d08a01df023e8959213aa2c1e35938592e7190e854f6` | `d3a3dbcee701fa75981e59b87144c05d78702a3d71b82a46627139bb74aeea15` | changed | Import paths as above, and the forged envelope's AAD prefix `peek-budget/v1/op\|` → `library-card/v1/op\|`. 9 tests. |

Hand-written type declarations (`*.d.ts`) sit beside each `.js` in
`src/sync/vendor/`; they are ours and not tracked here. ESLint skips
`src/sync/vendor/` and `src/sync/__tests__/ported/`, so they stay as upstream
wrote them.

## Intentionally not vendored

- **jsQR** (`js/jsqr.js`): QR scanning already uses `barcode-detector` / ZXing.
- **qrcode-generator** (`js/qrcode.js`): QR codes are already drawn with the
  `qrcode` npm package.

## Planned for later slices

These Peek Budget files are expected in later sync phases. Each will get a row
above when it is copied:

- `js/sync.js`: the sync engine (outbox, pull/push, applying remote ops).
- `js/secure-key.js`: keeping the household key on the device.
- `js/pairing.js`: pairing a second device.
- `js/qr-scan.js`: scanning a pairing code (to be adapted to our scanner).
- `relay/*`: the relay worker (`relay/src/index.js`, `relay/src/room.js`,
  `relay/src/room-logic.js`, `relay/wrangler.toml` and its tests).
