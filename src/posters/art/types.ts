/**
 * A poster's line drawing: outlines only, in the poster's units (src/posters/posterLayout.ts),
 * inside the art band (y 215-1012) and within 66 units of the centre line (x 397).
 *
 * Path data uses absolute M, L, H, V, C, Q, A and Z only (a test reads the bounds); fit.ts writes
 * drawings from the design canvas in that form. No text and no colour: JourneyPoster.tsx draws
 * every shape in the poster ink at the art line weight (or the thin one).
 */
export interface PosterShape {
  d: string;
  /** Filled with paper white, to hide lines behind it (e.g. a rocket body over its fins). Never a colour. */
  fill?: 'paper';
  /** A dotted line (round dots), e.g. a trail. */
  dots?: boolean;
  /** The thinner art line (1.5 units, 0.4 mm), for fine detail such as brick courses. */
  thin?: boolean;
}

export interface PosterArt {
  /** Drawn in order: later shapes sit on top. */
  shapes: readonly PosterShape[];
}
