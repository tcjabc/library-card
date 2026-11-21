import { lazy, Suspense, useEffect } from 'react';
import { matchPath, navigate, useHashPath } from './router';
import { CardLink } from './screens/CardLink';
import { ComingSoon, StaircaseSoon } from './screens/ComingSoon';
import { Hub } from './screens/Hub';
import { Shelf } from './screens/Shelf';
import { Splash } from './screens/Splash';
import { RequireReader } from './session/RequireReader';
import { strings } from './strings';
import { ToastProvider } from './ui/Toast';

const DevPage = lazy(() => import('./dev/DevPage'));

export function App() {
  return (
    <ToastProvider>
      <Routes />
    </ToastProvider>
  );
}

function Routes() {
  const path = useHashPath();

  // Each screen starts at the top, as it would on a new page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  if (path === '/') return <Splash />;

  const card = matchPath('/card/:token', path);
  if (card) return <CardLink key={card.token} token={card.token} />;

  switch (path) {
    case '/hub':
      return <RequireReader>{(reader) => <Hub reader={reader} />}</RequireReader>;
    case '/shelf':
      return <RequireReader>{(reader) => <Shelf reader={reader} />}</RequireReader>;
    case '/library':
      return <RequireReader>{() => <ComingSoon title={strings.hub.library} emoji="🏛️" />}</RequireReader>;
    case '/journey':
      return <RequireReader>{() => <ComingSoon title={strings.hub.journey} emoji="🗺️" />}</RequireReader>;
    case '/staircase':
      return <RequireReader>{(reader) => <StaircaseSoon reader={reader} />}</RequireReader>;
    case '/dev':
      return (
        <Suspense fallback={<p className="page muted">{strings.common.loading}</p>}>
          <DevPage />
        </Suspense>
      );
    default:
      return <NotFound />;
  }
}

function NotFound() {
  useEffect(() => navigate('/', { replace: true }), []);
  return null;
}
