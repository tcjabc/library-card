import { useEffect } from 'react';
import { useDataQuery, type DataStore } from '../data';
import { href, navigate } from '../router';
import { getActiveReaderId } from '../session/activeReader';
import { fmt, strings } from '../strings';
import { GROWN_UP_TABS, parseGrownUpsPath, tabPath, type GrownUpTab } from './helpers';
import { SYNC_ENABLED } from '../sync/app';
import { PinGuardProvider } from './pin/PinGuardProvider';
import { endGrownUpSession } from './session';
import { SyncIndicator } from './sync/SyncIndicator';
import { BooksTab } from './tabs/BooksTab';
import { CardsTab } from './tabs/CardsTab';
import { LibrariesTab } from './tabs/LibrariesTab';
import { LoansTab } from './tabs/LoansTab';
import { ReadersTab } from './tabs/ReadersTab';
import { SettingsTab } from './tabs/SettingsTab';
import type { TabProps } from './tabs/types';
import './grownups.css';

const TAB_ICONS: Record<GrownUpTab, string> = {
  books: '📚',
  readers: '🧒',
  libraries: '🏛️',
  loans: '🔖',
  cards: '🪪',
  settings: '⚙️',
};

const householdQuery = (s: DataStore) => s.getCurrentHousehold();

/**
 * #/grownups/<tab> — the grown-up area, behind the ParentGate (see App).
 * Each tab has its own hash, so the back button moves between tabs; leaving
 * the area (back past the first tab, or "Back to readers") ends the session.
 */
export default function GrownUpsArea({ path }: { path: string }) {
  const t = strings.grownups;
  const tab = parseGrownUpsPath(path);
  const { data: household, store, error } = useDataQuery(householdQuery, ['households']);

  // The bare #/grownups (and an unknown tab) opens Books.
  useEffect(() => {
    if (!tab) navigate(tabPath('books'), { replace: true });
  }, [tab]);

  const backToReaders = () => {
    endGrownUpSession();
    navigate(getActiveReaderId() ? '/hub' : '/');
  };

  return (
    <div className="grownups">
      <header className="grownups__header">
        <div className="grownups__title">
          <h1>{t.title}</h1>
          {household && <p className="muted small">{household.name}</p>}
        </div>
        {SYNC_ENABLED && <SyncIndicator />}
        <button type="button" className="btn btn--accent" onClick={backToReaders}>
          <span aria-hidden="true">←</span> {t.backToReaders}
        </button>
      </header>

      <nav className="grownups__tabs" aria-label={t.navLabel}>
        {GROWN_UP_TABS.map((id) => (
          <a key={id} className="grownups__tab" href={href(tabPath(id))} aria-current={id === tab ? 'page' : undefined}>
            <span className="grownups__tab-icon" aria-hidden="true">
              {TAB_ICONS[id]}
            </span>
            <span className="grownups__tab-label">{t.tabs[id]}</span>
          </a>
        ))}
      </nav>

      <main className="grownups__main">
        {error && (
          <p className="alert alert--danger" role="alert">
            {fmt(t.storageError, { message: error.message })}
          </p>
        )}
        {store && household && tab && (
          <PinGuardProvider store={store} household={household}>
            <TabContent tab={tab} store={store} household={household} />
          </PinGuardProvider>
        )}
      </main>
    </div>
  );
}

function TabContent({ tab, ...props }: TabProps & { tab: GrownUpTab }) {
  switch (tab) {
    case 'books':
      return <BooksTab {...props} />;
    case 'readers':
      return <ReadersTab {...props} />;
    case 'libraries':
      return <LibrariesTab {...props} />;
    case 'loans':
      return <LoansTab {...props} />;
    case 'cards':
      return <CardsTab {...props} />;
    case 'settings':
      return <SettingsTab {...props} />;
  }
}
