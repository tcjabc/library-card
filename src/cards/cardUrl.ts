/**
 * Library card QR contents. A card encodes a full URL so a phone's own camera
 * app can open it: <origin><base>#/card/<token>. The token is what matters;
 * parseCardToken ignores the origin, so cards keep working if the app moves.
 */

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function buildCardUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/card/${token}`;
}

/** Token from a scanned card URL or a bare token, or null if it isn't a card. */
export function parseCardToken(scanned: string): string | null {
  const value = scanned.trim();
  const match = /#\/card\/([^/?#\s]+)/.exec(value);
  const candidate = match ? safeDecode(match[1]) : value;
  return candidate && TOKEN.test(candidate) ? candidate : null;
}

function safeDecode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
