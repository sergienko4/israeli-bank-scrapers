/**
 * Browser-context payloads for {@link ./AnchorWalk.ts}.
 *
 * <p>Each exported function below is shipped INTO the page via
 * Playwright `locator.evaluateAll(fn)` — Playwright serializes
 * `fn.toString()` and runs it inside the browser, so each closure
 * MUST be fully self-contained (no module-scope imports, helpers,
 * or types). See {@link https://playwright.dev/docs/evaluating}.
 *
 * <p><b>Column-array data contract.</b> Instead of one closure that
 * returns compound tuples, each closure extracts ONE primitive
 * column for ALL ancestor elements. Node-side {@link ./AnchorWalk
 * .collectAncestorColumns} runs them in parallel via `Promise.all`
 * and {@link ./AnchorWalk.zipAncestorColumns} transforms the
 * columns into typed `IAncestorMeta[]`. This lets every closure
 * fit the canonical `CLEAN_CODE.md` cap-10 without raising the
 * ESLint ceiling (per `eslint-rules-guidlines.md` §1 + §3 +
 * `pr-guidlines.md` A3.5.2 "NO NEW grandfathers").
 *
 * <p><b>OCP.</b> Adding a new ancestor attribute = add one ≤10-LoC
 * column closure here + one zip line in `AnchorWalk.ts`. No edit
 * to the bridge or existing closures.
 *
 * <p>Phase 12d CR PR #345 — browser-eval decoupling addendum.
 */

/** Sibling-of-same-tag positional info for one ancestor. */
export interface ISibInfo {
  readonly index: number;
  readonly count: number;
}

/** Flat-column transport shape from browser to Node — one entry per ancestor. */
export interface IAncestorColumns {
  readonly tags: readonly string[];
  readonly ids: readonly string[];
  readonly forms: readonly boolean[];
  readonly inputs: readonly number[];
  readonly names: readonly string[];
  readonly classes: readonly string[];
  readonly sibs: readonly ISibInfo[];
}

/**
 * Browser closure: tag name of each ancestor element.
 * @param els - Array of ancestor DOM elements.
 * @returns Parallel column of `Element.tagName` (already upper-case per the DOM spec).
 */
export function getAncestorTags(els: Element[]): string[] {
  return els.map((e): string => e.tagName);
}

/**
 * Browser closure: id attribute of each ancestor.
 * @param els - Array of ancestor DOM elements.
 * @returns Parallel column; empty string when `id` is absent (DOM default).
 */
export function getAncestorIds(els: Element[]): string[] {
  return els.map((e): string => e.id);
}

/**
 * Browser closure: per-ancestor flag indicating a `<form>` element.
 * @param els - Array of ancestor DOM elements.
 * @returns Parallel boolean column (`true` iff `tagName === 'FORM'`).
 */
export function getAncestorFormFlags(els: Element[]): boolean[] {
  return els.map((e): boolean => e.tagName === 'FORM');
}

/**
 * Browser closure: count of `<input>` descendants per ancestor.
 * Used downstream to find form-like wrappers (fillable-input threshold).
 * @param els - Array of ancestor DOM elements.
 * @returns Parallel numeric column.
 */
export function getAncestorInputCounts(els: Element[]): number[] {
  return els.map((e): number => e.querySelectorAll('input').length);
}

/**
 * Browser closure: `name` attribute of each ancestor.
 * @param els - Array of ancestor DOM elements.
 * @returns Parallel column; empty string when `name` is absent (Node-side sentinel).
 */
export function getAncestorNames(els: Element[]): string[] {
  return els.map((e): string => e.getAttribute('name') ?? '');
}

/**
 * Browser closure: first non-`ng-*` class of each ancestor.
 * Angular adds dynamic `ng-*` classes that are unstable across runs;
 * the first non-Angular token is the stable identifier (e.g. Max's
 * `user-login-form`).
 * @param els - Array of ancestor DOM elements.
 * @returns Parallel column; empty string when no stable class exists.
 */
export function getAncestorStableClasses(els: Element[]): string[] {
  return els.map((e): string => {
    const parts = e.className.split(/\s+/u).filter((c): boolean => c.length > 0);
    return parts.find((c): boolean => !c.startsWith('ng-')) ?? '';
  });
}

/**
 * Browser closure: sibling-of-same-tag positional info per ancestor.
 * Used to emit `tag:nth-of-type(N)` selectors when no other identifier
 * is available.
 * @param els - Array of ancestor DOM elements.
 * @returns Parallel column of `{index, count}` (1-based index, sentinel `1/1` when orphan).
 */
export function getAncestorSibInfos(els: Element[]): ISibInfo[] {
  return els.map((e): ISibInfo => {
    const p = e.parentElement;
    const sibs = p ? [...p.children].filter((c): boolean => c.tagName === e.tagName) : null;
    return { index: sibs ? sibs.indexOf(e) + 1 : 1, count: sibs?.length ?? 1 };
  });
}
