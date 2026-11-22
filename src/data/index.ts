/**
 * The only entry point feature code may use for storage.
 *
 *   import { getDataStore, useDataQuery } from '../data';
 *   const store = await getDataStore();
 *
 * The adapter is chosen at build time from VITE_DATA_ADAPTER (default "local").
 * Adapters are loaded with dynamic import so unused backends are not bundled.
 */
export * from './DataStore';
export { configuredAdapter, getDataStore, type AdapterName } from './store';
export { isSyncStore, type ApplyResult, type PhotoCounts, type SyncConfig, type SyncDataStore, type SyncEngineStore, type SyncFlags, type SyncPhotoStore } from './sync/types';
export { withSyncLock } from './sync/lock';
export { useDataQuery, useDataStore, type DataQueryResult } from './react';
export { hashPin, verifyPin } from './pin';
export { isNoIsbnBookKey, newNoIsbnBookKey } from './ids';
export { findStickerDuplicates, pickStickerWinner, type StickerResolution } from './loanRules';
export {
  BACKUP_FORMAT,
  backupFileName,
  parseBackupText,
  summariseBackup,
  validateBackup,
  type Backup,
  type BackupCheck,
  type BackupProblem,
  type BackupSummary,
} from './backup';
