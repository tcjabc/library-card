import type { ResolvedJourney } from '../../journeys/resolve';
import { POSTER_ART } from '../../posters/art';
import { layoutSlots, POSTER_FRAME, POSTER_STROKES, POSTER_TYPE } from '../../posters/posterLayout';
import { fmt, strings } from '../../strings';

const t = strings.grownups.posters;
const F = POSTER_FRAME;
const T = POSTER_TYPE;

/**
 * A journey's printable poster: one A4 page of line art (black on white, in every theme), with a
 * numbered circle and a writing line per book either side of the journey's drawing. The name line
 * stays blank: the child writes it. Layout: src/posters/posterLayout.ts; art: src/posters/art.
 */
export function JourneyPoster({ journey }: { journey: ResolvedJourney }) {
  const art = POSTER_ART[journey.theme];
  const slots = layoutSlots(journey.steps, journey.direction, F);
  const left = F.margin + F.lineInset;
  const right = F.width - left;
  const down = journey.direction === 'down';
  return (
    <svg
      className="poster"
      viewBox={`0 0 ${F.width} ${F.height}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      role="img"
      aria-label={fmt(t.posterAlt, { journey: journey.title, count: journey.steps })}
    >
      <text className="poster__title" x={F.centre} y={T.titleY} textAnchor="middle" fontSize={T.titleSize}>
        {journey.title}
      </text>
      <text x={F.centre} y={T.captionY} textAnchor="middle" fontSize={T.captionSize}>
        {fmt(t.caption, { count: journey.steps })}
      </text>
      <text x={left} y={T.nameY} fontSize={T.nameSize}>
        {t.name}
      </text>
      <line x1={T.nameLineX} y1={T.nameY} x2={right} y2={T.nameY} stroke="currentColor" strokeWidth={POSTER_STROKES.line} strokeLinecap="round" />

      {art && (
        <g fill="none" stroke="currentColor" strokeWidth={POSTER_STROKES.art} strokeLinecap="round" strokeLinejoin="round">
          {art.shapes.map((shape, i) => (
            <path
              key={i}
              d={shape.d}
              className={shape.fill === 'paper' ? 'poster__paper' : undefined}
              strokeDasharray={shape.dots ? POSTER_STROKES.dots : undefined}
              strokeWidth={shape.thin ? POSTER_STROKES.artThin : undefined}
            />
          ))}
        </g>
      )}

      {slots.map((slot) => (
        <g key={slot.book}>
          <circle cx={slot.cx} cy={slot.cy} r={slot.r} fill="none" stroke="currentColor" strokeWidth={POSTER_STROKES.circle} />
          <text x={slot.cx} y={slot.cy + slot.r * T.numberDrop} textAnchor="middle" fontSize={slot.r * T.numberSize}>
            {slot.book}
          </text>
          <line x1={slot.line.x1} y1={slot.line.y} x2={slot.line.x2} y2={slot.line.y} stroke="currentColor" strokeWidth={POSTER_STROKES.line} strokeLinecap="round" />
        </g>
      ))}

      <text className="poster__end" x={F.centre} y={T.endTopY} textAnchor="middle" fontSize={T.endSize}>
        {down ? t.start : t.finish}
      </text>
      <text className="poster__end" x={F.centre} y={T.endBottomY} textAnchor="middle" fontSize={T.endSize}>
        {down ? t.finish : t.start}
      </text>
      <text x={F.centre} y={T.footerY} textAnchor="middle" fontSize={T.footerSize}>
        {t.footer}
      </text>
    </svg>
  );
}

/** One poster as an A4 sheet (the print copy and the preview). */
export function PosterSheet({ journey }: { journey: ResolvedJourney }) {
  return (
    <div className="poster-sheet">
      <JourneyPoster journey={journey} />
    </div>
  );
}
