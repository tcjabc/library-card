import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type LazyExoticComponent, type RefObject } from 'react';
import type { Journey, JourneyId } from '../../journeys/journeys';
import { readSeenStep, settleFrom, writeSeenStep } from '../../journeys/journeySeen';
import { SCENE_LAYERS, SETTLE_MS, layerTravel, sceneFor, sceneMotion, settleOffsets, stepShift, type SceneLayer } from '../../journeys/scene';
import { FRESH_SCENE_BUDGET, OPEN_SAMPLE_MS, SCROLL_SAMPLE_MS, SETTLE_SAMPLE_EXTRA_MS, sceneFrame, sceneLevel, type SceneBudget } from '../../journeys/sceneBudget';
import { useStackDecor } from '../../staircase/decorSetting';
import { decorRank, minDecor, type Decor } from '../../staircase/drawBudget';
import './journeyScene.css';
import { browserFrameHost, frameSampler, type FrameSampler } from './sceneFrames';
import { publishSceneMotion, useJourneySlow, type SceneStep } from './sceneMotionDev';
import { browserScrollHost, layerDriver } from './sceneScroll';

/** One scene's art for one depth layer (src/screens/journeys/scenes/*), loaded on demand: one chunk per scene. */
type SceneArt = ComponentType<{ layer: SceneLayer }>;
const ART: Partial<Record<JourneyId, LazyExoticComponent<SceneArt>>> = {
  hot_air_balloon: lazy(() => import('./scenes/HotAirBalloonScene')),
  ocean_deep: lazy(() => import('./scenes/OceanDeepScene')),
  redwood_tree: lazy(() => import('./scenes/RedwoodTreeScene')),
  ocean_cliff: lazy(() => import('./scenes/OceanCliffScene')),
  skyscraper: lazy(() => import('./scenes/SkyscraperScene')),
  rapunzel_tower: lazy(() => import('./scenes/RapunzelTowerScene')),
  ladder_to_the_moon: lazy(() => import('./scenes/LadderToTheMoonScene')),
  rocket_through_space: lazy(() => import('./scenes/RocketThroughSpaceScene')),
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
 * value, the shift (0 at the top end of the track, 1 at the bottom end), written
 * as each layer's own transform (sceneScroll.ts). With parallax it follows the
 * page's scroll (the track is the page's length); still (Sky decoration None, or
 * reduced motion), it shows the current step and stays. When the reader's step
 * has changed since they last saw the screen, each layer settles once from where
 * the old step put it: a transform on the layer's inner box, on top of the
 * layer's own. Decorative: hidden from screen readers. Nothing for journeys
 * without a scene.
 */
export function JourneyScene({ journey, progress, readerId, recordId, trackRef }: JourneySceneProps) {
  const config = sceneFor(journey.id);
  const Art = ART[journey.id];
  const decor = useStackDecor();
  const reduced = useReducedMotion();
  const pretendSlow = useJourneySlow();
  // This visit's cap (slow frames lower it, never back up; the setting itself is never changed).
  const [visit, setVisit] = useState<{ cap: Decor; steps: readonly SceneStep[] }>({ cap: 'full', steps: [] });
  const { level, why } = sceneLevel(decor, visit.cap, reduced);
  const motion = sceneMotion(level, reduced);
  const layerBoxes = useRef<(HTMLDivElement | null)[]>([]);
  const inners = useRef<(HTMLDivElement | null)[]>([]);
  const sampler = useRef<FrameSampler | null>(null);
  const budget = useRef<SceneBudget>(FRESH_SCENE_BUDGET);
  const openedAt = useRef(0);
  // One driver per visit: it knows whether the layers have followed the scroll yet (sceneScroll.ts).
  const [driver] = useState(() => layerDriver(browserScrollHost));

  // Slow devices (sceneBudget.ts): frames are measured only while there's something to measure
  // (scrolling, the settle, the first seconds with ambient loops), and slow ones lower the motion
  // for the rest of the visit: Full → Reduced → None. Nothing to measure at None.
  useEffect(() => {
    if (!openedAt.current) openedAt.current = performance.now();
    if (!config || level === 'none') return;
    budget.current = { ...FRESH_SCENE_BUDGET, cap: budget.current.cap };
    const s = frameSampler(browserFrameHost(), (dt) => {
      const next = sceneFrame(budget.current, dt, level, pretendSlow);
      budget.current = next;
      if (decorRank(next.cap) >= decorRank(level)) return;
      s.stop();
      const step: SceneStep = { from: level, to: next.cap, atMs: Math.round(performance.now() - openedAt.current) };
      setVisit((prev) => (decorRank(next.cap) < decorRank(prev.cap) ? { cap: minDecor(prev.cap, next.cap), steps: [...prev.steps, step] } : prev));
    });
    sampler.current = s;
    if (motion.loops) s.keepAlive(OPEN_SAMPLE_MS);
    return () => {
      s.stop();
      if (sampler.current === s) sampler.current = null;
    };
  }, [config, level, pretendSlow, motion.loops]);

  // What Developer tools shows for the last journey screen (sceneMotionDev.ts); never per frame.
  useEffect(() => {
    if (config) publishSceneMotion({ journeyId: journey.id, level, why, setting: decor, cap: visit.cap, steps: visit.steps });
  }, [config, journey.id, level, why, decor, visit]);

  // The shift, written as each layer's own transform (sceneScroll.ts): following the scroll
  // (parallax); still, the current step's place if the scene opened still, or frozen where the
  // layers were when a slow device stepped down to None (no move).
  useLayoutEffect(() => {
    if (!config) return;
    return driver.drive({
      parallax: motion.parallax,
      layers: layerBoxes.current.filter((layer): layer is HTMLDivElement => layer !== null),
      travels: SCENE_LAYERS.map((layer) => layerTravel(config, layer)),
      atStep: stepShift(progress, journey.steps, journey.direction),
      watch: trackRef.current,
      onScroll: () => sampler.current?.keepAlive(SCROLL_SAMPLE_MS),
    });
  }, [config, driver, motion.parallax, progress, journey.steps, journey.direction, trackRef]);

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
    sampler.current?.keepAlive(SETTLE_MS + SETTLE_SAMPLE_EXTRA_MS);
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
    <div className={`journey-scene journey-scene--${journey.id}${motion.loops ? ' journey-scene--loops' : ''}`} data-motion={level} aria-hidden="true">
      {SCENE_LAYERS.map((layer, i) => (
        <div
          key={layer}
          ref={(el) => {
            layerBoxes.current[i] = el;
          }}
          className={`journey-scene__layer journey-scene__layer--${layer}`}
          style={{ '--travel': `${layerTravel(config, layer)}px` } as CSSProperties}
        >
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
