import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { requestPersistentStorage } from './lib/persist';
import './theme.css';
import './ui/base.css';

registerSW({ immediate: true });
// Keep books and cover photos even when the device runs low on space. Silent either way.
void requestPersistentStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
