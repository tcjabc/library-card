import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { en } from './src/strings/en.ts';

// Theme colours for the web manifest. Keep in sync with --color-brand and
// --color-bg in src/theme.css (the manifest cannot read CSS variables).
const MANIFEST_THEME_COLOR = '#3b5bdb';
const MANIFEST_BACKGROUND_COLOR = '#fffaf0';

/**
 * What Settings > About shows: package.json's version, the commit (GITHUB_SHA in Actions, else
 * the local checkout, else "dev") and when this build was made (UTC).
 */
function buildInfo(): { version: string; sha: string; builtAt: string } {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      // Not a git checkout (or no git): fall through to "dev".
    }
  }
  return { version: pkg.version, sha: sha || 'dev', builtAt: new Date().toISOString() };
}

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
        // Explicit 'any' so tablets in landscape can rotate the installed app.
        orientation: 'any',
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
            // Catalogue cover images (Open Library, which redirects to
            // archive.org, and Google Books): cache-first, so a cover seen once
            // still shows offline. Capped, and cross-origin <img> responses
            // are opaque (status 0), so those are allowed. Photos taken in the
            // app live in IndexedDB, not here.
            urlPattern: ({ url }) =>
              url.hostname === 'covers.openlibrary.org' ||
              url.hostname === 'archive.org' ||
              url.hostname.endsWith('.archive.org') ||
              url.hostname === 'books.google.com' ||
              url.hostname === 'books.googleusercontent.com' ||
              url.hostname.endsWith('.googleusercontent.com'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'book-covers',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true },
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
    define: { __BUILD_INFO__: JSON.stringify(buildInfo()) },
    server: { host: mode === 'phone' ? true : undefined },
    // The oldest browsers the app supports (CSS_TARGETS). Vite's default CSS target treats
    // dvh/lvh/svh as safe and the minifier then drops the `100vh` line written before each one,
    // so Chrome 103 got no height at all (1.21.1). Kept in the build by a test (cssFallbacks).
    build: { cssTarget: CSS_TARGETS },
  };
});

/** The oldest browsers the app supports: Chrome / Edge 103 (our test tablets and emulators) and Safari 15. */
const CSS_TARGETS = ['chrome103', 'edge103', 'safari15'];

function normaliseBase(value: string): string {
  let base = value.trim();
  if (!base.startsWith('/') && !base.startsWith('.')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}
