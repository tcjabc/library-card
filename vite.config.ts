import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { en } from './src/strings/en.ts';

// Theme colours for the web manifest. Keep in sync with --color-brand and
// --color-bg in src/theme.css (the manifest cannot read CSS variables).
const MANIFEST_THEME_COLOR = '#3b5bdb';
const MANIFEST_BACKGROUND_COLOR = '#fffaf0';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = normaliseBase(env.VITE_BASE || '/');

  const plugins: PluginOption[] = [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: en.app.name,
        short_name: en.app.shortName,
        description: en.app.description,
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: MANIFEST_THEME_COLOR,
        background_color: MANIFEST_BACKGROUND_COLOR,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // registerType 'autoUpdate' only implies these when injectRegister is
        // 'auto'. We register manually (main.tsx), so set them explicitly or a
        // new version waits until every app window is closed.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The ZXing WASM (~1 MB) is precached so scanning works offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Book covers: cache-first, they never change for a given ISBN.
            urlPattern: ({ url }) =>
              url.hostname === 'covers.openlibrary.org' ||
              url.hostname === 'books.google.com' ||
              url.hostname.endsWith('.googleusercontent.com') ||
              url.hostname === 'archive.org' ||
              url.hostname.endsWith('.archive.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'book-covers',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ];

  // `npm run dev:phone` serves over self-signed HTTPS on the LAN, because
  // phone browsers only allow camera access from secure origins.
  if (mode === 'phone') plugins.push(basicSsl());

  return {
    base,
    plugins,
    server: { host: mode === 'phone' ? true : undefined },
  };
});

function normaliseBase(value: string): string {
  let base = value.trim();
  if (!base.startsWith('/') && !base.startsWith('.')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}
