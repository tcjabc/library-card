import { describe, expect, it } from 'vitest';
import { formatStamp } from '../../../sync/vendor/sync-core.js';
import {
  SCHEMA,
  SYNCED_TABLES,
  parentOf,
  parseWireId,
  recordToRow,
  rowToRecord,
  validate,
  wireId,
} from '../schema';

const T = formatStamp(Date.parse('2026-06-01T00:00:00Z'), 0, 'devA');
const UUID = '7c0e5a52-1b2f-4a8e-9a4b-0d6f2e3c4b5a';
const op = (rec: string, f: string, v: unknown, over: Record<string, unknown> = {}) => ({ id: 'op-1', rec, f, v, t: T, dev: 'devA', ...over });
const problem = (o: unknown) => {
  const r = validate(o);
  return r.ok ? 'ok' : r.problem;
};

describe('wire ids', () => {
  it('are "<table>:<local id>" for the nine synced tables', () => {
    expect(SYNCED_TABLES).toEqual(['households', 'readers', 'books', 'home_items', 'libraries', 'library_cards', 'loans', 'read_events', 'reader_journeys']);
    expect(parseWireId(`library_cards:${UUID}`)).toEqual({ table: 'library_cards', localId: UUID });
    expect(wireId('readers', UUID)).toBe(`readers:${UUID}`);
    expect(parseWireId(`readers:${UUID}`)).toEqual({ table: 'readers', localId: UUID });
    expect(parseWireId('books:9780000000002')).toEqual({ table: 'books', localId: '9780000000002' });
    expect(parseWireId('home_items:noisbn-abc_1')).toEqual({ table: 'home_items', localId: 'noisbn-abc_1' });
    expect(parseWireId('households:main')).toEqual({ table: 'households', localId: 'main' });
  });

  it('reject unknown tables and ids a table can\'t have', () => {
    for (const bad of ['read_summaries:x', 'meta:x', 'covers:x', 'readers', ':x', 'households:other', 'books:123', 'books:not-a-key', 'readers:has space', `readers:${'a'.repeat(41)}`, 42]) {
      expect(parseWireId(bad), String(bad)).toBeNull();
    }
  });
});

describe('validate(op)', () => {
  it('accepts well-formed ops on every table', () => {
    const ok = [
      op('households:main', 'name', 'The Readers'),
      op('households:main', 'parent_pin_hash', null),
      op(`readers:${UUID}`, 'display_name', 'A'),
      op(`readers:${UUID}`, 'active_journey_id', null),
      op('books:9780000000002', 'authors', ['X', 'Y']),
      op('books:9780000000002', 'cover_url', 'cover:abc'),
      op('home_items:9780000000002', 'isbn', '9780000000002'),
      op(`libraries:${UUID}`, 'default_loan_days', 21),
      op(`loans:${UUID}`, 'due_date', '2026-02-01'),
      op(`loans:${UUID}`, 'renew_count', 0),
      op(`read_events:${UUID}`, 'read_at', '2026-01-01T00:00:00.000Z'),
      op(`reader_journeys:${UUID}`, 'completed_at', null),
      op(`readers:${UUID}`, 'del', true),
    ];
    for (const o of ok) expect(problem(o), `${o.rec} ${o.f}`).toBe('ok');
  });

  it('rejects what sync-core rejects (shape, stamp, JSON, del not a boolean)', () => {
    expect(problem(null)).toBe('not_op');
    expect(problem({ ...op('households:main', 'name', 'x'), t: 'nope' })).toBe('not_op');
    expect(problem({ ...op('households:main', 'name', 'x'), dev: 'other' })).toBe('not_op');
    expect(problem(op('households:main', 'name', Number.NaN))).toBe('not_op');
    expect(problem(op(`readers:${UUID}`, 'del', 'yes'))).toBe('not_op');
  });

  it('rejects unknown tables and bad ids', () => {
    expect(problem(op('read_summaries:x', 'count', 1))).toBe('unknown_table');
    expect(problem(op('nocolon', 'name', 'x'))).toBe('unknown_table');
    expect(problem(op('households:other', 'name', 'x'))).toBe('bad_id');
    expect(problem(op('books:12', 'title', 'x'))).toBe('bad_id');
    expect(problem(op('readers:bad id!', 'display_name', 'x'))).toBe('bad_id');
  });

  it('rejects reserved field names: id, household_id and the table\'s key', () => {
    expect(problem(op(`readers:${UUID}`, 'id', 'x'))).toBe('reserved_field');
    expect(problem(op(`readers:${UUID}`, 'household_id', 'main'))).toBe('reserved_field');
    expect(problem(op('books:9780000000002', 'isbn', '9780000000002'))).toBe('reserved_field');
    expect(problem(op('home_items:9780000000002', 'isbn', '9780000000002'))).toBe('ok'); // a field there, not the key
  });

  it('rejects wrong types and out-of-range values for known fields', () => {
    const bad = [
      op('households:main', 'name', ''),
      op('households:main', 'name', 'x'.repeat(201)),
      op(`readers:${UUID}`, 'display_name', 3),
      op(`readers:${UUID}`, 'display_name', null),
      op(`readers:${UUID}`, 'active_journey_id', 'not an id!'),
      op('books:9780000000002', 'authors', 'X'),
      op('books:9780000000002', 'authors', [1]),
      op('books:9780000000002', 'authors', Array.from({ length: 51 }, () => 'a')),
      op('home_items:9780000000002', 'isbn', 'abc'),
      op(`libraries:${UUID}`, 'default_loan_days', 0),
      op(`libraries:${UUID}`, 'default_loan_days', 1.5),
      op(`loans:${UUID}`, 'due_date', '1 Feb'),
      op(`loans:${UUID}`, 'due_date', '2026-13-45'),
      op(`loans:${UUID}`, 'renew_count', -1),
      op(`loans:${UUID}`, 'borrowed_at', 'yesterday'),
      op(`read_events:${UUID}`, 'read_at', null),
      op(`reader_journeys:${UUID}`, 'journey_id', 'j'.repeat(65)),
      op(`readers:${UUID}`, 'kind', 'teacher'),
      op(`library_cards:${UUID}`, 'format', 'qr_code'),
      op(`library_cards:${UUID}`, 'value', 'x'.repeat(201)),
      op(`library_cards:${UUID}`, 'label', 'x'.repeat(101)),
      op(`library_cards:${UUID}`, 'created_at', 'today'),
    ];
    for (const o of bad) expect(problem(o), `${o.rec} ${o.f} ${JSON.stringify(o.v)?.slice(0, 20)}`).toBe('bad_value');
  });

  it('keeps unknown but well-formed fields (forward compatible), if they are small', () => {
    expect(problem(op(`readers:${UUID}`, 'favourite_colour', 'blue'))).toBe('ok');
    expect(problem(op(`readers:${UUID}`, 'settings', { a: [1, 2], b: null }))).toBe('ok');
    expect(problem(op(`readers:${UUID}`, 'big', 'x'.repeat(9000)))).toBe('too_large');
    expect(problem(op(`readers:${UUID}`, '1bad', 'x'))).toBe('not_op'); // sync-core's field name rule
  });
});

