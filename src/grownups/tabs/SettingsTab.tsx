import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  backupFileName,
  parseBackupText,
  summariseBackup,
  type Backup,
  type BackupSummary,
} from '../../data';
import { toCalendarDate } from '../../lib/dates';
import { href, navigate } from '../../router';
import { clearActiveReader, getActiveReaderId } from '../../session/activeReader';
import { fmt, strings } from '../../strings';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { useToast } from '../../ui/Toast';
import { formatBytes, formatTimestampDate, isAppStorageKey } from '../helpers';
import { endGrownUpSession } from '../session';
import { useGrownUpSession } from '../useGrownUpSession';
import type { TabProps } from './types';

const t = strings.grownups.settings;

/** Removes this app's keys from localStorage and sessionStorage (reader, flags, pretend dates…). */
function clearAppStorage(): void {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      for (const key of Object.keys(storage)) if (isAppStorageKey(key)) storage.removeItem(key);
    } catch {
      // Storage blocked: nothing stored there to clear.
    }
  }
}

/** Grown-ups > Settings: household name, backup and restore, reset, developer tools. */
export function SettingsTab({ store, household }: TabProps) {
  const toast = useToast();
  const { runAsGrownUp } = useGrownUpSession();
  const [name, setName] = useState(household.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [lastDownload, setLastDownload] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<{ backup: Backup; incoming: BackupSummary; current: BackupSummary } | null>(null);
  const [resetting, setResetting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), file: useId() };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setNameError(t.nameRequired);
    setNameError(null);
    try {
      const next = await store.updateHousehold(household.id, { name });
      setName(next.name);
      toast({ message: t.householdSaved });
    } catch (error) {
      console.error('[settings] household name', error);
      setNameError(strings.bookSheet.saveError);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const blob = new Blob([JSON.stringify(await store.exportBackup())], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // The real date, not the developer tools' pretend one.
      link.download = backupFileName(toCalendarDate(new Date()));
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const size = formatBytes(blob.size);
      setLastDownload(fmt(t.downloaded, { size }));
      toast({ message: fmt(t.downloaded, { size }) });
    } catch (error) {
      console.error('[settings] backup failed', error);
      toast({ message: t.downloadFailed });
    } finally {
      setDownloading(false);
    }
  };

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the same file be picked again later.
    event.target.value = '';
    if (!file) return;
    setRestoreError(null);
    const check = parseBackupText(await file.text());
    if (!check.ok) {
      console.warn('[settings] not a usable backup', check.problem, check.detail);
      setRestoreError(t.restoreProblems[check.problem]);
      return;
    }
    const current = summariseBackup(await store.exportBackup());
    setRestoring({ backup: check.backup, incoming: summariseBackup(check.backup), current });
  };

  const restore = (backup: Backup) =>
    runAsGrownUp(async () => {
      await store.importBackup(backup);
      // The reader signed in here may not be in the backup.
      const active = getActiveReaderId();
      if (active && !(await store.getReader(active))) clearActiveReader();
      setRestoring(null);
      const restored = await store.getCurrentHousehold();
      setName(restored.name);
      toast({ message: t.restored });
    }, strings.gate.reasonRestore);

  const reset = () =>
    runAsGrownUp(async () => {
      await store.resetDevice();
      clearAppStorage();
      clearActiveReader();
      endGrownUpSession();
      navigate('/', { replace: true });
    }, strings.gate.reasonReset);

  const counts = (summary: BackupSummary) => fmt(t.counts, { ...summary });

  return (
    <>
      <section className="stack card">
        <form className="stack" onSubmit={(e) => void saveName(e)} noValidate>
          <label htmlFor={ids.name} className="field-label">
            {t.household}
          </label>
          <div className="row">
            <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            <button type="submit" className="btn" disabled={name.trim() === household.name}>
              {t.householdSave}
            </button>
          </div>
          {nameError && (
            <p className="alert alert--danger" role="alert">
              {nameError}
            </p>
          )}
        </form>
      </section>

      <section className="stack card">
        <h2>{t.backupHeading}</h2>
        <p>{t.backupIntro}</p>
        <p className="alert">
          <span aria-hidden="true">🔒 </span>
          {t.privacy}
        </p>
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={downloading} onClick={() => void download()}>
            ⬇️ {downloading ? t.preparing : t.download}
          </button>
          {/* The input comes first so its focus can style the label (see base.css). */}
          <input
            ref={fileInput}
            id={ids.file}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(e) => void pickFile(e)}
          />
          <label htmlFor={ids.file} className="btn">
            ⬆️ {t.restore}
          </label>
        </div>
        {lastDownload && (
          <p className="small muted" role="status">
            {lastDownload}
          </p>
        )}
        {restoreError && (
          <p className="alert alert--danger" role="alert">
            {restoreError}
          </p>
        )}
      </section>

      <section className="stack card">
        <h2>{t.resetHeading}</h2>
        <p>{t.resetIntro}</p>
        <div className="row">
          <button type="button" className="btn btn--danger" onClick={() => setResetting(true)}>
            {t.reset}
          </button>
        </div>
      </section>

      <section className="stack card">
        <h2>{t.devHeading}</h2>
        <p className="muted">{t.devIntro}</p>
        <div className="row">
          <a className="btn" href={href('/dev')}>
            🛠️ {t.devLink}
          </a>
        </div>
      </section>

      {restoring && (
        <ConfirmSheet
          title={t.restoreTitle}
          confirmLabel={t.restoreConfirm}
          danger
          errorText={t.restoreFailed}
          onClose={() => setRestoring(null)}
          onConfirm={() => restore(restoring.backup)}
        >
          <p className="field-label">{fmt(t.restoreFrom, { date: formatTimestampDate(restoring.backup.exported_at) })}</p>
          <dl className="grownups__compare">
            <dt>{t.inBackup}</dt>
            <dd>{counts(restoring.incoming)}</dd>
            <dt>{t.thisDevice}</dt>
            <dd>{counts(restoring.current)}</dd>
          </dl>
          <p className="alert">{t.restoreWarning}</p>
        </ConfirmSheet>
      )}

      {resetting && (
        <ConfirmSheet
          title={t.resetTitle}
          confirmLabel={t.resetConfirm}
          danger
          typeToConfirm={t.resetWord}
          onClose={() => setResetting(false)}
          onConfirm={reset}
        >
          <p>{t.resetBody}</p>
        </ConfirmSheet>
      )}
    </>
  );
}
