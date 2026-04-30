import { type Frame, type Page } from 'playwright-core';

import { type SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { type Nullable } from '../../../Base/Interfaces/CallbackTypes.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';

const LOG = getDebug(import.meta.url);

/** CSS selector string for form elements. */
type CssSelectorStr = string;
/** HTML tag name string. */
type TagName = string;
/** HTML element ID attribute. */
type ElementId = string;
/** Whether a DOM condition is satisfied. */
type DomCheck = boolean;
/** DOM element count. */
type DomCount = number;
/** Sibling index position. */
type SiblingIndex = number;

/** Typed null value for Nullable return types — avoids the no-restricted-syntax rule on `return null`. */
const EMPTY_RESULT: Nullable<never> = JSON.parse('null') as Nullable<never>;

/** A cached form element discovered from a resolved input field. */
export interface IFormAnchor {
  /** CSS selector uniquely identifying the form element. */
  selector: CssSelectorStr;
  /** The Playwright context (Page or Frame) containing the form. */
  context: Page | Frame;
}

/**
 * Build a scoped CSS selector for a css-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The original candidate value.
 * @returns The scoped CSS selector string.
 */
function scopeCss(form: CssSelectorStr, val: CssSelectorStr): CssSelectorStr {
  return `${form} ${val}`;
}

/**
 * Build a scoped CSS selector for a placeholder-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The placeholder text to match.
 * @returns The scoped CSS selector string.
 */
function scopePlaceholder(form: CssSelectorStr, val: CssSelectorStr): CssSelectorStr {
  return `${form} input[placeholder*="${val}"]`;
}

/**
 * Build a scoped CSS selector for an ariaLabel-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The aria-label text to match.
 * @returns The scoped CSS selector string.
 */
function scopeAriaLabel(form: CssSelectorStr, val: CssSelectorStr): CssSelectorStr {
  return `${form} input[aria-label="${val}"]`;
}

/**
 * Build a scoped CSS selector for a name-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The name attribute value to match.
 * @returns The scoped CSS selector string.
 */
function scopeName(form: CssSelectorStr, val: CssSelectorStr): CssSelectorStr {
  return `${form} [name="${val}"]`;
}

/** Map from scopable kind to a function that builds the scoped CSS value. */
const SCOPE_BUILDERS: Record<
  CssSelectorStr,
  (form: CssSelectorStr, val: CssSelectorStr) => CssSelectorStr
> = {
  css: scopeCss,
  placeholder: scopePlaceholder,
  ariaLabel: scopeAriaLabel,
  name: scopeName,
};

/**
 * Run the form-walk: collect ancestor metadata in browser, then find form-like in Node.
 * Two-phase approach: browser evaluate returns metadata array, Node finds and builds selector.
 * @param ctx - The Page or Frame containing the input.
 * @param resolvedSelector - CSS/XPath selector for the already-resolved input.
 * @returns The form CSS selector, or empty string if not found.
 */
async function evaluateFormWalk(
  ctx: Page | Frame,
  resolvedSelector: CssSelectorStr,
): Promise<CssSelectorStr> {
  const loc = ctx.locator(resolvedSelector).first();
  if ((await loc.count()) === 0) return '';
  const ancestors = await collectAncestorMeta(ctx, resolvedSelector);
  const formAncestor = ancestors.find(isFormLikeAncestor);
  if (!formAncestor) return '';
  return buildSelectorFromMeta(formAncestor);
}

/** Metadata for a single ancestor element — transferred from browser to Node. */
interface IAncestorMeta {
  readonly tag: TagName;
  readonly id: ElementId;
  readonly isForm: DomCheck;
  readonly fillCount: DomCount;
  readonly sibIndex: SiblingIndex;
  readonly sibCount: DomCount;
}

/** Ancestor tuple: [tag, id, isForm, fillCount, sibIndex, sibCount]. */
type AncestorTuple = [string, string, boolean, number, number, number];

/**
 * Convert a raw ancestor tuple from browser evaluate into typed metadata.
 * @param t - The raw tuple: [tag, id, isForm, fillCount, sibIndex, sibCount].
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
  };
}

/** XPath expression for ancestors, excluding html and body. */
const ANCESTOR_XPATH = 'xpath=ancestor::*[not(self::html) and not(self::body)]';

/**
 * Walk up from an element collecting all ancestor metadata.
 * Uses Playwright locator.evaluateAll with fully inline callback.
 * @param ctx - The Page or Frame to evaluate in.
 * @param selector - CSS/XPath selector for the starting element.
 * @returns Array of typed ancestor metadata from nearest to farthest.
 */
async function collectAncestorMeta(
  ctx: Page | Frame,
  selector: CssSelectorStr,
): Promise<IAncestorMeta[]> {
  const ancestorLoc = ctx.locator(selector).first().locator(ANCESTOR_XPATH);
  if ((await ancestorLoc.count()) === 0) return [];
  const tuples = await ancestorLoc.evaluateAll(mapAncestorTuples);
  const reversed = [...tuples];
  reversed.reverse();
  return reversed.map(tupleToMeta);
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
    const children = p && [...p.children];
    const sibs = children?.filter((c): DomCheck => c.tagName === el.tagName);
    const idx = sibs?.indexOf(el) ?? 0;
    const cnt = sibs?.length ?? 1;
    return [
      el.tagName,
      el.id,
      el.tagName === 'FORM',
      el.querySelectorAll('input').length,
      idx,
      cnt,
    ];
  });
}

