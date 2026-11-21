import { lazy, Suspense } from 'react';
import { href, useHashPath } from './router';
import { strings } from './strings';

const DevPage = lazy(() => import('./dev/DevPage'));

export function App() {
  const path = useHashPath();

  if (path === '/dev') {
    return (
      <Suspense fallback={<p className="page muted">{strings.common.loading}</p>}>
        <DevPage />
      </Suspense>
    );
  }

  return <Landing />;
}

function Landing() {
  const t = strings.home;
  return (
    <main className="page">
      <h1>{t.title}</h1>
      <p>{t.tagline}</p>
      <p className="muted">{t.comingSoon}</p>
      <div className="row">
        <a className="btn btn--primary" href={href('/dev')}>
          {t.openDev}
        </a>
      </div>
    </main>
  );
}
