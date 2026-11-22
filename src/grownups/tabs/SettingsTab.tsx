import { lazy, Suspense, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  backupFileName,
  parseBackupText,
  summariseBackup,
  type Backup,
  type BackupSummary,
} from '../../data';
import { markAllCompletionsCelebrated } from '../../journeys/celebration';
import { toCalendarDate } from '../../lib/dates';
import { deviceTimeZone, isTimeZone, listTimeZones } from '../../lib/timezone';
import { href, navigate } from '../../router';
import { clearActiveReader, getActiveReaderId } from '../../session/activeReader';
import { fmt, strings } from '../../strings';
import { SYNC_ENABLED } from '../../sync/app';
import { useSync } from '../../sync/useSync';
import { ChoiceButton } from '../../ui/ChoiceButton';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { formatBytes, formatTimestampDate, isAppStorageKey } from '../helpers';
import { endGrownUpSession } from '../session';
import { HouseholdPinSection } from '../pin/HouseholdPinSection';
import { usePinGuard } from '../pin/pinGuardContext';
import type { TabProps } from './types';

const t = strings.grownups.settings;
const ts = strings.grownups.sync;

// Only builds with sync load the sync screens (and the engine behind them).
const SyncSection = lazy(() => import('../sync/SyncSection'));

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
  const pin = usePinGuard();
  const [name, setName] = useState(household.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const device = deviceTimeZone();
  const [zone, setZone] = useState(household.time_zone ?? device);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const zones = useMemo(() => listTimeZones(), []);
  const [downloading, setDownloading] = useState(false);
  const [lastDownload, setLastDownload] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<{ backup: Backup; incoming: BackupSummary; current: BackupSummary } | null>(null);
  const [resetting, setResetting] = useState(false);
  const { service: sync, status: syncStatus } = useSync();
  // On, or removed but not yet turned off: restoring or resetting must leave the household first.
  const syncOn = Boolean(sync && syncStatus && syncStatus.state !== 'off');
  const [syncRestoreBusy, setSyncRestoreBusy] = useState(false);
  const [syncRestoreError, setSyncRestoreError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), file: useId(), zone: useId(), zones: useId() };

  const saveZone = async (event: FormEvent) => {
    event.preventDefault();
    const value = zone.trim();
    if (!isTimeZone(value)) return setZoneError(t.timeZoneInvalid);
    setZoneError(null);
    try {
      await store.updateHousehold(household.id, { time_zone: value });
      toast({ message: t.timeZoneSaved });
    } catch (error) {
      console.error('[settings] time zone', error);
      setZoneError(strings.bookSheet.saveError);
    }
  };

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
    // The PIN first (if the household has one), so the confirm below doesn't ask again.
    await pin.runProtected('restoreBackup', () => setRestoring({ backup: check.backup, incoming: summariseBackup(check.backup), current }));
  };

  const restore = (backup: Backup, then: 'restore' | 'leave' | 'newHousehold' = 'restore') =>
    pin.runProtected('restoreBackup', async () => {
      // With sync on, this device leaves the household first (restoring would otherwise
      // replace the household's data on every device).
      if (then !== 'restore' && sync) await sync.stop(true);
      await store.importBackup(backup);
      // The backup's finished journeys were celebrated where they happened: don't replay them here.
      await markAllCompletionsCelebrated(store);
      if (then === 'newHousehold' && sync) {
        // A synced household has a PIN from the first push: the backup's, or a new one.
        const hasPin = Boolean((await store.getCurrentHousehold()).parent_pin_hash);
        if (hasPin || (await pin.chooseNewPin({ intro: strings.grownups.pin.forStart }))) {
          const { words } = await sync.start();
          toast({ message: ts.started });
          await pin.writeDownWords(words);
        }
      }
      // The reader signed in here may not be in the backup.
      const active = getActiveReaderId();
      if (active && !(await store.getReader(active))) clearActiveReader();
      setRestoring(null);
      const restored = await store.getCurrentHousehold();
      setName(restored.name);
      toast({ message: t.restored });
    });

  const reset = () =>
    pin.runProtected('resetDevice', async () => {
      // With sync on: leave the household on this device only (the others keep it), then clear.
      if (syncOn && sync) await sync.stop(false);
      else await store.resetDevice();
      clearAppStorage();
      clearActiveReader();
      endGrownUpSession();
      navigate('/', { replace: true });
    });

  const counts = (summary: BackupSummary) => fmt(t.counts, { ...summary });

  const restoreLeaving = async (then: 'leave' | 'newHousehold') => {
    if (!restoring) return;
    setSyncRestoreBusy(true);
    setSyncRestoreError(null);
    try {
      await restore(restoring.backup, then);
    } catch (error) {
      console.error('[settings] restore under sync failed', error);
      setSyncRestoreError(t.restoreFailed);
    } finally {
      setSyncRestoreBusy(false);
    }
  };

  return (
    <>
      {SYNC_ENABLED && (
        <Suspense fallback={null}>
          <SyncSection />
        </Suspense>
      )}

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
        <form className="stack" onSubmit={(e) => void saveZone(e)} noValidate>
          <label htmlFor={ids.zone} className="field-label">
            {t.timeZone}
          </label>
          <p className="small muted">{fmt(t.timeZoneIntro, { zone: device })}</p>
          <div className="row">
            <input
              id={ids.zone}
              className="input"
              list={ids.zones}
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <datalist id={ids.zones}>
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <button type="submit" className="btn" disabled={zone.trim() === (household.time_zone ?? '')}>
              {t.timeZoneSave}
            </button>
          </div>
          {zone !== device && (
            <div className="row">
              <button type="button" className="btn btn--quiet btn--small" onClick={() => setZone(device)}>
                {fmt(t.timeZoneUseDevice, { zone: device })}
              </button>
            </div>
          )}
          {zoneError && (
            <p className="alert alert--danger" role="alert">
              {zoneError}
            </p>
          )}
        </form>
      </section>

      <HouseholdPinSection store={store} household={household} />

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
          <button type="button" className="btn btn--danger" onClick={() => void pin.runProtected('resetDevice', () => setResetting(true))}>
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

      {restoring && syncOn && (
        <Sheet title={ts.backup.restoreTitle} onClose={() => setRestoring(null)}>
          <div className="stack">
            <p className="field-label">{fmt(t.restoreFrom, { date: formatTimestampDate(restoring.backup.exported_at) })}</p>
            <dl className="grownups__compare">
              <dt>{t.inBackup}</dt>
              <dd>{counts(restoring.incoming)}</dd>
              <dt>{t.thisDevice}</dt>
              <dd>{counts(restoring.current)}</dd>
            </dl>
            <p>{ts.backup.restoreBody}</p>
            <ChoiceButton
              title={syncRestoreBusy ? strings.common.saving : ts.backup.restoreOff}
              detail={ts.backup.restoreOffDetail}
              disabled={syncRestoreBusy}
              onClick={() => void restoreLeaving('leave')}
            />
            <ChoiceButton
              title={ts.backup.restoreNew}
              detail={ts.backup.restoreNewDetail}
              disabled={syncRestoreBusy}
              onClick={() => void restoreLeaving('newHousehold')}
            />
            {syncRestoreError && (
              <p className="alert alert--danger" role="alert">
                {syncRestoreError}
              </p>
            )}
            <div className="row">
              <button type="button" className="btn" disabled={syncRestoreBusy} onClick={() => setRestoring(null)}>
                {strings.common.cancel}
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {restoring && !syncOn && (
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
          {syncOn && <p className="alert">{ts.backup.resetSync}</p>}
        </ConfirmSheet>
      )}
    </>
  );
}
