import { describe, expect, it } from 'vitest';
import { asWebUrl, fillSearchTemplate, searchTemplateFromUrl } from '../searchTemplate';

describe('searchTemplateFromUrl', () => {
  it('finds an ISBN-13 in a query string', () => {
    expect(searchTemplateFromUrl('https://catalogue.example.org/search?q=9780439708180&type=isbn')).toEqual({
      template: 'https://catalogue.example.org/search?q={isbn}&type=isbn',
      form: 'isbn13',
      found: '9780439708180',
    });
  });

  it('finds a hyphenated ISBN-13 in a path', () => {
    expect(searchTemplateFromUrl('https://library.example/isbn/978-0-439-70818-0/details')?.template).toBe(
      'https://library.example/isbn/{isbn}/details',
    );
  });

  it('finds an ISBN-10, with or without hyphens, including an X check digit', () => {
    expect(searchTemplateFromUrl('https://lib.example/find?isbn=0064400557')).toMatchObject({
      template: 'https://lib.example/find?isbn={isbn10}',
      form: 'isbn10',
    });
    expect(searchTemplateFromUrl('https://lib.example/find?isbn=0-06-440055-7')?.template).toBe('https://lib.example/find?isbn={isbn10}');
    expect(searchTemplateFromUrl('https://lib.example/find?isbn=080442957X')?.form).toBe('isbn10');
  });

  it('copes with encoded separators', () => {
    expect(searchTemplateFromUrl('https://lib.example/s?q=978%2D0%2D439%2D70818%2D0')?.template).toBe('https://lib.example/s?q={isbn}');
    expect(searchTemplateFromUrl('https://lib.example/s?q=978+0+439+70818+0')?.template).toBe('https://lib.example/s?q={isbn}');
  });

  it('prefers the ISBN-13 when both appear, and replaces every copy of it', () => {
    const url = 'https://lib.example/s?a=9780439708180&b=0439708184&c=9780439708180';
    expect(searchTemplateFromUrl(url)?.template).toBe('https://lib.example/s?a={isbn}&b=0439708184&c={isbn}');
  });

  it('ignores numbers that are not valid ISBNs (record ids, timestamps)', () => {
    expect(searchTemplateFromUrl('https://lib.example/record/9780439708181')).toBeNull(); // bad check digit
    expect(searchTemplateFromUrl('https://lib.example/record/12345678901234567')).toBeNull();
    expect(searchTemplateFromUrl('https://lib.example/?t=1767225600000')).toBeNull();
  });

  it('returns null without an ISBN or for something that is not a web URL', () => {
    expect(searchTemplateFromUrl('https://lib.example/')).toBeNull();
    expect(searchTemplateFromUrl('9780439708180')).toBeNull();
    expect(searchTemplateFromUrl('ftp://lib.example/9780439708180')).toBeNull();
    expect(searchTemplateFromUrl('')).toBeNull();
  });
});

describe('fillSearchTemplate', () => {
  it('fills {isbn} with the ISBN-13 and {isbn10} with the ISBN-10', () => {
    expect(fillSearchTemplate('https://lib.example/s?q={isbn}', '9780064400558')).toBe('https://lib.example/s?q=9780064400558');
    expect(fillSearchTemplate('https://lib.example/s?q={isbn10}', '9780064400558')).toBe('https://lib.example/s?q=0064400557');
  });

  it('uses the ISBN-13 for {isbn10} when there is no ISBN-10 (979)', () => {
    expect(fillSearchTemplate('https://lib.example/s?q={isbn10}', '9791032305690')).toBe('https://lib.example/s?q=9791032305690');
  });

  it('round-trips with the detector', () => {
    const detected = searchTemplateFromUrl('https://lib.example/s?q=978-0-439-70818-0');
    expect(fillSearchTemplate(detected!.template, '9780547928227')).toBe('https://lib.example/s?q=9780547928227');
  });

  it('gives null for books without an ISBN and templates without a placeholder', () => {
    expect(fillSearchTemplate('https://lib.example/s?q={isbn}', 'noisbn-1234')).toBeNull();
    expect(fillSearchTemplate('https://lib.example/', '9780064400558')).toBeNull();
  });
});

describe('asWebUrl', () => {
  it('accepts http and https only', () => {
    expect(asWebUrl(' https://lib.example/ ')?.hostname).toBe('lib.example');
    expect(asWebUrl('http://lib.example')).not.toBeNull();
    expect(asWebUrl('javascript:alert(1)')).toBeNull();
    expect(asWebUrl('lib.example')).toBeNull();
  });
});
