/**
 * Per-kind locator builders + OCP-friendly dispatch table. Each builder
 * accepts a form-scoped context and returns BASE Playwright locators
 * (without `.first()`). Callers wrap as needed:
 *   - `buildCandidateLocators` applies `.first()` (resolveVisibleInContextImpl).
 *   - `buildLocatorEntriesAll` enumerates `.nth(0..N-1)` (resolveVisible /
 *     resolveAllVisible / resolveAndClick) so multi-match elements all enter
 *     the race.
 *
 * Extracted from CreateElementMediator.ts (Phase 12a §3) so the god module
 * no longer owns SelectorCandidate→Locator dispatch.
 *
 * Internal helpers (`CLICK_ANCESTORS`, `XPATH_PREFIX_BY_SCOPE`,
 * `relativizeXpath`) live here because their only consumers are the
 * xpath-flavoured builders below — keeping them private satisfies
 * Pipeline Rule #15 (no primitive returns at exported boundaries).
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import { applyFormScope, type LocatorContext, NO_FORM_ANCHOR } from './Scope.js';

/** Interactive ancestor tags for walk-up — same as SelectorLabelStrategies. */
const CLICK_ANCESTORS = ['button', 'a', 'select', 'div', 'span'] as const;

/** XPath prefix lookup keyed by scoping: scoped = descendant-relative, unscoped = absolute. */
const XPATH_PREFIX_BY_SCOPE: Readonly<Record<string, string>> = {
  true: './/',
  false: '//',
};

/**
 * Escape an arbitrary string for safe interpolation into an XPath
 * double-quoted literal. Returns one of three encodings:
 *   - `"..."` when the input contains no `"`.
 *   - `'...'` when the input contains no `'`.
 *   - `concat(...)` decomposition when both quote characters appear.
 *
 * XPath 1.0 (§3.7) does NOT support backslash escaping inside string
 * literals, so `concat()` is the only portable encoding for arbitrary
 * input. The return value INCLUDES the quote delimiters (or
 * `concat(...)`) — callers splice it directly into the surrounding
 * predicate without re-quoting. Defends against accidental selector
 * breakage when WellKnown text content carries quote characters.
 * @param s - Arbitrary string to encode.
 * @returns XPath literal expression equivalent to `s`.
 */
function escapeXPathString(s: string): string {
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  const parts = s.split('"').map((p): string => `"${p}"`);
  const sep = ", '\"', ";
  return `concat(${parts.join(sep)})`;
}

/**
 * Escape an arbitrary string for safe interpolation into a CSS
 * attribute-selector double-quoted literal: backslash-escapes `\` and
 * `"` per the CSS Syntax specification (§4.3.5). Returns the raw
 * escaped content WITHOUT the enclosing `"..."` — callers wrap.
 * Defends against selector breakage when WellKnown name attribute
 * values carry quote characters.
 * @param s - Arbitrary string to encode.
 * @returns Backslash-escaped CSS-safe attribute-value content.
 */
function escapeCssAttrValue(s: string): string {
  return s.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
}

/**
 * Convert absolute "//pattern" XPath to descendant-relative ".//pattern"
 * when scoped under a form Locator. Playwright's chained `Locator.locator()`
 * treats "//..." as document-absolute (NOT relative to the locator), which
 * would silently defeat form scoping. Prepending "." makes it descendant-only.
 * Internal helper — not exported so Rule #15 (nominal returns at boundaries)
 * stays satisfied for this file.
 * @param value - XPath value (already with `xpath=` prefix stripped).
 * @param isScoped - True when chained under a form Locator.
 * @returns Adjusted XPath string.
 */
function relativizeXpath(value: string, isScoped: boolean): string {
  if (!isScoped) return value;
  if (value.startsWith('//')) return '.' + value;
  return value;
}

/**
 * Build the xpath selector that walks up from a text node to the
 * nearest interactive ancestor of `tag` whose subtree contains `text`.
 * Extracted from `buildWalkUpLocatorsBase` so the parent function fits
 * under the 10-LoC cap.
 * @param tag - Click-ancestor tag (one of `CLICK_ANCESTORS`).
 * @param prefix - XPATH_PREFIX_BY_SCOPE entry (`.//` when scoped, `//` otherwise).
 * @param textExpr - Pre-escaped XPath string literal of the visible text.
 * @returns Playwright-compatible `xpath=` selector string.
 */
function buildClickAncestorSelector(tag: string, prefix: string, textExpr: string): string {
  return `xpath=${prefix}${tag}[.//text()[contains(., ${textExpr})]]`;
}

