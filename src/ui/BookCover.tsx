import { useState } from 'react';
import { fmt, strings } from '../strings';

interface BookCoverProps {
  title: string;
  coverUrl: string | null;
}

// Placeholder colours rotate through --cover-placeholder-* tokens by title.
const PLACEHOLDER_COLOURS = 4;

function placeholderIndex(title: string): number {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(hash) % PLACEHOLDER_COLOURS) + 1;
}

/** Cover image, or a friendly coloured placeholder with the title when there's no cover or it fails to load. */
export function BookCover({ title, coverUrl }: BookCoverProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!coverUrl || failedUrl === coverUrl) {
    return (
      <div className={`cover cover--placeholder cover--tone-${placeholderIndex(title)}`} aria-hidden="true">
        <span className="cover__emoji">📖</span>
        <span className="cover__title">{title}</span>
      </div>
    );
  }
  return (
    <img
      className="cover"
      src={coverUrl}
      alt={fmt(strings.common.coverAlt, { title })}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(coverUrl)}
    />
  );
}
