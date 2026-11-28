import { JOURNEYS, type Journey, type JourneyId } from '../../journeys/journeys';
import { rocketThroughSpace } from './rocketThroughSpace';
import type { PosterArt } from './types';

export type { PosterArt, PosterShape } from './types';

/**
 * Every journey that has a poster. Adding one = its art module plus one line here; the posters
 * section lists only journeys found in this registry (docs/posters.md).
 */
export const POSTER_ART: Partial<Record<JourneyId, PosterArt>> = {
  rocket_through_space: rocketThroughSpace,
};

/** The journeys with a poster, in the gallery's order (short to long). */
export const POSTER_JOURNEYS: readonly Journey[] = JOURNEYS.filter((journey) => POSTER_ART[journey.id]);
