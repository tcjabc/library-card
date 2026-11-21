import { describe, expect, it } from 'vitest';
import { isValidIsbn10, isValidIsbn13, isbn10To13, isbn13To10, normaliseIsbn } from '../isbn';

describe('normaliseIsbn', () => {
  it('keeps a valid ISBN-13', () => {
    expect(normaliseIsbn('9780439708180')).toBe('9780439708180');
  });

  it('accepts 979 ISBN-13s', () => {
    expect(normaliseIsbn('9791032305690')).toBe('9791032305690');
  });

  it('strips hyphens, spaces, Unicode dashes and an ISBN: prefix', () => {
    expect(normaliseIsbn('978-0-439-70818-0')).toBe('9780439708180');
    expect(normaliseIsbn(' 978 0439 708180 ')).toBe('9780439708180');
    expect(normaliseIsbn('978‐0‐439‐70818‐0')).toBe('9780439708180');
    expect(normaliseIsbn('ISBN-13: 978-0-439-70818-0')).toBe('9780439708180');
    expect(normaliseIsbn('isbn 0-06-440055-7')).toBe('9780064400558');
  });

  it('converts a valid ISBN-10 to ISBN-13, including an X check digit', () => {
    expect(normaliseIsbn('0-06-440055-7')).toBe('9780064400558');
    expect(normaliseIsbn('080442957X')).toBe('9780804429573');
    expect(normaliseIsbn('080442957x')).toBe('9780804429573');
  });

  it('rejects bad check digits, non-book EAN-13s and wrong lengths', () => {
    expect(normaliseIsbn('9780439708181')).toBeNull();
    expect(normaliseIsbn('0064400558')).toBeNull();
    expect(normaliseIsbn('5901234123457')).toBeNull(); // a valid EAN-13, but not a book
    expect(normaliseIsbn('978043970818')).toBeNull();
    expect(normaliseIsbn('')).toBeNull();
    expect(normaliseIsbn('not an isbn')).toBeNull();
  });
});

describe('ISBN helpers', () => {
  it('validates ISBN-10 and ISBN-13 check digits', () => {
    expect(isValidIsbn10('0064400557')).toBe(true);
    expect(isValidIsbn10('0064400558')).toBe(false);
    expect(isValidIsbn10('X064400557')).toBe(false); // X only as the last digit
    expect(isValidIsbn13('9780064400558')).toBe(true);
    expect(isValidIsbn13('9770064400558')).toBe(false); // not 978/979
  });

  it('converts between ISBN-10 and ISBN-13', () => {
    expect(isbn10To13('0064400557')).toBe('9780064400558');
    expect(isbn13To10('9780064400558')).toBe('0064400557');
    expect(isbn13To10('9780804429573')).toBe('080442957X');
    expect(isbn13To10('9791032305690')).toBeNull(); // 979 has no ISBN-10
  });
});
