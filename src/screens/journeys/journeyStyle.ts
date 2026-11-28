import type { CSSProperties } from 'react';
import type { ResolvedJourney } from '../../journeys/resolve';

/** A journey's theme colour as --journey-color, for the .journey-* styles. */
export const journeyStyle = (journey: Pick<ResolvedJourney, 'colorVar'>): CSSProperties =>
  ({ '--journey-color': `var(${journey.colorVar})` }) as CSSProperties;
