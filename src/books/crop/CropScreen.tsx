import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { strings } from '../../strings';
import { decodePhoto, encodeCrop, samplePixels, workingCopy } from './cropImage';
import {
  centredBox,
  clampRect,
  clampView,
  fitScale,
  FULL,
  moveRect,
  photoBox,
  resizeRect,
  rotateRect90,
  START_VIEW,
  zoomAround,
  type Corner,
  type Rect,
  type Size,
  type View,
} from './cropMath';
import { suggestCrop } from './suggestCrop';
import './crop.css';

/** What the crop screen gives back: the cover photo, and how to open it again where it left off. */
export interface CropResult {
  blob: Blob;
  /** The photo as taken (or as stored), for "Edit photo" later. */
  source: Blob;
  turns: number;
  rect: Rect;
}

interface CropScreenProps {
  source: Blob;
  /** Where to start: a re-edit opens with its last turns and rectangle. Without it, the suggested crop. */
  initial?: { turns: number; rect: Rect };
  onDone: (result: CropResult) => void;
  onCancel: () => void;
}

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
/** The smallest crop, in screen px either way (so the handles never sit on top of each other). */
const MIN_CROP_PX = 64;
/** Arrow keys move (or, with Shift, resize) the rectangle by this much of the photo. */
const KEY_STEP = 0.01;

interface Working {
  img: HTMLImageElement;
  source: Blob;
  turns: number;
  canvas: HTMLCanvasElement;
}

type Gesture =
  | { kind: 'move' | 'resize'; corner: Corner; id: number; x: number; y: number; rect: Rect }
  | { kind: 'pan'; id: number; x: number; y: number; view: View }
  | { kind: 'pinch'; distance: number; mid: { x: number; y: number }; view: View };

/**
 * Fitting a cover photo, full screen: the photo with a crop rectangle to drag (inside it) and
 * resize (its corners); pinch, drag outside the rectangle or scroll to zoom and pan; Rotate 90°;
 * Retake; Use whole photo; Done. It starts from a suggested rectangle round the book (or a centred
 * box when it can't tell). Cancel (or Escape) changes nothing.
 */
