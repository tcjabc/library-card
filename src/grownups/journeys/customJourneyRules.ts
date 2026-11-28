import { MAX_CUSTOM_JOURNEY_NAME, MAX_CUSTOM_JOURNEY_STEPS, MIN_CUSTOM_JOURNEY_STEPS, type CustomJourney, type JourneyTheme } from '../../data';
import { strings } from '../../strings';

const t = strings.grownups.customJourneys;

/** The length presets the form offers. */
export const LENGTH_PRESETS = [5, 10, 20, 30] as const;
/** A new journey's length until a grown-up changes it. */
export const DEFAULT_LENGTH = 10;

/** The lengths the form allows: 3–30 for a new journey; from its current length up for an edit. */
export function lengthRange(journey: Pick<CustomJourney, 'steps'> | null): { min: number; max: number } {
  return { min: journey?.steps ?? MIN_CUSTOM_JOURNEY_STEPS, max: MAX_CUSTOM_JOURNEY_STEPS };
}

/** A length moved into the allowed range. */
export function clampLength(value: number, journey: Pick<CustomJourney, 'steps'> | null): number {
  const { min, max } = lengthRange(journey);
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** What stops the form saving, as text for the grown-up, or null. */
export function formProblem(input: { theme: JourneyTheme | null; steps: number; name: string }, journey: Pick<CustomJourney, 'steps'> | null): string | null {
  if (!input.theme) return t.pickTheme;
  if (input.name.trim().length > MAX_CUSTOM_JOURNEY_NAME) return t.nameTooLong;
  const { min, max } = lengthRange(journey);
  if (!Number.isInteger(input.steps) || input.steps < min || input.steps > max) return journey && input.steps < journey.steps ? t.tooShort : t.failed;
  return null;
}
