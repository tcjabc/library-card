import { useEffect, useState } from 'react';

/**
 * Pretend covers for the developer tools' pretend piles (#/dev/stack), so "Covers on the stack"
 * and the benchmark have pictures to draw without any network: a few small images drawn here
 * (a coloured ground, a band, a circle and a number) and kept as blob: URLs for the visit. They
 * load like photos taken in the app.
 */

export const PRETEND_COVERS = 12;
const WIDTH = 120;
const HEIGHT = 180;

function drawCover(i: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  const hue = (i * 360) / PRETEND_COVERS;
  ctx.fillStyle = `hsl(${hue}, 65%, 52%)`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 60%, 85%)`;
  ctx.fillRect(0, HEIGHT * 0.12, WIDTH, HEIGHT * 0.16);
  ctx.beginPath();
  ctx.arc(WIDTH / 2, HEIGHT * 0.62, WIDTH * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `hsl(${hue}, 70%, 25%)`;
  ctx.font = `bold ${Math.round(HEIGHT * 0.14)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(i + 1), WIDTH / 2, HEIGHT * 0.62);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** The pretend covers' URLs while `on` (null until they're drawn, or when off). */
export function usePretendCovers(on: boolean): string[] | null {
  const [urls, setUrls] = useState<string[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    let made: string[] = [];
    void Promise.all(Array.from({ length: PRETEND_COVERS }, (_, i) => drawCover(i))).then((blobs) => {
      made = blobs.filter((b): b is Blob => b !== null).map((b) => URL.createObjectURL(b));
      if (cancelled) made.forEach((u) => URL.revokeObjectURL(u));
      else setUrls(made);
    });
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
      setUrls(null);
    };
  }, [on]);
  return on ? urls : null;
}
