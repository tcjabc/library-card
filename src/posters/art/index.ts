import { JOURNEYS, type Journey, type JourneyId } from '../../journeys/journeys';
import { hotAirBalloon } from './hotAirBalloon';
import { ladderToTheMoon } from './ladderToTheMoon';
import { oceanCliff } from './oceanCliff';
import { oceanDeep } from './oceanDeep';
import { rapunzelTower } from './rapunzelTower';
import { redwoodTree } from './redwoodTree';
import { rocketThroughSpace } from './rocketThroughSpace';
import { skyscraper } from './skyscraper';
import type { PosterArt } from './types';

export type { PosterArt, PosterShape } from './types';

/**
 * Every journey that has a poster. Adding one = its art module plus one line here; the posters
 * section lists only journeys found in this registry (docs/posters.md). Since 1.24.0: all eight.
 */
export const POSTER_ART: Partial<Record<JourneyId, PosterArt>> = {
  ocean_deep: oceanDeep,
  redwood_tree: redwoodTree,
  ocean_cliff: oceanCliff,
  skyscraper,
  rapunzel_tower: rapunzelTower,
  hot_air_balloon: hotAirBalloon,
  ladder_to_the_moon: ladderToTheMoon,
  rocket_through_space: rocketThroughSpace,
};

/** The journeys with a poster, in the gallery's order (short to long). */
export const POSTER_JOURNEYS: readonly Journey[] = JOURNEYS.filter((journey) => POSTER_ART[journey.id]);
