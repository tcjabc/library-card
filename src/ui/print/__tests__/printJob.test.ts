import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { beginPrintJob, createPrintJobs, currentPrintJob, endPrintJob, PAGE_RULE, PAGE_RULE_ID, PRINT_JOB_ATTR, type PrintDocument } from '../printJob';

// 1.23.0: the print rules apply only while a print job is on. Before, the card print rules were
// global: once Grown-ups > Cards had loaded, printing any other screen printed a blank page.

/** A stand-in for document: <html>'s attributes and <head>'s style elements. */
function fakeDocument() {
  const attributes = new Map<string, string>();
  const styles: { id: string; textContent: string | null; remove(): void }[] = [];
  const doc: PrintDocument = {
    documentElement: {
      setAttribute: (name, value) => void attributes.set(name, value),
      removeAttribute: (name) => void attributes.delete(name),
      getAttribute: (name) => attributes.get(name) ?? null,
    },
    head: { appendChild: (node) => styles.push(node as (typeof styles)[number]) },
    getElementById: (id) => styles.find((s) => s.id === id) ?? null,
    createElement: () => {
      const style = { id: '', textContent: null as string | null, remove: () => void styles.splice(styles.indexOf(style), 1) };
      return style;
    },
  };
  return { doc, attributes, styles };
}

const src = fileURLToPath(new URL('../../../', import.meta.url));
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'vendor' ? [] : cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}
/** The body of every `@media print { … }` block in a stylesheet (nested braces counted). */
function printBlocks(css: string): string[] {
  const out: string[] = [];
  for (const match of css.matchAll(/@media print\s*\{/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

describe('print jobs', () => {
  it('a job sets the attribute and adds the A4 page rule; ending it removes both', () => {
    const { doc, attributes, styles } = fakeDocument();
    expect(currentPrintJob(doc)).toBeNull();
    beginPrintJob(doc, 'posters');
    expect(attributes.get(PRINT_JOB_ATTR)).toBe('posters');
    expect(currentPrintJob(doc)).toBe('posters');
    expect(styles).toEqual([expect.objectContaining({ id: PAGE_RULE_ID, textContent: PAGE_RULE })]);
    // A second start (the button, then the browser's beforeprint) doesn't add the rule twice.
    beginPrintJob(doc, 'posters');
    expect(styles).toHaveLength(1);
    endPrintJob(doc);
    expect(attributes.has(PRINT_JOB_ATTR)).toBe(false);
    expect(styles).toHaveLength(0);
    // Ending when nothing is printing is harmless (unmount after afterprint).
    endPrintJob(doc);
    expect(currentPrintJob(doc)).toBeNull();
  });

  /** A print root's controller with a record of what each layout pass would print. */
  function controller(fallback?: string) {
    const { doc, styles } = fakeDocument();
    const shown: (string | null)[] = [];
    const jobs = createPrintJobs(doc, (job) => shown.push(job));
    jobs.setFallback(fallback);
    /** What a layout pass prints now: the job in the root while the rules are on, else the screen. */
    const pass = () => {
      jobs.beforePrint();
      const job = currentPrintJob(doc);
      const printed = job !== null && shown[shown.length - 1] === job && styles.length === 1 ? job : 'the screen';
      jobs.afterPrint();
      return printed;
    };
    return { doc, jobs, shown, pass };
  }

  it('desktop: a print button prints its job for the whole dialog, then the page is plain again', () => {
    const { doc, jobs, shown } = controller('cards');
    jobs.request('posters');
    expect(shown).toEqual(['posters']);
    expect(currentPrintJob(doc)).toBe('posters');
    // window.print(): one beforeprint (already on, nothing changes), the dialog, one afterprint.
    jobs.beforePrint();
    expect(shown).toEqual(['posters']);
    jobs.afterPrint();
    expect(currentPrintJob(doc)).toBeNull();
    expect(shown).toEqual(['posters', null]);
  });

  it('Android: the early afterprint and the preview’s own layout passes all print the job asked for', () => {
    const { jobs, pass } = controller('cards');
    jobs.request('posters');
    jobs.afterPrint(); // About 0.2 s after print() returns, before the preview is drawn.
    expect(pass()).toBe('posters'); // The preview.
    expect(pass()).toBe('posters'); // Another paper size.
    // Back in the page: the next tap ends that request, and the browser's own Print prints the cards.
    jobs.userInput();
    expect(pass()).toBe('cards');
  });

  it('the browser’s own Print prints the fallback job on its screen, or the screen itself without one', () => {
    expect(controller('cards').pass()).toBe('cards');
    expect(controller().pass()).toBe('the screen');
    const { jobs, pass } = controller();
    jobs.request('posters');
    jobs.afterPrint();
    jobs.dispose(); // The screen goes away: nothing of it prints again.
    expect(pass()).toBe('the screen');
  });

  it('the page rule is A4 with no margin (the sheets pad themselves)', () => {
    expect(PAGE_RULE).toBe('@page { size: A4; margin: 0; }');
  });

  it('no stylesheet has a global page rule, and every print rule is scoped to a print job (or only hides a secret)', () => {
    const files = cssFiles(src);
    expect(files.length).toBeGreaterThan(5);
    let scoped = 0;
    for (const file of files) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, file).not.toContain('@page');
      for (const block of printBlocks(css)) {
        for (const [, selector, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          for (const part of selector.split(',').map((p) => p.trim())) {
            if (part.startsWith('html[data-print-job]')) {
              scoped++;
              continue;
            }
            // A rule that only keeps something off paper in every printout (the sync code) is fine;
            // nothing else may change how a screen prints.
            expect(body.trim(), `${file}: ${part}`).toBe('display: none;');
            expect(part, `${file}: ${part}`).not.toMatch(/#root|^html|^body|print-root/);
          }
        }
      }
    }
    expect(scoped).toBeGreaterThanOrEqual(4);
  });

  it('the card print sheet no longer carries print rules of its own (they are shared, in src/ui/print)', () => {
    const cards = readFileSync(join(src, 'grownups', 'tabs', 'cards-print.css'), 'utf8');
    expect(cards).not.toContain('@media print');
    expect(cards).not.toContain('.print-root');
    const shared = readFileSync(join(src, 'ui', 'print', 'print.css'), 'utf8');
    expect(shared).toMatch(/\.print-root \{\s*display: none;/);
    expect(shared).toMatch(/html\[data-print-job\] #root \{\s*display: none;/);
    expect(shared).toMatch(/html\[data-print-job\] \.print-root \{\s*display: block;\s*-webkit-print-color-adjust: exact;\s*print-color-adjust: exact;/);
  });

  it('the Cards tab prints through the shared root: no portal or window.print() of its own', () => {
    const tab = readFileSync(join(src, 'grownups', 'tabs', 'CardsTab.tsx'), 'utf8');
    expect(tab).not.toContain('createPortal');
    expect(tab).not.toContain('window.print');
    expect(tab).toContain('<PrintPages job={CARDS_JOB}>');
    const posters = readFileSync(join(src, 'grownups', 'cards', 'PostersSection.tsx'), 'utf8');
    expect(posters).toContain('<PrintPages job={POSTERS_JOB}>');
    expect(posters).not.toContain('window.print');
  });
});
