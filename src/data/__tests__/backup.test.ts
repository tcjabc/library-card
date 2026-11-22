import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  backupFileName,
  base64ToBytes,
  bytesToBase64,
  parseBackupText,
  sniffImageType,
  summariseBackup,
  validateBackup,
  type Backup,
} from '../backup';

const HASH = 'a'.repeat(64);

/** A small valid backup, as JSON would bring it back. */
function sample(): Backup {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    schema: 4,
    exported_at: '2026-11-22T10:00:00.000Z',
    tables: {
      households: [{ id: 'main', name: 'Home', parent_pin_hash: null, time_zone: null }],
      readers: [
        { id: 'r1', household_id: 'main', display_name: 'A', avatar: '🦊', card_token: 'tok-1', active_journey_id: 'j1' },
        { id: 'r2', household_id: 'main', display_name: 'B', avatar: '🐢', card_token: 'tok-2', active_journey_id: null },
      ],
      books: [
        { isbn: '9780000000002', title: 'Photo', authors: [], cover_url: `cover:${HASH}`, source: 'manual' },
        { isbn: '9780000000019', title: 'Online', authors: ['X'], cover_url: 'https://example.org/c.jpg', source: 'google' },
        { isbn: 'noisbn-1', title: 'None', authors: [], cover_url: null, source: 'manual' },
      ],
      home_items: [{ id: '9780000000002', household_id: 'main', isbn: '9780000000002', added_at: '2026-01-01T00:00:00.000Z' }],
      libraries: [
        {
          id: 'l1',
          household_id: 'main',
          name: 'Branch',
          search_url_template: null,
          homepage_url: null,
          default_loan_days: 21,
          sticker_prefix: null,
        },
      ],
      library_cards: [
        {
          id: 'c1',
          household_id: 'main',
          reader_id: 'r2',
          library_id: 'l1',
          library_name: 'Branch',
          value: '21234000123456',
          format: 'codabar',
          label: null,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      loans: [
        {
          id: 'n1',
          household_id: 'main',
          reader_id: 'r1',
          isbn: '9780000000019',
          library_id: 'l1',
          library_name: null,
          sticker_barcode: null,
          borrowed_at: '2026-01-01T00:00:00.000Z',
          due_date: '2026-01-22',
          returned_at: null,
          renew_count: 0,
        },
      ],
      read_events: [
        { id: 'e1', household_id: 'main', reader_id: 'r1', isbn: '9780000000002', read_at: '2026-01-02T00:00:00.000Z' },
        { id: 'e2', household_id: 'main', reader_id: 'r1', isbn: '9780000000002', read_at: '2026-01-03T00:00:00.000Z' },
        { id: 'e3', household_id: 'main', reader_id: 'r2', isbn: 'noisbn-1', read_at: '2026-01-04T00:00:00.000Z' },
      ],
      reader_journeys: [
        { id: 'j1', reader_id: 'r1', journey_id: 'ocean_deep', started_at: '2026-01-01T00:00:00.000Z', completed_at: null, abandoned_at: null },
      ],
    },
    covers: { [`cover:${HASH}`]: bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])) },
  };
}

