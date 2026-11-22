import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCardToken } from '../cards/cardUrl';
import { HOUSEHOLD_ID, useDataQuery, type DataStore } from '../data';
import { href, navigate, useHashQuery } from '../router';
import { Scanner, type ScanResult } from '../scan/Scanner';
import { setActiveReaderId } from '../session/activeReader';
import { looksLikePairingCode } from '../sync/pairingCode';
import { fmt, strings } from '../strings';
import { splashTiles, type SplashTile } from './splashTiles';

const NOTICE_MS = 3500;

/**
 * #/ — the big "Scan your library card!" button and a tile for each reader.
 * #/scan — the card scanner (from the button, or a child's tile: #/scan?reader=<id>).
 * Any valid card signs in as that card's reader, whoever's tile was tapped.
 */
export function Splash({ scanning = false }: { scanning?: boolean }) {
  return scanning ? <CardScanner /> : <ReaderPicker />;
}

function ReaderPicker() {
  const t = strings.splash;
  // Under sync, readers hidden by a card-token clash aren't in the list (as everywhere).
  const query = useCallback((s: DataStore) => s.listReaders(HOUSEHOLD_ID), []);
  const { data: readers } = useDataQuery(query, ['readers']);
  const tiles = splashTiles(readers ?? []);

  const open = (tile: SplashTile) => {
    if (tile.signIn === 'tap') {
      // A grown-up: no card, no gate.
      setActiveReaderId(tile.reader.id);
      navigate('/hub');
    } else {
      navigate(`/scan?reader=${encodeURIComponent(tile.reader.id)}`);
    }
  };

  return (
    <main className="page page--kid splash">
      <header className="splash__header">
        <p className="splash__emoji" aria-hidden="true">
          📚
        </p>
        <h1 className="visually-hidden">{strings.app.name}</h1>
      </header>
      <a className="btn btn--primary btn--big splash__scan" href={href('/scan')}>
        <span aria-hidden="true">🪪</span> {t.title}
      </a>
      {tiles.length > 0 && (
        <section className="stack" aria-labelledby="splash-readers">
          <h2 className="splash__who" id="splash-readers">
            {t.whoIsReading}
          </h2>
          <ul className="reader-tiles">
            {tiles.map((tile) => (
              <li key={tile.reader.id}>
                <button
                  type="button"
                  className="reader-tile"
                  aria-label={fmt(tile.signIn === 'card' ? t.tileCard : t.tileOpen, { name: tile.reader.display_name })}
                  onClick={() => open(tile)}
                >
                  <span className="reader-tile__avatar" aria-hidden="true">
                    {tile.reader.avatar}
                    {tile.signIn === 'card' && <span className="reader-tile__badge">💳</span>}
                  </span>
                  <span className="reader-tile__name" aria-hidden="true">
                    {tile.reader.display_name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="splash__footer">
        <a className="link-quiet" href={href('/grownups')}>
          {t.grownUps}
        </a>
      </footer>
    </main>
  );
}

function CardScanner() {
  const t = strings.splash;
  const readerId = useHashQuery().get('reader');
  const query = useCallback((s: DataStore) => (readerId ? s.getReader(readerId) : Promise.resolve(null)), [readerId]);
  const { data: forReader } = useDataQuery(query, ['readers']);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onResult = useCallback(
    ({ value }: ScanResult) => {
      const token = parseCardToken(value);
      if (token) {
        navigate(`/card/${encodeURIComponent(token)}`);
        return;
      }
      // A sync pairing code (12 words) is for grown-ups; keep scanning for a card.
      setNotice(looksLikePairingCode(value) ? t.grownUpCode : t.notACard);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
    },
    [t.notACard, t.grownUpCode],
  );

  return (
    <main className="page page--kid splash">
      <header className="splash__header">
        <p className="splash__emoji" aria-hidden="true">
          {forReader?.avatar ?? '📚'}
        </p>
        <h1 className="kid-title">{forReader ? t.scanYourCard : t.title}</h1>
      </header>
      <Scanner formats="qr_code" camera="card" hint={t.cardGuide} onResult={onResult} notice={notice} className="splash__scanner" />
      <footer className="splash__footer">
        <button type="button" className="btn btn--quiet back-link" onClick={() => navigate('/', { replace: true })}>
          <span aria-hidden="true">←</span> {t.back}
        </button>
      </footer>
    </main>
  );
}
