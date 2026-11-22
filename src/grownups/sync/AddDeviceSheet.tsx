import { useEffect, useId, useState } from 'react';
import { strings } from '../../strings';
import { Sheet } from '../../ui/Sheet';
import { useQrDataUrl } from '../../ui/useQrDataUrl';

const t = strings.grownups.sync.add;

interface AddDeviceSheetProps {
  /** The 12 household words, space-separated; null while they load. */
  words: string | null;
  /** Just started syncing: ask the grown-up to write the words down (a tick before Continue). */
  writeDown?: boolean;
  onClose: () => void;
}

/**
 * "Add a device": the household words as a QR code (the words only) and in a
 * numbered grid, with the risk spelled out. Closes when the page is hidden
 * (another app, a screenshot tool, the tab switched), so the words never stay
 * on screen unattended. No copy, share or print: print hides it (CSS).
 */
export function AddDeviceSheet({ words, writeDown = false, onClose }: AddDeviceSheetProps) {
  const qr = useQrDataUrl(words);
  const [ticked, setTicked] = useState(false);
  const tickId = useId();
  const p = strings.grownups.pin;

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') onClose();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onClose);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onClose);
    };
  }, [onClose]);

  return (
    <Sheet title={t.title} onClose={onClose}>
      <div className="stack sync-secret">
        {writeDown && (
          <p className="alert" role="note">
            <span aria-hidden="true">✍️ </span>
            {p.writeDown}
          </p>
        )}
        <p>{t.intro}</p>
        <p className="alert alert--danger" role="note">
          <span aria-hidden="true">⚠️ </span>
          {t.risk}
        </p>
        {words === null ? (
          <p className="muted">{t.loading}</p>
        ) : (
          <>
            <div className="sync-qr">{qr && <img src={qr} alt={t.qrAlt} className="sync-qr__img" draggable={false} />}</div>
            <ol className="sync-words sync-words--show" aria-label={t.wordsLabel}>
              {words.split(' ').map((word, i) => (
                <li key={i} className="sync-words__item">
                  <span className="sync-words__word">{word}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {writeDown && (
          <label className="grownups__check" htmlFor={tickId}>
            <input id={tickId} type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            {p.writtenDown}
          </label>
        )}
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={writeDown && (!ticked || words === null)} onClick={onClose}>
            {writeDown ? p.continue : t.done}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
