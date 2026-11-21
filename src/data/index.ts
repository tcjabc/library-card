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
export { useDataQuery, useDataStore, type DataQueryResult } from './react';
export { hashPin, verifyPin } from './pin';
export { isNoIsbnBookKey, newNoIsbnBookKey } from './ids';
export { findStickerDuplicates, pickStickerWinner, type StickerResolution } from './loanRules';
