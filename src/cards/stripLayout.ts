/**
 * The printed fold-over card ("butterfly" strip), in millimetres. Pure numbers, so the SVG
 * drawing, the print page and the tests share one layout. The matching --print-* tokens in
 * theme.css size the HTML page; a test checks they agree.
 *
 *   ┌──────────── strip 171.2 × 54 ────────────┐
 *   │  front panel      ┆      back panel      │
 *   │  art · avatar · QR┆ library · barcode    │
 *   └───────────────────┆──────────────────────┘
 *                      fold
 *
 * Each panel is an ID-1 card (85.6 × 54). Fold the back panel behind the front along the dashed
 * line, then turn the card over sideways: the back reads the right way up (see foldAndFlip).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PAGE = { width: 210, height: 297 } as const;
export const PANEL = { width: 85.6, height: 54 } as const;
export const STRIP = { width: PANEL.width * 2, height: PANEL.height } as const;
export const STRIPS_PER_PAGE = 5;

/** Page margins that centre the column of strips on A4 (the same as the old 2 × 5 card sheet). */
export const PAGE_MARGIN = {
  x: round((PAGE.width - STRIP.width) / 2),
  y: round((PAGE.height - STRIPS_PER_PAGE * STRIP.height) / 2),
} as const;

/** The fold line, from the strip's left edge. */
export const FOLD_X = PANEL.width;

/** Space kept clear inside each panel's edge. */
export const PANEL_PADDING = 4;

/** Front panel (strip coordinates). The QR box is white and includes the code's own quiet zone. */
export const QR_SIZE = 42;
export const QR_BOX: Rect = {
  x: round(PANEL.width - PANEL_PADDING - QR_SIZE),
  y: round((PANEL.height - QR_SIZE) / 2),
  width: QR_SIZE,
  height: QR_SIZE,
};
/** Modules of white round the QR code (inside QR_BOX). */
export const QR_MARGIN_MODULES = 4;

/** The column left of the QR code: app name and avatar. */
export const FRONT_COLUMN: Rect = { x: PANEL_PADDING, y: PANEL_PADDING, width: round(QR_BOX.x - 2 * PANEL_PADDING), height: PANEL.height - 2 * PANEL_PADDING };
export const AVATAR_SIZE = 20;
export const AVATAR_BOX: Rect = {
  x: round(FRONT_COLUMN.x + (FRONT_COLUMN.width - AVATAR_SIZE) / 2),
  y: 22,
  width: AVATAR_SIZE,
  height: AVATAR_SIZE,
};
export const APP_NAME = { x: round(FRONT_COLUMN.x + FRONT_COLUMN.width / 2), y: 12, size: 3.6 } as const;

/** Back panel (strip coordinates). */
export const BACK_X = PANEL.width;
export const LIBRARY_NAME = { x: round(BACK_X + PANEL.width / 2), y: 10.5, size: 4 } as const;
/** The white box behind the barcode: at least 20 mm tall, with room for quiet zones and the number. */
export const BARCODE_BOX: Rect = { x: round(BACK_X + PANEL_PADDING), y: 14, width: round(PANEL.width - 2 * PANEL_PADDING), height: 32 };
/** Bars inside the box (the quiet zones are part of the drawn barcode). */
export const BARCODE_BARS = { top: BARCODE_BOX.y + 2.5, height: 22 } as const;
export const BARCODE_TEXT = { y: BARCODE_BOX.y + 2.5 + 22 + 4.6, size: 3.4 } as const;
/** Light, readable bars: no wider than this per module, however short the number. */
export const MAX_MODULE_WIDTH = 0.6;
/** Narrower than this and phone cameras and library scanners struggle: the app warns. */
export const MIN_MODULE_WIDTH = 0.25;
/** White round each barcode, in modules (drawn as part of the barcode). */
export const BARCODE_QUIET_MODULES = 10;

/** Art never comes closer than this to the QR code, the avatar or the barcode box. */
export const ZONE_GAP = 1;

/** 300 dpi PNG size for a strip. */
export const PNG_DPI = 300;
export const mmToPx = (mm: number, dpi = PNG_DPI) => Math.round((mm / 25.4) * dpi);
export const STRIP_PNG = { width: mmToPx(STRIP.width), height: mmToPx(STRIP.height) } as const;

/** Where strip `index` (0-based) sits on its page, and on which page. */
export function stripPosition(index: number): { page: number; x: number; y: number } {
  const page = Math.floor(index / STRIPS_PER_PAGE);
  const row = index % STRIPS_PER_PAGE;
  return { page, x: PAGE_MARGIN.x, y: round(PAGE_MARGIN.y + row * STRIP.height) };
}

/** How wide the barcode is drawn: `modules` (quiet zones included) at up to MAX_MODULE_WIDTH. */
export function barcodeWidth(modules: number): { width: number; moduleWidth: number; tooNarrow: boolean } {
  const moduleWidth = Math.min(MAX_MODULE_WIDTH, BARCODE_BOX.width / modules);
  return { width: round(moduleWidth * modules), moduleWidth: round(moduleWidth), tooNarrow: moduleWidth < MIN_MODULE_WIDTH };
}

/**
 * Where a point printed on the back panel ends up when the card is folded on the midline (the
 * back panel goes behind the front) and then turned over sideways, in the coordinates of the
 * card as you now look at it. `u` is measured from the fold line, `v` from the top.
 * Fold: the point lands behind the front panel at x = FOLD_X − u, seen from behind.
 * Turning over sideways mirrors x across the card: x' = PANEL.width − x.
 */
export function foldAndFlip(u: number, v: number): { x: number; y: number } {
  const behindFront = FOLD_X - u;
  return { x: round(PANEL.width - behindFront), y: v };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
