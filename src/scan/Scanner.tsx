import { useEffect, useRef, useState } from 'react';
import { strings } from '../strings';
import {
  defaultFacing,
  listCameras,
  loadCameraChoice,
  nextCameraChoice,
  resolveFacing,
  saveCameraChoice,
  videoConstraints,
  type CameraChoice,
  type CameraInfo,
  type CameraMode,
  type Facing,
} from './cameras';
import type { Detector, ScanFormat } from './detector';
import './Scanner.css';

export type { ScanFormat } from './detector';
export type { CameraMode } from './cameras';

export interface ScanResult {
  value: string;
  format: ScanFormat;
}

export type ScannerErrorKind = 'permission' | 'no_camera' | 'in_use' | 'insecure' | 'unsupported' | 'generic';

export interface ScannerProps {
  /** Barcode formats to look for. */
  formats: ScanFormat | readonly ScanFormat[];
  /** Called once per distinct code; repeats of the same code are debounced. */
  onResult: (result: ScanResult) => void;
  onError?: (kind: ScannerErrorKind, error: unknown) => void;
  /**
   * "card": front camera by default, card-shaped aiming frame.
   * "book" (default): back camera by default, barcode frame.
   * "pairing": back camera by default, square frame (another device's QR code).
   * The last camera chosen is remembered per mode on this device.
   */
  camera?: CameraMode;
  /** Shown over the preview instead of the default hint. */
  hint?: string;
  /** Replaces the hint temporarily, e.g. "Try the other barcode". */
  notice?: string | null;
  /** The same value is ignored until it has been out of view this long. Default 2500 ms. */
  debounceMs?: number;
  /** Keep the camera running but stop reporting results. */
  paused?: boolean;
  className?: string;
}

// Time between detection attempts. ZXing on a phone takes ~20-60 ms per frame.
const SCAN_INTERVAL_MS = 150;
// Some Android cameras need a moment to release before the other one can open.
const BUSY_RETRY_MS = 400;

// Not yet in lib.dom.d.ts.
interface ExtendedCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  focusMode?: string[];
}

type Status = 'starting' | 'running' | 'error';

// Camera opens are queued across all Scanner instances so a switch (or a
// StrictMode remount) never has two getUserMedia calls in flight at once.
let cameraQueue: Promise<unknown> = Promise.resolve();

