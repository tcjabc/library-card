import type { DrawnBarcode } from './barcodeDraw';
import {
  APP_NAME,
  AVATAR_BOX,
  BACK_X,
  BARCODE_BARS,
  BARCODE_BOX,
  BARCODE_TEXT,
  FOLD_X,
  LIBRARY_NAME,
  PANEL,
  QR_BOX,
  STRIP,
  ZONE_GAP,
  barcodeWidth,
  type Rect,
} from './stripLayout';
import { templateArt, type CardTemplate } from './templates';

/**
 * One fold-over card as an SVG document, in millimetres (viewBox 0 0 171.2 54). Pure: everything
 * that needs the browser (QR code, barcode, avatar image) is made beforehand and passed in. The
 * same markup is printed, previewed and downloaded.
 *
 * Groups (ids, with `idPrefix-` in front when several strips share a page): art, avatar, qr,
 * barcode, text, cut, fold. The reader's name is never drawn.
 */

export interface StripColours {
  paper: string;
  ink: string;
  accent: string;
  cut: string;
  fold: string;
  art: string;
  qrDark: string;
  qrLight: string;
  font: string;
  cutWidth: number;
  foldWidth: number;
  foldDash: number;
  artWidth: number;
}

export interface StripBack {
  /** Library name or label, above the barcode (null: none). */
  title: string | null;
  barcode: DrawnBarcode;
  /** The number written under the bars. */
  text: string;
}

export interface StripInput {
  /** Prefix for ids, unique per strip on a page; '' for a downloaded file. */
  idPrefix: string;
  template: CardTemplate;
  /** The avatar, already drawn (a PNG data URL). */
  avatarHref: string;
  /** A complete QR code SVG (as made by qrcode's toString). */
  qrSvg: string;
  appName: string;
  /** null: no library card, the back is template art only. */
  back: StripBack | null;
  colours: StripColours;
}

const n = (v: number) => String(Math.round(v * 1000) / 1000);

/** XML-escapes text for an attribute or text node. */
export function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

const MAX_TITLE = 36;
export const shortTitle = (title: string) => (title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title);

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });
const rect = (r: Rect, attrs = '') => `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"${attrs}/>`;

/** The zones art must stay out of, in strip coordinates. */
export function keepClearZones(hasBarcode: boolean): Rect[] {
  const zones = [grow(QR_BOX, ZONE_GAP), grow(AVATAR_BOX, ZONE_GAP), { x: 6, y: APP_NAME.y - APP_NAME.size, width: 30, height: APP_NAME.size * 1.6 }];
  if (hasBarcode) {
    zones.push(grow(BARCODE_BOX, ZONE_GAP));
    zones.push({ x: BACK_X + 6, y: LIBRARY_NAME.y - LIBRARY_NAME.size, width: PANEL.width - 12, height: LIBRARY_NAME.size * 1.5 });
  }
  return zones;
}

/** The QR code's own <svg>, placed in a box (its viewBox and drawing kept). */
function nestQr(qrSvg: string, box: Rect): string {
  const viewBox = /viewBox="([^"]+)"/.exec(qrSvg)?.[1];
  const start = qrSvg.indexOf('>');
  const end = qrSvg.lastIndexOf('</svg>');
  if (!viewBox || start < 0 || end < start) throw new Error('Not a QR code SVG.');
  const inner = qrSvg.slice(start + 1, end);
  return `<svg x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" viewBox="${viewBox}" shape-rendering="crispEdges">${inner}</svg>`;
}

function barcodeGroup(back: StripBack, c: StripColours, gid: (name: string) => string): string {
  const { width } = barcodeWidth(back.barcode.modules);
  const x = BARCODE_BOX.x + (BARCODE_BOX.width - width) / 2;
  const bars =
    `<svg x="${n(x)}" y="${n(BARCODE_BARS.top)}" width="${n(width)}" height="${n(BARCODE_BARS.height)}" ` +
    `viewBox="0 0 ${n(back.barcode.widthUnits)} ${n(back.barcode.heightUnits)}" preserveAspectRatio="none" shape-rendering="crispEdges">${back.barcode.inner}</svg>`;
  const text =
    `<text x="${n(BARCODE_BOX.x + BARCODE_BOX.width / 2)}" y="${n(BARCODE_TEXT.y)}" font-size="${n(BARCODE_TEXT.size)}" ` +
    `text-anchor="middle" fill="${c.qrDark}" letter-spacing="0.4">${escapeXml(back.text)}</text>`;
  return `<g id="${gid('barcode')}">${rect(BARCODE_BOX, ` fill="${c.qrLight}" rx="1.5"`)}${bars}${text}</g>`;
}

