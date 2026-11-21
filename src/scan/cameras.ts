/**
 * Camera choice for the Scanner.
 *
 * Kids switch between front and back, not between lenses: when the device
 * reports both a front and a back camera, "switch" toggles facingMode and lets
 * the browser pick its default lens for that side (on multi-lens phones that is
 * the main wide camera, which focuses close enough for barcodes). Only when
 * facing can't be told apart (e.g. a laptop with two webcams) does switching
 * cycle through devices by id.
 *
 * The last choice is remembered per device, separately for card scanning and
 * book scanning.
 */

export type CameraMode = 'card' | 'book';
export type Facing = 'user' | 'environment';

export interface CameraChoice {
  facing?: Facing;
  deviceId?: string;
}

export interface CameraInfo {
  deviceId: string;
  label: string;
  facing: Facing | null;
}

const STORAGE_PREFIX = 'library-card:camera:';

export function defaultFacing(mode: CameraMode): Facing {
  // Card scan: a child holds their card up to the screen. Book scan: a grown-up points the back camera.
  return mode === 'card' ? 'user' : 'environment';
}

export function loadCameraChoice(mode: CameraMode): CameraChoice | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + mode);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CameraChoice;
    const facing = parsed.facing === 'user' || parsed.facing === 'environment' ? parsed.facing : undefined;
    const deviceId = typeof parsed.deviceId === 'string' && parsed.deviceId ? parsed.deviceId : undefined;
    return facing || deviceId ? { facing, deviceId } : null;
  } catch {
    return null;
  }
}

export function saveCameraChoice(mode: CameraMode, choice: CameraChoice): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + mode, JSON.stringify(choice));
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

export function facingFromLabel(label: string): Facing | null {
  if (/front|user|facetime|selfie/i.test(label)) return 'user';
  if (/back|rear|environment|world/i.test(label)) return 'environment';
  return null;
}

/** Video inputs. Labels (and so facing) are only known after camera permission is granted. */
export async function listCameras(): Promise<CameraInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label, facing: facingFromLabel(d.label) }));
}

function facingsPresent(cameras: CameraInfo[]): Set<Facing> {
  return new Set(cameras.map((c) => c.facing).filter((f): f is Facing => f !== null));
}

/**
 * Constraints for a choice. Falls back to the mode's default facing when the
 * saved camera isn't on this device.
 */
export function videoConstraints(choice: CameraChoice, cameras: CameraInfo[], fallback: Facing): MediaTrackConstraints {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (choice.deviceId && cameras.some((c) => c.deviceId === choice.deviceId)) {
    return { deviceId: { exact: choice.deviceId }, ...size };
  }
  const known = facingsPresent(cameras);
  let facing = choice.facing ?? fallback;
  // Saved facing isn't available (e.g. "front" on a device with only a back camera).
  if (known.size > 0 && !known.has(facing)) facing = known.has(fallback) ? fallback : [...known][0];
  return { facingMode: { ideal: facing }, ...size };
}

/** What "switch camera" moves to from the camera that is running now. */
export function nextCameraChoice(current: { facing: Facing | null; deviceId: string | null }, cameras: CameraInfo[]): CameraChoice {
  const known = facingsPresent(cameras);
  if (known.has('user') && known.has('environment')) {
    return { facing: current.facing === 'user' ? 'environment' : 'user' };
  }
  if (cameras.length === 0) return { facing: current.facing === 'user' ? 'environment' : 'user' };
  const index = cameras.findIndex((c) => c.deviceId === current.deviceId);
  const next = cameras[(index + 1) % cameras.length];
  return { deviceId: next.deviceId, facing: next.facing ?? undefined };
}

/** Facing of the running track: what the browser reports, else the label, else what we asked for. */
export function resolveFacing(track: MediaStreamTrack, cameras: CameraInfo[], requested: Facing | null): Facing | null {
  const settings = track.getSettings?.() ?? {};
  if (settings.facingMode === 'user' || settings.facingMode === 'environment') return settings.facingMode;
  const byDevice = cameras.find((c) => c.deviceId === settings.deviceId)?.facing;
  if (byDevice) return byDevice;
  const byLabel = facingFromLabel(track.label);
  return byLabel ?? requested;
}
