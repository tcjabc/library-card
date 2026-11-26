import { lazy, Suspense, useEffect, useRef } from 'react';
import { GrownUpGate } from './grownups/GrownUpGate';
import { GrownUpProvider } from './grownups/GrownUpProvider';
import { endGrownUpSession, isGrownUpPath } from './grownups/session';
import { matchPath, navigate, useHashPath } from './router';
import { CardLink } from './screens/CardLink';
import { CheckReads } from './screens/CheckReads';
import { Hub } from './screens/Hub';
import { CelebrationHost } from './screens/journeys/CelebrationHost';
import { FamilyStaircase } from './screens/journeys/FamilyStaircase';
import { JourneyGallery } from './screens/journeys/JourneyGallery';
import { LibraryBooks } from './screens/library/LibraryBooks';
import { Shelf } from './screens/Shelf';
import { Splash } from './screens/Splash';
import { GrownUpReaderGuard } from './session/GrownUpReaderGuard';
import { HouseholdTimeZone } from './session/HouseholdTimeZone';
import { RequireReader } from './session/RequireReader';
import { strings } from './strings';
import { ToastProvider } from './ui/Toast';
import { UpdatingNotice } from './ui/UpdatingNotice';

const FamilyStack = lazy(() => import('./screens/journeys/FamilyStack'));
// The journey screen and its scenes load on demand (each scene its own chunk, JourneyScene.tsx).
const JourneyScreen = lazy(() => import('./screens/journeys/JourneyScreen').then((m) => ({ default: m.JourneyScreen })));
const DevPage = lazy(() => import('./dev/DevPage'));
const StackDevPage = lazy(() => import('./dev/StackDevPage'));
const GrownUpsArea = lazy(() => import('./grownups/GrownUpsArea'));

export function App() {
  return (
    <ToastProvider>
      <GrownUpProvider>
        <UpdatingNotice />
        <HouseholdTimeZone />
        <GrownUpReaderGuard />
        <Routes />
        <CelebrationHost />
      </GrownUpProvider>
    </ToastProvider>
  );
}

function Routes() {
  const path = useHashPath();

  // Each screen starts at the top, as it would on a new page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  // Leaving the grown-up area ends the grown-up session, so a child handed
  // the device back can't return to it. Watching the route (not unmounting)
  // keeps a reload inside the area from ending it.
  const previousPath = useRef(path);
  useEffect(() => {
    if (isGrownUpPath(previousPath.current) && !isGrownUpPath(path)) endGrownUpSession();
    previousPath.current = path;
  }, [path]);

  if (path === '/') return <Splash />;
  if (path === '/scan') return <Splash scanning />;

  const card = matchPath('/card/:token', path);
  if (card) return <CardLink key={card.token} token={card.token} />;

  if (path === '/grownups' || path.startsWith('/grownups/')) {
    return (
      <GrownUpGate>
        <Suspense fallback={<p className="page muted">{strings.common.loading}</p>}>
          <GrownUpsArea path={path} />
        </Suspense>
      </GrownUpGate>
    );
  }

  switch (path) {
    case '/hub':
      return <RequireReader>{(reader) => <Hub reader={reader} />}</RequireReader>;
    case '/shelf':
      return <RequireReader>{(reader) => <Shelf reader={reader} />}</RequireReader>;
    case '/library':
      return <RequireReader>{(reader) => <LibraryBooks reader={reader} />}</RequireReader>;
    case '/journeys':
      return <RequireReader>{(reader) => <JourneyGallery reader={reader} />}</RequireReader>;
    case '/journey':
      return (
        <RequireReader>
          {(reader) => (
            <Suspense fallback={<p className="page muted">{strings.common.loading}</p>}>
              <JourneyScreen reader={reader} />
            </Suspense>
          )}
        </RequireReader>
      );
    case '/check':
      return <RequireReader>{(reader) => <CheckReads reader={reader} />}</RequireReader>;
    case '/staircase':
      return (
        <RequireReader>
          {(reader) => (
            <Suspense fallback={<p className="page muted">{strings.common.loading}</p>}>
              <FamilyStack reader={reader} />
            </Suspense>
          )}
        </RequireReader>
      );
    case '/staircase/old':
      // The zig-zag staircase from before the pile, kept for comparison (developer tools link here).
      return <RequireReader>{(reader) => <FamilyStaircase reader={reader} />}</RequireReader>;
    case '/dev':
      return (
        <GrownUpGate>
          <Suspense fallback={<p className="page muted">{strings.common.loading}</p>}>
            <DevPage />
          </Suspense>
        </GrownUpGate>
      );
    case '/dev/stack':
      return (
        <GrownUpGate>
          <Suspense fallback={<p className="page muted">{strings.common.loading}</p>}>
            <StackDevPage />
          </Suspense>
        </GrownUpGate>
      );
    default:
      return <NotFound />;
  }
}

function NotFound() {
  useEffect(() => navigate('/', { replace: true }), []);
  return null;
}
