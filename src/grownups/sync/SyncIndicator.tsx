import { strings } from '../../strings';
import { useSync } from '../../sync/useSync';

const t = strings.grownups.sync.header;

/**
 * A small, calm note in the grown-up header when sync needs a glance:
 * offline, syncing, a problem, or the household removed. Nothing when all is
 * well (or sync is off), and never on kid screens.
 */
export function SyncIndicator() {
  const { status } = useSync();
  // No note for "syncing in another tab": the Settings screen explains that one.
  if (!status || status.leaderSilent) return null;
  const text =
    status.state === 'offline'
      ? t.offline
      : status.state === 'connecting'
        ? t.syncing
        : status.state === 'error'
          ? t.error
          : status.state === 'deleted'
            ? t.deleted
            : null;
  if (!text) return null;
  return (
    <p className={`sync-pill sync-pill--${status.state}`} role="status">
      <span className={`sync-dot sync-dot--${status.state}`} aria-hidden="true" />
      {text}
    </p>
  );
}
