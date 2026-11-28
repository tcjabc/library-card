import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createPrintJobs } from './printJob';
import './print.css';

interface PrintContextValue {
  /** The job whose pages are in the print root now (null: none). */
  active: string | null;
  root: HTMLElement | null;
  /** Puts `job`'s pages (and only those) in the print root, then opens the print dialog. */
  print(job: string): void;
}

const PrintContext = createContext<PrintContextValue | null>(null);

/**
 * One print root for a screen with printable pages (Grown-ups > Cards: the cards and the posters).
 * Each kind of page is a job: <PrintPages job="…"> renders its pages into the root only while
 * that job is printing, and printJob.ts scopes the print rules to that time (and keeps a button's
 * job through every layout pass Android's print preview makes). `fallback` is the job the
 * browser's own Print (Ctrl+P, the menu) prints on this screen; without one it prints the screen.
 */
export function PrintRoot({ fallback, children }: { fallback?: string; children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  // The pages must be in the DOM before each layout pass, so `show` renders synchronously.
  const [jobs] = useState(() => (typeof document === 'undefined' ? null : createPrintJobs(document, (job) => flushSync(() => setActive(job)))));

  useEffect(() => jobs?.setFallback(fallback), [jobs, fallback]);

  useEffect(() => {
    if (!jobs) return;
    const before = () => jobs.beforePrint();
    const after = () => jobs.afterPrint();
    const input = () => jobs.userInput();
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    // Capture: a tap on a print button clears the old request before its click makes a new one.
    window.addEventListener('pointerdown', input, true);
    window.addEventListener('keydown', input, true);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      window.removeEventListener('pointerdown', input, true);
      window.removeEventListener('keydown', input, true);
      jobs.dispose();
    };
  }, [jobs]);

  const print = useCallback(
    (job: string) => {
      jobs?.request(job);
      window.print();
    },
    [jobs],
  );

  const value = useMemo(() => ({ active, root, print }), [active, root, print]);
  return (
    <PrintContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' && createPortal(<div ref={setRoot} className="print-root" />, document.body)}
    </PrintContext.Provider>
  );
}

/** A job's printable pages: in the print root while that job prints, nowhere otherwise. */
export function PrintPages({ job, children }: { job: string; children: ReactNode }) {
  const context = useContext(PrintContext);
  return context?.root && context.active === job ? createPortal(children, context.root) : null;
}

/** Starts a print job (inside a PrintRoot). */
// eslint-disable-next-line react-refresh/only-export-components
export function usePrint(): (job: string) => void {
  const context = useContext(PrintContext);
  if (!context) throw new Error('usePrint needs a PrintRoot');
  return context.print;
}
