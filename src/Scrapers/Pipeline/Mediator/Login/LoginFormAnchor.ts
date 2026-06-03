/**
 * LOGIN form-anchor + submit selector builders.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}. Pure builders — no I/O, no logging.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import type { Option } from '../../Types/Option.js';
import type { IRaceResult } from '../Elements/ElementMediator.js';
import type { IFormAnchor } from '../Form/FormAnchor.js';

/**
 * Normalize submit config to flat array of SelectorCandidate.
 * @param submit - Single or array of candidates.
 * @returns Flat array of candidates.
 */
function normalizeSubmitConfig(submit: ILoginConfig['submit']): readonly SelectorCandidate[] {
  if (Array.isArray(submit) && submit.length > 0) return submit;
  if (!Array.isArray(submit)) return [submit];
  return WK_LOGIN_FORM.submit;
}

/**
 * Extract form-anchor selector ONLY when the anchor is trustworthy:
 *   - `#id`
 *   - `tag[name="X"]`
 *   - `tag.class`
 * Positional fallbacks and bare `tag` are REJECTED.
 * @param formAnchor - Optional form anchor option.
 * @returns Trustworthy CSS selector or empty string.
 */
function extractFormAnchorSelector(formAnchor: Option<IFormAnchor>): string {
  if (!formAnchor.has) return '';
  const selector = formAnchor.value.selector;
  if (selector.length === 0) return '';
  if (selector.startsWith('#') && selector.length > 1) return selector;
  if (selector.includes('[name="')) return selector;
  if (/^[a-z]+\.[a-zA-Z][\w-]*$/.test(selector)) return selector;
  return '';
}

/** Candidate value fallbacks for submit resolution. */
const SUBMIT_FALLBACKS: Record<string, string> = { true: '', false: 'submit' };

/**
 * Extract candidate value from race result.
 * @param result - Race result from resolveVisible.
 * @returns Candidate value string.
 */
function extractCandidateVal(result: IRaceResult): string {
  if (!result.candidate) return SUBMIT_FALLBACKS.false;
  return result.candidate.value;
}

/**
 * Extract candidate kind from race result.
 * @param result - Race result from resolveVisible.
 * @returns Candidate kind string.
 */
function extractCandidateKind(result: IRaceResult): string {
  if (!result.candidate) return 'unknown';
  return result.candidate.kind;
}

/** Default structural submit selector when the race has no candidate. */
const INNER_SUBMIT_FALLBACK = 'button[type="submit"]';

/**
 * Build the per-kind selector lookup for the inner-submit builder.
 * @param value - The candidate's value.
 * @returns Map keyed by candidate kind.
 */
function buildInnerSelectorMap(value: string): Partial<Record<string, string>> {
  return {
    xpath: value,
    textContent: `text=${value}`,
    exactText: `text="${value}"`,
    placeholder: `[placeholder="${value}"]`,
    ariaLabel: `role=button[name="${value}"]`,
    labelText: `text=${value}`,
  };
}

/**
 * Build the inner (un-scoped) selector for a candidate kind.
 * @param result - Race result from resolveVisible.
 * @returns Inner selector string without form scope.
 */
function buildInnerSubmitSelector(result: IRaceResult): string {
  if (!result.candidate) return INNER_SUBMIT_FALLBACK;
  const c = result.candidate;
  const selectorMap = buildInnerSelectorMap(c.value);
  return selectorMap[c.kind] ?? c.value;
}

/**
 * Build a scoped selector from the resolved submit race result. When a
 * trustworthy form anchor exists, the stored selector uses Playwright's
 * `>>` chain syntax.
 * @param result - Race result from resolveVisible.
 * @param formAnchor - Trustworthy form selector or empty string.
 * @returns Scoped selector string for the click executor.
 */
function buildSubmitSelector(result: IRaceResult, formAnchor: string): string {
  const inner = buildInnerSubmitSelector(result);
  if (formAnchor.length === 0) return inner;
  return `${formAnchor} >> ${inner}`;
}

export {
  buildSubmitSelector,
  extractCandidateKind,
  extractCandidateVal,
  extractFormAnchorSelector,
  normalizeSubmitConfig,
};
