import QRCode from 'qrcode';
import type { Library, LibraryCard, Reader } from '../data';
import { strings } from '../strings';
import { drawBarcodeSvg } from './barcodeDraw';
import { buildCardUrl } from './cardUrl';
import { QR_MARGIN_MODULES } from './stripLayout';
import { buildStripSvg, type StripColours } from './stripSvg';
import type { CardTemplate } from './templates';

/** Browser side of the card drawing: theme tokens, QR code, avatar image and barcode. */

const css = () => getComputedStyle(document.documentElement);
const token = (style: CSSStyleDeclaration, name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
/** "0.25mm" -> 0.25 (the strip is drawn in millimetres). */
const mm = (style: CSSStyleDeclaration, name: string, fallback: number) => {
  const value = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
};

/** Colours and line widths from the --print-* tokens (paper colours, never dark mode). */
export function readStripColours(): StripColours {
  const s = css();
  return {
    paper: token(s, '--print-paper', '#ffffff'),
    ink: token(s, '--print-ink', '#000000'),
    accent: token(s, '--print-accent', '#000000'),
    cut: token(s, '--print-cut', '#888888'),
    fold: token(s, '--print-fold', '#666666'),
    art: token(s, '--print-art', '#aaaaaa'),
    qrDark: token(s, '--color-qr-dark', '#000000'),
    qrLight: token(s, '--color-qr-light', '#ffffff'),
    font: token(s, '--font-body', 'sans-serif'),
    cutWidth: mm(s, '--print-cut-width', 0.25),
    foldWidth: mm(s, '--print-fold-width', 0.3),
    foldDash: mm(s, '--print-fold-dash', 1.6),
    artWidth: mm(s, '--print-art-width', 0.45),
  };
}

const avatarCache = new Map<string, string>();

/**
 * An emoji drawn as a PNG data URL with the device's colour emoji font, centred on a square.
 * Embedded as an image, the avatar looks the same in every app that opens the file.
 */
export function emojiToPng(emoji: string, size = 512): string {
  const cached = avatarCache.get(emoji);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.font = `${Math.round(size * 0.78)}px ${token(css(), '--font-emoji', 'sans-serif')}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(emoji);
  const ascent = m.actualBoundingBoxAscent || size * 0.7;
  const descent = m.actualBoundingBoxDescent || size * 0.1;
  ctx.fillText(emoji, size / 2, size / 2 + (ascent - descent) / 2);
  const url = canvas.toDataURL('image/png');
  avatarCache.set(emoji, url);
  return url;
}

/** The QR code for a reader's card as an SVG document (error correction M, 4-module quiet zone). */
export function cardQrSvg(cardToken: string, colours: Pick<StripColours, 'qrDark' | 'qrLight'>): Promise<string> {
  return QRCode.toString(buildCardUrl(cardToken), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: QR_MARGIN_MODULES,
    color: { dark: colours.qrDark, light: colours.qrLight },
  });
}

/** The name shown for a card: its library's current name, else the saved name, else the label. */
export function libraryCardTitle(card: LibraryCard, libraries: readonly Library[]): string | null {
  const live = card.library_id ? libraries.find((l) => l.id === card.library_id) : undefined;
  return live?.name ?? card.library_name ?? card.label ?? null;
}

export interface MakeStripOptions {
  reader: Reader;
  card: LibraryCard | null;
  libraries: readonly Library[];
  template: CardTemplate;
  idPrefix?: string;
}

/** The whole fold-over card for one reader, as SVG markup. */
export async function makeStripSvg({ reader, card, libraries, template, idPrefix = '' }: MakeStripOptions): Promise<string> {
  const colours = readStripColours();
  const qrSvg = await cardQrSvg(reader.card_token, colours);
  let back = null;
  if (card) {
    try {
      const barcode = await drawBarcodeSvg(card.value, card.format, { dark: colours.qrDark, light: colours.qrLight });
      back = { title: libraryCardTitle(card, libraries), barcode, text: card.value };
    } catch (error) {
      // A number that can't be drawn (e.g. synced from a newer version): art only on the back.
      console.warn('[cards] barcode not drawn', error);
    }
  }
  return buildStripSvg({
    idPrefix,
    template,
    avatarHref: emojiToPng(reader.avatar),
    qrSvg,
    appName: strings.grownups.cards.appName,
    back,
    colours,
  });
}
