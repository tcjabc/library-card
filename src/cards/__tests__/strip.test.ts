import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_BOX,
  BARCODE_BARS,
  BARCODE_BOX,
  BARCODE_TEXT,
  FOLD_X,
  FRONT_COLUMN,
  PAGE,
  PAGE_MARGIN,
  PANEL,
  QR_BOX,
  STRIP,
  STRIP_PNG,
  STRIPS_PER_PAGE,
  barcodeWidth,
  foldAndFlip,
  stripPosition,
  type Rect,
} from '../stripLayout';
import { buildStripSvg, escapeXml, keepClearZones, shortTitle, type StripColours, type StripInput } from '../stripSvg';
import { CARD_TEMPLATES, templateArt } from '../templates';

// The fold-over card: layout maths (src/cards/stripLayout.ts) and its SVG (stripSvg.ts).

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const FRONT: Rect = { x: 0, y: 0, width: PANEL.width, height: PANEL.height };
const BACK: Rect = { x: FOLD_X, y: 0, width: PANEL.width, height: PANEL.height };

describe('strip layout', () => {
  it('is two ID-1 cards side by side, five to an A4 page with the old margins', () => {
    expect([PANEL.width, PANEL.height]).toEqual([85.6, 54]);
    expect([STRIP.width, STRIP.height]).toEqual([171.2, 54]);
    expect(STRIPS_PER_PAGE).toBe(5);
    expect(PAGE_MARGIN).toEqual({ x: 19.4, y: 13.5 });
    expect(2 * PAGE_MARGIN.x + STRIP.width).toBeCloseTo(PAGE.width, 6);
    expect(2 * PAGE_MARGIN.y + STRIPS_PER_PAGE * STRIP.height).toBeCloseTo(PAGE.height, 6);
  });

  it('places strips down one column, a new page every five', () => {
    expect([0, 1, 4].map(stripPosition)).toEqual([
      { page: 0, x: 19.4, y: 13.5 },
      { page: 0, x: 19.4, y: 67.5 },
      { page: 0, x: 19.4, y: 229.5 },
    ]);
    expect(stripPosition(5)).toEqual({ page: 1, x: 19.4, y: 13.5 });
    expect(stripPosition(4).y + STRIP.height).toBeCloseTo(PAGE.height - PAGE_MARGIN.y, 6);
  });

  it('agrees with the --print-* tokens in theme.css', () => {
    const css = readFileSync(new URL('../../theme.css', import.meta.url), 'utf8');
    const token = (name: string) => Number(new RegExp(`${name}:\\s*([\\d.]+)mm`).exec(css)?.[1]);
    expect(token('--print-page-width')).toBe(PAGE.width);
    expect(token('--print-page-height')).toBe(PAGE.height);
    expect(token('--print-page-margin-x')).toBe(PAGE_MARGIN.x);
    expect(token('--print-page-margin-y')).toBe(PAGE_MARGIN.y);
    expect(token('--print-card-width')).toBe(PANEL.width);
    expect(token('--print-card-height')).toBe(PANEL.height);
    expect(token('--print-strip-width')).toBe(STRIP.width);
    expect(token('--print-qr-size')).toBe(QR_BOX.width);
  });

  it('keeps the QR code 42 mm, the avatar beside it and both on the front panel', () => {
    expect([QR_BOX.width, QR_BOX.height]).toEqual([42, 42]);
    expect(inside(QR_BOX, FRONT)).toBe(true);
    expect(inside(AVATAR_BOX, FRONT_COLUMN)).toBe(true);
    expect(overlaps(QR_BOX, AVATAR_BOX)).toBe(false);
  });

  it('gives the barcode a white box on the back at least 20 mm tall, bars and number inside it', () => {
    expect(inside(BARCODE_BOX, BACK)).toBe(true);
    expect(BARCODE_BOX.height).toBeGreaterThanOrEqual(20);
    expect(BARCODE_BARS.top).toBeGreaterThan(BARCODE_BOX.y);
    expect(BARCODE_TEXT.y).toBeLessThan(BARCODE_BOX.y + BARCODE_BOX.height);
  });

  it('draws short numbers at most 0.6 mm a module and warns when bars get too thin', () => {
    expect(barcodeWidth(60)).toEqual({ width: 36, moduleWidth: 0.6, tooNarrow: false });
    const long = barcodeWidth(400);
    expect(long.width).toBeCloseTo(BARCODE_BOX.width, 6);
    expect(long.tooNarrow).toBe(true);
  });

  it('makes a 300 dpi PNG of about 2022 × 638 px', () => {
    expect(STRIP_PNG).toEqual({ width: 2022, height: 638 });
  });

  it('folded on the midline and turned over sideways, the back reads the right way up', () => {
    // Back-panel points (from the fold line, from the top) land in the same place, not mirrored.
    for (const [u, v] of [[0, 0], [10, 5], [PANEL.width, PANEL.height], [42.8, 27]]) {
      expect(foldAndFlip(u, v)).toEqual({ x: u, y: v });
    }
  });
});

