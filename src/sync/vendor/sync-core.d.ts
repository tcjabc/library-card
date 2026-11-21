// Types for sync-core.js (vendored verbatim from Peek Budget; see VENDORED.md). Hand-written:
// keep in step with the .js if it is ever re-vendored.

/** A hybrid logical clock: wall time (ms), a counter within that ms, and this device's id. */
export interface Clock {
  wall: number;
  count: number;
  dev: string;
}

/** The parts of a stamp ("<wall 15 digits>-<counter 6 digits>-<device id>"). */
export interface ParsedStamp {
  wall: number;
  count: number;
  dev: string;
}

/** Plain JSON: what a field can hold. */
export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

/** One field change on one record. Deleting is { f: 'del', v: true }; creating includes { f: 'del', v: false }. */
export interface Op {
  id: string;
  rec: string;
  f: string;
  v: JsonValue;
  /** HLC stamp. */
  t: string;
  dev: string;
}

/** A record: each field's value and the stamp of the op that last set it. */
export interface SyncRecord {
  id: string;
  fields: Record<string, JsonValue>;
  ts: Record<string, string>;
}

export interface Replica {
  clock: Clock;
  records: Map<string, SyncRecord>;
}

export interface EmitOptions {
  now?: number;
  newId?: () => string;
}

export type Fields = Record<string, JsonValue | undefined>;

export declare const isDeviceId: (v: unknown) => v is string;
export declare function newClock(dev: string): Clock;
export declare function isClock(c: unknown): c is Clock;
export declare function formatStamp(wall: number, count: number, dev: string): string;
export declare function parseStamp(s: unknown): ParsedStamp | null;
export declare const isStamp: (s: unknown) => s is string;
export declare function compare(a: string, b: string): -1 | 0 | 1;
export declare function tick(clock: Clock, now?: number): { clock: Clock; stamp: string };
export declare const MAX_DRIFT_MS: number;
export declare function receive(clock: Clock, remoteStamp: string, now?: number, maxDrift?: number): Clock;

export declare const sameValue: (a: JsonValue, b: JsonValue) => boolean;

export declare const DELETED: 'del';
export declare const isRecordId: (v: unknown) => v is string;
export declare const isFieldName: (v: unknown) => v is string;
export declare function isOp(op: unknown): op is Op;
export declare const isLive: (record: SyncRecord | null | undefined) => boolean;
export declare function applyToRecord(record: SyncRecord | undefined, op: Op): { record: SyncRecord; changed: boolean };
export declare function applyOp(records: Map<string, SyncRecord>, op: Op): boolean;

export declare function createRecord(replica: Replica, rec: string, fields: Fields, opts?: EmitOptions): Op[];
export declare function editRecord(replica: Replica, rec: string, fields: Fields, opts?: EmitOptions): Op[];
export declare function deleteRecord(replica: Replica, rec: string, opts?: EmitOptions): Op[];
export declare function setFields(replica: Replica, rec: string, fields: Fields, opts?: EmitOptions): Op[];
export declare function putRecord(replica: Replica, rec: string, fields: Fields, opts?: EmitOptions): Op[];
