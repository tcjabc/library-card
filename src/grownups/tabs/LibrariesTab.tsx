import { useCallback, useId, useState, type FormEvent } from 'react';
import { DEFAULT_LOAN_DAYS, useDataQuery, type DataStore, type Household, type Library } from '../../data';
import { useGrownUpSession } from '../useGrownUpSession';
import { SAMPLE_ISBN, asWebUrl, fillSearchTemplate, searchTemplateFromUrl } from '../../library/searchTemplate';
import { stickerPrefix } from '../../library/sticker';
import { BookScanner } from '../../scan/BookScanner';
import { fmt, strings } from '../../strings';
import { Sheet } from '../../ui/Sheet';
import type { TabProps } from './types';
import { useToast } from '../../ui/Toast';

const t = strings.grownups.libraries;

/** Grown-ups > Libraries: the places loans come from. */
export function LibrariesTab({ store, household }: TabProps) {
  const toast = useToast();
  const { requireGrownUp } = useGrownUpSession();
  const [editing, setEditing] = useState<Library | 'new' | null>(null);
  const query = useCallback((s: DataStore) => s.listLibraries(household.id), [household.id]);
  const { data: libraries = [] } = useDataQuery(query, ['libraries']);

  const remove = (lib: Library) =>
    requireGrownUp(async () => {
      await store.deleteLibrary(lib.id);
      toast({ message: fmt(t.deleted, { name: lib.name }) });
    }, strings.gate.reasonDeleteLibrary);

  return (
    <section className="stack card">
      <h2>{t.heading}</h2>
      {libraries.length === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <ul className="dev-list">
          {libraries.map((lib) => (
            <li key={lib.id} className="dev-list__row">
              <div className="stack">
                <p className="reader-row__name">{lib.name}</p>
                <p className="small muted">
                  {fmt(t.loanDays, { days: lib.default_loan_days })}
                  {lib.sticker_prefix ? ` · ${fmt(t.prefixShown, { prefix: lib.sticker_prefix })}` : ''}
                  {lib.search_url_template ? ` · ${t.hasSearch}` : lib.homepage_url ? ` · ${t.hasHomepage}` : ''}
                </p>
              </div>
              <div className="row">
                <button type="button" className="btn btn--small" onClick={() => setEditing(lib)}>
                  {t.edit}
                </button>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => remove(lib)}>
                  {t.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
          {t.add}
        </button>
      </div>
      {editing && (
        <LibraryForm
          key={editing === 'new' ? 'new' : editing.id}
          store={store}
          household={household}
          library={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function LibraryForm({
  store,
  household,
  library,
  onClose,
}: {
  store: DataStore;
  household: Household;
  library: Library | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(library?.name ?? '');
  const [days, setDays] = useState(String(library?.default_loan_days ?? DEFAULT_LOAN_DAYS));
  const [prefix, setPrefix] = useState(library?.sticker_prefix ?? '');
  const [pasted, setPasted] = useState('');
  const [template, setTemplate] = useState(library?.search_url_template ?? '');
  const [homepage, setHomepage] = useState(library?.homepage_url ?? '');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), days: useId(), prefix: useId(), url: useId(), homepage: useId() };

  const detected = pasted.trim() ? searchTemplateFromUrl(pasted) : null;
  const pastedIsUrl = !!asWebUrl(pasted);
  const testUrl = template ? fillSearchTemplate(template, SAMPLE_ISBN) : null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const loanDays = Number(days);
    if (!name.trim()) return setError(t.nameRequired);
    if (!Number.isInteger(loanDays) || loanDays < 1) return setError(t.daysInvalid);
    if (homepage.trim() && !asWebUrl(homepage)) return setError(t.homepageInvalid);
    const fields = {
      name: name.trim(),
      default_loan_days: loanDays,
      sticker_prefix: prefix.trim() || null,
      search_url_template: template.trim() || null,
      homepage_url: homepage.trim() || null,
    };
    try {
      if (library) await store.updateLibrary(library.id, fields);
      else await store.createLibrary({ household_id: household.id, ...fields });
      toast({ message: fmt(t.saved, { name: fields.name }) });
      onClose();
    } catch (err) {
      console.error('[libraries] save failed', err);
      setError(strings.bookSheet.saveError);
    }
  };

  return (
    <Sheet title={library ? t.editTitle : t.addTitle} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)} noValidate>
        <label htmlFor={ids.name} className="field-label">
          {t.name}
        </label>
        <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder={t.namePlaceholder} />

        <label htmlFor={ids.days} className="field-label">
          {t.days}
        </label>
        <input id={ids.days} className="input input--short" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />

        <label htmlFor={ids.prefix} className="field-label">
          {t.prefix}
        </label>
        <div className="row">
          <input id={ids.prefix} className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} autoComplete="off" />
          <button type="button" className="btn" onClick={() => setScanning((v) => !v)}>
            🏷️ {scanning ? t.stopScan : t.scanSticker}
          </button>
        </div>
        <p className="small muted">{t.prefixHelp}</p>
        {scanning && (
          <BookScanner
            mode="sticker"
            onSticker={(value) => {
              setPrefix(stickerPrefix(value));
              setScanning(false);
            }}
          />
        )}

        <label htmlFor={ids.url} className="field-label">
          {t.searchUrl}
        </label>
        <input
          id={ids.url}
          className="input"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          inputMode="url"
          autoComplete="off"
          placeholder={t.searchUrlPlaceholder}
        />
        <p className="small muted">{t.searchUrlHelp}</p>
        {pasted.trim() && detected && (
          <div className="alert stack">
            <p className="small">{fmt(t.detected, { isbn: detected.found })}</p>
            <code className="template">{detected.template}</code>
            <div className="row">
              <button type="button" className="btn btn--small btn--primary" onClick={() => setTemplate(detected.template)}>
                {t.useTemplate}
              </button>
            </div>
          </div>
        )}
        {pasted.trim() && !detected && (
          <div className="alert stack">
            <p className="small">{pastedIsUrl ? t.noIsbnFound : t.notAUrl}</p>
            {pastedIsUrl && (
              <div className="row">
                <button type="button" className="btn btn--small" onClick={() => setHomepage(pasted.trim())}>
                  {t.useAsHomepage}
                </button>
              </div>
            )}
          </div>
        )}

        {template && (
          <div className="stack">
            <p className="field-label">{t.template}</p>
            <code className="template">{template}</code>
            <div className="row">
              {testUrl && (
                <a className="btn btn--small" href={testUrl} target="_blank" rel="noopener noreferrer">
                  {t.testIt}
                </a>
              )}
              <button type="button" className="btn btn--small btn--quiet" onClick={() => setTemplate('')}>
                {t.removeTemplate}
              </button>
            </div>
          </div>
        )}

        <label htmlFor={ids.homepage} className="field-label">
          {t.homepage}
        </label>
        <input
          id={ids.homepage}
          className="input"
          value={homepage}
          onChange={(e) => setHomepage(e.target.value)}
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
        />

        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary">
            {strings.bookSheet.save}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {strings.common.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