export function buildStripSvg(input: StripInput): string {
  const { colours: c, back } = input;
  const gid = (name: string) => (input.idPrefix ? `${input.idPrefix}-${name}` : name);
  const maskId = gid('keep-clear');

  // Art everywhere except the zones (white in a mask shows, black hides).
  const mask =
    `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${n(STRIP.width)}" height="${n(STRIP.height)}">` +
    `<rect width="${n(STRIP.width)}" height="${n(STRIP.height)}" fill="#fff"/>` +
    keepClearZones(back !== null)
      .map((z) => rect(z, ' fill="#000"'))
      .join('') +
    `</mask>`;

  const art =
    `<g id="${gid('art')}" fill="none" stroke="${c.art}" stroke-width="${n(c.artWidth)}" stroke-linecap="round" stroke-linejoin="round" mask="url(#${maskId})">` +
    `<g>${templateArt(input.template, 'front')}</g>` +
    `<g transform="translate(${n(BACK_X)} 0)">${templateArt(input.template, 'back')}</g>` +
    `</g>`;

  const avatar =
    `<g id="${gid('avatar')}"><image x="${n(AVATAR_BOX.x)}" y="${n(AVATAR_BOX.y)}" width="${n(AVATAR_BOX.width)}" ` +
    `height="${n(AVATAR_BOX.height)}" href="${input.avatarHref}" xlink:href="${input.avatarHref}" preserveAspectRatio="xMidYMid meet"/></g>`;

  const qr = `<g id="${gid('qr')}">${rect(QR_BOX, ` fill="${c.qrLight}"`)}${nestQr(input.qrSvg, QR_BOX)}</g>`;

  const texts = [
    `<text x="${n(APP_NAME.x)}" y="${n(APP_NAME.y)}" font-size="${n(APP_NAME.size)}" font-weight="700" text-anchor="middle" fill="${c.accent}">${escapeXml(input.appName)}</text>`,
  ];
  if (back?.title) {
    texts.push(
      `<text x="${n(LIBRARY_NAME.x)}" y="${n(LIBRARY_NAME.y)}" font-size="${n(LIBRARY_NAME.size)}" font-weight="700" text-anchor="middle" fill="${c.ink}">${escapeXml(shortTitle(back.title))}</text>`,
    );
  }

  const half = c.cutWidth / 2;
  const cut = `<g id="${gid('cut')}">${rect({ x: half, y: half, width: STRIP.width - c.cutWidth, height: STRIP.height - c.cutWidth }, ` fill="none" stroke="${c.cut}" stroke-width="${n(c.cutWidth)}"`)}</g>`;
  const fold =
    `<g id="${gid('fold')}"><line x1="${n(FOLD_X)}" y1="0" x2="${n(FOLD_X)}" y2="${n(STRIP.height)}" stroke="${c.fold}" ` +
    `stroke-width="${n(c.foldWidth)}" stroke-dasharray="${n(c.foldDash)} ${n(c.foldDash)}"/></g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(STRIP.width)}mm" height="${n(STRIP.height)}mm" ` +
    `viewBox="0 0 ${n(STRIP.width)} ${n(STRIP.height)}" font-family="${escapeXml(c.font)}">` +
    `<defs>${mask}</defs>` +
    `<rect width="${n(STRIP.width)}" height="${n(STRIP.height)}" fill="${c.paper}"/>` +
    art +
    avatar +
    qr +
    (back ? barcodeGroup(back, c, gid) : '') +
    `<g id="${gid('text')}">${texts.join('')}</g>` +
    fold +
    cut +
    `</svg>`
  );
}
