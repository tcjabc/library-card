import type { LibraryCardFormat } from '../data';
import { BARCODE_QUIET_MODULES } from './stripLayout';

/**
 * Redraws a library card barcode with JsBarcode (loaded on first use, so it stays out of the
 * main bundle). Bars only: the number is written under them by the card drawing.
 */

const JS_FORMAT: Record<LibraryCardFormat, string> = {
  code_128: 'CODE128',
  code_39: 'CODE39',
  codabar: 'codabar',
  itf: 'ITF',
  ean_13: 'EAN13',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Drawing units per module in the SVG (scaled to millimetres on the card). */
const MODULE_UNITS = 2;
const BAR_UNITS = 100;

export interface DrawnBarcode {
  /** The bars as SVG elements, in a box of widthUnits × heightUnits (quiet zones included). */
  inner: string;
  widthUnits: number;
  heightUnits: number;
  /** Modules across, quiet zones included. */
  modules: number;
}

export interface BarcodeColours {
  dark: string;
  light: string;
}

async function jsBarcode() {
  return (await import('jsbarcode')).default;
}

/** The barcode as SVG markup. Rejects if JsBarcode can't encode the value in that format. */
export async function drawBarcodeSvg(value: string, format: LibraryCardFormat, colours: BarcodeColours): Promise<DrawnBarcode> {
  const JsBarcode = await jsBarcode();
  const svg = document.createElementNS(SVG_NS, 'svg');
  let valid = true;
  JsBarcode(svg, value, {
    format: JS_FORMAT[format],
    width: MODULE_UNITS,
    height: BAR_UNITS,
    margin: 0,
    marginLeft: BARCODE_QUIET_MODULES * MODULE_UNITS,
    marginRight: BARCODE_QUIET_MODULES * MODULE_UNITS,
    displayValue: false,
    background: colours.light,
    lineColor: colours.dark,
    flat: true,
    valid: (ok: boolean) => {
      valid = ok;
    },
  } as Parameters<typeof JsBarcode>[2]);
  if (!valid) throw new Error(`JsBarcode can't draw that value as ${format}.`);
  const widthUnits = parseFloat(svg.getAttribute('width') ?? '0');
  const heightUnits = parseFloat(svg.getAttribute('height') ?? '0');
  const serializer = new XMLSerializer();
  const inner = Array.from(svg.childNodes, (node) => serializer.serializeToString(node))
    .join('')
    // Each child carries the namespace when serialised alone; the parent <svg> has it already.
    .replaceAll(` xmlns="${SVG_NS}"`, '');
  return { inner, widthUnits, heightUnits, modules: widthUnits / MODULE_UNITS };
}

/** The barcode on a canvas, large and sharp, for "Test it" (decoded again by the scanner). */
export async function drawBarcodeCanvas(value: string, format: LibraryCardFormat, colours: BarcodeColours): Promise<HTMLCanvasElement> {
  const JsBarcode = await jsBarcode();
  const canvas = document.createElement('canvas');
  let valid = true;
  JsBarcode(canvas, value, {
    format: JS_FORMAT[format],
    width: 3,
    height: 160,
    margin: 30,
    marginLeft: BARCODE_QUIET_MODULES * 3,
    marginRight: BARCODE_QUIET_MODULES * 3,
    displayValue: false,
    background: colours.light,
    lineColor: colours.dark,
    flat: true,
    valid: (ok: boolean) => {
      valid = ok;
    },
  } as Parameters<typeof JsBarcode>[2]);
  if (!valid) throw new Error(`JsBarcode can't draw that value as ${format}.`);
  return canvas;
}