export function Scanner({
  formats,
  onResult,
  onError,
  camera = 'book',
  hint,
  notice,
  debounceMs = 2500,
  paused = false,
  className,
}: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const camerasRef = useRef<CameraInfo[]>([]);
  const [status, setStatus] = useState<Status>('starting');
  const [errorKind, setErrorKind] = useState<ScannerErrorKind | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [cameraCount, setCameraCount] = useState(0);
  const [choice, setChoice] = useState<CameraChoice>(() => loadCameraChoice(camera) ?? {});
  const [active, setActive] = useState<{ facing: Facing | null; deviceId: string | null }>({ facing: null, deviceId: null });

  // Latest callbacks/options without restarting the camera when they change.
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const pausedRef = useRef(paused);
  const debounceRef = useRef(debounceMs);
  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
    pausedRef.current = paused;
    debounceRef.current = debounceMs;
  });

  const formatList: readonly ScanFormat[] = typeof formats === 'string' ? [formats] : formats;
  const formatsKey = [...formatList].sort().join(',');

  // Keep the switch button in step with cameras being plugged in or removed.
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const onChange = () =>
      void listCameras().then((cams) => {
        camerasRef.current = cams;
        setCameraCount(cams.length);
      });
    media.addEventListener('devicechange', onChange);
    return () => media.removeEventListener('devicechange', onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const wanted = formatsKey.split(',') as ScanFormat[];
    const fallback = defaultFacing(camera);

    let disposed = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detector: Detector | null = null;
    let last: { value: string; at: number } | null = null;

    const fail = (kind: ScannerErrorKind, error: unknown) => {
      if (disposed) return;
      setStatus('error');
      setErrorKind(kind);
      onErrorRef.current?.(kind, error);
    };

    const stopCamera = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      trackRef.current = null;
      video.pause();
      video.srcObject = null;
      setTorchOn(false);
      setTorchSupported(false);
    };

    const tick = async () => {
      if (disposed || !stream || !detector) return;
      if (!pausedRef.current && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        try {
          // Always decodes the camera's own (unmirrored) frame; mirroring is CSS only.
          const codes = await detector.detect(video);
          if (disposed) return;
          const now = Date.now();
          const hit = codes.find((c) => c.rawValue && wanted.includes(c.format as ScanFormat));
          if (hit) {
            const isRepeat = last?.value === hit.rawValue && now - last.at < debounceRef.current;
            // Refresh the timestamp on every sighting so a code held in view never re-fires.
            last = { value: hit.rawValue, at: now };
            if (!isRepeat) onResultRef.current({ value: hit.rawValue, format: hit.format as ScanFormat });
          }
        } catch (error) {
          // A single failed frame is not fatal (e.g. a frame grabbed mid-resize).
          console.debug('[scanner] detect failed', error);
        }
      }
      if (!disposed && stream) timer = setTimeout(tick, SCAN_INTERVAL_MS);
    };

    const openStream = async (): Promise<MediaStream> => {
      const cams = await listCameras().catch(() => [] as CameraInfo[]);
      const constraints = videoConstraints(choice, cams, fallback);
      const usesDevice = 'deviceId' in constraints;
      const attemptOpen = (video: MediaTrackConstraints | true) =>
        navigator.mediaDevices.getUserMedia({ audio: false, video });
      try {
        return await attemptOpen(constraints);
      } catch (error) {
        const name = (error as DOMException)?.name;
        if (name === 'NotReadableError' && !disposed) {
          // The previous camera may still be closing.
          await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
          return attemptOpen(constraints);
        }
        if (usesDevice && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
          return attemptOpen({ facingMode: { ideal: fallback } });
        }
        if (name === 'OverconstrainedError') return attemptOpen(true);
        throw error;
      }
    };

    const startCamera = async () => {
      setStatus('starting');
      setErrorKind(null);

      if (!window.isSecureContext) return fail('insecure', new Error('Insecure context'));
      if (!navigator.mediaDevices?.getUserMedia) return fail('unsupported', new Error('No getUserMedia'));

      try {
        detector ??= await (await import('./detector')).createDetector(wanted);
      } catch (error) {
        return fail('unsupported', error);
      }
      if (disposed) return;

      let next: MediaStream;
      const opening = cameraQueue.then(() => (disposed ? null : openStream()));
      cameraQueue = opening.catch(() => undefined);
      try {
        const opened = await opening;
        if (!opened) return;
        next = opened;
      } catch (error) {
        return fail(classify(error), error);
      }

      // Unmounted, switched or hidden while the camera was opening.
      if (disposed || document.hidden) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }

      stream = next;
      const track = next.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      video.srcObject = next;
      try {
        await video.play();
      } catch (error) {
        // AbortError happens when the element is torn down mid-play; ignore.
        if ((error as DOMException)?.name !== 'AbortError') console.warn('[scanner] play failed', error);
      }
      if (disposed) return;

      // Labels (and so facing) are readable now that permission is granted.
      const cams = await listCameras().catch(() => [] as CameraInfo[]);
      if (disposed) return;
      camerasRef.current = cams;
      setCameraCount(cams.length);
      if (track) {
        const settings = track.getSettings?.() ?? {};
        setActive({
          facing: resolveFacing(track, cams, choice.facing ?? fallback),
          deviceId: settings.deviceId ?? null,
        });
        applyTrackFeatures(track, setTorchSupported);
      }
      setStatus('running');
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    };

    // Release the camera when the page is hidden (tab switch, app switch, screen
    // lock). iOS ends the track in the background anyway, so restart on return.
    const onVisibility = () => {
      if (document.hidden) stopCamera();
      else if (!stream) void startCamera();
    };
    document.addEventListener('visibilitychange', onVisibility);

    void startCamera();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stopCamera();
    };
  }, [formatsKey, attempt, choice, camera]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch (error) {
      console.warn('[scanner] torch failed', error);
      setTorchSupported(false);
    }
  };

  const switchCamera = () => {
    const next = nextCameraChoice(active, camerasRef.current);
    saveCameraChoice(camera, next);
    // Changing the choice re-runs the camera effect: its cleanup stops this
    // stream before the next one is opened.
    setChoice(next);
  };

  const t = strings.scanner;
  const guide = camera === 'card' ? 'card' : camera === 'pairing' ? 'square' : 'barcode';
  const mirrored = active.facing === 'user' && status === 'running';
  return (
    <div className={['scanner', mirrored && 'scanner--mirrored', className].filter(Boolean).join(' ')}>
      <video ref={videoRef} className="scanner__video" playsInline muted autoPlay aria-label={t.videoLabel} />
      {status === 'running' && (
        <div className={`scanner__frame scanner__frame--${guide}`} aria-hidden="true">
          {guide === 'card' && <span className="scanner__frame-icon">🪪</span>}
        </div>
      )}
      {status === 'starting' && <p className="scanner__status">{t.starting}</p>}
      {status === 'running' && (
        <p className={notice ? 'scanner__hint scanner__hint--notice' : 'scanner__hint'} role={notice ? 'status' : undefined}>
          {notice ?? hint ?? t.hint}
        </p>
      )}
      {status === 'error' && errorKind && (
        <div className="scanner__error" role="alert">
          <p>{errorMessage(errorKind)}</p>
          {errorKind !== 'insecure' && errorKind !== 'unsupported' && (
            <button type="button" className="btn btn--primary" onClick={() => setAttempt((n) => n + 1)}>
              {strings.common.retry}
            </button>
          )}
        </div>
      )}
      {status !== 'starting' && cameraCount > 1 && (
        <button type="button" className="btn btn--round scanner__switch" aria-label={t.switchCamera} onClick={switchCamera}>
          <span aria-hidden="true">🔄</span>
        </button>
      )}
      {status === 'running' && torchSupported && (
        <button
          type="button"
          className="btn btn--round scanner__torch"
          aria-pressed={torchOn}
          aria-label={torchOn ? t.torchOff : t.torchOn}
          onClick={() => void toggleTorch()}
        >
          {torchOn ? '🔦' : '💡'}
        </button>
      )}
    </div>
  );
}

