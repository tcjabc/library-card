import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 1.21.1: the PRODUCTION CSS keeps a fallback before every newer viewport unit, and writes media
// queries old browsers understand. Vite's default CSS target treated dvh/lvh/svh as safe and the
// minifier dropped the `100vh` line before each one (Chrome 103 got no height at all: the journey
// scene was 0 px tall), and it rewrote min-width/max-width queries into range syntax
// (`width>=48rem`), which Chrome only reads from 104. The fix is build.cssTarget in vite.config.ts
// (Chrome / Edge 103, Safari 15). This runs the real production build (vite build, with that
// config) into a temp folder and reads every CSS file it writes.

/** Units newer than our oldest browsers: each needs a fallback first, or an @supports guard. */
const NEW_UNIT = /\d(?:dvh|lvh|svh|dvw|lvw|svw|dvb|lvb|svb|dvi|lvi|svi|dvmin|lvmin|svmin|dvmax|lvmax|svmax)\b/;

interface Declaration {
  /** The rule's selector, with any @media / @supports around it. */
  where: string;
  property: string;
  value: string;
  /** The declarations before it in the same rule. */
  before: { property: string; value: string }[];
  /** The @supports conditions around it. */
  supports: string[];
}

/** Every declaration in a (minified) stylesheet, with its rule and the at-rules around it. */
function declarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  const stack: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', i);
    if (close === -1) break;
    if (open !== -1 && open < close) {
      const prelude = css.slice(i, open).trim();
      const next = css.indexOf('{', open + 1);
      const end = css.indexOf('}', open + 1);
      if (prelude.startsWith('@') || (next !== -1 && next < end)) {
        // An at-rule (or anything holding nested blocks): go inside.
        stack.push(prelude);
        i = open + 1;
        continue;
      }
      const body = css.slice(open + 1, end);
      const before: { property: string; value: string }[] = [];
      for (const part of body.split(';')) {
        const colon = part.indexOf(':');
        if (colon < 1) continue;
        const property = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).trim();
        out.push({ where: [...stack, prelude].join(' > '), property, value, before: [...before], supports: stack.filter((s) => s.startsWith('@supports')) });
        before.push({ property, value });
      }
      i = end + 1;
      continue;
    }
    stack.pop();
    i = close + 1;
  }
  return out;
}

let outDir = '';
let files: { name: string; css: string }[] = [];

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'lc-cssbuild-'));
  // The Vite command line in its own process: building inside the test runner's module loader is far slower.
  const vite = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  const run = spawnSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`vite build failed: ${run.stderr || run.stdout}`);
  const assets = join(outDir, 'assets');
  files = readdirSync(assets)
    .filter((name) => name.endsWith('.css'))
    .map((name) => ({ name, css: readFileSync(join(assets, name), 'utf8') }));
}, 180_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('the production CSS keeps its viewport-unit fallbacks (Chrome 103, Safari 15)', () => {
  it('every dvh/lvh/svh-style declaration has a vh, % or fixed fallback before it in the same rule, or an @supports guard', () => {
    const checked: string[] = [];
    for (const { name, css } of files) {
      for (const d of declarations(css)) {
        if (!NEW_UNIT.test(d.value)) continue;
        checked.push(`${name.replace(/-[\w-]{8}\.css$/, '')}: ${d.where} { ${d.property}: ${d.value} }`);
        const guarded = d.supports.some((s) => NEW_UNIT.test(s));
        const fallback = d.before.some((b) => b.property === d.property && !NEW_UNIT.test(b.value));
        expect(guarded || fallback, `no fallback before ${d.where} { ${d.property}: ${d.value} } in ${name}`).toBe(true);
      }
    }
    // The rules this release fixed (and the scanner's guarded ones) are all among those checked.
    const joined = checked.join('\n');
    for (const rule of ['.journey-scene { height: 100lvh }', '.stack-dev { height: 100dvh }', '.stack-dev__panel { max-height: 50dvh }', 'body { min-height: 100dvh }', '.sheet { max-height: 92dvh }', '--scanner-max-height: 55svh', '--scanner-max-height: 50svh']) {
      expect(joined, rule).toContain(rule);
    }
  });

  it('the journey scene’s fallback is a full-view height, so Chrome 103 still sees the scene', () => {
    const scene = files.flatMap(({ css }) => declarations(css)).find((d) => d.where === '.journey-scene' && d.value === '100lvh');
    expect(scene?.before).toContainEqual({ property: 'height', value: '100vh' });
  });

  it('media queries use min-/max- features, not range syntax (Chrome reads `width>=…` only from 104)', () => {
    for (const { name, css } of files) {
      const queries = css.match(/@media[^{]*/g) ?? [];
      for (const query of queries) expect(query, `${name}: ${query}`).not.toMatch(/\((?:width|height|aspect-ratio)\s*[<>]=?/);
    }
    expect(files.some(({ css }) => css.includes('@media (min-width:48rem)'))).toBe(true);
  });
});
