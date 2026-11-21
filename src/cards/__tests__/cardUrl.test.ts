import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCardUrl, parseCardToken } from '../cardUrl';

const TOKEN = 'gDCWktxYYFmUAG9mCOtAtQ';

describe('parseCardToken', () => {
  it('reads the token from a card URL, whatever the origin and base path', () => {
    expect(parseCardToken(`https://example.github.io/library-card/#/card/${TOKEN}`)).toBe(TOKEN);
    expect(parseCardToken(`http://localhost:5173/#/card/${TOKEN}`)).toBe(TOKEN);
    expect(parseCardToken(`https://elsewhere.example/app/#/card/${TOKEN}?x=1`)).toBe(TOKEN);
  });

  it('accepts a bare token, with surrounding spaces', () => {
    expect(parseCardToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it('decodes a percent-encoded token', () => {
    expect(parseCardToken(`https://x/#/card/${encodeURIComponent('abc-DEF_123456789xyz')}`)).toBe('abc-DEF_123456789xyz');
  });

  it('rejects anything that is not a card', () => {
    expect(parseCardToken('hello world')).toBeNull();
    expect(parseCardToken('9780439708180')).toBeNull(); // too short, a book barcode
    expect(parseCardToken('https://example.org/#/shelf')).toBeNull();
    expect(parseCardToken('https://x/#/card/has spaces')).toBeNull();
    expect(parseCardToken('https://x/#/card/%E0%A4%A')).toBeNull(); // broken encoding
    expect(parseCardToken('a'.repeat(129))).toBeNull();
    expect(parseCardToken('abandon ability able about above absent absorb abstract absurd abuse access accident')).toBeNull();
  });
});

describe('buildCardUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds origin + base + #/card/<token>, which parses back', () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.org' } });
    const url = buildCardUrl(TOKEN);
    expect(url).toBe(`https://example.org/#/card/${TOKEN}`);
    expect(parseCardToken(url)).toBe(TOKEN);
  });
});
