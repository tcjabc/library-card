import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCardToken } from '../cards/cardUrl';
import { href, navigate } from '../router';
import { Scanner, type ScanResult } from '../scan/Scanner';
import { strings } from '../strings';

const NOTICE_MS = 3500;

/** #/ — "Scan your library card!" */
export function Splash() {
  const t = strings.splash;
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onResult = useCallback(({ value }: ScanResult) => {
    const token = parseCardToken(value);
    if (token) {
      navigate(`/card/${encodeURIComponent(token)}`);
      return;
    }
    setNotice(t.notACard);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, [t.notACard]);

  return (
    <main className="page page--kid splash">
      <header className="splash__header">
        <p className="splash__emoji" aria-hidden="true">
          📚
        </p>
        <h1 className="kid-title">{t.title}</h1>
      </header>
      <Scanner
        formats="qr_code"
        camera="card"
        hint={t.cardGuide}
        onResult={onResult}
        notice={notice}
        className="splash__scanner"
      />
      <footer className="splash__footer">
        <a className="link-quiet" href={href('/grownups')}>
          {t.grownUps}
        </a>
      </footer>
    </main>
  );
}
