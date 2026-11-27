import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getJourney } from '../../../journeys/journeys';
import { SCENE_LAYERS, layerTravel, sceneFor } from '../../../journeys/scene';
import { JourneyScene } from '../JourneyScene';
import { followScroll, placeLayers, type ScrollHost } from '../sceneScroll';

// 1.20.1: the scene's layers get their own transforms, and the frame callback only writes.
// Tests run in Node: the browser is a fake that counts every read and write.

const ROCKET = sceneFor('rocket_through_space')!;
const TRAVELS = SCENE_LAYERS.map((layer) => layerTravel(ROCKET, layer)); // 128, 384, 640

function fakeBrowser(start: { scrollTop?: number; scrollHeight: number; viewHeight: number }) {
  const state = { scrollTop: start.scrollTop ?? 0, scrollHeight: start.scrollHeight, viewHeight: start.viewHeight };
  const reads = { scrollTop: 0, scrollHeight: 0, viewHeight: 0, rect: 0 };
  const listeners = new Map<string, Set<() => void>>();
  const options = new Map<string, AddEventListenerOptions | undefined>();
  const frames = new Map<number, () => void>();
  const sizeWatchers = new Set<() => void>();
  let nextFrame = 1;
  let unobserved = 0;
  const page = {
    get scrollTop() {
      reads.scrollTop++;
      return state.scrollTop;
    },
    get scrollHeight() {
      reads.scrollHeight++;
      return state.scrollHeight;
    },
    getBoundingClientRect() {
      reads.rect++;
      return { top: 0, height: state.scrollHeight };
    },
  };
  const host: ScrollHost = {
    page,
    viewHeight: () => {
      reads.viewHeight++;
      return state.viewHeight;
    },
    addEventListener: (type, listener, opts) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
      options.set(type, opts);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    requestAnimationFrame: (callback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    observeSize: (_target, listener) => {
      sizeWatchers.add(listener);
      return () => {
        sizeWatchers.delete(listener);
        unobserved++;
      };
    },
  };
  const layers = SCENE_LAYERS.map(() => {
    let transform = '';
    const writes: string[] = [];
    return {
      writes,
      style: {
        get transform() {
          return transform;
        },
        set transform(value: string) {
          transform = value;
          writes.push(value);
        },
      },
      getBoundingClientRect() {
        reads.rect++;
        return { top: 0 };
      },
    };
  });
  const resetReads = () => Object.keys(reads).forEach((k) => (reads[k as keyof typeof reads] = 0));
  return {
    host,
    state,
    reads,
    layers,
    listeners,
    options,
    frames,
    resetReads,
    fire: (type: 'scroll' | 'resize') => listeners.get(type)?.forEach((fn) => fn()),
    resized: () => sizeWatchers.forEach((fn) => fn()),
    runFrames: () => {
      const due = [...frames.values()];
      frames.clear();
      due.forEach((fn) => fn());
      return due.length;
    },
    transforms: () => layers.map((layer) => layer.style.transform),
    sizeWatchers,
    unobserved: () => unobserved,
  };
}

const at = (...ys: number[]) => ys.map((y) => `translate3d(0, ${y}px, 0)`);
const track = {} as Element;

describe('followScroll: each layer gets its own transform from the scroll', () => {
  it('places the three layers at once: the top end of the page at 0, the bottom end at each travel', () => {
    const top = fakeBrowser({ scrollTop: 0, scrollHeight: 3000, viewHeight: 800 });
    followScroll(top.host, { layers: top.layers, travels: TRAVELS, fallback: 0.5, watch: track });
    expect(top.transforms()).toEqual(at(0, 0, 0));
    const bottom = fakeBrowser({ scrollTop: 2200, scrollHeight: 3000, viewHeight: 800 });
    followScroll(bottom.host, { layers: bottom.layers, travels: TRAVELS, fallback: 0.5, watch: track });
    expect(bottom.transforms()).toEqual(at(-128, -384, -640));
  });

  it('reads the scroll position in the scroll event; the frame callback only writes (no layout or style reads)', () => {
    const b = fakeBrowser({ scrollHeight: 3000, viewHeight: 800 });
    followScroll(b.host, { layers: b.layers, travels: TRAVELS, fallback: 0.5, watch: track });
    b.state.scrollTop = 1100;
    b.resetReads();
    for (let i = 0; i < 5; i++) b.fire('scroll');
    expect(b.reads).toEqual({ scrollTop: 5, scrollHeight: 0, viewHeight: 0, rect: 0 });
    b.resetReads();
    expect(b.runFrames()).toBe(1);
    expect(b.reads).toEqual({ scrollTop: 0, scrollHeight: 0, viewHeight: 0, rect: 0 });
    expect(b.transforms()).toEqual(at(-64, -192, -320));
  });

  it('one passive scroll listener and at most one animation frame per change', () => {
    const b = fakeBrowser({ scrollHeight: 3000, viewHeight: 800 });
    followScroll(b.host, { layers: b.layers, travels: TRAVELS, fallback: 0.5, watch: track });
    expect(b.listeners.get('scroll')?.size).toBe(1);
    expect(b.options.get('scroll')).toEqual({ passive: true });
    for (let i = 0; i < 10; i++) {
      b.state.scrollTop += 3;
      b.fire('scroll');
    }
    expect(b.frames.size).toBe(1);
  });

  it('keeps the scroll range from the last resize: the window resizing or the track changing size updates it', () => {
    const b = fakeBrowser({ scrollTop: 1100, scrollHeight: 3000, viewHeight: 800 });
    followScroll(b.host, { layers: b.layers, travels: TRAVELS, fallback: 0.5, watch: track });
    expect(b.transforms()[2]).toBe('translate3d(0, -320px, 0)'); // 1100 of 2200
    // The page grows (a row's cover loads) without a resize yet: the cached range still holds.
    b.state.scrollHeight = 5000;
    b.fire('scroll');
    b.runFrames();
    expect(b.transforms()[2]).toBe('translate3d(0, -320px, 0)');
    // The track's size change arrives: 1100 of 4200.
    b.resized();
    b.runFrames();
    expect(b.transforms()[2]).toBe('translate3d(0, -167.6px, 0)');
    // The window resizes (taller view): 1100 of 3800.
    b.state.viewHeight = 1200;
    b.fire('resize');
    b.runFrames();
    expect(b.transforms()[2]).toBe('translate3d(0, -185.3px, 0)');
  });

  it('a browser bar sliding away (the view 56 px taller, with its resize) never makes the scene jump', () => {
    for (const scrollHeight of [3000, 1400, 1250]) {
      const b = fakeBrowser({ scrollTop: 300, scrollHeight, viewHeight: 844 });
      followScroll(b.host, { layers: b.layers, travels: TRAVELS, fallback: 0.4, watch: track });
      const near = () => parseFloat(b.transforms()[2].split(', ')[1]);
      const before = near();
      b.state.viewHeight = 900;
      b.fire('resize');
      b.runFrames();
      expect(Math.abs(near() - before)).toBeLessThan(0.12 * TRAVELS[2]);
    }
  });

  it('writes a layer only when its transform changes (a fraction of a pixel of scroll writes nothing)', () => {
    const b = fakeBrowser({ scrollTop: 1100, scrollHeight: 3000, viewHeight: 800 });
    followScroll(b.host, { layers: b.layers, travels: TRAVELS, fallback: 0.5, watch: track });
    const writes = () => b.layers.reduce((n, layer) => n + layer.writes.length, 0);
    expect(writes()).toBe(3);
    b.state.scrollTop = 1100.1;
    b.fire('scroll');
    b.runFrames();
    expect(writes()).toBe(3);
    b.state.scrollTop = 1200;
    b.fire('scroll');
    b.runFrames();
    expect(writes()).toBe(6);
  });

  it('the stop removes both listeners, the track watch and a pending frame', () => {
    const b = fakeBrowser({ scrollHeight: 3000, viewHeight: 800 });
    const stop = followScroll(b.host, { layers: b.layers, travels: TRAVELS, fallback: 0.5, watch: track });
    b.fire('scroll');
    expect(b.frames.size).toBe(1);
    stop();
    expect(b.listeners.get('scroll')?.size).toBe(0);
    expect(b.listeners.get('resize')?.size).toBe(0);
    expect(b.sizeWatchers.size).toBe(0);
    expect(b.unobserved()).toBe(1);
    expect(b.frames.size).toBe(0);
  });

  it('without a track to watch, or a browser without ResizeObserver, window resizes still update the range', () => {
    const b = fakeBrowser({ scrollTop: 1100, scrollHeight: 3000, viewHeight: 800 });
    const { observeSize, ...host } = b.host;
    void observeSize;
    followScroll(host, { layers: b.layers, travels: TRAVELS, fallback: 0.5, watch: track });
    expect(b.sizeWatchers.size).toBe(0);
    b.state.scrollHeight = 5000;
    b.fire('resize');
    b.runFrames();
    expect(b.transforms()[2]).toBe('translate3d(0, -167.6px, 0)');
  });
});

describe('placeLayers: the still picture (Sky decoration None, reduced motion)', () => {
  it('writes each layer’s transform once, at the step’s shift', () => {
    const b = fakeBrowser({ scrollHeight: 3000, viewHeight: 800 });
    expect(placeLayers(b.layers, TRAVELS, 0.25)).toEqual(at(-32, -96, -160));
    expect(b.layers.map((layer) => layer.writes.length)).toEqual([1, 1, 1]);
    expect(b.reads).toEqual({ scrollTop: 0, scrollHeight: 0, viewHeight: 0, rect: 0 });
  });
});

describe('JourneyScene: the shift lives on the three layers, not on a parent the art inherits from', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  beforeAll(() => {
    // Just enough of a window to render (the reduced-motion query; no storage).
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    };
  });
  afterAll(() => {
    (globalThis as { window?: unknown }).window = realWindow;
  });

  it('renders three layer boxes and sets no --journey-shift anywhere', () => {
    const journey = getJourney('rocket_through_space')!;
    const html = renderToStaticMarkup(createElement(JourneyScene, { journey, progress: 15, readerId: 'r', recordId: 'j', trackRef: { current: null } }));
    expect(html.match(/class="journey-scene__layer journey-scene__layer--(far|mid|near)"/g)).toHaveLength(3);
    expect(html).not.toContain('--journey-shift');
    expect(html).toContain('--travel:128px');
    expect(html).toContain('--travel:640px');
  });

  it('the stylesheet moves no layer by an inherited value, and keeps each layer its own compositor layer', () => {
    const css = readFileSync(new URL('../journeyScene.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/var\(--journey-shift/);
    const layerRule = css.match(/\.journey-scene__layer \{[^}]*\}/)![0];
    expect(layerRule).toContain('will-change: transform');
    expect(layerRule).not.toMatch(/\btransform:/);
  });
});
