/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Storage adapter: "local" (default). Future: "supabase", "d1". */
  readonly VITE_DATA_ADAPTER?: string;
  /** Public base path, e.g. "/library-card/" for GitHub Pages. Default "/". */
  readonly VITE_BASE?: string;
  /** Optional. Raises the Google Books fallback's anonymous rate limit. */
  readonly VITE_GOOGLE_BOOKS_API_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
