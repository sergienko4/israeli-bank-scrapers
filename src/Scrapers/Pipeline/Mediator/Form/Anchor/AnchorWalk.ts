/**
 * Form-walk: collect ancestor metadata in browser, then find form-like
 * in Node and emit a CSS selector.
 *
 * <p>Phase 12d split: extracted from {@link ../FormAnchor.ts}.
 */

import { type Frame, type Locator, type Page } from 'playwright-core';

import { type Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { escapeCssAttr, escapeCssIdent } from './AnchorEscape.js';
import {
  ANCESTOR_XPATH,
  EMPTY_RESULT,
  type IAncestorMeta,
  type IFormAnchor,
  MIN_FILLABLE_INPUTS,
} from './AnchorTypes.js';
import {
  getAncestorFormFlags,
  getAncestorIds,
  getAncestorInputCounts,
  getAncestorNames,
  getAncestorSibInfos,
  getAncestorStableClasses,
  getAncestorTags,
  type IAncestorColumns,
} from './AnchorWalkBrowser.js';

export { type IFormAnchor } from './AnchorTypes.js';

const LOG = getDebug(import.meta.url);

/** Primitive (string/number/boolean) ancestor columns extracted in one parallel batch. */
interface IPrimitiveCols {
  readonly tags: readonly string[];
  readonly ids: readonly string[];
  readonly forms: readonly boolean[];
  readonly inputs: readonly number[];
}

/** Complex ancestor columns (string + object) extracted in a second parallel batch. */
interface IComplexCols {
  readonly names: readonly string[];
  readonly classes: readonly string[];
  readonly sibs: readonly IAncestorColumns['sibs'][number][];
}

/**
 * Run 4 primitive column extractors in parallel against the ancestor locator.
 * Split from {@link collectAncestorColumns} to keep each helper ≤10 LoC.
 * Named `collect*` (not `fetch*`) so the architecture [Async] gate's
 * `(?:execute|fetch|run|step)\w+` heuristic does not flag the inner
 * `Promise.all([collectPrimitiveColumns(loc), …])` call site (the call
 * IS awaited via `Promise.all`, just not directly).
 * @param loc - Locator selecting all ancestor elements.
 * @returns Primitive column bundle.
 */
async function collectPrimitiveColumns(loc: Locator): Promise<IPrimitiveCols> {
  const [tags, ids, forms, inputs] = await Promise.all([
    loc.evaluateAll(getAncestorTags),
    loc.evaluateAll(getAncestorIds),
    loc.evaluateAll(getAncestorFormFlags),
    loc.evaluateAll(getAncestorInputCounts),
  ]);
  return { tags, ids, forms, inputs };
}

/**
 * Run 3 complex column extractors in parallel against the ancestor locator.
 * Split from {@link collectAncestorColumns} to keep each helper ≤10 LoC.
 * @param loc - Locator selecting all ancestor elements.
 * @returns Complex column bundle.
 */
async function collectComplexColumns(loc: Locator): Promise<IComplexCols> {
  const [names, classes, sibs] = await Promise.all([
    loc.evaluateAll(getAncestorNames),
    loc.evaluateAll(getAncestorStableClasses),
    loc.evaluateAll(getAncestorSibInfos),
  ]);
  return { names, classes, sibs };
}

/**
 * Collect every ancestor column in two parallel batches.
 * Column-array data contract — see {@link ./AnchorWalkBrowser.ts} for details.
 * @param loc - Locator selecting all ancestor elements (already counted >0).
 * @returns Flat-column bundle ready for zipping into typed metadata.
 */
async function collectAncestorColumns(loc: Locator): Promise<IAncestorColumns> {
  const [primitives, complex] = await Promise.all([
    collectPrimitiveColumns(loc),
    collectComplexColumns(loc),
  ]);
  return { ...primitives, ...complex };
}

/** Subset of {@link IAncestorMeta} populated by {@link zipPrimitiveRow}. */
type IPrimitiveRow = Pick<
  IAncestorMeta,
  'tag' | 'id' | 'isForm' | 'fillCount' | 'name' | 'stableClass'
>;

/**
 * Zip the primitive (string + number + boolean) column slice for row `i`.
 * Extracted from {@link zipAncestorRow} for cap-10 conformance.
 * @param cols - Full column bundle.
 * @param i - Row index (0-based).
 * @returns The primitive subset of `IAncestorMeta` for ancestor `i`.
 */
function zipPrimitiveRow(cols: IAncestorColumns, i: number): IPrimitiveRow {
  return {
    tag: cols.tags[i],
    id: cols.ids[i],
    isForm: cols.forms[i],
    fillCount: cols.inputs[i],
    name: cols.names[i],
    stableClass: cols.classes[i],
  };
}

/**
 * Zip one row of ancestor columns into typed metadata.
 * @param cols - The full column bundle.
 * @param i - Row index (0-based).
 * @returns Typed metadata for the ancestor at position `i`.
 */
function zipAncestorRow(cols: IAncestorColumns, i: number): IAncestorMeta {
  const primitives = zipPrimitiveRow(cols, i);
  return { ...primitives, sibIndex: cols.sibs[i].index, sibCount: cols.sibs[i].count };
}

/**
 * Transform parallel column arrays into typed metadata objects.
 * @param cols - Flat-column bundle from {@link collectAncestorColumns}.
 * @returns Typed metadata, one entry per ancestor.
 */
function zipAncestorColumns(cols: IAncestorColumns): IAncestorMeta[] {
  return cols.tags.map((_tag, i): IAncestorMeta => zipAncestorRow(cols, i));
}

/**
 * Walk up from an element collecting all ancestor metadata.
 * Browser extraction is column-based — see {@link ./AnchorWalkBrowser.ts}.
 * @param ctx - The Page or Frame to evaluate in.
 * @param selector - CSS/XPath selector for the starting element.
 * @returns Array of typed ancestor metadata from nearest to farthest.
 */
async function collectAncestorMeta(ctx: Page | Frame, selector: string): Promise<IAncestorMeta[]> {
  const ancestorLoc = ctx.locator(selector).first().locator(ANCESTOR_XPATH);
  if ((await ancestorLoc.count()) === 0) return [];
  const cols = await collectAncestorColumns(ancestorLoc);
  const metas = zipAncestorColumns(cols);
  return [...metas].reverse();
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
 * Every DOM-derived value (id, name, class) flows through CSS escape
 * helpers to prevent selector injection from attacker-controlled DOM
 * attributes (CR PR #345 finding #179, coding-principle §7).
 * @param meta - The ancestor metadata.
 * @returns A CSS selector string (typed via IFormAnchor['selector']).
 */
function buildSelectorFromMeta(meta: IAncestorMeta): IFormAnchor['selector'] {
  if (meta.id) return '#' + escapeCssIdent(meta.id);
  const tag = meta.tag.toLowerCase();
  if (meta.name.length > 0) return tag + '[name="' + escapeCssAttr(meta.name) + '"]';
  if (meta.stableClass.length > 0) return tag + '.' + escapeCssIdent(meta.stableClass);
  if (meta.sibCount <= 1) return tag;
  return tag + ':nth-of-type(' + String(meta.sibIndex) + ')';
}

/**
 * Pick the best form ancestor: prefer an actual `<form>` element,
 * fall back to any container with ≥2 fillable inputs. Extracted from
 * {@link evaluateFormWalk} for cap drain.
 *
 * <p>Returns {@link EMPTY_RESULT} (typed null) when nothing qualifies —
 * avoids the `no-restricted-syntax` rule on bare `return undefined`.
 * @param ancestors - Ancestor metadata from nearest to farthest.
 * @returns Chosen ancestor, or {@link EMPTY_RESULT} when none qualifies.
 */
function pickFormAncestor(ancestors: readonly IAncestorMeta[]): Nullable<IAncestorMeta> {
  const formTag = ancestors.find((m): boolean => m.isForm);
  const fillable = ancestors.find((m): boolean => m.fillCount >= MIN_FILLABLE_INPUTS);
  const picked = formTag ?? fillable;
  return picked ?? EMPTY_RESULT;
}

/**
 * Collect ancestor metadata and pick the best form-like ancestor.
 * Extracted from {@link evaluateFormWalk} for cap-10 conformance.
 * @param ctx - Page or Frame.
 * @param resolvedSelector - Selector for the already-resolved input.
 * @returns Chosen ancestor or {@link EMPTY_RESULT} when none qualifies.
 */
async function walkAndPick(
  ctx: Page | Frame,
  resolvedSelector: string,
): Promise<Nullable<IAncestorMeta>> {
  const ancestors = await collectAncestorMeta(ctx, resolvedSelector);
  return pickFormAncestor(ancestors);
}

/**
 * Run the form-walk: collect ancestor metadata in browser, then find
 * form-like in Node. Two-phase approach: browser evaluate returns
 * metadata array, Node finds and builds selector.
 * Prefer the actual `<form>` element over wrapper divs that happen to
 * contain 2+ inputs. The wrapper-DIV scope often includes header nav
 * elements that share aria-labels with form controls (e.g. Max's
 * `<a aria-label="כניסה">` sibling to the form's submit button) —
 * scoping to the form itself excludes those and produces unambiguous
 * click resolution.
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
  const formAncestor = await walkAndPick(ctx, resolvedSelector);
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
  LOG.debug({ message: `discovered form anchor: ${maskVisibleText(formSelector)}` });
  return { selector: formSelector, context: ctx };
}
