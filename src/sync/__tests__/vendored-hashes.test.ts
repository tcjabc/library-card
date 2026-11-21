import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every file in VENDORED.md's table must still have the SHA-256 recorded there.
 * Verbatim files must also equal the upstream hash, so editing one by accident
 * (or letting git convert its line endings) fails here.
 */

const root = new URL('../../../', import.meta.url);
const sha256 = (path: string) => createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');

interface Row {
  ours: string;
  upstream: string;
  upstreamSha: string;
  ourSha: string;
  status: string;
}

/** The rows of the "Files" table. Cells may contain escaped pipes (\|). */
function readTable(): Row[] {
  const text = readFileSync(new URL('VENDORED.md', root), 'utf8');
  const section = text.split('## Files')[1].split('\n## ')[0];
  return section
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replace(/^`|`$/g, ''));
      const [ours, upstream, upstreamSha, ourSha, status] = cells;
      return { ours, upstream, upstreamSha, ourSha, status };
    });
}

const rows = readTable();

describe('VENDORED.md', () => {
  it('lists the vendored files', () => {
    expect(rows.map((r) => r.ours)).toEqual(
      expect.arrayContaining([
        'src/sync/vendor/sync-core.js',
        'src/sync/vendor/words.js',
        'src/sync/vendor/wordlist.js',
        'src/sync/vendor/crypto.js',
        'src/sync/vendor/i18n.js',
      ]),
    );
    for (const row of rows) {
      expect(row.ourSha, row.ours).toMatch(/^[0-9a-f]{64}$/);
      expect(row.upstreamSha, row.ours).toMatch(/^[0-9a-f]{64}$/);
      expect(['verbatim', 'changed', 'ours'], row.ours).toContain(row.status);
    }
  });

  for (const row of rows) {
    it(`${row.ours} has the SHA-256 recorded (${row.status})`, () => {
      expect(existsSync(new URL(row.ours, root)), `${row.ours} exists`).toBe(true);
      const actual = sha256(row.ours);
      expect(actual, `${row.ours} changed: update VENDORED.md if that was on purpose`).toBe(row.ourSha);
      if (row.status === 'verbatim') expect(actual, `${row.ours} must be byte-for-byte upstream`).toBe(row.upstreamSha);
      else expect(actual).not.toBe(row.upstreamSha);
    });
  }

  it('every vendored .js has a hand-written .d.ts beside it', () => {
    for (const row of rows.filter((r) => r.ours.startsWith('src/sync/vendor/'))) {
      expect(existsSync(new URL(row.ours.replace(/\.js$/, '.d.ts'), root)), row.ours).toBe(true);
    }
  });
});