export default function CropScreen({ source, initial, onDone, onCancel }: CropScreenProps) {
  const t = strings.crop;
  const dialog = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const retakeId = useId();
  const [work, setWork] = useState<Working | null>(null);
  const [failed, setFailed] = useState(false);
  const [rect, setRect] = useState<Rect>(FULL);
  const [view, setView] = useState<View>(START_VIEW);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  // Open as a modal over the book sheet; Escape cancels.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      onCancelRef.current();
    };
    el.addEventListener('cancel', cancel);
    return () => {
      el.removeEventListener('cancel', cancel);
      if (el.open) el.close();
    };
  }, []);

  /** A photo: decode it, and start from the suggested rectangle (or `start`). */
  const open = (file: Blob, start?: { turns: number; rect: Rect }) => {
    decodePhoto(file)
      .then((img) => {
        const turns = start?.turns ?? 0;
        const canvas = workingCopy(img, turns);
        let first = start?.rect;
        if (!first) {
          try {
            first = suggestCrop(samplePixels(canvas)) ?? undefined;
          } catch (error) {
            console.warn('[crop] no suggestion', error);
          }
        }
        setRect(first ?? centredBox(canvas.width, canvas.height));
        setView(START_VIEW);
        setWork({ img, source: file, turns, canvas });
      })
      .catch((error: unknown) => {
        console.error('[crop] could not open the photo', error);
        setFailed(true);
      });
  };

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open(source, initial);
  });

  // The stage's size (it changes when the phone turns).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStage({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The working copy is a canvas: put it on the page.
  useEffect(() => {
    const holder = photoRef.current;
    if (!holder || !work) return;
    holder.replaceChildren(work.canvas);
  }, [work]);

  const size: Size = work ? { width: work.canvas.width, height: work.canvas.height } : { width: 1, height: 1 };
  const base = fitScale(stage, size);
  const shown = clampView(view, stage, size, base);
  const box = photoBox(shown, stage, size, base);
  const minW = Math.min(1, MIN_CROP_PX / Math.max(1, box.width));
  const minH = Math.min(1, MIN_CROP_PX / Math.max(1, box.height));

  const stagePoint = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    gesture.current = { kind: 'pinch', distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: shown };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!work || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = stagePoint(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) return startPinch();
    if (pointers.current.size > 2) return;
    const target = e.target as HTMLElement;
    const corner = target.closest<HTMLElement>('[data-corner]')?.dataset.corner as Corner | undefined;
    if (corner) gesture.current = { kind: 'resize', corner, id: e.pointerId, x: p.x, y: p.y, rect };
    else if (target.closest('.crop__rect')) gesture.current = { kind: 'move', corner: 'nw', id: e.pointerId, x: p.x, y: p.y, rect };
    else gesture.current = { kind: 'pan', id: e.pointerId, x: p.x, y: p.y, view: shown };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = stagePoint(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAround(g.view, Math.hypot(a.x - b.x, a.y - b.y) / g.distance, g.mid, stage, size, base);
      setView(clampView({ ...zoomed, panX: zoomed.panX + mid.x - g.mid.x, panY: zoomed.panY + mid.y - g.mid.y }, stage, size, base));
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.kind === 'pan') {
      setView(clampView({ ...g.view, panX: g.view.panX + p.x - g.x, panY: g.view.panY + p.y - g.y }, stage, size, base));
      return;
    }
    const dx = (p.x - g.x) / box.width;
    const dy = (p.y - g.y) / box.height;
    setRect(g.kind === 'move' ? moveRect(g.rect, dx, dy) : resizeRect(g.rect, g.corner, dx, dy, minW, minH));
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const left = [...pointers.current.entries()];
    if (gesture.current?.kind === 'pinch' && left.length === 1) {
      // One finger stays down after a pinch: carry on panning with it.
      const [id, p] = left[0];
      gesture.current = { kind: 'pan', id, x: p.x, y: p.y, view: shown };
    } else if (left.length === 0) {
      gesture.current = null;
    }
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!work) return;
    setView(zoomAround(shown, e.deltaY < 0 ? 1.15 : 1 / 1.15, stagePoint(e), stage, size, base));
  };

  const onRectKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    setRect((r) => (e.shiftKey ? resizeRect(r, 'se', d[0], d[1], minW, minH) : moveRect(r, d[0], d[1])));
  };

  const rotate = () => {
    if (!work) return;
    const turns = (work.turns + 1) % 4;
    const canvas = workingCopy(work.img, turns);
    setRect((r) => clampRect(rotateRect90(r)));
    setView(START_VIEW);
    setWork({ ...work, turns, canvas });
  };

  const finish = async (crop: Rect) => {
    if (!work) return;
    setBusy(true);
    setSaveError(false);
    try {
      const blob = await encodeCrop(work.canvas, crop);
      onDone({ blob, source: work.source, turns: work.turns, rect: crop });
    } catch (error) {
      console.error('[crop] could not save the photo', error);
      setSaveError(true);
      setBusy(false);
    }
  };

  const onRetake = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFailed(false);
    setSaveError(false);
    setWork(null);
    open(file);
  };

  const ready = !!work && stage.width > 0;
  const crop = { left: box.left + rect.x * box.width, top: box.top + rect.y * box.height, width: rect.w * box.width, height: rect.h * box.height };

  return (
    <dialog ref={dialog} className="crop" aria-labelledby={titleId}>
      <div className="crop__body">
        <header className="crop__header">
          <h2 id={titleId}>{t.title}</h2>
          <p className="crop__hint">{t.hint}</p>
        </header>

        <div
          ref={stageRef}
          className="crop__stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
        >
          {!work && <p className="crop__status">{failed ? t.error : t.loading}</p>}
          <div
            ref={photoRef}
            className="crop__photo"
            hidden={!ready}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />
          {ready && (
            <div
              className="crop__rect"
              role="group"
              tabIndex={0}
              aria-label={t.areaLabel}
              onKeyDown={onRectKey}
              style={{ left: crop.left, top: crop.top, width: crop.width, height: crop.height }}
            >
              {CORNERS.map((corner) => (
                <span key={corner} className={`crop__handle crop__handle--${corner}`} data-corner={corner} aria-label={t.corners[corner]} role="img" />
              ))}
            </div>
          )}
        </div>

        {saveError && (
          <p className="alert alert--danger crop__error" role="alert">
            {t.saveError}
          </p>
        )}

        <div className="crop__tools">
          <button type="button" className="btn" disabled={!work || busy} onClick={rotate}>
            <span aria-hidden="true">↻</span> {t.rotate}
          </button>
          <input id={retakeId} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={onRetake} disabled={busy} />
          <label htmlFor={retakeId} className="btn">
            <span aria-hidden="true">📷</span> {t.retake}
          </label>
          <button type="button" className="btn" disabled={!work || busy} onClick={() => void finish(FULL)}>
            {t.whole}
          </button>
        </div>
        <div className="crop__actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {strings.common.cancel}
          </button>
          <button type="button" className="btn btn--primary" disabled={!work || busy} onClick={() => void finish(rect)}>
            {busy ? strings.common.saving : t.done}
          </button>
        </div>
      </div>
    </dialog>
  );
}
