import { useQrDataUrl } from '../ui/useQrDataUrl';
import { buildCardUrl } from './cardUrl';

/**
 * A reader's card QR code as an SVG data URL (sharp at any print size).
 * Error correction M; dark on light from the --color-qr-* tokens in every
 * theme, so it always scans. Null until it is ready.
 */
export function useCardQr(cardToken: string): string | null {
  return useQrDataUrl(buildCardUrl(cardToken));
}