/**
 * Build xpath BASE locators (no `.first()`) for a textContent candidate.
 * Walk-up to each interactive ancestor — same logic as resolveByAncestorWalkUp.
 * Callers that want first-match-only wrap with `.first()`; callers that
 * want all matches enumerate via `.nth(i)`.
 * @param scope - Page, Frame, or form Locator (Locator under form scoping).
 * @param text - Visible text to find.
 * @param isScoped - True when scope is a form Locator (relativize xpath).
 * @returns Array of Playwright base locators targeting interactive ancestors.
 */
export function buildWalkUpLocatorsBase(
  scope: LocatorContext,
  text: string,
  isScoped: boolean,
): Locator[] {
  const prefix = XPATH_PREFIX_BY_SCOPE[String(isScoped)];
  const textExpr = escapeXPathString(text);
  return CLICK_ANCESTORS.map((tag): Locator => {
    const selector = buildClickAncestorSelector(tag, prefix, textExpr);
    return scope.locator(selector);
  });
}

/**
 * Build BASE locators (no `.first()`) for a clickableText candidate —
 * innermost element with text. Excludes elements that have children also
 * containing the text.
 * @param scope - Page, Frame, or form Locator.
 * @param text - Visible text to find.
 * @param isScoped - True when scope is a form Locator (relativize xpath).
 * @returns Array of Playwright base locators.
 */
export function buildClickableTextLocatorsBase(
  scope: LocatorContext,
  text: string,
  isScoped: boolean,
): Locator[] {
  const prefix = XPATH_PREFIX_BY_SCOPE[String(isScoped)];
  const textExpr = escapeXPathString(text);
  const innermost = `${prefix}*[contains(., ${textExpr}) and not(.//*[contains(., ${textExpr})])]`;
  return [scope.locator(`xpath=${innermost}`)];
}

/**
 * ariaLabel candidate fans out across label + 3 ARIA roles.
 * @param scope - Form-scoped locator context.
 * @param value - The aria-label / accessible name to match.
 * @returns Array of base locators.
 */
export function buildAriaLabelLocators(scope: LocatorContext, value: string): Locator[] {
  return [
    scope.getByLabel(value),
    scope.getByRole('button', { name: value, exact: false }),
    scope.getByRole('link', { name: value, exact: false }),
    scope.getByRole('tab', { name: value, exact: false }),
  ];
}

/**
 * xpath candidate — prepend "xpath=" prefix because Playwright auto-detects
 * xpath only when selector starts with "//"; the descendant-relative ".//"
 * form would otherwise be parsed as CSS.
 * @param scope - Form-scoped locator context.
 * @param value - The xpath expression.
 * @param isScoped - Whether form-scoping is active (relativize to descendant).
 * @returns Single-element array containing the xpath locator.
 */
export function buildXpathLocators(
  scope: LocatorContext,
  value: string,
  isScoped: boolean,
): Locator[] {
  return [scope.locator(`xpath=${relativizeXpath(value, isScoped)}`)];
}

/**
 * Placeholder candidate: single getByPlaceholder locator.
 * @param scope - Locator context.
 * @param value - Placeholder text.
 * @returns Single-element locator array.
 */
export function buildPlaceholderLocators(scope: LocatorContext, value: string): Locator[] {
  return [scope.getByPlaceholder(value)];
}

/**
 * name attribute candidate: single CSS attribute-selector locator.
 * @param scope - Locator context.
 * @param value - HTML `name` attribute value.
 * @returns Single-element locator array.
 */
export function buildNameLocators(scope: LocatorContext, value: string): Locator[] {
  return [scope.locator(`[name="${escapeCssAttrValue(value)}"]`)];
}

/**
 * regex candidate: single getByText(RegExp) locator.
 * @param scope - Locator context.
 * @param value - Regex pattern source string.
 * @returns Single-element locator array.
 */
export function buildRegexLocators(scope: LocatorContext, value: string): Locator[] {
  return [scope.getByText(new RegExp(value))];
}

/**
 * exactText candidate: single getByText with exact:true.
 * @param scope - Locator context.
 * @param value - Exact text to match.
 * @returns Single-element locator array.
 */
export function buildExactTextLocators(scope: LocatorContext, value: string): Locator[] {
  return [scope.getByText(value, { exact: true })];
}

/**
 * css candidate: raw CSS selector — wrap in a single Playwright locator
 * so the candidate is treated as a selector (not as visible text).
 * Restored after the dispatch-table refactor accidentally routed `css`
 * candidates through the unknown-kind `getByText` fallback.
 * @param scope - Locator context.
 * @param value - Raw CSS selector string.
 * @returns Single-element locator array.
 */
