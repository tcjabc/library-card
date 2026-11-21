import type { CSSProperties } from 'react';
import type { Journey } from '../../journeys/journeys';

/** A journey's theme colour as --journey-color, for the .journey-* styles. */
export const journeyStyle = (journey: Journey): CSSProperties =>
  ({ '--journey-color': `var(${journey.colorVar})` }) as CSSProperties;
