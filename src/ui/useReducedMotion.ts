import { useSyncExternalStore } from 'react';

/**
 * The system's reduced-motion setting, followed live (shared; first used by the launch shelf).
 * JourneyScene, CanvasStack, FamilyStack and confetti.ts still have their own copies.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

/** Now, without React: false where the browser can't say. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
