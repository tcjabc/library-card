// Helpers shared by adapters. Feature code should not need these.

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID is missing outside secure contexts (e.g. plain-HTTP LAN dev).
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 128 random bits, base64url, no padding (22 chars). Safe in a URL or QR code. */
export function newCardToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Accepts any parseable date string and returns canonical UTC ISO, so values sort as strings. */
export function toIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid timestamp: ${value}`);
  return date.toISOString();
}
