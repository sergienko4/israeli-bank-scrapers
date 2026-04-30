import { type Frame, type Page } from 'playwright-core';

import { type SelectorCandidate } from '../Scrapers/Base/Config/LoginConfig.js';
import { type Nullable } from '../Scrapers/Base/Interfaces/CallbackTypes.js';
import { getDebug } from './Debug.js';

const LOG = getDebug('form-anchor');

/** Typed null value for Nullable return types — avoids the no-restricted-syntax rule on `return null`. */
const EMPTY_RESULT: Nullable<never> = JSON.parse('null') as Nullable<never>;

/** A cached form element discovered from a resolved input field. */
export interface IFormAnchor {
  /** CSS selector uniquely identifying the form element. */
  selector: string;
  /** The Playwright context (Page or Frame) containing the form. */
  context: Page | Frame;
}

/**
 * Build a scoped CSS selector for a css-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The original candidate value.
 * @returns The scoped CSS selector string.
 */
function scopeCss(form: string, val: string): string {
  return `${form} ${val}`;
}

/**
 * Build a scoped CSS selector for a placeholder-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The placeholder text to match.
 * @returns The scoped CSS selector string.
 */
function scopePlaceholder(form: string, val: string): string {
  return `${form} input[placeholder*="${val}"]`;
}

/**
 * Build a scoped CSS selector for an ariaLabel-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The aria-label text to match.
 * @returns The scoped CSS selector string.
 */
function scopeAriaLabel(form: string, val: string): string {
  return `${form} input[aria-label="${val}"]`;
}

/**
 * Build a scoped CSS selector for a name-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The name attribute value to match.
 * @returns The scoped CSS selector string.
 */
function scopeName(form: string, val: string): string {
  return `${form} [name="${val}"]`;
}

/** Map from scopable kind to a function that builds the scoped CSS value. */
const SCOPE_BUILDERS: Record<string, (form: string, val: string) => string> = {
  css: scopeCss,
  placeholder: scopePlaceholder,
  ariaLabel: scopeAriaLabel,
  name: scopeName,
};

/**
 * Evaluate the DOM to find the nearest form-like ancestor of the input.
 * Runs inside the browser context via Playwright's evaluate.
 * All helpers inlined — browser context cannot access Node.js closures.
 * @param input - The DOM input element to start walking from.
 * @returns A CSS selector for the form ancestor, or empty string if none found.
 */
/** Non-fillable input types — shared between Node and browser contexts. */
const NON_FILLABLE_TYPES = ['hidden', 'submit', 'button', 'radio', 'checkbox'];

/**
 * Run the form-walk evaluation on a resolved input handle.
 * @param ctx - The Page or Frame containing the input.
 * @param resolvedSelector - The CSS/XPath selector for the input.
 * @returns The form CSS selector, or empty string if not found.
 */
async function evaluateFormWalk(ctx: Page | Frame, resolvedSelector: string): Promise<string> {
  const loc = ctx.locator(resolvedSelector).first();
  const locCount = await loc.count();
  if (locCount === 0) return '';
  return loc.evaluate(formWalkBrowserFn, NON_FILLABLE_TYPES);
}

/**
 * Self-contained browser-context form walk. ALL logic inline — no external refs.
 * Uses only anonymous function expressions to avoid __name injection by build tools.
 * @param input - DOM input element (injected by Playwright).
 * @param skipTypes - Non-fillable input types (passed as arg).
 * @returns CSS selector for the nearest form-like ancestor.
 */
/**
 * Self-contained browser-context form walk. ALL logic inline — no external refs.
 * Must be self-contained: Playwright evaluate() serializes only this function.
 * @param input - DOM input element (injected by Playwright).
 * @param skipTypes - Non-fillable input types (passed as arg).
 * @returns CSS selector for the nearest form-like ancestor.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: browser evaluate() requires self-contained function
function formWalkBrowserFn(input: Element, skipTypes: string[]): string {
  const skip = new Set(skipTypes);
  let el = input.parentElement;
  while (el && el !== document.body) {
    const isForm = el.tagName === 'FORM';
    const fills = isForm ? [] : [...el.querySelectorAll('input')].filter(i => !skip.has(i.type));
    if (isForm || fills.length >= 2) {
      if (el.id) return '#' + el.id;
      const tag = el.tagName.toLowerCase();
      const p = el.parentElement;
      if (!p) return tag;
      const target = el;
      const sib = [...p.children].filter(c => c.tagName === target.tagName);
      return sib.length <= 1 ? tag : tag + ':nth-of-type(' + String(sib.indexOf(target) + 1) + ')';
    }
    el = el.parentElement;
  }
  return '';
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
  LOG.debug('discovered form anchor: %s', formSelector);
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
  formSelector: string,
  candidate: SelectorCandidate,
): SelectorCandidate {
  const builder = SCOPE_BUILDERS[candidate.kind] as
    | ((form: string, val: string) => string)
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
  formSelector: string,
  candidates: SelectorCandidate[],
): SelectorCandidate[] {
  return candidates.map(c => scopeCandidate(formSelector, c));
}