describe('rows and records', () => {
  const reader = { id: UUID, household_id: 'main', display_name: 'A', avatar: '🦊', card_token: 'tok-1', active_journey_id: null };

  it('rowToRecord drops the key and household_id, and skips other households', () => {
    expect(rowToRecord('readers', reader)).toEqual({
      rec: `readers:${UUID}`,
      fields: { display_name: 'A', avatar: '🦊', card_token: 'tok-1', active_journey_id: null },
    });
    expect(rowToRecord('books', { isbn: '9780000000002', title: 'T', authors: [], cover_url: null, source: 'manual' })?.fields).toEqual({
      title: 'T',
      authors: [],
      cover_url: null,
      source: 'manual',
    });
    expect(rowToRecord('readers', { ...reader, household_id: 'hx' })).toBeNull();
    expect(rowToRecord('households', { id: 'hx', name: 'X', parent_pin_hash: null })).toBeNull();
  });

  it('recordToRow needs a live record with every required field, and fills optional ones with null', () => {
    const fields = { display_name: 'A', avatar: '🦊', card_token: 'tok-1', del: false };
    // A record from before reader kinds: kind null (the store reads it as a child).
    expect(recordToRow('readers', UUID, fields)).toEqual({ ...reader, kind: null, needs_check: null });
    expect(recordToRow('readers', UUID, { ...fields, kind: 'grown_up' })).toEqual({ ...reader, kind: 'grown_up', needs_check: null });
    expect(recordToRow('readers', UUID, { ...fields, del: true })).toBeNull();
    expect(recordToRow('readers', UUID, { display_name: 'A', avatar: '🦊', card_token: 't' })).toBeNull(); // never created
    expect(recordToRow('readers', UUID, { ...fields, card_token: undefined })).toBeNull();
    expect(recordToRow('readers', UUID, { ...fields, favourite: 'x' })).toEqual({ ...reader, kind: null, needs_check: null }); // unknown fields ignored
  });

  it('every table lists its required fields', () => {
    const required = Object.fromEntries(
      SYNCED_TABLES.map((t) => [t, Object.entries(SCHEMA[t].fields).filter(([, f]) => f.required).map(([n]) => n)]),
    );
    expect(required).toEqual({
      households: ['name'],
      readers: ['display_name', 'avatar', 'card_token'],
      books: ['title', 'authors', 'source'],
      home_items: ['isbn', 'added_at'],
      libraries: ['name', 'default_loan_days'],
      library_cards: ['reader_id', 'value', 'format', 'created_at'],
      loans: ['reader_id', 'isbn', 'borrowed_at', 'renew_count'],
      read_events: ['reader_id', 'isbn', 'read_at'],
      reader_journeys: ['reader_id', 'journey_id', 'started_at'],
    });
  });

  it('a home book is only shown under its own book key', () => {
    const f = { isbn: '9780000000002', added_at: '2026-01-01T00:00:00.000Z', del: false };
    expect(recordToRow('home_items', '9780000000002', f)).toEqual({ id: '9780000000002', household_id: 'main', ...{ isbn: f.isbn, added_at: f.added_at } });
    expect(recordToRow('home_items', '9780000000019', f)).toBeNull();
  });

  it('children name their parent reader', () => {
    expect(parentOf('read_events', { reader_id: UUID })).toBe(`readers:${UUID}`);
    expect(parentOf('loans', { reader_id: UUID })).toBe(`readers:${UUID}`);
    expect(parentOf('reader_journeys', { reader_id: UUID })).toBe(`readers:${UUID}`);
    expect(parentOf('books', {})).toBeUndefined();
  });
});
