import { describe, expect, it } from 'vitest';
import { LIBRARY_CARD_FORMATS } from '../DataStore';
import { checkLibraryCardBarcode, cleanLibraryCardLabel, isLibraryCardFormat, sameLibraryCardValue } from '../libraryCardRules';

// Library card barcodes (src/data/libraryCardRules.ts): what each barcode type can hold.

const ok = (raw: string, format: string, value = raw.trim()) => expect(checkLibraryCardBarcode(raw, format)).toEqual({ ok: true, value });
const bad = (raw: string, format: string, problem: string) => expect(checkLibraryCardBarcode(raw, format)).toEqual({ ok: false, problem });

describe('checkLibraryCardBarcode', () => {
  it('knows the five types the scanner reads on library cards', () => {
    expect(LIBRARY_CARD_FORMATS).toEqual(['code_128', 'code_39', 'codabar', 'itf', 'ean_13']);
    expect(LIBRARY_CARD_FORMATS.every(isLibraryCardFormat)).toBe(true);
    expect(isLibraryCardFormat('qr_code')).toBe(false);
    bad('123', 'qr_code', 'unknown_format');
  });

  it('trims, and refuses empty or over 200 characters', () => {
    ok('  31000123  ', 'code_128');
    bad('   ', 'code_128', 'empty');
    ok('x'.repeat(200), 'code_128');
    bad('x'.repeat(201), 'code_128', 'too_long');
  });

  it('Code 128: printable ASCII', () => {
    ok('LIB-0042 a/b', 'code_128');
    bad('café', 'code_128', 'characters');
    bad('tab\there', 'code_128', 'characters');
  });

  it('Code 39: upper case, its own symbols, and drops the * start/stop marks', () => {
    ok('abc-12', 'code_39', 'ABC-12');
    ok('*12345*', 'code_39', '12345');
    ok('A $/+%.', 'code_39');
    bad('AB_C', 'code_39', 'characters');
  });

  it('Codabar: digits and - $ : / . +, start and stop letters both or neither', () => {
    ok('21234000123456', 'codabar');
    ok('a21234000123456b', 'codabar', 'A21234000123456B');
    ok('12-34:56/78.9+$', 'codabar');
    bad('A12345', 'codabar', 'characters');
    bad('12E45', 'codabar', 'characters');
  });

  it('ITF: digits in pairs', () => {
    ok('00012345678905', 'itf');
    bad('12345', 'itf', 'odd_length');
    bad('12AB', 'itf', 'characters');
  });

  it('EAN-13: 13 digits with a correct check digit, and not an ISBN', () => {
    ok('4006381333931', 'ean_13');
    ok('5901234123457', 'ean_13');
    bad('4006381333932', 'ean_13', 'check_digit');
    bad('400638133393', 'ean_13', 'check_digit');
    bad('9780000000002', 'ean_13', 'isbn');
    bad('9791234567896', 'ean_13', 'isbn');
    bad('40063813339X1', 'ean_13', 'characters');
  });
});

describe('sameLibraryCardValue', () => {
  it('ignores Codabar start and stop letters', () => {
    expect(sameLibraryCardValue('codabar', 'A21234000123456A', '21234000123456')).toBe(true);
    expect(sameLibraryCardValue('codabar', '21234000123456', 'b21234000123456d')).toBe(true);
    expect(sameLibraryCardValue('codabar', 'A1A', '2')).toBe(false);
  });

  it('Code 39 ignores case; the rest must match exactly', () => {
    expect(sameLibraryCardValue('code_39', 'abc', 'ABC')).toBe(true);
    expect(sameLibraryCardValue('code_128', 'abc', 'ABC')).toBe(false);
    expect(sameLibraryCardValue('itf', '0012', '0012')).toBe(true);
  });
});

describe('cleanLibraryCardLabel', () => {
  it('trims, turns empty into null and refuses over 100 characters', () => {
    expect(cleanLibraryCardLabel('  Pool ')).toBe('Pool');
    expect(cleanLibraryCardLabel('   ')).toBeNull();
    expect(cleanLibraryCardLabel(null)).toBeNull();
    expect(cleanLibraryCardLabel(undefined)).toBeNull();
    expect(cleanLibraryCardLabel('x'.repeat(100))).toBe('x'.repeat(100));
    expect(cleanLibraryCardLabel('x'.repeat(101))).toBe('too_long');
  });
});
