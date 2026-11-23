import { describe, expect, it } from 'vitest';
import { LITE_GAP, bookViews } from '../bookViews';
import { LITE_ROW, bookShape, generateFakeStack, stackLayout } from '../stackModel';

// The book stack's per-book style lookup (src/staircase/bookViews.ts).

function pile(count: number, seed = 'seed') {
  const entries = generateFakeStack(count, seed);
  const shapes = entries.map((e) => bookShape(seed, e.step));
  const layout = stackLayout(shapes.map((s) => s.thickness));
  return { entries, shapes, layout, views: bookViews(entries, shapes, layout) };
}

describe('bookViews', () => {
  it('has one view per step, with the entry’s title and avatar', () => {
    const { entries, views } = pile(40);
    expect(views.size).toBe(40);
    for (const entry of entries) {
      const view = views.get(entry.step)!;
      expect(view.step).toBe(entry.step);
      expect(view.title).toBe(entry.title);
      expect(view.avatar).toBe(entry.avatar);
    }
    expect(views.get(0)).toBeUndefined();
    expect(views.get(41)).toBeUndefined();
  });

  it('puts the newest book at the top of the pile and each book at its layout place', () => {
    const { entries, layout, views } = pile(25);
    const newest = entries[entries.length - 1].step;
    expect(views.get(newest)!.book.top).toBe(0);
    expect(views.get(newest)!.flat.top).toBe(0);
    entries.forEach((entry, index) => {
      const row = entries.length - 1 - index;
      expect(views.get(entry.step)!.book.top).toBe(layout.tops[row]);
      expect(views.get(entry.step)!.flat.top).toBe(row * LITE_ROW);
    });
  });

  it('sizes, wobbles and colours each book from its shape and entry', () => {
    const { entries, shapes, views } = pile(10);
    const entry = entries[3];
    const { width, depth, thickness, x, z, yaw } = shapes[3];
    const view = views.get(entry.step)!;
    expect(view.book).toMatchObject({
      '--spine-hue': entry.spineHue,
      '--reader-hue': entry.readerHue,
      width,
      height: thickness,
      marginLeft: -width / 2,
      transform: `translate3d(${x}px, 0, ${z}px) rotateY(${yaw}deg)`,
    });
    expect(view.spine.transform).toBe(`translateZ(${depth / 2}px)`);
    expect(view.cover).toMatchObject({ width, height: depth, top: (thickness - depth) / 2 });
    expect(view.pages).toMatchObject({ width: depth, height: thickness, transform: `rotateY(90deg) translateZ(${width / 2}px)` });
    expect(view.flat).toMatchObject({ '--spine-hue': entry.spineHue, width, height: LITE_ROW - LITE_GAP, transform: `translateX(${x}px)` });
  });

  it('gives the same styles for the same pile', () => {
    expect([...pile(30).views.values()]).toEqual([...pile(30).views.values()]);
  });

  it('is empty for an empty pile', () => {
    expect(bookViews([], [], stackLayout([])).size).toBe(0);
  });
});