function classify(error: unknown): ScannerErrorKind {
  switch ((error as DOMException)?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'permission';
    case 'SecurityError':
      return 'insecure';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no_camera';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'in_use';
    default:
      return 'generic';
  }
}

function errorMessage(kind: ScannerErrorKind): string {
  const t = strings.scanner;
  switch (kind) {
    case 'permission':
      return t.errorPermission;
    case 'no_camera':
      return t.errorNoCamera;
    case 'in_use':
      return t.errorInUse;
    case 'insecure':
      return t.errorInsecure;
    case 'unsupported':
      return t.errorUnsupported;
    default:
      return t.errorGeneric;
  }
}

/**
 * Enables continuous autofocus where offered and reports torch support.
 * Capabilities are often empty until the first frame on Android, so retry once.
 * Front cameras normally report no torch, so the button hides after a switch.
 */
function applyTrackFeatures(track: MediaStreamTrack, setTorchSupported: (v: boolean) => void) {
  const check = () => {
    if (track.readyState !== 'live' || typeof track.getCapabilities !== 'function') return false;
    const caps = track.getCapabilities() as ExtendedCapabilities;
    if (caps.focusMode?.includes('continuous')) {
      track
        .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
        .catch(() => undefined);
    }
    const torch = caps.torch === true;
    setTorchSupported(torch);
    return torch;
  };
  if (!check()) setTimeout(check, 600);
}
