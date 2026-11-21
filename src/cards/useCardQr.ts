import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { buildCardUrl } from './cardUrl';

/**
 * A reader's card QR code as an SVG data URL (sharp at any print size).
 * Error correction M; dark on light from the --color-qr-* tokens in every
 * theme, so it always scans. Null until it is ready.
 */
export function useCardQr(cardToken: string): string | null {
  const url = buildCardUrl(cardToken);
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const css = getComputedStyle(document.documentElement);
    QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: {
        dark: css.getPropertyValue('--color-qr-dark').trim() || '#000000',
        light: css.getPropertyValue('--color-qr-light').trim() || '#ffffff',
      },
    }).then(
      (svg) => !cancelled && setQr({ url, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }),
      (error: unknown) => console.error('[cards] QR code failed', error),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  return qr?.url === url ? qr.dataUrl : null;
}
