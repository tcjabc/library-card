// Types for pairing.js (vendored from Peek Budget and changed; see VENDORED.md). Hand-written.

import type { EngineStatus } from './sync.js';

export declare const JOIN_REPLACE: 'replace';
export declare const JOIN_MERGE: 'merge';
export type JoinMode = 'replace' | 'merge';

export interface ConfirmAction { label: string; value: boolean; kind?: 'danger' | 'primary' }
export interface ConfirmSpec { title: string; message: string; actions: ConfirmAction[] }
export type Confirm = (spec: ConfirmSpec) => Promise<unknown>;

export interface PairingInfo { paired?: boolean; enabled?: boolean; keyUnavailable?: boolean; wasPaired?: boolean }

export declare function sheetView(info: PairingInfo | null | undefined): 'active' | 'setup';
export declare function chooseJoinMode(options: {
  localItems: number;
  ask: (localItems: number) => Promise<'replace' | 'merge' | 'export' | null>;
  confirm: Confirm;
  exportBackup: () => Promise<void>;
}): Promise<JoinMode | null>;
export declare function replaceConfirm(localItems: number): ConfirmSpec;
export declare function confirmStart(config: { wasPaired?: boolean } | null | undefined, confirm: Confirm): Promise<boolean>;
export declare const TURN_OFF_CONFIRM: Readonly<ConfirmSpec>;
export declare const SHOW_WORDS_CONFIRM: Readonly<ConfirmSpec>;
export declare function statusText(status: Pick<EngineStatus, 'state' | 'lastError'> | null | undefined): string;
export declare function summaryText(info: PairingInfo | null | undefined, status: Pick<EngineStatus, 'state'> | null | undefined): string;
