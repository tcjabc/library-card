import { useCallback, useState } from 'react';
import { getDataStore } from '../../data';
import { fmt, strings } from '../../strings';
import type { JoinMode } from '../../sync/service';
import { useSync } from '../../sync/useSync';
import { ChoiceButton } from '../../ui/ChoiceButton';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { useToast } from '../../ui/Toast';
import { formatTimestampDate } from '../helpers';
import { usePinGuard } from '../pin/pinGuardContext';
import { AddDeviceSheet } from './AddDeviceSheet';
import { JoinSheet } from './JoinSheet';
import { actionErrorText, lastSyncedText, photosWaitingText, stateText, waitingText } from './syncText';

const t = strings.grownups.sync;

type Open =
  | null
  | { sheet: 'join' }
  | { sheet: 'add'; words: string | null; writeDown?: boolean }
  | { sheet: 'startWarn' }
  | { sheet: 'turnOff' }
  | { sheet: 'delete' };

/**
 * Grown-ups → Settings → Sync devices. Loaded lazily, and only in builds with
 * sync (src/sync/app.ts SYNC_ENABLED). Off: start or join. On: status, Sync
 * now, Add a device, turn off, delete. Removed: keep a copy or start again.
 */
export default function SyncSection() {
  const { service, status } = useSync();
  const toast = useToast();
  const pin = usePinGuard();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);

  if (!service || !status) return null;

  /** Run an action with a busy label; failures show under the section. */
  const act = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (e) {
      console.warn('[sync] action failed', e);
      setError(actionErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Start syncing: the household PIN first (before the first push: the household's PIN if it has
   * one, else a new one), then the 12 words with the write-down step.
   */
  const start = async () => {
    const store = await getDataStore();
    const hasPin = Boolean((await store.getCurrentHousehold()).parent_pin_hash);
    const ready = hasPin ? await pin.askPin(strings.grownups.pin.reasons.startSync) : await pin.chooseNewPin({ intro: strings.grownups.pin.forStart });
    if (!ready) return;
    await act(t.starting, async () => {
      const { words } = await service.start();
      toast({ message: t.started });
      setOpen({ sheet: 'add', words, writeDown: true });
    });
  };

  const showWords = () =>
    void pin.runProtected('addDevice', async () => {
      setOpen({ sheet: 'add', words: null });
      const words = await service.recoveryWords();
      setOpen((o) => (o?.sheet === 'add' ? { sheet: 'add', words } : o));
    });

  const onJoined = (mode: JoinMode) => {
    setOpen(null);
    toast({ message: t.join.joined });
    console.info('[sync] joined', mode);
  };

  const off = status.state === 'off';
  const removed = status.state === 'deleted';
  const disabled = Boolean(busy) || status.busyElsewhere;

  return (
    <section className="stack card sync-section" aria-labelledby="sync-heading">
      <h2 id="sync-heading">{t.heading}</h2>

      {status.busyElsewhere && (
        <p className="alert" role="status">
          {t.busyElsewhere}
        </p>
      )}

      {off && (
        <>
          <p>{t.intro}</p>
          <ChoiceButton
            primary
            title={busy === t.starting ? t.starting : t.startTitle}
            detail={t.startDetail}
            disabled={disabled}
            onClick={() => (status.wasPairedAt ? setOpen({ sheet: 'startWarn' }) : void start())}
          />
          <ChoiceButton title={t.joinTitle} detail={t.joinDetail} disabled={disabled} onClick={() => setOpen({ sheet: 'join' })} />
        </>
      )}

      {removed && (
        <>
          <p className="field-label">{t.removed.title}</p>
          <p>{t.removed.body}</p>
          <ChoiceButton
            primary
            title={t.removed.keep}
            detail={t.removed.keepDetail}
            disabled={disabled}
            onClick={() => void act(t.removed.keep, () => service.stop(true))}
          />
          <ChoiceButton
            title={busy === t.starting ? t.starting : t.removed.startNew}
            detail={t.removed.startNewDetail}
            disabled={disabled}
            onClick={() => void start()}
          />
        </>
      )}

      {!off && !removed && (
        <>
          {status.leaderSilent ? (
            // This tab doesn't run sync and the tab that does hasn't answered (hidden or frozen).
            <div className="sync-status" role="status">
              <span className="sync-dot" aria-hidden="true" />
              <div>
                <p className="field-label">{t.otherTab}</p>
                <p className="small muted">{t.otherTabDetail}</p>
              </div>
            </div>
          ) : (
            <div className="sync-status" role="status">
              <span className={`sync-dot sync-dot--${status.state}`} aria-hidden="true" />
              <div>
                <p className="field-label">
                  {stateText(status.state)}
                  {status.state === 'error' && status.message ? `: ${status.message}` : ''}
                </p>
                <p className="small muted">
                  {lastSyncedText(status.lastSynced)}
                  {status.pendingCount > 0 && ` · ${waitingText(status.pendingCount)}`}
                  {status.photosWaiting > 0 && ` · ${photosWaitingText(status.photosWaiting)}`}
                </p>
              </div>
            </div>
          )}
          {status.photosFailed > 0 && (
            <div className="alert" role="status">
              <p className="field-label">{fmt(t.photosFailed, { count: status.photosFailed })}</p>
              <p className="small">{t.photosFailedDetail}</p>
            </div>
          )}
          <div className="row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={disabled}
              onClick={() => void act(t.syncing, () => service.syncNow())}
            >
              🔄 {busy === t.syncing ? t.syncing : t.syncNow}
            </button>
            <button type="button" className="btn" disabled={disabled} onClick={showWords}>
              📱 {t.addDevice}
            </button>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => void pin.runProtected('turnOffSync', () => setOpen({ sheet: 'turnOff' }))}
            >
              {t.turnOff}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={disabled}
              onClick={() => void pin.runProtected('deleteHousehold', () => setOpen({ sheet: 'delete' }))}
            >
              {t.deleteHousehold}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="alert alert--danger" role="alert">
          {error}
        </p>
      )}

      {open?.sheet === 'join' && <JoinSheet service={service} onJoined={onJoined} onClose={close} />}
      {open?.sheet === 'add' && <AddDeviceSheet words={open.words} writeDown={open.writeDown} onClose={close} />}
      {open?.sheet === 'startWarn' && (
        <ConfirmSheet
          title={t.startWarnTitle}
          confirmLabel={t.startWarnConfirm}
          onClose={close}
          onConfirm={async () => {
            setOpen(null);
            await start();
          }}
        >
          <p>{fmt(t.startWarnBody, { date: status.wasPairedAt ? formatTimestampDate(status.wasPairedAt) : '' })}</p>
        </ConfirmSheet>
      )}
      {open?.sheet === 'turnOff' && (
        <ConfirmSheet
          title={t.turnOffTitle}
          confirmLabel={t.turnOffConfirm}
          errorText={t.failed}
          onClose={close}
          onConfirm={() =>
            pin.runProtected('turnOffSync', async () => {
              await service.stop(true);
              setOpen(null);
              toast({ message: t.turnedOff });
            })
          }
        >
          <p>{t.turnOffBody}</p>
        </ConfirmSheet>
      )}
      {open?.sheet === 'delete' && (
        <ConfirmSheet
          title={t.deleteTitle}
          confirmLabel={t.deleteConfirm}
          danger
          typeToConfirm={t.deleteWord}
          errorText={t.failed}
          onClose={close}
          onConfirm={() =>
            pin.runProtected('deleteHousehold', async () => {
              await service.deleteHousehold();
              setOpen(null);
            })
          }
        >
          <p>{t.deleteBody}</p>
        </ConfirmSheet>
      )}
    </section>
  );
}
