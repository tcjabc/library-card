import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * A QR code for `text` as an SVG data URL (sharp at any size), or null until
 * it is ready (and while `text` is null). Error correction M; dark on light
 * from the --color-qr-* tokens in every theme, so it always scans.
 */
export function useQrDataUrl(text: string | null): string | null {
  const [qr, setQr] = useState<{ text: string; dataUrl: string } | null>(null);

  useEffect(() => {
    if (text === null) return;
    let cancelled = false;
    const css = getComputedStyle(document.documentElement);
    QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: {
        dark: css.getPropertyValue('--color-qr-dark').trim() || '#000000',
        light: css.getPropertyValue('--color-qr-light').trim() || '#ffffff',
      },
    }).then(
      (svg) => !cancelled && setQr({ text, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }),
      (error: unknown) => console.error('[qr] QR code failed', error),
    );
    return () => {
      cancelled = true;
    };
  }, [text]);

  return text !== null && qr?.text === text ? qr.dataUrl : null;
}