const colours: StripColours = {
  paper: '#ffffff',
  ink: '#1f2430',
  accent: '#3b5bdb',
  cut: '#9aa1ad',
  fold: '#6b7385',
  art: '#a3abba',
  qrDark: '#000000',
  qrLight: '#ffffff',
  font: "ui-rounded, 'Nunito', sans-serif",
  cutWidth: 0.25,
  foldWidth: 0.3,
  foldDash: 1.6,
  artWidth: 0.45,
};
const QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 41 41" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h41v41H0z"/><path stroke="#000000" d="M4 4.5h7"/></svg>';
const input = (over: Partial<StripInput> = {}): StripInput => ({
  idPrefix: '',
  template: 'bubbles',
  avatarHref: 'data:image/png;base64,AAAA',
  qrSvg: QR,
  appName: 'Library Card',
  back: {
    title: 'Town & Country <Library>',
    barcode: { inner: '<rect x="20" y="0" width="2" height="100"/>', widthUnits: 120, heightUnits: 100, modules: 60 },
    text: '21234000123456',
  },
  colours,
  ...over,
});

describe('strip SVG', () => {
  it('is 171.2 × 54 mm with the named groups, a solid cut line and a dashed fold', () => {
    const svg = buildStripSvg(input());
    expect(svg).toContain('width="171.2mm" height="54mm" viewBox="0 0 171.2 54"');
    for (const group of ['art', 'avatar', 'qr', 'barcode', 'text', 'cut', 'fold']) expect(svg).toContain(`<g id="${group}"`);
    expect(svg).toMatch(/<g id="fold"><line x1="85.6" y1="0" x2="85.6" y2="54"[^>]*stroke-dasharray/);
    expect(svg).toMatch(/<g id="cut"><rect [^>]*fill="none" stroke="#9aa1ad"/);
    expect(svg).not.toMatch(/<g id="cut">[^]*?stroke-dasharray[^]*?<\/g>/);
  });

  it('nests the QR code in its white 42 mm box and embeds the avatar as an image', () => {
    const svg = buildStripSvg(input());
    expect(svg).toContain(`<rect x="${QR_BOX.x}" y="${QR_BOX.y}" width="42" height="42" fill="#ffffff"/>`);
    expect(svg).toContain(`<svg x="${QR_BOX.x}" y="${QR_BOX.y}" width="42" height="42" viewBox="0 0 41 41"`);
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
  });

  it('keeps the art out of the QR code, avatar and barcode', () => {
    const svg = buildStripSvg(input());
    expect(svg).toMatch(/<g id="art"[^>]*mask="url\(#keep-clear\)"/);
    const zones = keepClearZones(true);
    for (const zone of [QR_BOX, AVATAR_BOX, BARCODE_BOX]) expect(zones.some((z) => inside(zone, z))).toBe(true);
    // Without a barcode the whole back is art.
    expect(keepClearZones(false).some((z) => overlaps(z, BACK))).toBe(false);
  });

  it('never shows the reader’s name, and escapes the library name', () => {
    const svg = buildStripSvg(input());
    expect(svg).toContain('Town &amp; Country &lt;Library&gt;');
    expect(svg).not.toContain('<Library>');
    expect(escapeXml(`a"b'c`)).toBe('a&quot;b&apos;c');
    expect(shortTitle('x'.repeat(50))).toHaveLength(36);
  });

  it('with no barcode, the back is template art only', () => {
    const svg = buildStripSvg(input({ back: null }));
    expect(svg).not.toContain('id="barcode"');
    expect(svg).not.toContain('21234000123456');
  });

  it('prefixes every id when strips share a page', () => {
    const svg = buildStripSvg(input({ idPrefix: 's3' }));
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every((id) => id.startsWith('s3-'))).toBe(true);
    expect(svg).toContain('mask="url(#s3-keep-clear)"');
  });

  it('every template is outline only (no filled shapes)', () => {
    for (const template of CARD_TEMPLATES) {
      for (const side of ['front', 'back'] as const) {
        const art = templateArt(template, side);
        expect(art.length).toBeGreaterThan(0);
        expect(art).not.toMatch(/fill=/);
      }
    }
  });
});
