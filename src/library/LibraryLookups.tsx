import { useCallback, useState } from 'react';
import { useDataQuery, type DataStore } from '../data';
import { fmt, strings } from '../strings';
import { fillSearchTemplate } from './searchTemplate';

/**
 * "Look it up at <library>" for a book the catalogues didn't know:
 * - a library with a search template opens its catalogue with the ISBN;
 * - a library with only a homepage opens it and copies the ISBN.
 * Renders nothing when the household has no such library.
 */
export function LibraryLookups({ store, isbn }: { store: DataStore; isbn: string }) {
  const t = strings.bookSheet;
  const query = useCallback(async (s: DataStore) => s.listLibraries((await s.getCurrentHousehold()).id), []);
  const { data: libraries = [] } = useDataQuery(store ? query : null, ['libraries']);
  const [copied, setCopied] = useState<string | null>(null);

  const usable = libraries.filter((lib) => lib.search_url_template || lib.homepage_url);
  if (usable.length === 0) return null;

  const openHomepage = async (id: string, url: string) => {
    // Open first, while the tap still counts as a user gesture.
    window.open(url, '_blank', 'noopener,noreferrer');
    try {
      await navigator.clipboard.writeText(isbn);
      setCopied(id);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="stack lookups">
      <p className="field-label">{t.lookItUpHeading}</p>
      <div className="row">
        {usable.map((lib) => {
          const searchUrl = lib.search_url_template ? fillSearchTemplate(lib.search_url_template, isbn) : null;
          if (searchUrl) {
            return (
              <a key={lib.id} className="btn btn--small" href={searchUrl} target="_blank" rel="noopener noreferrer">
                🔎 {fmt(t.lookItUp, { library: lib.name })}
              </a>
            );
          }
          if (!lib.homepage_url) return null;
          return (
            <button key={lib.id} type="button" className="btn btn--small" onClick={() => void openHomepage(lib.id, lib.homepage_url!)}>
              🔎 {fmt(t.lookItUp, { library: lib.name })}
            </button>
          );
        })}
      </div>
      <p className="small muted" role="status">
        {copied ? t.copied : ''}
      </p>
    </div>
  );
}
