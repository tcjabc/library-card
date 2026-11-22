import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { requestPersistentStorage } from './lib/persist';
import { getSyncService, SYNC_ENABLED } from './sync/app';
import './theme.css';
import './ui/base.css';

registerSW({ immediate: true });
// Keep books and cover photos even when the device runs low on space. Silent either way.
void requestPersistentStorage();
// Sync runs whenever the app is open (only in builds with the sync adapter and a relay).
if (SYNC_ENABLED) void getSyncService();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
