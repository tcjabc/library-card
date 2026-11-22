/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Storage adapter: "local" (default). Future: "supabase", "d1". */
  readonly VITE_DATA_ADAPTER?: string;
  /** Public base path, e.g. "/library-card/" for GitHub Pages. Default "/". */
  readonly VITE_BASE?: string;
  /** Optional. Raises the Google Books fallback's anonymous rate limit. */
  readonly VITE_GOOGLE_BOOKS_API_KEY?: string;
  /** The sync relay's base URL (https://…, or http://localhost:… in development). Unset: no sync. */
  readonly VITE_SYNC_RELAY_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

/** Injected by vite.config.ts at build time (Settings > About). */
declare const __BUILD_INFO__: {
  /** package.json version, e.g. "1.0.0". */
  readonly version: string;
  /** Short commit SHA, or "dev" when it isn't known. */
  readonly sha: string;
  /** When the build was made, UTC ISO. */
  readonly builtAt: string;
};

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
