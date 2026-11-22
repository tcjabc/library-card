/**
 * The household's time zone: every "today" (due chips, the hub badge, default due dates, renewals,
 * the loan editor's checks, the pretend date) is the date in this zone, so two devices in
 * different zones agree on what is overdue. Due dates stay plain YYYY-MM-DD.
 *
 * The zone is households.time_zone (synced). A household without one uses this device's zone.
 * The app keeps the current household's zone here (src/App.tsx), so plain functions can use it.
 */

/** This device's IANA time zone, e.g. "Europe/London". */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** True for a zone the platform knows ("Asia/Taipei", "UTC"). */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every zone the platform lists (for the Settings picker), with the device's first if missing. */
export function listTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported('timeZone') : [];
  const device = deviceTimeZone();
  return zones.includes(device) ? zones : [device, ...zones];
}

const partsIn = (date: Date, zone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
};

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar date (YYYY-MM-DD) of an instant in a zone. */
export function calendarDateIn(date: Date, zone: string): string {
  const { y, m, d } = partsIn(date, zone);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The instant (ISO) of 12:00 on a calendar date in a zone: a date stored this way shows as that date there. */
export function noonIn(date: string, zone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 12);
  // The zone's offset at that moment: its wall-clock time minus UTC.
  const wall = partsIn(new Date(guess), zone);
  const offset = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min, wall.s) - guess;
  return new Date(guess - offset).toISOString();
}

/* --------------------------------------------------------------------------
   The current household's zone
   -------------------------------------------------------------------------- */

let householdZone: string | null = null;
const listeners = new Set<() => void>();

/** Set by the app whenever the household (or its time_zone) changes; null: not set, use the device's. */
export function setHouseholdTimeZone(zone: string | null | undefined): void {
  const next = isTimeZone(zone) ? zone : null;
  if (next === householdZone) return;
  householdZone = next;
  listeners.forEach((l) => l());
}

export function getHouseholdTimeZone(): string | null {
  return householdZone;
}

/** The zone "today" is counted in: the household's, else this device's. */
export function currentTimeZone(): string {
  return householdZone ?? deviceTimeZone();
}

export function onTimeZoneChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
