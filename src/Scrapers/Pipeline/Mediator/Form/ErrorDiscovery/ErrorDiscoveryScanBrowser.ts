/**
 * Browser-context payloads for {@link ./ErrorDiscoveryScan.ts}.
 *
 * <p>Each exported function below is shipped INTO the page via
 * Playwright `ctx.evaluate(fn, arg)` — Playwright serializes
 * `fn.toString()` and runs it inside the browser, so each closure
 * MUST be fully self-contained (no module-scope imports, helpers,
 * or types). See {@link https://playwright.dev/docs/evaluating}.
 *
 * <p><b>Column-array data contract.</b> Instead of one closure that
 * returns compound `IRawDomItem[]`, each closure extracts ONE
 * primitive column for ALL matching elements. Node-side
 * {@link ./ErrorDiscoveryScan.collectErrorColumns} runs the 4
 * closures in parallel via `Promise.all` and
 * {@link ./ErrorDiscoveryScan.zipErrorColumns} transforms columns
 * into `IRawDomItem[]`. This lets every closure fit the canonical
 * `CLEAN_CODE.md` cap-10 without raising the ESLint ceiling
 * (per `eslint-rules-guidlines.md` §1 + §3 + `pr-guidlines.md`
 * A3.5.2 "NO NEW grandfathers").
 *
 * <p><b>Field exclusion at the CSS layer.</b> The Node-side caller
 * appends `:not(input):not(select):not(textarea)` per disjunct
 * (see {@link ./ErrorDiscoveryScan.withoutFieldsSelector}) so each
 * browser closure can do a single `querySelectorAll(sel).map(...)`
 * — no per-element field-tag filter is needed in browser code.
 *
 * <p><b>OCP.</b> Adding a new column = add one ≤10-LoC closure here
 * + one zip line in `ErrorDiscoveryScan.ts`. No edit to the bridge
 * or existing closures.
 *
 * <p>Phase 12d CR PR #345 — browser-eval decoupling addendum.
 */

/** Flat-column transport shape from browser to Node — one entry per matched element. */
export interface IErrorColumns {
  readonly tags: readonly string[];
  readonly classes: readonly string[];
  readonly texts: readonly string[];
  readonly hidden: readonly boolean[];
}

/** Browser-side argument bundle for {@link getErrorClasses} (sel + noClass sentinel). */
export interface IErrorClassesArg {
  readonly sel: string;
  readonly noClass: string;
}

/**
 * Browser closure: lowercase tag name of each matched element.
 * @param sel - Pre-filtered CSS selector (caller already excludes input/select/textarea).
 * @returns Parallel column of lowercase tag names.
 */
export function getErrorTags(sel: string): string[] {
  return [...document.querySelectorAll(sel)].map((e): string => e.tagName.toLowerCase());
}

/**
 * Browser closure: `class` attribute (or sentinel) of each matched element.
 * @param arg - Selector + `noClass` sentinel bundle.
 * @returns Parallel column of class strings.
 */
export function getErrorClasses(arg: IErrorClassesArg): string[] {
  const nodes = document.querySelectorAll(arg.sel);
  const els = Array.from(nodes);
  return els.map((e): string => {
    const attr = e.getAttribute('class');
    if (attr === null || attr.trim().length === 0) return arg.noClass;
    return attr;
  });
}

/**
 * Browser closure: trimmed `textContent` of each matched element.
 * @param sel - Pre-filtered CSS selector.
 * @returns Parallel column of trimmed visible text.
 */
export function getErrorTexts(sel: string): string[] {
  const nodes = document.querySelectorAll(sel);
  const els = Array.from(nodes);
  return els.map((e): string => e.textContent.trim());
}

/**
 * Browser closure: per-element hidden-flag derived from computed style.
 * @param sel - Pre-filtered CSS selector.
 * @returns Parallel boolean column (`true` when `display:none` or `visibility:hidden`).
 */
export function getErrorHidden(sel: string): boolean[] {
  return [...document.querySelectorAll(sel)].map((e): boolean => {
    const cs = globalThis.getComputedStyle(e);
    return cs.display === 'none' || cs.visibility === 'hidden';
  });
}
