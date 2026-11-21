import { useState } from 'react';
import { fmt, strings } from '../strings';

interface BookCoverProps {
  title: string;
  coverUrl: string | null;
}

/** Cover image with a text placeholder when there is no cover or it fails to load. */
export function BookCover({ title, coverUrl }: BookCoverProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!coverUrl || failedUrl === coverUrl) {
    return (
      <div className="cover cover--placeholder" aria-hidden="true">
        {title}
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
