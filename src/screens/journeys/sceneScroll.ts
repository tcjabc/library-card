import { layerOffset, layerTransform, scrollShift } from '../../journeys/scene';

/**
 * Moving a journey scene's layers with the page's scroll (JourneyScene.tsx, docs/journeys.md),
 * written so each scroll frame costs as little as possible:
 *
 * - Each layer gets its own transform (translate3d, rounded to 0.1 px). Nothing is set on the
 *   scene's root, so the art inside the layers is never restyled while scrolling (an inherited
 *   custom property on the root restyled every element of the scene on every frame).
 * - The scroll position is read in the scroll event, and the page's scroll range and the view's
 *   height are kept from the last resize (the window's, or the track's through a ResizeObserver),
 *   so the animation-frame callback only writes: no layout or style reads in it.
 * - One passive scroll listener, at most one animation frame per change, and a layer is only
 *   written when its transform changes.
 *
 * The browser is passed in (`ScrollHost`), so this runs unchanged in the unit tests.
 */

/** What the scene's scrolling needs from the browser. */
export interface ScrollHost {
  /** The page's scrolling element (document.scrollingElement). */
  readonly page: { readonly scrollTop: number; readonly scrollHeight: number };
  /** The view's height (window.innerHeight). */
  viewHeight(): number;
  addEventListener(type: 'scroll' | 'resize', listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: 'scroll' | 'resize', listener: () => void): void;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
  /** Calls `listener` when `target` changes size (a ResizeObserver); returns the stop. Absent: only window resizes count. */
  observeSize?: (target: Element, listener: () => void) => () => void;
}

/** A layer element: only its inline transform is ever touched. */
export interface LayerTarget {
  readonly style: { transform: string };
}

/** Places each layer at `shift` (0–1): layer i moves up by shift × travels[i]. Returns the transforms written. */
export function placeLayers(layers: readonly LayerTarget[], travels: readonly number[], shift: number): string[] {
  return layers.map((layer, i) => {
    const transform = layerTransform(layerOffset(shift, travels[i] ?? 0));
    layer.style.transform = transform;
    return transform;
  });
}

export interface FollowScrollOptions {
  layers: readonly LayerTarget[];
  /** Each layer's travel (px), in the same order. */
  travels: readonly number[];
  /** The shift at the reader's step, for a page that can barely scroll (scrollShift's fallback). */
  fallback: number;
  /** An element whose size changes the page's scroll range (the track); watched when the host can. */
  watch?: Element | null;
}

/** Follows the page's scroll until the returned stop is called. Places the layers at once. */
export function followScroll(host: ScrollHost, { layers, travels, fallback, watch }: FollowScrollOptions): () => void {
  let scrollTop = 0;
  let range = 0;
  let view = 0;
  let frame = 0;
  const written: string[] = [];

  // The reads: on mount, in the scroll event and on resize, never in the frame callback.
  const measure = () => {
    view = host.viewHeight();
    range = host.page.scrollHeight - view;
    scrollTop = host.page.scrollTop;
  };
  const write = () => {
    frame = 0;
    const shift = scrollShift(scrollTop, range, view, fallback);
    layers.forEach((layer, i) => {
      const transform = layerTransform(layerOffset(shift, travels[i] ?? 0));
      if (written[i] === transform) return;
      layer.style.transform = transform;
      written[i] = transform;
    });
  };
  const later = () => {
    if (!frame) frame = host.requestAnimationFrame(write);
  };
  const onScroll = () => {
    scrollTop = host.page.scrollTop;
    later();
  };
  const onResize = () => {
    measure();
    later();
  };

  measure();
  write();
  host.addEventListener('scroll', onScroll, { passive: true });
  host.addEventListener('resize', onResize);
  const unobserve = watch && host.observeSize ? host.observeSize(watch, onResize) : undefined;
  return () => {
    host.removeEventListener('scroll', onScroll);
    host.removeEventListener('resize', onResize);
    unobserve?.();
    if (frame) host.cancelAnimationFrame(frame);
    frame = 0;
  };
}

/** The real browser as a ScrollHost (the window, the document's scrolling element, ResizeObserver). */
export function browserScrollHost(): ScrollHost {
  const page = document.scrollingElement ?? document.documentElement;
  return {
    page,
    viewHeight: () => window.innerHeight,
    addEventListener: (type, listener, options) => window.addEventListener(type, listener, options),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    observeSize:
      typeof ResizeObserver === 'function'
        ? (target, listener) => {
            const observer = new ResizeObserver(() => listener());
            observer.observe(target);
            return () => observer.disconnect();
          }
        : undefined,
  };
}
