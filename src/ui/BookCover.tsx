import { useState } from 'react';
import { fmt, strings } from '../strings';

/**
 * - "frame": the cover fills a 2:3 frame, cropped to fit (grown-up screens, journeys, sheets).
 * - "whole": the whole cover, uncropped at its own shape, scaled to fit a 2:3 area and standing on
 *   its bottom edge, centred, like a book on a shelf (the My Bookshelf and Library Books grids).
 * - "row": a small whole cover at a fixed height and its own width (the List rows).
 */
export type CoverFit = 'frame' | 'whole' | 'row';

interface BookCoverProps {
  title: string;
  coverUrl: string | null;
  /** Picks the placeholder colour (default: the title). The kids' grid and list use the ISBN. */
  seed?: string;
  fit?: CoverFit;
}

// Placeholder colours rotate through --cover-placeholder-* tokens by seed.
const PLACEHOLDER_COLOURS = 4;
/** The cover area's shape (width / height), as --cover-aspect. */
const AREA_RATIO = 2 / 3;

function placeholderIndex(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(hash) % PLACEHOLDER_COLOURS) + 1;
}

/** Cover image, or a friendly coloured placeholder with the title when there's no cover or it fails to load. */
export function BookCover({ title, coverUrl, seed, fit = 'frame' }: BookCoverProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // Wider than the area (by its own shape, once loaded): it fits the width instead of the height.
  const [wideUrl, setWideUrl] = useState<string | null>(null);
  const tone = `cover--tone-${placeholderIndex(seed ?? title)}`;

  if (!coverUrl || failedUrl === coverUrl) {
    if (fit === 'row') {
      return (
        <div className={`cover cover--placeholder cover-row ${tone}`} aria-hidden="true">
          <span className="cover__emoji">📖</span>
        </div>
      );
    }
    // In the grid: a coloured card the size of the cover area, with the title in big text.
    const big = fit === 'whole';
    const card = (
      <div className={`cover cover--placeholder ${tone}${big ? ' cover--big' : ''}`} aria-hidden="true">
        {!big && <span className="cover__emoji">📖</span>}
        <span className="cover__title">{title}</span>
      </div>
    );
    return big ? <div className="cover-whole">{card}</div> : card;
  }

  const img = (className: string) => (
    <img
      className={className}
      src={coverUrl}
      alt={fmt(strings.common.coverAlt, { title })}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={
        fit === 'whole'
          ? (e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (w > 0 && h > 0 && w / h > AREA_RATIO) setWideUrl(coverUrl);
            }
          : undefined
      }
      onError={() => setFailedUrl(coverUrl)}
    />
  );

  if (fit === 'whole') return <div className="cover-whole">{img(`cover-whole__img${wideUrl === coverUrl ? ' cover-whole__img--wide' : ''}`)}</div>;
  if (fit === 'row') return img('cover-row');
  return img('cover');
}
