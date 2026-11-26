import type { CSSProperties } from 'react';

/**
 * Scene colours always come from theme tokens (--journey-scene-*, light and dark
 * values in src/theme.css), never from the art: `paint('balloon-sky-low')` is
 * the fill var(--journey-scene-balloon-sky-low).
 */
export const paint = (token: string): CSSProperties => ({ fill: `var(--journey-scene-${token})` });

/** An outline in a token's colour (bubbles, ropes). */
export const ink = (token: string, width: number): CSSProperties => ({ fill: 'none', stroke: `var(--journey-scene-${token})`, strokeWidth: width });

/** Where a piece of art sits in its layer (all in CSS units; top/bottom % are of the layer's height). */
export const at = (place: { left?: string; right?: string; top?: string; bottom?: string; width: string; height?: string }): CSSProperties => place;
