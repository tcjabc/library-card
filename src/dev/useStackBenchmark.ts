import { useCallback, useRef, useState, type RefObject } from 'react';
import type { StackBench } from '../staircase/CanvasStack';
import { fmt, strings } from '../strings';
import type { BenchProgress } from './runStackBenchmark';
import { BENCH_STORAGE_KEY, configLabel, type BenchResult } from './stackBenchmark';

/**
 * The book stack benchmark's state (developer tools): idle, running (with a progress line) or
 * showing results, plus the last result kept on this device. The runner is loaded only when a
 * benchmark starts, so none of it costs anything until then.
 */

const t = strings.dev;

/** The last result on this device, or null (try/catch: storage can be missing or full). */
function loadLast(): BenchResult | null {
  try {
    const text = window.localStorage.getItem(BENCH_STORAGE_KEY);
    if (!text) return null;
    const value = JSON.parse(text) as BenchResult;
    return typeof value?.version === 'string' && Array.isArray(value.rows) ? value : null;
  } catch {
    return null;
  }
}

function saveLast(result: BenchResult) {
  try {
    window.localStorage.setItem(BENCH_STORAGE_KEY, JSON.stringify(result));
  } catch {
    // Not saved; the result is still on screen.
  }
}

function progressText(progress: BenchProgress): string {
  if (progress.kind === 'calibrate') return fmt(t.benchCalibrating, { when: progress.when === 'start' ? t.benchCalStart : t.benchCalEnd });
  return fmt(t.benchProgress, { n: progress.index + 1, total: progress.total, config: configLabel(progress.config) });
}

export type BenchState = 'idle' | 'running' | 'results';

/** Runs the benchmark on the stack's handle and keeps its state; `onFinished` runs afterwards (finished, cancelled or failed). */
export function useStackBenchmark(handle: RefObject<StackBench | null>, version: string, onFinished: () => void) {
  const [state, setState] = useState<BenchState>('idle');
  const [progress, setProgress] = useState('');
  const [status, setStatus] = useState('');
  const [shown, setShown] = useState<BenchResult | null>(null);
  const [last, setLast] = useState<BenchResult | null>(loadLast);
  const cancelled = useRef(false);

  const start = useCallback(async () => {
    const bench = handle.current;
    if (!bench) return;
    cancelled.current = false;
    setStatus('');
    setProgress('');
    setState('running');
    try {
      const { runStackBenchmark } = await import('./runStackBenchmark');
      const result = await runStackBenchmark({
        bench,
        version,
        isCancelled: () => cancelled.current,
        onProgress: (p) => setProgress(progressText(p)),
      });
      saveLast(result);
      setLast(result);
      if (result.cancelled) {
        setStatus(t.benchCancelledStatus);
        setState('idle');
      } else {
        setStatus(t.benchDoneStatus);
        setShown(result);
        setState('results');
      }
    } catch {
      setStatus(t.benchFailedStatus);
      setState('idle');
    } finally {
      onFinished();
    }
  }, [handle, version, onFinished]);

  const cancel = useCallback(() => {
    cancelled.current = true;
  }, []);

  const openLast = useCallback(() => {
    if (!last) return;
    setShown(last);
    setState('results');
  }, [last]);

  const close = useCallback(() => setState('idle'), []);

  return { state, progress, status, shown, last, start, cancel, openLast, close };
}
