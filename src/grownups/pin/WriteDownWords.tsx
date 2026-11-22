import { useEffect, useId, useState } from 'react';
import { strings } from '../../strings';

const t = strings.grownups.pin;

interface WriteDownWordsProps {
  /** The 12 household words, space-separated; null while they load. */
  words: string | null;
  onDone: () => void;
  /** The page was hidden: the words never stay on screen unattended. */
  onHidden: () => void;
}

/**
 * "Write these 12 words down": the words in a numbered grid and an "I've written them down"
 * tick before Continue. No copy, share or print (print hides .sync-secret).
 */
export function WriteDownWords({ words, onDone, onHidden }: WriteDownWordsProps) {
  const [ticked, setTicked] = useState(false);
  const tickId = useId();

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') onHidden();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHidden);
    };
  }, [onHidden]);

  return (
    <div className="stack sync-secret">
      <p className="alert" role="note">
        <span aria-hidden="true">✍️ </span>
        {t.writeDown}
      </p>
      {words === null ? (
        <p className="muted">{strings.grownups.sync.add.loading}</p>
      ) : (
        <ol className="sync-words sync-words--show" aria-label={strings.grownups.sync.add.wordsLabel}>
          {words.split(' ').map((word, i) => (
            <li key={i} className="sync-words__item">
              <span className="sync-words__word">{word}</span>
            </li>
          ))}
        </ol>
      )}
      <label className="grownups__check" htmlFor={tickId}>
        <input id={tickId} type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
        {t.writtenDown}
      </label>
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={!ticked || words === null} onClick={onDone}>
          {t.continue}
        </button>
      </div>
    </div>
  );
}
