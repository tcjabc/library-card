import {
  BarcodeDetector as ZXingBarcodeDetector,
  setZXingModuleOverrides,
} from 'barcode-detector/ponyfill';
// Self-host the ZXing WASM so scanning works offline and doesn't depend on a CDN.
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/**
 * Picks a barcode detector for the requested formats:
 * - the browser's native BarcodeDetector when it supports every format
 *   (Chrome on Android, Chrome/Edge on macOS);
 * - otherwise the `barcode-detector` polyfill (ZXing compiled to WASM), which
 *   is what iOS Safari, Firefox and desktop Chrome on Windows/Linux use.
 *
 * The polyfill is used as a ponyfill (not patched onto globalThis) so we can
 * still see whether a native implementation exists.
 */

export type ScanFormat = 'qr_code' | 'ean_13' | 'code_128' | 'code_39' | 'codabar' | 'itf';

export interface Detection {
  rawValue: string;
  format: string;
}

export interface Detector {
  readonly kind: 'native' | 'polyfill';
  detect(source: HTMLVideoElement): Promise<Detection[]>;
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): { detect(source: CanvasImageSource): Promise<Detection[]> };
  getSupportedFormats(): Promise<string[]>;
}

let zxingConfigured = false;

function configureZXing(): void {
  if (zxingConfigured) return;
  setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path),
  });
  zxingConfigured = true;
}

export async function createDetector(formats: readonly ScanFormat[]): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorCtor }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      if (formats.every((f) => supported.includes(f))) {
        const native = new Native({ formats: [...formats] });
        return { kind: 'native', detect: (source) => native.detect(source) };
      }
    } catch {
      // Fall through to the polyfill (e.g. Android without Play Services).
    }
  }

  configureZXing();
  const polyfill = new ZXingBarcodeDetector({ formats: [...formats] });
  return { kind: 'polyfill', detect: (source) => polyfill.detect(source) };
}
