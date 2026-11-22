import { useSyncExternalStore } from 'react';
import { isDatabaseUpgradeBlocked, onDatabaseUpgradeBlocked } from '../data';
import { strings } from '../strings';

/**
 * "Updating… close the Library Card app in other tabs or windows": over everything while a new
 * version waits for an older one in another tab to let go of the database (src/data/upgradeStatus.ts).
 * It goes away by itself once the update goes through.
 */
export function UpdatingNotice() {
  const blocked = useSyncExternalStore(onDatabaseUpgradeBlocked, isDatabaseUpgradeBlocked);
  if (!blocked) return null;
  return (
    <div className="updating-notice" role="alertdialog" aria-modal="true" aria-labelledby="updating-notice-title" aria-describedby="updating-notice-body">
      <div className="updating-notice__body">
        <span className="updating-notice__icon" aria-hidden="true">
          🔄
        </span>
        <h2 id="updating-notice-title">{strings.app.updatingTitle}</h2>
        <p id="updating-notice-body" className="kid-lead">
          {strings.app.updatingBody}
        </p>
      </div>
    </div>
  );
}
