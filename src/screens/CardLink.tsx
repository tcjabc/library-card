import { useCallback, useEffect } from 'react';
import { useDataQuery, type DataStore } from '../data';
import { isIosBrowserTab } from '../lib/platform';
import { href, navigate } from '../router';
import { setActiveReaderId } from '../session/activeReader';
import { signInGrownUpReader } from '../session/grownUpReader';
import { fmt, strings } from '../strings';
import { GrownUpSignIn } from './GrownUpSignIn';

/**
 * #/card/<token> — sign in with a library card, then go to the hub. A grown-up's card also
 * needs the household PIN (or the gate); cancelling goes back to the splash.
 */
export function CardLink({ token }: { token: string }) {
  const t = strings.card;
  const query = useCallback((s: DataStore) => s.getReaderByCardToken(token), [token]);
  const { data: reader, loading, error } = useDataQuery(query, ['readers']);

  const grownUp = reader?.kind === 'grown_up';

  useEffect(() => {
    if (reader && reader.kind !== 'grown_up') {
      setActiveReaderId(reader.id);
      navigate('/hub', { replace: true });
    }
  }, [reader]);

  if (reader && grownUp) {
    return (
      <main className="page page--kid gate-page">
        <h1 className="kid-title">{fmt(strings.grownUpSignIn.title, { name: reader.display_name })}</h1>
        <GrownUpSignIn
          reader={reader}
          onPass={() => {
            signInGrownUpReader(reader.id);
            navigate('/hub', { replace: true });
          }}
          onCancel={() => navigate('/', { replace: true })}
        />
      </main>
    );
  }

  if (loading || reader) {
    return (
      <main className="page page--kid center-stack">
        <p className="kid-emoji" aria-hidden="true">
          🪪
        </p>
        <p className="kid-lead">{t.checking}</p>
      </main>
    );
  }

  return (
    <main className="page page--kid center-stack">
      <p className="kid-emoji" aria-hidden="true">
        🤔
      </p>
      <h1 className="kid-title">{t.unknownTitle}</h1>
      <p className="kid-lead">{error ? t.unknownError : t.unknownBody}</p>
      {/* The installed iOS app keeps its own storage, so a card opened from the
          Camera app in Safari can't find readers made in the app. */}
      {!error && isIosBrowserTab() && (
        <p className="alert kid-lead">
          <span aria-hidden="true">📱 </span>
          {t.iosOpenApp}
        </p>
      )}
      <a className="btn btn--primary btn--big" href={href('/')}>
        {t.scanAgain}
      </a>
    </main>
  );
}