/** A deep copy with one change, for the failure cases. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests poke at untyped JSON on purpose
function broken(edit: (data: Record<string, any>) => void): unknown {
  const data = JSON.parse(JSON.stringify(sample()));
  edit(data);
  return data;
}

describe('validateBackup', () => {
  it('accepts a good backup and returns it', () => {
    const result = validateBackup(JSON.parse(JSON.stringify(sample())));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backup).toEqual(sample());
  });

  it('fills in missing nullable fields as null (older files)', () => {
    const result = validateBackup(broken((d) => delete d.tables.reader_journeys[0].abandoned_at));
    expect(result.ok && result.backup.tables.reader_journeys[0].abandoned_at).toBeNull();
  });

  it('accepts a backup from before library cards: they restore empty', () => {
    const result = validateBackup(broken((d) => delete d.tables.library_cards));
    expect(result.ok && result.backup.tables.library_cards).toEqual([]);
  });

  it('accepts a library card whose library is not in the file (it shows the saved name)', () => {
    expect(validateBackup(broken((d) => (d.tables.library_cards[0].library_id = 'gone'))).ok).toBe(true);
  });

  it('accepts a backup from before households had a time zone', () => {
    const result = validateBackup(broken((d) => delete d.tables.households[0].time_zone));
    expect(result.ok && result.backup.tables.households[0].time_zone).toBeNull();
  });

  it.each([
    ['not an object', [] as unknown, 'wrong_format'],
    ['another app', { format: 'something-else' }, 'wrong_format'],
    ['no version', broken((d) => delete d.version), 'wrong_format'],
    ['a newer format version', broken((d) => (d.version = 2)), 'newer_version'],
    ['a bad export date', broken((d) => (d.exported_at = 'yesterday')), 'wrong_format'],
    ['a missing table', broken((d) => delete d.tables.loans), 'missing_table'],
    ['no tables at all', broken((d) => delete d.tables), 'missing_table'],
    ['a row that is not an object', broken((d) => d.tables.readers.push('x')), 'bad_row'],
    ['a missing required field', broken((d) => delete d.tables.readers[0].card_token), 'bad_row'],
    ['an empty id', broken((d) => (d.tables.books[0].isbn = '')), 'bad_row'],
    ['a wrong type', broken((d) => (d.tables.libraries[0].default_loan_days = '21')), 'bad_row'],
    ['authors not a list of text', broken((d) => (d.tables.books[1].authors = [1])), 'bad_row'],
    ['a duplicate key', broken((d) => d.tables.read_events.push({ ...d.tables.read_events[0] })), 'duplicate'],
    ['a duplicate card token', broken((d) => (d.tables.readers[1].card_token = 'tok-1')), 'duplicate'],
    ['no "main" household', broken((d) => (d.tables.households[0].id = 'other')), 'no_household'],
    ['a read by an unknown reader', broken((d) => (d.tables.read_events[0].reader_id = 'ghost')), 'bad_reference'],
    ['a loan of an unknown reader', broken((d) => (d.tables.loans[0].reader_id = 'ghost')), 'bad_reference'],
    ['a library card of an unknown reader', broken((d) => (d.tables.library_cards[0].reader_id = 'ghost')), 'bad_reference'],
    ['library cards that are not a list', broken((d) => (d.tables.library_cards = {})), 'missing_table'],
    ['a library card number that does not fit its type', broken((d) => (d.tables.library_cards[0].format = 'ean_13')), 'bad_row'],
    ['a library card in an unknown type', broken((d) => (d.tables.library_cards[0].format = 'qr_code')), 'bad_row'],
    ['a library card number not tidied', broken((d) => (d.tables.library_cards[0].value = ' 21234000123456')), 'bad_row'],
    ['covers missing', broken((d) => delete d.covers), 'bad_cover'],
    ['a badly named cover', broken((d) => (d.covers['cover:xyz'] = 'AAAA')), 'bad_cover'],
    ['a cover that is not base64', broken((d) => (d.covers[`cover:${HASH}`] = '***')), 'bad_cover'],
    ['a book whose photo is missing', broken((d) => (d.covers = {})), 'missing_cover'],
    ['a blob: URL saved by mistake', broken((d) => (d.tables.books[2].cover_url = 'blob:http://x/1')), 'bad_row'],
  ])('rejects %s', (_label, data, problem) => {
    const result = validateBackup(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe(problem);
  });

  it('rejects a backup from a newer database schema when told the limit', () => {
    const data = broken((d) => (d.schema = 5));
    expect(validateBackup(data).ok).toBe(true);
    const result = validateBackup(data, { maxSchema: 4 });
    expect(!result.ok && result.problem).toBe('newer_version');
  });

  it('says where a bad row is', () => {
    const result = validateBackup(broken((d) => delete d.tables.loans[0].borrowed_at));
    expect(!result.ok && result.detail).toBe('loans[0].borrowed_at');
  });
});

describe('parseBackupText', () => {
  it('reports text that is not JSON', () => {
    expect(parseBackupText('{ nope')).toEqual({ ok: false, problem: 'not_json' });
    expect(parseBackupText('')).toEqual({ ok: false, problem: 'not_json' });
  });

  it('parses and validates', () => {
    expect(parseBackupText(JSON.stringify(sample())).ok).toBe(true);
    expect(parseBackupText('{"format":"library-card-backup"}').ok).toBe(false);
  });
});

describe('summariseBackup', () => {
  it('counts readers, books, home books, loans, reads and covers', () => {
    expect(summariseBackup(sample())).toEqual({ readers: 2, books: 3, homeBooks: 1, loans: 1, reads: 3, covers: 1 });
  });
});

describe('backup helpers', () => {
  it('backupFileName uses the date', () => {
    expect(backupFileName('2026-11-22')).toBe('library-card-backup-2026-11-22.json');
  });

  it('base64 round-trips bytes, including large ones', () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('/9j/');
  });

  it('base64ToBytes refuses text that is not base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow();
  });

  it('sniffImageType knows the usual photo formats', () => {
    const bytes = (...b: number[]) => new Uint8Array(b);
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe('image/png');
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38))).toBe('image/gif');
    expect(sniffImageType(bytes(1, 2, 3))).toBe('application/octet-stream');
  });

  it('lists every synced table and not read_summaries', () => {
    expect(BACKUP_TABLES).not.toContain('read_summaries');
    expect([...BACKUP_TABLES].sort()).toEqual(Object.keys(sample().tables).sort());
  });
});
