import { strings } from '../strings';

/**
 * Reading Journey definitions. Data only; no UI yet.
 *
 * A reader picks one journey from the gallery. Each read advances one step;
 * the journey completes when steps are reached. stageLabels are shown at
 * evenly spaced milestones along the way (the last label is the finish).
 *
 * Step counts are placeholders to be tuned in a later phase.
 */

export type JourneyTheme = 'ocean' | 'forest' | 'coast' | 'city' | 'fairytale' | 'sky' | 'space';

export interface Journey {
  id: string;
  title: string;
  theme: JourneyTheme;
  emoji: string;
  /** Number of reads needed to complete the journey. */
  steps: number;
  stageLabels: readonly string[];
}

const j = strings.journeys;

export const JOURNEYS: readonly Journey[] = [
  { id: 'ocean_deep', title: j.ocean_deep.title, theme: 'ocean', emoji: '🐋', steps: 20, stageLabels: j.ocean_deep.stages },
  { id: 'redwood_tree', title: j.redwood_tree.title, theme: 'forest', emoji: '🌲', steps: 20, stageLabels: j.redwood_tree.stages },
  { id: 'ocean_cliff', title: j.ocean_cliff.title, theme: 'coast', emoji: '🪨', steps: 15, stageLabels: j.ocean_cliff.stages },
  { id: 'skyscraper', title: j.skyscraper.title, theme: 'city', emoji: '🏙️', steps: 25, stageLabels: j.skyscraper.stages },
  { id: 'rapunzel_tower', title: j.rapunzel_tower.title, theme: 'fairytale', emoji: '🏰', steps: 15, stageLabels: j.rapunzel_tower.stages },
  { id: 'hot_air_balloon', title: j.hot_air_balloon.title, theme: 'sky', emoji: '🎈', steps: 15, stageLabels: j.hot_air_balloon.stages },
  { id: 'ladder_to_the_moon', title: j.ladder_to_the_moon.title, theme: 'space', emoji: '🌙', steps: 30, stageLabels: j.ladder_to_the_moon.stages },
  { id: 'rocket_through_space', title: j.rocket_through_space.title, theme: 'space', emoji: '🚀', steps: 30, stageLabels: j.rocket_through_space.stages },
];

export function getJourney(id: string): Journey | undefined {
  return JOURNEYS.find((journey) => journey.id === id);
}
