/**
 * XPath / CSS selector synthesis from SelectorCandidate values.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import type { PlaywrightSelector, XpathLiteralStr } from './SelectorResolver.types.js';

/**
 * Escape a string for safe use as an XPath string literal.
 * Handles values containing single quotes, double quotes, or both.
 * @param value - The raw string value.
 * @returns XPath-safe quoted string.
 */
function toXpathLiteral(value: string): XpathLiteralStr {
  if (!value.includes('"')) return `"${value}"` as XpathLiteralStr;
  if (!value.includes("'")) return `'${value}'` as XpathLiteralStr;
  const parts = value.split('"').map((part): string => `"${part}"`);
  return `concat(${parts.join(", '\"', ")})` as XpathLiteralStr;
}

/**
 * Build XPath for clickableText — innermost element with text.
 * @param value - The visible text to match.
 * @returns Playwright-compatible XPath selector.
 */
function clickableTextXpath(value: string): string {
  const lit = toXpathLiteral(value);
  return [
    'xpath=//*[not(self::script)',
    'and not(self::style)',
    `and contains(., ${lit})`,
    `and not(.//*[contains(., ${lit})])]`,
  ].join(' ');
}

/**
 * Build deepest-text XPath for visible text matching.
 * @param text - Visible text to search for.
 * @returns XPath selector string.
 */
function buildTextXpath(text: string): string {
  return clickableTextXpath(text);
}

/** Builder fn signature shared by the candidate→css dispatch map. */
type CssBuilder = (v: string, lit: string) => string;

/** Map from candidate kind to its Playwright-selector builder. */
const CANDIDATE_TO_CSS: Partial<Record<SelectorCandidate['kind'], CssBuilder>> = {
  /**
   * Build XPath for clickableText — innermost element with visible text.
   * @param v - Visible text value.
   * @returns XPath selector.
   */
  clickableText: (v): string => clickableTextXpath(v),
  /**
   * Build XPath for labelText — `<label>` matching by visible text.
   * @param _v - Unused raw value (use the literal form).
   * @param lit - XPath-safe quoted literal.
   * @returns XPath selector.
   */
  labelText: (_v, lit): string => `xpath=//label[contains(., ${lit})]`,
  /**
   * Build XPath for textContent — any element containing visible text.
   * @param _v - Unused raw value (use the literal form).
   * @param lit - XPath-safe quoted literal.
   * @returns XPath selector.
   */
  textContent: (_v, lit): string => `xpath=//*[contains(text(), ${lit})]`,
  /**
   * Pass-through for raw CSS selectors.
   * @param v - CSS selector string.
   * @returns The CSS selector unchanged.
   */
  css: (v): string => v,
  /**
   * Build CSS selector matching a placeholder fragment.
   * @param v - Placeholder fragment.
   * @returns CSS selector.
   */
  placeholder: (v): string => `input[placeholder*="${v}"]`,
  /**
   * Build CSS selector matching an exact aria-label.
   * @param v - aria-label value.
   * @returns CSS selector.
   */
  ariaLabel: (v): string => `input[aria-label="${v}"]`,
  /**
   * Build CSS selector matching a form-control name attribute.
   * @param v - Name value.
   * @returns CSS selector.
   */
  name: (v): string => `[name="${v}"]`,
};

/**
 * Convert a SelectorCandidate to a Playwright-compatible selector.
 * @param candidate - The selector candidate to convert.
 * @returns A Playwright-compatible CSS or XPath selector string.
 */
function candidateToCss(candidate: SelectorCandidate): PlaywrightSelector {
  const v = candidate.value;
  const lit = toXpathLiteral(v);
  const handler = CANDIDATE_TO_CSS[candidate.kind];
  if (handler) return handler(v, lit) as PlaywrightSelector;
  return `xpath=${v}` as PlaywrightSelector;
}

export { buildTextXpath, candidateToCss, clickableTextXpath, toXpathLiteral };
