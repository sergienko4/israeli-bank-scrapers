/**
 * Form-walk: collect ancestor metadata in browser, then find form-like
 * in Node and emit a CSS selector.
 *
 * <p>Phase 12d split: extracted from {@link ../FormAnchor.ts}.
 */

import { type Frame, type Page } from 'playwright-core';

import { type Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import {
  ANCESTOR_XPATH,
  type AncestorTuple,
  EMPTY_RESULT,
  type IAncestorMeta,
  type IFormAnchor,
  MIN_FILLABLE_INPUTS,
} from './AnchorTypes.js';

export { type IFormAnchor } from './AnchorTypes.js';

const LOG = getDebug(import.meta.url);

/**
 * Convert a raw ancestor tuple from browser evaluate into typed metadata.
 * @param t - The raw tuple.
 * @returns Typed ancestor metadata.
 */
function tupleToMeta(t: AncestorTuple): IAncestorMeta {
  return {
    tag: t[0],
    id: t[1],
    isForm: t[2],
    fillCount: t[3],
    sibIndex: t[4],
    sibCount: t[5],
    name: t[6],
    stableClass: t[7],
  };
}

/**
 * Browser-context: map ancestor elements to metadata tuples.
 * Self-contained — Playwright serializes only this function.
 * @param els - Array of ancestor DOM elements.
 * @returns Array of ancestor tuples.
 */
function mapAncestorTuples(els: Element[]): AncestorTuple[] {
  return els.map((el): AncestorTuple => {
    const p = el.parentElement;
    const sibs = p ? [...p.children].filter((c): boolean => c.tagName === el.tagName) : null;
    // `String()` is the empty-string sentinel for "absent" attributes;
    // downstream `extractFormAnchorSelector` treats zero-length values as "not present".
    const absent = String();
    const filtered = el.className.split(/\s+/).filter((c): boolean => c.length > 0);
    const stableClass = filtered.find((c): boolean => !c.startsWith('ng-')) ?? absent;
    return [
      el.tagName,
      el.id,
      el.tagName === 'FORM',
      el.querySelectorAll('input').length,
      sibs ? sibs.indexOf(el) + 1 : 1,
      sibs?.length ?? 1,
      el.getAttribute('name') ?? absent,
      stableClass,
    ];
  });
}

/**
 * Walk up from an element collecting all ancestor metadata.
 * Uses Playwright locator.evaluateAll with fully inline callback.
 * @param ctx - The Page or Frame to evaluate in.
 * @param selector - CSS/XPath selector for the starting element.
 * @returns Array of typed ancestor metadata from nearest to farthest.
 */
async function collectAncestorMeta(ctx: Page | Frame, selector: string): Promise<IAncestorMeta[]> {
  const ancestorLoc = ctx.locator(selector).first().locator(ANCESTOR_XPATH);
  if ((await ancestorLoc.count()) === 0) return [];
  const tuples = await ancestorLoc.evaluateAll(mapAncestorTuples);
  const reversed = [...tuples];
  reversed.reverse();
  return reversed.map(tupleToMeta);
}

/**
 * Build a CSS selector from ancestor metadata. Preference order (most to
 * least stable):
 *   1. `#id`             — explicit id
 *   2. `tag[name="X"]`   — name attribute (form/input common)
 *   3. `tag.classX`      — first non-Angular class (e.g. Max's `.user-login-form`)
 *   4. `tag:nth-of-type` — positional fallback (Discount-style; intentionally
 *      LAST because it is fragile and historically caused regressions)
 *   5. `tag` alone — only when single sibling and no other identifier
 * The downstream `extractFormAnchorSelector` guard accepts options 1–3 only;
 * positional/tag-only selectors are rejected to avoid the "div:nth-of-type(0)"
 * trap. This function emits the BEST AVAILABLE selector regardless of trust;
 * the trust filter happens at the caller.
 * @param meta - The ancestor metadata.
 * @returns A CSS selector string (typed via IFormAnchor['selector']).
 */
function buildSelectorFromMeta(meta: IAncestorMeta): IFormAnchor['selector'] {
  if (meta.id) return '#' + meta.id;
  const tag = meta.tag.toLowerCase();
  if (meta.name.length > 0) return tag + '[name="' + meta.name + '"]';
  if (meta.stableClass.length > 0) return tag + '.' + meta.stableClass;
  if (meta.sibCount <= 1) return tag;
  return tag + ':nth-of-type(' + String(meta.sibIndex) + ')';
}

/**
 * Run the form-walk: collect ancestor metadata in browser, then find
 * form-like in Node. Two-phase approach: browser evaluate returns
 * metadata array, Node finds and builds selector.
 * @param ctx - The Page or Frame containing the input.
 * @param resolvedSelector - CSS/XPath selector for the already-resolved input.
 * @returns The form CSS selector, or empty string if not found.
 */
async function evaluateFormWalk(
  ctx: Page | Frame,
  resolvedSelector: string,
): Promise<IFormAnchor['selector']> {
  const loc = ctx.locator(resolvedSelector).first();
  if ((await loc.count()) === 0) return '';
  const ancestors = await collectAncestorMeta(ctx, resolvedSelector);
  // Prefer the actual `<form>` element over wrapper divs that happen to contain
  // 2+ inputs. The wrapper-DIV scope often includes header nav elements that
  // share aria-labels with form controls (e.g. Max's `<a aria-label="כניסה">`
  // sibling to the form's submit button) — scoping to the form itself excludes
  // those and produces unambiguous click resolution.
  const formTag = ancestors.find((m): boolean => m.isForm);
  const fallback = ancestors.find((m): boolean => m.fillCount >= MIN_FILLABLE_INPUTS);
  const formAncestor = formTag ?? fallback;
  if (!formAncestor) return '';
  return buildSelectorFromMeta(formAncestor);
}

/**
 * From a resolved input element, walk up the DOM to find the nearest form.
 * Looks for a form tag first, then any container with 2+ fillable inputs.
 * @param ctx - The Page or Frame containing the resolved input.
 * @param resolvedSelector - The CSS/XPath selector for the already-resolved input.
 * @returns A form anchor with a unique selector, or Nullable when no form found.
 */
export async function discoverFormAnchor(
  ctx: Page | Frame,
  resolvedSelector: string,
): Promise<Nullable<IFormAnchor>> {
  const formSelector = await evaluateFormWalk(ctx, resolvedSelector);
  if (!formSelector) return EMPTY_RESULT;
  LOG.debug({
    message: `discovered form anchor: ${maskVisibleText(formSelector)}`,
  });
  return { selector: formSelector, context: ctx };
}
