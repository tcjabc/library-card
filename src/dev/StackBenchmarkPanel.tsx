import { useMemo, useState } from 'react';
import { fmt, strings } from '../strings';
import { benchFilename, formatBenchResult, type BenchResult } from './stackBenchmark';

/**
 * The book stack benchmark's controls and screens (developer tools): the start button with its
 * confirm step, the progress bar with Cancel, and the results screen (Download, Share, Copy).
 * Their state is in useStackBenchmark.ts; the runner is loaded only when a benchmark starts.
 */

const t = strings.dev;

/** In the measurement panel: what the benchmark does, Run (then Start / Not now), and the last result. */
export function BenchControls({
  canRun,
  hasLast,
  status,
  onStart,
  onOpenLast,
}: {
  canRun: boolean;
  hasLast: boolean;
  status: string;
  onStart: () => void;
  onOpenLast: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="stack-dev__bench" aria-labelledby="stack-bench-heading">
      <h2 id="stack-bench-heading" className="stack-dev__bench-heading">
        {t.benchHeading}
      </h2>
      <p className="small muted">{t.benchIntro}</p>
      {confirming ? (
        <>
          <p className="small">{t.benchConfirm}</p>
          <div className="stack-dev__controls">
            <button
              type="button"
              className="btn btn--small stack-dev__bench-button"
              onClick={() => {
                setConfirming(false);
                onStart();
              }}
            >
              {t.benchStart}
            </button>
            <button type="button" className="btn btn--small btn--quiet stack-dev__bench-button" onClick={() => setConfirming(false)}>
              {t.benchNotNow}
            </button>
          </div>
        </>
      ) : (
        <div className="stack-dev__controls">
          <button type="button" className="btn btn--small stack-dev__bench-button" disabled={!canRun} onClick={() => setConfirming(true)}>
            {t.benchRun}
          </button>
          {hasLast && (
            <button type="button" className="btn btn--small btn--quiet stack-dev__bench-button" onClick={onOpenLast}>
              {t.benchLastButton}
            </button>
          )}
        </div>
      )}
      <p className="small muted" role="status">
        {status}
      </p>
    </section>
  );
}

/** While it runs: one line of progress and Cancel, in place of the panel. */
export function BenchRunning({ progress, onCancel }: { progress: string; onCancel: () => void }) {
  return (
    <div className="stack-dev__panel stack-dev__bench-bar">
      <p className="stack-dev__bench-progress" role="status">
        {progress || t.benchStarting}
      </p>
      <button type="button" className="btn btn--small stack-dev__bench-button" onClick={onCancel}>
        {t.benchCancel}
      </button>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'stack-dev__copy-area';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** The results screen: the whole text, large and scrollable, and ways to get it off the device. */
export function BenchResults({ result, version, onClose }: { result: BenchResult; version: string; onClose: () => void }) {
  const text = useMemo(() => formatBenchResult(result), [result]);
  const filename = useMemo(() => benchFilename(version, new Date(result.at)), [version, result.at]);
  const [message, setMessage] = useState('');
  const canShare = typeof navigator.share === 'function';

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage(fmt(t.benchDownloaded, { file: filename }));
  };

  const share = async () => {
    try {
      const file = new File([text], filename, { type: 'text/plain' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: t.benchResultsHeading });
      else await navigator.share({ title: t.benchResultsHeading, text });
      setMessage(t.benchShared);
    } catch (error) {
      if ((error as { name?: string })?.name !== 'AbortError') setMessage(t.benchShareFailed);
    }
  };

  const copy = async () => setMessage((await copyText(text)) ? t.measureCopied : t.measureCopyFailed);

  return (
    <div className="stack-dev__results" role="dialog" aria-modal="true" aria-labelledby="stack-bench-results">
      <h2 id="stack-bench-results" className="stack-dev__bench-heading">
        {t.benchResultsHeading}
      </h2>
      <pre className="stack-dev__results-text" tabIndex={0}>
        {text}
      </pre>
      <div className="stack-dev__controls">
        <button type="button" className="btn btn--small stack-dev__bench-button" onClick={download}>
          {t.benchDownload}
        </button>
        {canShare && (
          <button type="button" className="btn btn--small stack-dev__bench-button" onClick={() => void share()}>
            {t.benchShare}
          </button>
        )}
        <button type="button" className="btn btn--small stack-dev__bench-button" onClick={() => void copy()}>
          {t.benchCopy}
        </button>
        <button type="button" className="btn btn--small btn--quiet stack-dev__bench-button" onClick={onClose}>
          {t.benchClose}
        </button>
      </div>
      <p className="small muted" role="status">
        {message}
      </p>
    </div>
  );
}