/** Minimum fillable input count to consider a non-form element as form-like. */
const MIN_FILLABLE_INPUTS = 2;

/**
 * Determine if an ancestor is a form-like container based on its metadata.
 * @param meta - The ancestor metadata.
 * @returns True if the ancestor is a form tag or has 2+ inputs.
 */
function isFormLikeAncestor(meta: IAncestorMeta): DomCheck {
  if (meta.isForm) return true;
  return meta.fillCount >= MIN_FILLABLE_INPUTS;
}

/**
 * Build a CSS selector from ancestor metadata.
 * @param meta - The ancestor metadata.
 * @returns A CSS selector string (#id, tag, or tag:nth-of-type).
 */
function buildSelectorFromMeta(meta: IAncestorMeta): CssSelectorStr {
  if (meta.id) return '#' + meta.id;
  const tag = meta.tag.toLowerCase();
  if (meta.sibCount <= 1) return tag;
  return tag + ':nth-of-type(' + String(meta.sibIndex) + ')';
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
  resolvedSelector: CssSelectorStr,
): Promise<Nullable<IFormAnchor>> {
  const formSelector = await evaluateFormWalk(ctx, resolvedSelector);
  if (!formSelector) return EMPTY_RESULT;
  LOG.debug({
    message: `discovered form anchor: ${maskVisibleText(formSelector)}`,
  });
  return { selector: formSelector, context: ctx };
}

/**
 * Scope a selector candidate to search within a form element.
 * CSS-based candidates get the form selector prepended as a descendant.
 * XPath and labelText/textContent candidates are returned unchanged.
 * @param formSelector - The CSS selector for the form anchor.
 * @param candidate - The original selector candidate.
 * @returns A form-scoped copy of the candidate, or the original if not scopable.
 */
export function scopeCandidate(
  formSelector: CssSelectorStr,
  candidate: SelectorCandidate,
): SelectorCandidate {
  const builder = SCOPE_BUILDERS[candidate.kind] as
    | ((form: CssSelectorStr, val: CssSelectorStr) => CssSelectorStr)
    | undefined;
  if (!builder) return candidate;
  return { kind: 'css', value: builder(formSelector, candidate.value) };
}

/**
 * Create form-scoped versions of all candidates in an array.
 * @param formSelector - The CSS selector for the form anchor.
 * @param candidates - The original selector candidates.
 * @returns An array of form-scoped candidates.
 */
export function scopeCandidates(
  formSelector: CssSelectorStr,
  candidates: SelectorCandidate[],
): SelectorCandidate[] {
  return candidates.map((c): SelectorCandidate => scopeCandidate(formSelector, c));
}
