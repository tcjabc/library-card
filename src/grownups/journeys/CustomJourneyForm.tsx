import { useId, useState, type FormEvent } from 'react';
import {
  JOURNEY_THEMES,
  MAX_CUSTOM_JOURNEY_NAME,
  isDataStoreError,
  type CustomJourney,
  type DataStore,
  type JourneyTheme,
} from '../../data';
import { getJourney } from '../../journeys/journeys';
import { customJourneyDefaultName, customJourneyDefinition } from '../../journeys/resolve';
import { POSTER_ART } from '../../posters/art';
import { POSTER_FRAME } from '../../posters/posterLayout';
import { fmt, strings } from '../../strings';
import { ScaledPage } from '../../ui/print/ScaledPage';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { PosterArtShapes, PosterSheet } from '../cards/JourneyPoster';
import '../cards/posters-print.css';
import { DEFAULT_LENGTH, LENGTH_PRESETS, clampLength, formProblem, lengthRange } from './customJourneyRules';
import './customJourneys.css';

const t = strings.grownups.customJourneys;
const F = POSTER_FRAME;
/** The art column of a poster (the band, ±artHalf of the centre, a little room for the strokes). */
const ART_VIEWBOX = `${F.centre - F.artHalf - 4} ${F.slotTop - 4} ${2 * (F.artHalf + 4)} ${F.slotBottom - F.slotTop + 8}`;

/** A theme's poster line art, small (its chip in the form). */
export function ThemeArt({ theme }: { theme: JourneyTheme }) {
  const art = POSTER_ART[theme];
  if (!art) return null;
  return (
    <svg className="custom-journey-theme__art" viewBox={ART_VIEWBOX} xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <PosterArtShapes art={art} />
    </svg>
  );
}

export interface CustomJourneyFormProps {
  store: DataStore;
  householdId: string;
  /** The journey to edit, or null to make a new one. */
  journey: CustomJourney | null;
  onClose: () => void;
  /** After a save, with the saved journey (the posters section picks its poster). */
  onSaved?: (journey: CustomJourney) => void;
}

/**
 * Grown-ups: make or edit a custom journey (1.26.0). A new one: a picture (one of the eight
 * themes), a length of 3–30 books and an optional name. Editing: the name, and the length only
 * upwards; the picture stays (a new picture is a new journey). A small poster shows the result.
 */
export default function CustomJourneyForm({ store, householdId, journey, onClose, onSaved }: CustomJourneyFormProps) {
  const toast = useToast();
  const editing = journey !== null;
  const { min: minSteps, max: maxSteps } = lengthRange(journey);
  const [theme, setTheme] = useState<JourneyTheme | null>(journey?.theme ?? null);
  const [steps, setSteps] = useState(journey?.steps ?? DEFAULT_LENGTH);
  const [name, setName] = useState(journey?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { theme: useId(), length: useId(), lengthHelp: useId(), name: useId(), nameHelp: useId() };

  const themeTitle = theme ? (getJourney(theme)?.title ?? theme) : '';
  const placeholder = theme ? customJourneyDefaultName(themeTitle, steps) : '';
  const preview = theme
    ? customJourneyDefinition({ id: journey?.id ?? 'preview', household_id: householdId, theme, steps, name: name.trim() || null, created_at: '', archived_at: null })
    : undefined;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const problem = formProblem({ theme, steps, name }, journey);
    if (problem || !theme) return setError(problem ?? t.pickTheme);
    setBusy(true);
    setError(null);
    try {
      const saved = journey
        ? await store.updateCustomJourney(journey.id, { name: name.trim() || null, steps })
        : await store.createCustomJourney({ household_id: householdId, theme, steps, name: name.trim() || null });
      toast({ message: t.saved });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      console.error('[journeys] save failed', err);
      setError(isDataStoreError(err, 'invalid') && journey && steps < journey.steps ? t.tooShort : t.failed);
      setBusy(false);
    }
  };

  const setLength = (value: number) => setSteps(clampLength(value, journey));
  const themes = editing && theme ? [theme] : JOURNEY_THEMES;

  return (
    <Sheet title={editing ? t.editTitle : t.createTitle} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)} noValidate>
        <p className="field-label" id={ids.theme}>
          {t.theme}
        </p>
        <div className="custom-journey-themes" role="group" aria-labelledby={ids.theme}>
          {themes.map((id) => {
            const def = getJourney(id);
            return (
              <button
                key={id}
                type="button"
                className="custom-journey-theme"
                aria-pressed={theme === id}
                disabled={editing}
                onClick={() => {
                  setTheme(id);
                  setError(null);
                }}
              >
                <ThemeArt theme={id} />
                <span className="custom-journey-theme__title">
                  <span aria-hidden="true">{def?.emoji}</span> {def?.title}
                </span>
              </button>
            );
          })}
        </div>
        <p className="small muted">{editing ? t.themeLocked : t.themeHelp}</p>

        <div className="stack">
          <p className="field-label" id={ids.length}>
            {t.length}
          </p>
          <div className="stepper" role="group" aria-labelledby={ids.length} aria-describedby={ids.lengthHelp}>
            <button type="button" className="btn btn--round" aria-label={t.lengthLess} disabled={steps <= minSteps} onClick={() => setLength(steps - 1)}>
              −
            </button>
            <output className="stepper__value" aria-live="polite">
              {steps}
            </output>
            <button type="button" className="btn btn--round" aria-label={t.lengthMore} disabled={steps >= maxSteps} onClick={() => setLength(steps + 1)}>
              +
            </button>
          </div>
          <div className="chip-row chip-row--dense" role="group" aria-labelledby={ids.length}>
            {LENGTH_PRESETS.map((count) => (
              <button key={count} type="button" className="chip" aria-pressed={steps === count} disabled={count < minSteps} onClick={() => setLength(count)}>
                {fmt(t.lengthPreset, { count })}
              </button>
            ))}
          </div>
          <p className="small muted" id={ids.lengthHelp}>
            {editing ? fmt(t.lengthNow, { count: minSteps }) : t.lengthHelp}
          </p>
        </div>

        <div className="stack">
          <label className="field-label" htmlFor={ids.name}>
            {t.name}
          </label>
          <input
            id={ids.name}
            className="input"
            value={name}
            maxLength={MAX_CUSTOM_JOURNEY_NAME}
            placeholder={placeholder}
            aria-describedby={ids.nameHelp}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="small muted" id={ids.nameHelp}>
            {t.nameHelp}
          </p>
        </div>

        {preview && (
          <figure className="custom-journey-preview">
            <figcaption className="small muted">{t.preview}</figcaption>
            <ScaledPage>
              <PosterSheet journey={preview} />
            </ScaledPage>
          </figure>
        )}

        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={!theme || busy}>
            {t.save}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
