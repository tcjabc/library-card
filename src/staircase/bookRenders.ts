/**
 * Dev measurement for the book stack prototype: how many times a book has rendered, so the
 * measurement panel can show renders per second while scrolling. A plain counter, not state,
 * so reading it never causes a render.
 */

let renders = 0;

/** Called from each book's render. */
export function countBookRender(): void {
  renders += 1;
}

/** Book renders so far on this page. */
export function bookRenders(): number {
  return renders;
}