export function buildCssLocators(scope: LocatorContext, value: string): Locator[] {
  return [scope.locator(value)];
}

/**
 * labelText candidate: resolve to the form control associated with the
 * given label (Playwright `getByLabel`) — NOT the label's visible text.
 * Restored after the dispatch-table refactor accidentally routed
 * `labelText` candidates through the unknown-kind `getByText` fallback,
 * which targeted the label element itself instead of its bound input.
 * @param scope - Locator context.
 * @param value - Visible label text bound to the target control.
 * @returns Single-element locator array.
 */
export function buildLabelTextLocators(scope: LocatorContext, value: string): Locator[] {
  return [scope.getByLabel(value)];
}

/** Dispatch signature for per-kind locator builders. */
export type LocatorKindBuilder = (
  scope: LocatorContext,
  value: string,
  isScoped: boolean,
) => Locator[];

/**
 * Dispatch table mapping each SelectorCandidate.kind to its locator builder.
 * Open-Closed-friendly: new kinds add a row instead of growing an if-chain.
 */
export const LOCATOR_KIND_BUILDERS: Readonly<
  Partial<Record<SelectorCandidate['kind'], LocatorKindBuilder>>
> = {
  css: buildCssLocators,
  labelText: buildLabelTextLocators,
  textContent: buildWalkUpLocatorsBase,
  clickableText: buildClickableTextLocatorsBase,
  ariaLabel: buildAriaLabelLocators,
  placeholder: buildPlaceholderLocators,
  xpath: buildXpathLocators,
  name: buildNameLocators,
  regex: buildRegexLocators,
  exactText: buildExactTextLocators,
};

/**
 * Look up the per-kind builder in `LOCATOR_KIND_BUILDERS` and run it,
 * or fall back to the generic `getByText(value)` when no builder is
 * registered for the candidate kind. Pure dispatch: no scoping logic
 * (caller already produced the scoped `scope` argument).
 * @param scope - Pre-scoped Page / Frame / form-Locator context.
 * @param candidate - The selector candidate driving the dispatch.
 * @param isScoped - True when `scope` is a form-Locator descendant.
 * @returns Base locators for the candidate (without `.first()`).
 */
function getLocatorBuilderOrFallback(
  scope: LocatorContext,
  candidate: SelectorCandidate,
  isScoped: boolean,
): Locator[] {
  const builder = LOCATOR_KIND_BUILDERS[candidate.kind];
  if (!builder) return [scope.getByText(candidate.value)];
  return builder(scope, candidate.value, isScoped);
}

/**
 * Build BASE Playwright locators from a SelectorCandidate — without `.first()`
 * applied. Two callers wrap the output:
 *   - `buildCandidateLocators`: applies `.first()` for first-match-only
 *     resolvers (login, preLogin, etc.) — preserves existing behaviour.
 *   - `buildLocatorEntriesAll`: enumerates `.nth(0..N-1)` per base locator
 *     so multi-match elements (legacy + modern nav buttons) both surface
 *     in the candidate list.
 * When formAnchor is non-empty, builds child locators chained off the form
 * (Locator chaining) so ALL candidate kinds are uniformly form-scoped.
 * @param ctx - Playwright Page or Frame.
 * @param candidate - The selector candidate.
 * @param formAnchor - Optional CSS form selector for descendant scoping.
 * @returns Array of base locators (race targets — no `.first()` applied).
 */
export function buildCandidateLocatorsBase(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
  formAnchor = NO_FORM_ANCHOR,
): Locator[] {
  const scope = applyFormScope(ctx, formAnchor);
  return getLocatorBuilderOrFallback(scope, candidate, formAnchor.length > 0);
}

/**
 * Build first-match locators from a SelectorCandidate — applies `.first()`
 * on top of the base locators. This is the API used by every legacy
 * resolver (login, preLogin, OTP, scrape) — same behaviour as before the
 * nth-enumeration split.
 * @param ctx - Playwright Page or Frame.
 * @param candidate - The selector candidate.
 * @param formAnchor - Optional CSS form selector for descendant scoping.
 * @returns Array of `.first()`-wrapped locators ready to race.
 */
export function buildCandidateLocators(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
  formAnchor = NO_FORM_ANCHOR,
): Locator[] {
  return buildCandidateLocatorsBase(ctx, candidate, formAnchor).map((loc): Locator => loc.first());
}
