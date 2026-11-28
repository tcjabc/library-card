/**
 * The print job switch (1.23.0). The print rules in print.css apply only while <html> carries
 * PRINT_JOB_ATTR, and the A4 page rule exists only while a job is on: printing any other screen
 * prints that screen, as the browser would. Before 1.23.0 the card print rules were global, so once
 * Grown-ups > Cards had loaded, printing any other screen printed a blank page.
 *
 * PrintRoot.tsx starts a job when a print button is pressed (or when the browser's own Print is
 * used on a screen with a default job) and ends it on afterprint, or when the screen goes away.
 */

export const PRINT_JOB_ATTR = 'data-print-job';

/** The id of the <style> holding the page rule while a job is on. */
export const PAGE_RULE_ID = 'print-job-page';

/** A4, no page margin: every printable sheet is real size and pads itself (theme.css --print-*). */
export const PAGE_RULE = '@page { size: A4; margin: 0; }';

/** The few parts of a Document used here (a stub in Node tests). */
export interface PrintDocument {
  documentElement: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void; getAttribute(name: string): string | null };
  head: { appendChild(node: unknown): unknown };
  getElementById(id: string): { remove(): void } | null;
  createElement(tag: 'style'): { id: string; textContent: string | null };
}

/** Starts printing `job`: the print rules and the page rule apply from now. */
export function beginPrintJob(doc: PrintDocument, job: string): void {
  doc.documentElement.setAttribute(PRINT_JOB_ATTR, job);
  if (!doc.getElementById(PAGE_RULE_ID)) {
    const style = doc.createElement('style');
    style.id = PAGE_RULE_ID;
    style.textContent = PAGE_RULE;
    doc.head.appendChild(style);
  }
}

/** Ends any print job: the page prints as plain screen content again. */
export function endPrintJob(doc: PrintDocument): void {
  doc.documentElement.removeAttribute(PRINT_JOB_ATTR);
  doc.getElementById(PAGE_RULE_ID)?.remove();
}

/** The job printing now, if any. */
export function currentPrintJob(doc: PrintDocument): string | null {
  return doc.documentElement.getAttribute(PRINT_JOB_ATTR);
}

/**
 * Which job each print layout pass prints. Desktop Chrome brackets the whole dialog with one
 * beforeprint / afterprint. Android Chrome (checked on 103) fires afterprint about 0.2 s after
 * print() returns, then lays the page out again for its own preview with another beforeprint /
 * afterprint pair, and again when the paper changes. So the job a print button asked for stays
 * requested through every pass, until the next tap or key press on the page (the dialog is gone
 * by then); a pass with no request prints the screen's fallback job, if it has one.
 */
export interface PrintJobs {
  /** A print button: puts `job` in the root now (the caller then opens the dialog). */
  request(job: string): void;
  /** On beforeprint: (re)starts the requested job, else the fallback. */
  beforePrint(): void;
  /** On afterprint: the page is plain screen content again (the request stays). */
  afterPrint(): void;
  /** On any tap or key press: the request is done with. */
  userInput(): void;
  /** The job the browser's own Print prints on this screen (undefined: the screen itself). */
  setFallback(job: string | undefined): void;
  /** The screen goes away. */
  dispose(): void;
}

/** `show` puts a job's pages in the print root (or none), synchronously, before layout. */
export function createPrintJobs(doc: PrintDocument, show: (job: string | null) => void): PrintJobs {
  let requested: string | null = null;
  let fallback: string | undefined;
  const begin = (job: string) => {
    show(job);
    beginPrintJob(doc, job);
  };
  return {
    request(job) {
      requested = job;
      begin(job);
    },
    beforePrint() {
      if (currentPrintJob(doc) !== null) return; // Already on (a print button, this same pass).
      const job = requested ?? fallback;
      if (job) begin(job);
    },
    afterPrint() {
      endPrintJob(doc);
      show(null);
    },
    userInput() {
      requested = null;
    },
    setFallback(job) {
      fallback = job;
    },
    dispose() {
      requested = null;
      endPrintJob(doc);
    },
  };
}
