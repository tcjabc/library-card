import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type LazyExoticComponent, type RefObject } from 'react';
import type { Journey, JourneyId } from '../../journeys/journeys';
import { readSeenStep, settleFrom, writeSeenStep } from '../../journeys/journeySeen';
import { SCENE_LAYERS, SETTLE_MS, layerTravel, sceneFor, sceneMotion, scrollShift, settleOffsets, stepShift, type SceneLayer } from '../../journeys/scene';
import { useStackDecor } from '../../staircase/decorSetting';
import './journeyScene.css';

/** One scene's art for one depth layer (src/screens/journeys/scenes/*), loaded on demand: one chunk per scene. */
type SceneArt = ComponentType<{ layer: SceneLayer }>;
const ART: Partial<Record<JourneyId, LazyExoticComponent<SceneArt>>> = {
  hot_air_balloon: lazy(() => import('./scenes/HotAirBalloonScene')),
  ocean_deep: lazy(() => import('./scenes/OceanDeepScene')),
  redwood_tree: lazy(() => import('./scenes/RedwoodTreeScene')),
  ocean_cliff: lazy(() => import('./scenes/OceanCliffScene')),
  skyscraper: lazy(() => import('./scenes/SkyscraperScene')),
};

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The system's reduced-motion setting, followed live. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface JourneySceneProps {
  journey: Journey;
  progress: number;
  readerId: string;
  /** The reader's journey record (its seen step is kept per record). */
  recordId: string;
  /** The track the scene follows. */
  trackRef: RefObject<HTMLOListElement | null>;
}

/**
 * The journey's scene behind its track (src/journeys/scene.ts, docs/journeys.md):
 * a fixed backdrop in three layers that slide by different amounts, from one
 * value, --journey-shift (0 at the top end of the track, 1 at the bottom end).
 * With parallax it follows the page's scroll (the track is the page's length); still (Sky decoration None, or reduced motion), it shows the current
 * step and stays. When the reader's step has changed since they last saw the
 * screen, each layer settles once from where the old step put it. Decorative:
 * hidden from screen readers. Nothing for journeys without a scene.
 */
export function JourneyScene({ journey, progress, readerId, recordId, trackRef }: JourneySceneProps) {
  const config = sceneFor(journey.id);
  const Art = ART[journey.id];
  const decor = useStackDecor();
  const reduced = useReducedMotion();
  const motion = sceneMotion(decor, reduced);
  const root = useRef<HTMLDivElement>(null);
  const inners = useRef<(HTMLDivElement | null)[]>([]);

  // The shift: following the scroll (parallax), or the current step's, still.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const set = (shift: number) => el.style.setProperty('--journey-shift', shift.toFixed(4));
    const atStep = stepShift(progress, journey.steps, journey.direction);
    if (!motion.parallax) {
      set(atStep);
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      if (!trackRef.current) return;
      const page = document.scrollingElement ?? document.documentElement;
      set(scrollShift(page.scrollTop, page.scrollHeight - window.innerHeight, window.innerHeight, atStep));
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => {
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
      cancelAnimationFrame(raf);
    };
  }, [motion.parallax, progress, journey.steps, journey.direction, trackRef]);

  // The settle: once per step change since this reader last saw the screen (the seen step is
  // recorded either way). Decided while rendering, by reading only (as the Family Staircase does),
  // and kept per step, so the effect running again (React's development double run, a decor
  // change) never loses it or replays a finished one; the step is written in an effect.
  const key = `${recordId}:${progress}`;
  const [plan, setPlan] = useState<{ key: string; from: number | null } | null>(null);
  if (config && plan?.key !== key) setPlan({ key, from: settleFrom(readSeenStep(storage(), readerId, recordId), progress, motion.settle) });
  useEffect(() => {
    if (config) writeSeenStep(storage(), readerId, recordId, progress);
  }, [config, readerId, recordId, progress]);
  useEffect(() => {
    if (!config || !plan || plan.key !== key || plan.from === null || !motion.settle) return;
    const from = plan.from;
    const layers = inners.current.filter((inner): inner is HTMLDivElement => inner !== null);
    const reset = (inner: HTMLDivElement) => {
      inner.style.willChange = '';
      inner.style.transition = '';
      inner.style.transform = '';
    };
    const offsets = settleOffsets(from, progress, journey.steps, journey.direction, config);
    SCENE_LAYERS.forEach((layer, i) => {
      const inner = inners.current[i];
      if (!inner) return;
      const offset = offsets[layer];
      inner.style.transition = 'none';
      inner.style.willChange = 'transform';
      inner.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    });
    // Start from there, then glide to where the new step puts each layer.
    void layers[0]?.getBoundingClientRect();
    const raf = requestAnimationFrame(() => {
      for (const inner of layers) {
        inner.style.transition = `transform ${SETTLE_MS}ms ease-in-out`;
        inner.style.transform = 'translate3d(0, 0, 0)';
      }
    });
    const done = (event: TransitionEvent) => {
      reset(event.currentTarget as HTMLDivElement);
      setPlan((prev) => (prev && prev.key === plan.key ? { ...prev, from: null } : prev));
    };
    for (const inner of layers) inner.addEventListener('transitionend', done, { once: true });
    return () => {
      cancelAnimationFrame(raf);
      for (const inner of layers) {
        inner.removeEventListener('transitionend', done);
        reset(inner);
      }
    };
  }, [config, plan, key, progress, journey.steps, journey.direction, motion.settle]);

  if (!config || !Art) return null;
  return (
    <div ref={root} className={`journey-scene journey-scene--${journey.id}${motion.loops ? ' journey-scene--loops' : ''}`} aria-hidden="true">
      {SCENE_LAYERS.map((layer, i) => (
        <div key={layer} className={`journey-scene__layer journey-scene__layer--${layer}`} style={{ '--travel': `${layerTravel(config, layer)}px` } as CSSProperties}>
          <div
            ref={(el) => {
              inners.current[i] = el;
            }}
            className="journey-scene__inner"
          >
            <Suspense fallback={null}>
              <Art layer={layer} />
            </Suspense>
          </div>
        </div>
      ))}
    </div>
  );
}
