/**
 * Per-kind locator builders + OCP-friendly dispatch table. Each builder
 * accepts a form-scoped context and returns BASE Playwright locators
 * (without `.first()`). Callers wrap as needed:
 *   - `buildCandidateLocators` applies `.first()` (resolveVisibleImpl).
 *   - `buildLocatorEntriesAll` enumerates `.nth(0..N-1)` (resolveAllVisible /
 *     resolveAndClick) so multi-match elements all enter the race.
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
  return CLICK_ANCESTORS.map(
    (tag): Locator => scope.locator(`xpath=${prefix}${tag}[.//text()[contains(., "${text}")]]`),
  );
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
  const innermost = `${prefix}*[contains(., "${text}") and not(.//*[contains(., "${text}")])]`;
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
  return [scope.locator(`[name="${value}"]`)];
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
  const isScoped = formAnchor.length > 0;
  const builder = LOCATOR_KIND_BUILDERS[candidate.kind];
  if (!builder) return [scope.getByText(candidate.value)];
  return builder(scope, candidate.value, isScoped);
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
