import { useCallback, useEffect } from 'react';
import { useDataQuery, type DataStore } from '../data';
import { href, navigate } from '../router';
import { setActiveReaderId } from '../session/activeReader';
import { strings } from '../strings';

/** #/card/<token> — sign in with a library card, then go to the hub. */
export function CardLink({ token }: { token: string }) {
  const t = strings.card;
  const query = useCallback((s: DataStore) => s.getReaderByCardToken(token), [token]);
  const { data: reader, loading, error } = useDataQuery(query, ['readers']);

  useEffect(() => {
    if (reader) {
      setActiveReaderId(reader.id);
      navigate('/hub', { replace: true });
    }
  }, [reader]);

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
      <a className="btn btn--primary btn--big" href={href('/')}>
        {t.scanAgain}
      </a>
    </main>
  );
}
