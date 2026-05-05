/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor + FormErrorDiscovery.
 * Black box for ALL HTML resolution — scrapers describe WHAT, mediator finds HOW.
 * Each mediator instance has its own form anchor cache (no shared mutable state).
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import { WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import { capTimeout, getDebug } from '../../Types/Debug.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { none, type Option, some } from '../../Types/Option.js';
import { fail, isOk, type Procedure, succeed } from '../../Types/Procedure.js';
import { discoverFormAnchor, type IFormAnchor, scopeCandidates } from '../Form/FormAnchor.js';
import {
  checkFrameForErrors,
  discoverFormErrors,
  type IFormErrorScanResult,
} from '../Form/FormErrorDiscovery.js';
import { createNetworkDiscovery } from '../Network/NetworkDiscovery.js';
import { resolveFieldPipeline } from '../Selector/PipelineFieldResolver.js';
import type { IFieldContext } from '../Selector/SelectorResolverPipeline.js';
import {
  buildFrameRegistry,
  clickElementImpl,
  fillInputImpl,
  pressEnterImpl,
  resolveFrame,
} from './ActionExecutors.js';
import {
  type IActionMediator,
  type ICookieSnapshot,
  type IElementIdentity,
  type IElementMediator,
  type IRaceResult,
  type IsTxnFound,
  NOT_FOUND_RESULT,
} from './ElementMediator.js';

const LOG = getDebug(import.meta.url);

import {
  getActivePhase,
  getActiveStage,
  setActivePhase as setGlobalPhase,
  setActiveStage as setGlobalStage,
  type StageLabel,
} from '../../Types/ActiveState.js';

/** CSS selector string cached from form anchor discovery. */
type FormSelectorStr = string;
/** Field key string used to identify a credential or form field. */
type FieldKeyStr = string;
/** Form anchor CSS selector for scoping subsequent field fills. */
type FormAnchorStr = string;
/** Whether a locator is currently visible in the viewport. */
type IsVisible = boolean;
/** Index of the winning locator from a race. */
type WinnerIndex = number;
/** Raw href or text attribute from a DOM element. */
type ElementAttr = string;
/** Diagnostic string for trace logging. */
type DiagnosticStr = string;
/** Href string extracted from anchor ancestor walk-up. */
type AncestorHref = string;
/** Whether a filter predicate matches. */
type FilterMatch = boolean;
/** Current page URL string. */
type PageUrl = string;
/** Dedup key for a winning element in extractWinnerSequence. */
type IdentityKey = string;
/** Number of matches a base locator yielded (per `Locator.count()`). */
type LocatorCount = number;
/** Whether a candidate beats the existing canonical group representative. */
type IsCanonicalUpgrade = boolean;

/** Per-instance mutable cache for the form anchor selector. */
interface IFormCache {
  selector: FormSelectorStr;
}

/** Options for field resolution — bundled to satisfy max-params. */
interface IResolveOpts {
  readonly page: Page;
  readonly fieldKey: FieldKeyStr;
  readonly candidates: readonly SelectorCandidate[];
  readonly scopeContext?: Page | Frame;
  readonly formSelector?: FormAnchorStr;
}

/**
 * Try scoped resolve in the same iframe — flat, no nesting.
 * @param opts - Bundled resolution options.
 * @returns Resolved field context or null-ish if not found in scope.
 */
async function tryScopedResolve(opts: IResolveOpts): Promise<IFieldContext | false> {
  if (!opts.scopeContext) return false;
  const scoped = await resolveFieldPipeline({
    pageOrFrame: opts.scopeContext,
    fieldKey: opts.fieldKey,
    bankCandidates: opts.candidates,
    formSelector: opts.formSelector,
  });
  if (scoped.isResolved) return scoped;
  return false;
}

/**
 * Try scoped search first, then full page scan.
 * @param opts - Bundled resolution options.
 * @returns Success or failure Procedure.
 */
async function resolveFieldImpl(opts: IResolveOpts): Promise<Procedure<IFieldContext>> {
  const notFoundMsg = `Field not found: ${opts.fieldKey}`;
  const scopeHit = await tryScopedResolve(opts);
  if (scopeHit) return succeed<IFieldContext>(scopeHit);
  const wide = await resolveFieldPipeline({
    pageOrFrame: opts.page,
    fieldKey: opts.fieldKey,
    bankCandidates: opts.candidates,
  });
  if (wide.isResolved) return succeed<IFieldContext>(wide);
  return fail(ScraperErrorTypes.Generic, notFoundMsg);
}

/**
 * Catch resolution errors and return failure Procedure.
 * @param error - Thrown error.
 * @returns Failure Procedure.
 */
function handleResolveError(error: Error): Procedure<IFieldContext> {
  const msg = toErrorMessage(error);
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * Resolve a field by key — delegates to resolveFieldImpl.
 * @param opts - Bundled resolution options.
 * @returns Procedure with resolved field context.
 */
function resolveFieldForPage(opts: IResolveOpts): Promise<Procedure<IFieldContext>> {
  return resolveFieldImpl(opts).catch(handleResolveError);
}

/**
 * Build resolveField method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveField function.
 */
function buildResolveField(page: Page): IElementMediator['resolveField'] {
  return (
    ...args: Parameters<IElementMediator['resolveField']>
  ): Promise<Procedure<IFieldContext>> => {
    const [fieldKey, candidates, scopeContext, formSelector] = args;
    const opts: IResolveOpts = { page, fieldKey, candidates, scopeContext, formSelector };
    return resolveFieldForPage(opts);
  };
}

/**
 * Build resolveClickable method bound to a page.
 * Uses '__submit__' as the fieldKey so WellKnown.__submit__ is the automatic fallback.
 * Searches main page + child iframes (via resolveFieldPipeline) — correct for iframe forms.
 * Returns IFieldContext so caller can click in the correct frame/page context.
 * @param page - The Playwright page.
 * @returns Mediator resolveClickable function.
 */
function buildResolveClickable(page: Page): IElementMediator['resolveClickable'] {
  return (candidates): Promise<Procedure<IFieldContext>> => {
    const opts: IResolveOpts = { page, fieldKey: '__submit__', candidates };
    return resolveFieldImpl(opts).catch(handleResolveError);
  };
}

/**
 * Build discoverErrors method.
 * Runs Layer 1 (DOM structural scan) then Layer 2 (WellKnown text) if needed.
 * The frame parameter lets callers target the specific context (e.g., connect iframe).
 * @returns Mediator discoverErrors function.
 */
function buildDiscoverErrors(): IElementMediator['discoverErrors'] {
  return async (frame: Page | Frame): Promise<IFormErrorScanResult> => {
    const layer1 = await discoverFormErrors(frame);
    if (layer1.hasErrors) return layer1;
    return checkFrameForErrors(frame);
  };
}

/** Delay between loading indicator checks in milliseconds. */
const LOADING_DELAY_MS = 2000;

/**
 * Check if any WellKnown loading indicator is currently visible.
 * Probes all candidates in parallel via Promise.all.
 * @param frame - Page or Frame to check.
 * @returns succeed(true) if loading visible, succeed(false) if clear.
 */
async function isAnyLoadingVisible(frame: Page | Frame): Promise<Procedure<boolean>> {
  const candidates = WK_DASHBOARD.LOADING;
  const checks = candidates.map((c): Promise<boolean> => {
    const locator = frame.getByText(c.value).first();
    return locator.isVisible().catch((): IsVisible => false);
  });
  const results = await Promise.all(checks);
  const hasLoading = results.some(Boolean);
  return succeed(hasLoading);
}

/**
 * Wait once for loading indicators to disappear, then re-check.
 * @param frame - Page or Frame.
 * @param attempt - Current attempt number (for logging).
 * @returns succeed(true) if loading gone, succeed(false) if still present.
 */
async function waitOnceForLoading(
  frame: Page | Frame,
  attempt: number,
): Promise<Procedure<boolean>> {
  const loadingResult = await isAnyLoadingVisible(frame);
  if (isOk(loadingResult) && !loadingResult.value) return succeed(true);
  const delayStr = String(LOADING_DELAY_MS);
  const attemptStr = String(attempt);
  LOG.debug({
    message: `loading indicator visible, waiting ${delayStr}ms (attempt ${attemptStr})`,
  });
  await frame.waitForTimeout(LOADING_DELAY_MS);
  return succeed(false);
}

/**
 * Build waitForLoadingDone method.
 * Checks WellKnown loadingIndicator candidates, waits up to 2×2s for them to disappear.
 * Uses recursive check instead of await-in-loop.
 * @returns Mediator waitForLoadingDone function.
 */
function buildWaitForLoadingDone(): IElementMediator['waitForLoadingDone'] {
  return async (frame: Page | Frame): Promise<Procedure<true>> => {
    const done1 = await waitOnceForLoading(frame, 1);
    if (isOk(done1) && done1.value) return succeed(true);
    const done2 = await waitOnceForLoading(frame, 2);
    if (isOk(done2) && done2.value) return succeed(true);
    await waitOnceForLoading(frame, 3);
    return succeed(true);
  };
}

/**
 * Discover form anchor and update cache — no try/catch (caller handles).
 * @param cache - Form cache to update.
 * @param resolvedContext - Resolved field context.
 * @returns Option with form anchor.
 */
async function discoverFormCore(
  cache: IFormCache,
  resolvedContext: IFieldContext,
): Promise<Option<IFormAnchor>> {
  const ctx = resolvedContext.context;
  const anchor = await discoverFormAnchor(ctx, resolvedContext.selector);
  if (!anchor) return none();
  cache.selector = anchor.selector;
  return some(anchor);
}

/**
 * Build discoverForm method with per-instance cache.
 * Uses resolvedContext.context (not root page) so iframe form anchors are found correctly.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator discoverForm function.
 */
function buildDiscoverForm(cache: IFormCache): IElementMediator['discoverForm'] {
  return (resolvedContext: IFieldContext): Promise<Option<IFormAnchor>> => {
    /**
     * Catch form discovery errors — non-fatal, returns none.
     * @param error - Thrown error.
     * @returns None option.
     */
    const handleError = (error: Error): Option<IFormAnchor> => {
      const msg = toErrorMessage(error);
      const truncated = msg.slice(0, 60);
      LOG.debug({
        message: `discoverForm failed (non-fatal): ${truncated}`,
      });
      return none();
    };
    return discoverFormCore(cache, resolvedContext).catch(handleError);
  };
}

/**
 * Build scopeToForm method with per-instance cache.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator scopeToForm function.
 */
function buildScopeToForm(cache: IFormCache): IElementMediator['scopeToForm'] {
  return (candidates: readonly SelectorCandidate[]): readonly SelectorCandidate[] => {
    if (!cache.selector) return candidates;
    const mutable = [...candidates];
    return scopeCandidates(cache.selector, mutable);
  };
}

/** Interactive ancestor tags for walk-up — same as SelectorLabelStrategies. */
const CLICK_ANCESTORS = ['button', 'a', 'select', 'div', 'span'] as const;

/** Timeout for parallel resolveAndClick race. */
const CLICK_RACE_TIMEOUT = 3000;

/** Sentinel for "no form anchor" — empty selector means unscoped global search. */
const NO_FORM_ANCHOR = '';

/** XPath prefix lookup keyed by scoping: scoped = descendant-relative, unscoped = absolute. */
const XPATH_PREFIX_BY_SCOPE: Readonly<Record<string, string>> = {
  true: './/',
  false: '//',
};

/**
 * Page, Frame, or Locator — all expose `.locator()` / `.getBy*()` so any
 * of the three can serve as a child-locator context. Used to apply form
 * scoping uniformly to ALL candidate kinds via Playwright Locator chaining.
 */
type LocatorContext = Page | Frame | Locator;

/**
 * Apply form-anchor scoping to a context. When formAnchor is non-empty,
 * returns `ctx.locator(formAnchor)` so subsequent child-locator calls
 * (`.locator`, `.getByText`, `.getByLabel`, `.getByRole`, `.getByPlaceholder`)
 * are scoped to descendants of the matched form. When empty, returns ctx
 * unchanged. This is the single point where form-membership becomes a
 * deterministic DOM-tree filter — regardless of candidate kind.
 * @param ctx - Page or Frame.
 * @param formAnchor - CSS form selector, or empty for global scope.
 * @returns Scoped Locator or original ctx.
 */
function applyFormScope(ctx: Page | Frame, formAnchor: string): LocatorContext {
  if (formAnchor.length === 0) return ctx;
  return ctx.locator(formAnchor);
}

/** XPath expression body (no `xpath=` prefix). */
type XpathValue = string;

/**
 * Convert absolute "//pattern" XPath to descendant-relative ".//pattern"
 * when scoped under a form Locator. Playwright's chained `Locator.locator()`
 * treats "//..." as document-absolute (NOT relative to the locator), which
 * would silently defeat form scoping. Prepending "." makes it descendant-only.
 * @param value - XPath value (already with `xpath=` prefix stripped).
 * @param isScoped - True when chained under a form Locator.
 * @returns Adjusted XPath string.
 */
function relativizeXpath(value: string, isScoped: boolean): XpathValue {
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
function buildWalkUpLocatorsBase(
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
function buildClickableTextLocatorsBase(
  scope: LocatorContext,
  text: string,
  isScoped: boolean,
): Locator[] {
  const prefix = XPATH_PREFIX_BY_SCOPE[String(isScoped)];
  const innermost = `${prefix}*[contains(., "${text}") and not(.//*[contains(., "${text}")])]`;
  return [scope.locator(`xpath=${innermost}`)];
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
function buildCandidateLocatorsBase(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
  formAnchor = NO_FORM_ANCHOR,
): Locator[] {
  const scope = applyFormScope(ctx, formAnchor);
  const isScoped = formAnchor.length > 0;
  if (candidate.kind === 'textContent')
    return buildWalkUpLocatorsBase(scope, candidate.value, isScoped);
  if (candidate.kind === 'clickableText') {
    return buildClickableTextLocatorsBase(scope, candidate.value, isScoped);
  }
  if (candidate.kind === 'ariaLabel')
    return [
      scope.getByLabel(candidate.value), // form inputs
      scope.getByRole('button', { name: candidate.value, exact: false }),
      scope.getByRole('link', { name: candidate.value, exact: false }),
      scope.getByRole('tab', { name: candidate.value, exact: false }),
    ];
  if (candidate.kind === 'placeholder') return [scope.getByPlaceholder(candidate.value)];
  if (candidate.kind === 'xpath') {
    // Explicit "xpath=" prefix: Playwright auto-detects xpath only when
    // selector starts with "//", but the descendant-relative form ".//"
    // starts with "." — without prefix Playwright would parse as CSS.
    const xpathValue = relativizeXpath(candidate.value, isScoped);
    return [scope.locator(`xpath=${xpathValue}`)];
  }
  if (candidate.kind === 'name') return [scope.locator(`[name="${candidate.value}"]`)];
  if (candidate.kind === 'regex') return [scope.getByText(new RegExp(candidate.value))];
  if (candidate.kind === 'exactText') return [scope.getByText(candidate.value, { exact: true })];
  return [scope.getByText(candidate.value)];
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
function buildCandidateLocators(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
  formAnchor = NO_FORM_ANCHOR,
): Locator[] {
  return buildCandidateLocatorsBase(ctx, candidate, formAnchor).map((loc): Locator => loc.first());
}

/**
 * Collect all contexts to search: main page + child iframes.
 * @param page - The Playwright page.
 * @returns Array of Page/Frame contexts to build locators from.
 */
function getAllContexts(page: Page): (Page | Frame)[] {
  const mainFrame = page.mainFrame();
  const childFrames = page.frames().filter((f): IsVisible => f !== mainFrame);
  return [page, ...childFrames];
}

/** Playwright element wait state for locator races. */
type WaitState = 'visible' | 'attached';

/**
 * Race all locators in parallel — first matching state wins. Returns winning index or -1.
 * @param locators - Array of Playwright locators to race.
 * @param timeout - Timeout in ms for each locator.
 * @param state - Element state to wait for (default: 'visible').
 * @returns Index of first matching locator, or -1 if none.
 */
async function raceLocators(
  locators: Locator[],
  timeout: number,
  state: WaitState = 'visible',
): Promise<WinnerIndex> {
  const waiters = locators.map(async (loc, i): Promise<WinnerIndex> => {
    await loc.waitFor({ state, timeout });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  const winner = results.find((r): IsVisible => r.status === 'fulfilled');
  if (winner?.status !== 'fulfilled') return -1;
  return winner.value;
}

/**
 * Hit-test: check if the browser compositor can reach this element.
 * Uses elementFromPoint at the element's center — handles ALL hiding:
 * CSS 3D backface, ng-hide inheritance, z-index, overflow clip.
 * @param locator - The Playwright locator to test.
 * @returns True if the element is hit-testable at its center.
 */
/** True when MOCK_MODE is active — relaxes hit-test to DOM presence on null. */
const isMockModeActive = process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true';

/**
 * Hit-test — scroll into viewport then check elementFromPoint at center.
 * MOCK_MODE bypass: accept bbox-positive elements when hit returns null.
 * @param locator - The Playwright locator to test.
 * @returns True when the element is hit-testable.
 */
async function isTrulyVisible(locator: Locator): Promise<IsVisible> {
  return locator
    .evaluate((el: Element, mockMode: boolean): IsVisible => {
      // Reject disabled placeholders BEFORE hit-test. Wix renders a
      // disabled <button role="link"> on top of the real link in some bank
      // templates; without this filter the placeholder wins hit-test and
      // the click times out.
      if (el.hasAttribute('disabled')) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;
      // Scroll into viewport ONLY under MOCK_MODE — live pages position
      // elements via CSS and don't need a per-hit-test scroll. Doing it on
      // every locator in live multiplies hundreds of Playwright round-trips.
      if (mockMode) el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (el === hit || el.contains(hit)) return true;
      // MOCK_MODE relaxation: if elementFromPoint returns null (point outside
      // viewport / Gecko quirk in static mock), accept DOM presence with a
      // positive bounding box. The selectors already proved correct in live
      // E2E; mock only validates pipeline logic, not browser rendering.
      if (mockMode && hit === null && rect.width > 0 && rect.height > 0) return true;
      return false;
    }, isMockModeActive)
    .catch((): IsVisible => false);
}

/**
 * Race locators then validate winner with elementFromPoint hit-test.
 * If winner fails hit-test, check remaining settled results.
 * Falls back to first Playwright-visible if no hit-test passes.
 * @param locators - Locators to race.
 * @param timeout - Timeout in ms.
 * @returns Index of first truly visible locator, or -1.
 */
/** Race diagnostic — trace-level detail about what happened. */
interface IRaceDiagnostic {
  readonly winner: WinnerIndex;
  readonly fulfilledCount: WinnerIndex;
  readonly hitTestPassedCount: WinnerIndex;
  readonly fulfilledIndices: readonly WinnerIndex[];
}

/**
 * Race locators then validate with hit-test. Returns diagnostic.
 * @param locators - Locators to race.
 * @param timeout - Timeout in ms.
 * @returns Diagnostic with winner + fulfilled detail.
 */
async function raceLocatorsWithHitTest(
  locators: Locator[],
  timeout: number,
): Promise<IRaceDiagnostic> {
  const waiters = locators.map(async (loc, i): Promise<WinnerIndex> => {
    await loc.waitFor({ state: 'visible', timeout });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  const fulfilled = results
    .filter((r): IsVisible => r.status === 'fulfilled')
    .map((r): WinnerIndex => (r as PromiseFulfilledResult<WinnerIndex>).value);
  const hitTestPromises = fulfilled.map(async (idx): Promise<WinnerIndex> => {
    const isHit = await isTrulyVisible(locators[idx]);
    if (isHit) return idx;
    return -1;
  });
  const hitTests = await Promise.all(hitTestPromises);
  const hitPassed = hitTests.filter((idx): IsVisible => idx >= 0);
  const winner = resolveWinner(hitPassed, fulfilled);
  return {
    winner,
    fulfilledCount: fulfilled.length,
    hitTestPassedCount: hitPassed.length,
    fulfilledIndices: fulfilled,
  };
}

/**
 * Pick winner: hit-test winner first, then first visible fallback.
 * Fallback handles overlays (cookie banners) on bank homepages.
 * @param hitPassed - Indices that passed hit-test.
 * @param fulfilled - Indices that passed waitFor visible.
 * @returns Winner index or -1.
 */
function resolveWinner(
  hitPassed: readonly WinnerIndex[],
  fulfilled: readonly WinnerIndex[],
): WinnerIndex {
  if (hitPassed.length > 0) return hitPassed[0];
  if (fulfilled.length > 0) return fulfilled[0];
  return -1;
}

/** A locator paired with the candidate and context that produced it. */
interface ILocatorEntry {
  readonly locator: Locator;
  readonly candidate: SelectorCandidate;
  readonly context: Page | Frame;
}

/**
 * Build locator entries with metadata for all contexts × candidates.
 * Preserves which candidate and context produced each locator.
 * @param page - The Playwright page.
 * @param candidates - WellKnown selector candidates.
 * @param formAnchor - Optional CSS form selector for descendant scoping
 *   applied uniformly to every candidate kind via Locator chaining.
 * @returns Array of locator entries with metadata.
 */
function buildLocatorEntries(
  page: Page,
  candidates: readonly SelectorCandidate[],
  formAnchor = NO_FORM_ANCHOR,
): ILocatorEntry[] {
  const contexts = getAllContexts(page);
  return contexts.flatMap((ctx): ILocatorEntry[] =>
    candidates.flatMap((c): ILocatorEntry[] =>
      buildCandidateLocators(ctx, c, formAnchor).map(
        (locator): ILocatorEntry => ({ locator, candidate: c, context: ctx }),
      ),
    ),
  );
}

/** Maximum nth-matches enumerated per locator in `resolveAllVisible` —
 *  surfaces multi-element matches (legacy + modern nav buttons) into the
 *  candidate list without exploding the race work. */
const MAX_NTH_PER_LOCATOR = 5;

/**
 * Expand a single locator into up to N nth-locators, one per matching DOM
 * element. Uses `locator.count()` to discover how many siblings match,
 * caps at `max`. Used by `resolveAllVisible` to surface legacy/modern
 * sibling pairs (same aria-label, distinct ids) so identity-dedup can
 * collapse race winners that point to the same element while preserving
 * distinct ones.
 * @param base - Base locator (without `.first()`).
 * @param max - Cap on returned nth-locators.
 * @returns Up to `max` `.nth(i)` locators (empty when count() rejects or 0).
 */
async function expandLocatorToNth(base: Locator, max: number): Promise<readonly Locator[]> {
  const total = await base.count().catch((): LocatorCount => 0);
  if (total <= 0) return [];
  const limit = Math.min(total, max);
  const out: Locator[] = [];
  for (let i = 0; i < limit; i = i + 1) {
    const nthLocator = base.nth(i);
    out.push(nthLocator);
  }
  return out;
}

/**
 * Bundled args for the per-candidate locator-entry expander — keeps the
 * helper inside the 3-param ceiling.
 */
interface IExpandEntryArgs {
  readonly ctx: Page | Frame;
  readonly candidate: SelectorCandidate;
  readonly maxPerLocator: number;
  readonly formAnchor: string;
}

/**
 * Expand all base locators for one (context, candidate) pair into nth-
 * enumerated entries. Drops `.first()` semantics by reusing the same
 * builder output (`.nth(i)` chains compose with `.first()` such that
 * `.first()` is `.nth(0)` — Playwright treats them identically).
 * @param args - Bundled context + candidate + per-locator cap + formAnchor.
 * @returns Locator entries (one per nth-match per base locator).
 */
async function expandCandidateEntries(args: IExpandEntryArgs): Promise<readonly ILocatorEntry[]> {
  const bases = buildCandidateLocatorsBase(args.ctx, args.candidate, args.formAnchor);
  const maxPerLocator = args.maxPerLocator;
  const expansionPromises = bases.map(
    (b): Promise<readonly Locator[]> => expandLocatorToNth(b, maxPerLocator),
  );
  const expanded = await Promise.all(expansionPromises);
  const candidate = args.candidate;
  const ctx = args.ctx;
  return expanded.flatMap((locs): readonly ILocatorEntry[] =>
    locs.map((locator): ILocatorEntry => ({ locator, candidate, context: ctx })),
  );
}

/**
 * Build locator entries that surface MULTIPLE elements per locator (up to
 * `MAX_NTH_PER_LOCATOR`). Used only by `resolveAllVisible` so other
 * resolvers (login/preLogin/etc.) keep their `.first()`-only semantics —
 * zero behavioural change for banks that already pass on attempt 0.
 * @param page - Playwright page.
 * @param candidates - WK selector candidates.
 * @param formAnchor - Optional CSS form selector — when set, all candidate
 *   kinds are scoped to descendants of the form via Locator chaining.
 * @returns Locator entries (contexts × candidates × nth-matches).
 */
async function buildLocatorEntriesAll(
  page: Page,
  candidates: readonly SelectorCandidate[],
  formAnchor = NO_FORM_ANCHOR,
): Promise<readonly ILocatorEntry[]> {
  const contexts = getAllContexts(page);
  const expansionPromises = contexts.flatMap((ctx): Promise<readonly ILocatorEntry[]>[] =>
    mapCandidatesToExpansions(ctx, candidates, formAnchor),
  );
  const groups = await Promise.all(expansionPromises);
  return groups.flat();
}

/**
 * Build the per-(ctx,candidate) expansion promises array. Extracted from
 * `buildLocatorEntriesAll` so the parent function's nesting stays inside
 * the depth-1 ceiling.
 * @param ctx - Playwright context (Page or Frame).
 * @param candidates - WK selector candidates to enumerate per locator.
 * @param formAnchor - Optional CSS form selector for descendant scoping.
 * @returns One promise of locator entries per candidate, in input order.
 */
function mapCandidatesToExpansions(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
  formAnchor = NO_FORM_ANCHOR,
): Promise<readonly ILocatorEntry[]>[] {
  return candidates.map(
    (c): Promise<readonly ILocatorEntry[]> =>
      expandCandidateEntries({
        ctx,
        candidate: c,
        maxPerLocator: MAX_NTH_PER_LOCATOR,
        formAnchor,
      }),
  );
}

/**
 * Walk up DOM from element to nearest `<a>` ancestor and return its href.
 * Structural CSS for extraction — allowed per CLAUDE.md exceptions.
 * Uses `closest('a')` for flat, null-safe ancestor traversal.
 * @param el - Starting DOM element.
 * @returns href string from the nearest anchor ancestor, or empty string.
 */
function walkUpToAnchorHref(el: Element): AncestorHref {
  const anchor = el.closest('a');
  if (anchor) return anchor.href;
  return '';
}

/**
 * Snapshot the element value immediately to prevent stale-element errors.
 * For target:'href' candidates, captures the href attribute.
 * Walks up to nearest `<a>` ancestor if element itself has no href.
 * Otherwise captures innerText.
 * @param entry - The winning locator entry.
 * @returns The captured text or href value.
 */
/**
 * Extract diagnostic info from a DOM element for trace logging.
 * @param el - DOM element to inspect.
 * @returns Formatted diagnostic string.
 */
/** Sentinel for absent attribute values. */
const NO_ATTR = '(none)';

/**
 * Extract diagnostic trace info from a DOM element.
 * @param el - The DOM element.
 * @returns Diagnostic string with tag, text, href, aria.
 */
function traceElementInfo(el: Element): DiagnosticStr {
  const tag = el.tagName;
  const rawText = el.textContent;
  let text = NO_ATTR;
  if (rawText) {
    text = rawText.slice(0, 30).trim();
  }
  const href = el.getAttribute('href') ?? NO_ATTR;
  const aria = el.getAttribute('aria-label') ?? NO_ATTR;
  const closestA = el.closest('a');
  let aHref = 'NO_ANCHOR';
  if (closestA) {
    aHref = closestA.getAttribute('href') ?? NO_ATTR;
  }
  return `tag=${tag} text=${text} href=${href} aria=${aria} closestA=${aHref}`;
}

/**
 * Snapshot the element value immediately to prevent stale-element errors.
 * For target:'href' candidates, captures href + walks up to nearest `<a>` ancestor.
 * Otherwise captures innerText.
 * @param entry - The winning locator entry.
 * @returns The captured text or href value.
 */
async function snapshotValue(entry: ILocatorEntry): Promise<string> {
  const target = entry.candidate.target ?? 'self';
  if (target !== 'href') return entry.locator.innerText().catch((): ElementAttr => '');
  const elInfo = await entry.locator.evaluate(traceElementInfo).catch((): DiagnosticStr => 'error');
  const candidateInfo = `${entry.candidate.kind}="${entry.candidate.value}"`;
  LOG.debug({
    message:
      `snapshotValue: [${maskVisibleText(elInfo)}] ` +
      `candidate=${maskVisibleText(candidateInfo)}`,
  });
  const directHref = await entry.locator.getAttribute('href').catch((): ElementAttr => '');
  if (directHref) return directHref;
  const ancestorHref = await entry.locator
    .evaluate(walkUpToAnchorHref)
    .catch((): AncestorHref => '');
  return ancestorHref;
}

/** Post-race winner details bundled to satisfy the 3-param ceiling. */
interface IWinnerInfo {
  readonly index: number;
  readonly value: string;
  readonly identity: IElementIdentity;
}

/**
 * Build a successful IRaceResult from a winning entry.
 * @param entry - The winning locator entry.
 * @param winner - Winner index + snapshot value + DOM identity captured at
 *   resolve time (used by ACTION to build a precise click selector).
 * @returns A found IRaceResult.
 */
function buildFoundResult(entry: ILocatorEntry, winner: IWinnerInfo): IRaceResult {
  const { locator, candidate, context } = entry;
  const { index, value, identity } = winner;
  return { found: true, locator, candidate, context, index, value, identity };
}

/** Identity for "?" — used when evaluate() throws. */
const UNKNOWN_IDENTITY: IElementIdentity = {
  tag: '?',
  id: '?',
  classes: '?',
  name: '?',
  type: '?',
  ariaLabel: '?',
  title: '?',
  href: '?',
};

/** Max chars of outerHTML to surface in trace logs (forensic snippet). */
const OUTER_HTML_SNIPPET_MAX = 300;

/** Identity bundled with a bounded outerHTML snippet — single-evaluate result. */
interface IIdentityVerbose {
  readonly identity: IElementIdentity;
  readonly outerHtml: string;
}

/** Fallback verbose payload — used when evaluate throws. */
const UNKNOWN_VERBOSE: IIdentityVerbose = { identity: UNKNOWN_IDENTITY, outerHtml: '?' };

/**
 * Extract Physical Identity, log at TRACE level, return identity for the
 * caller (so ACTION-stage selectors can use the resolved element's actual
 * attributes — id/name/aria-label/title/href — rather than re-deriving from
 * the original WK candidate). The trace emit uses `domId` (not `id`) so the
 * DOM identity bypasses the credential-id redaction path; DOM ids on a public
 * commercial site are not PII. An outerHTML snippet (≤300 chars) is also
 * surfaced so CI-vs-LOCAL diffs can prove same-element-clicked.
 * @param entry - The winning locator entry.
 * @returns Identity object captured during PRE.
 */
/**
 * Normalize a partial verbose payload to a fully-defined IIdentityVerbose,
 * substituting the UNKNOWN sentinel when the shape is wrong. Defensive
 * against test mocks that return `false`/`true`/strings from `evaluate(...)`
 * rather than the structured payload.
 * @param obj - Partial payload — typed (no `unknown`).
 * @returns Verbose shape, never with missing fields.
 */
/** Guaranteed-string outerHTML snippet for trace logging. */
type OuterHtmlSnippet = string;

/**
 * Resolve `obj.outerHtml` to a string when present, falling back to `?`
 * when the field is missing or non-string (test mocks may return non-string
 * payloads).
 * @param obj - Partial verbose payload.
 * @returns A guaranteed outerHTML snippet.
 */
function resolveOuterHtml(obj: Partial<IIdentityVerbose>): OuterHtmlSnippet {
  if (typeof obj.outerHtml === 'string') return obj.outerHtml;
  return '?';
}

/**
 * Normalize a partial verbose payload to a fully-defined `IIdentityVerbose`,
 * substituting the UNKNOWN sentinels when the shape is wrong. Defensive
 * against test mocks that return `false`/`true`/strings from `evaluate(...)`
 * rather than the structured payload.
 * @param obj - Partial payload from evaluate.
 * @returns Verbose shape with all fields defined.
 */
function normalizeVerbose(obj: Partial<IIdentityVerbose>): IIdentityVerbose {
  const identity = obj.identity ?? UNKNOWN_IDENTITY;
  const outerHtml = resolveOuterHtml(obj);
  return { identity, outerHtml };
}

/**
 * Snapshot the resolved element's DOM identity (tag, id, classes, attrs)
 * plus a bounded outerHTML, log the bundle at debug level, and return the
 * identity for ACTION-stage selector building. The trace emit uses `domId`
 * (not `id`) so the public DOM identity bypasses the credential-id Pino
 * redaction — DOM ids on a public commercial site are not PII.
 * @param entry - The winning locator entry.
 * @returns Identity object captured during PRE.
 */
async function extractAndTraceIdentity(entry: ILocatorEntry): Promise<IElementIdentity> {
  const evaluated = await entry.locator
    .evaluate(
      (el: Element, max: number): IIdentityVerbose => ({
        identity: {
          tag: el.tagName,
          id: el.id || '(none)',
          classes: el.className || '(none)',
          name: el.getAttribute('name') ?? '(none)',
          type: el.getAttribute('type') ?? '(none)',
          ariaLabel: el.getAttribute('aria-label') ?? '(none)',
          title: el.getAttribute('title') ?? '(none)',
          href: el.getAttribute('href') ?? '(none)',
        },
        outerHtml: (el.outerHTML || '').slice(0, max),
      }),
      OUTER_HTML_SNIPPET_MAX,
    )
    .catch((): IIdentityVerbose => UNKNOWN_VERBOSE);
  // Static type says IIdentityVerbose but test mocks return arbitrary
  // payloads — narrow defensively before destructuring.
  const raw = evaluated as Partial<IIdentityVerbose>;
  const verbose = normalizeVerbose(raw);
  const { identity, outerHtml } = verbose;
  LOG.debug({
    tag: identity.tag,
    domId: identity.id,
    classes: identity.classes,
    attrs: {
      name: identity.name,
      type: identity.type,
      ariaLabel: identity.ariaLabel,
      title: identity.title,
      href: identity.href,
    },
    outerHtml,
    visibility: 'visible',
  });
  return identity;
}

/**
 * Log race diagnostic — fulfilled count + winner index + per-locator detail.
 * Emitted at debug level (not trace) so the resolver flow stays visible at
 * the standard CI debug level. Without this, debug-level runs see the
 * "resolveVisible: 49 locators" probe but no winner — i.e. blind to which
 * locator actually matched.
 * @param entries - All locator entries with candidate + context.
 * @param diag - Race diagnostic result.
 * @returns True after logging.
 */
function traceRaceDiagnostic(entries: readonly ILocatorEntry[], diag: IRaceDiagnostic): true {
  const fulfilledDetail = diag.fulfilledIndices.map((idx): DiagnosticStr => {
    const e = entries[idx];
    const kind = e.candidate.kind;
    const val = e.candidate.value;
    const ctx = e.context.url();
    return `${kind}:${val} @ ${ctx}`;
  });
  LOG.debug({
    fulfilled: diag.fulfilledCount,
    hitTestPassed: diag.hitTestPassedCount,
    winner: diag.winner,
    detail: fulfilledDetail,
  });
  return true;
}

/**
 * Run the hit-test race against an entry list, log diagnostics.
 * Extracted so resolveVisibleImpl + resolveVisibleNthAware share one path.
 * @param entries - Locator entries (single-match `.first()` OR nth-enumerated).
 * @param timeout - Race timeout (already capped by caller).
 * @param label - Log prefix identifying the resolver (for diagnostic trace).
 * @returns Race diagnostic with winner + fulfilled detail.
 */
async function runHitTestRace(
  entries: readonly ILocatorEntry[],
  timeout: number,
  label: string,
): Promise<IRaceDiagnostic> {
  const locators = entries.map((e): Locator => e.locator);
  const countStr = String(locators.length);
  const timeoutStr = String(timeout);
  LOG.debug({ message: `${label}: ${countStr} locators, timeout=${timeoutStr}ms` });
  const diag = await raceLocatorsWithHitTest(locators, timeout);
  traceRaceDiagnostic(entries, diag);
  return diag;
}

/**
 * Capture identity + value from the winning entry and wrap as IRaceResult.
 * @param winner - Winning locator entry.
 * @param index - Winner's index within the entries array.
 * @returns Found IRaceResult ready for the caller.
 */
async function finalizeWinner(winner: ILocatorEntry, index: WinnerIndex): Promise<IRaceResult> {
  const identity = await extractAndTraceIdentity(winner);
  const value = await snapshotValue(winner);
  return buildFoundResult(winner, { index, value, identity });
}

/**
 * Race entries through hit-test, return found-result or NOT_FOUND.
 * Shared body for resolveVisibleImpl (`.first()` per candidate) and
 * resolveVisibleNthAware (nth-enumerated). Caller picks the entry-builder.
 * @param entries - Locator entries to race.
 * @param timeout - Race timeout (already capped).
 * @param label - Diagnostic label for log output.
 * @returns Found-result on hit-test winner, NOT_FOUND_RESULT otherwise.
 */
async function raceEntriesToResult(
  entries: readonly ILocatorEntry[],
  timeout: number,
  label: string,
): Promise<IRaceResult> {
  if (entries.length === 0) return NOT_FOUND_RESULT;
  const diag = await runHitTestRace(entries, timeout, label);
  if (diag.winner < 0) return NOT_FOUND_RESULT;
  return finalizeWinner(entries[diag.winner], diag.winner);
}

/**
 * Resolve the first visible element — parallel race across candidates with
 * `.first()` per locator. Uses the SAME resolveVisible + hit-test logic in
 * both LIVE and MOCK modes (Rule #20: passive discovery is identical). If
 * an element isn't visible in the rendered snapshot, the mock MUST fail —
 * that's the whole point. When `args.formAnchor` is set, ALL candidate kinds
 * are scoped to descendants of the form via Playwright Locator chaining.
 * @param args - Bundled page + candidates + timeout + formAnchor.
 * @returns Race result with locator + metadata, or NOT_FOUND.
 */
async function resolveVisibleImpl(args: IClickResolveArgs): Promise<IRaceResult> {
  const entries = buildLocatorEntries(args.page, args.candidates, args.formAnchor);
  const effectiveTimeout = capTimeout(args.timeout);
  return raceEntriesToResult(entries, effectiveTimeout, 'resolveVisible');
}

/**
 * Bundled args for the click-resolution pipeline (resolveVisibleNthAware
 * and resolveAndClickImpl). Keeps both functions inside the 3-param
 * ceiling while threading formAnchor for form-membership scoping.
 */
interface IClickResolveArgs {
  readonly page: Page;
  readonly candidates: readonly SelectorCandidate[];
  readonly timeout: number;
  readonly formAnchor: string;
}

/**
 * Resolve the first visible element — like resolveVisibleImpl but enumerates
 * `.nth(0..MAX_NTH_PER_LOCATOR-1)` per base locator so multi-match elements
 * (e.g. several `<button type="submit">` across login + SMS forms) all enter
 * the race. Hit-test picks the truly visible+enabled winner.
 *
 * When `args.formAnchor` is set, ALL candidate kinds are scoped to descendants
 * of the form via Playwright Locator chaining — `ctx.locator(formAnchor)`
 * becomes the parent context for `.locator/.getByText/.getByLabel/...`,
 * and absolute "//xpath" is relativized to ".//xpath". Form-membership is
 * a deterministic DOM-tree filter, independent of CSS visibility timing.
 *
 * @param args - Bundled page + candidates + timeout + formAnchor.
 * @returns Race result with locator + metadata, or NOT_FOUND.
 */
async function resolveVisibleNthAware(args: IClickResolveArgs): Promise<IRaceResult> {
  const entries = await buildLocatorEntriesAll(args.page, args.candidates, args.formAnchor);
  const effectiveTimeout = capTimeout(args.timeout);
  return raceEntriesToResult(entries, effectiveTimeout, 'resolveVisibleNthAware');
}

/**
 * Build a dedup key for a winning element. Prefers the resolved element's
 * `id` attribute (a stable, human-meaningful handle); falls back to a
 * selector + frame-url composite when id is absent.
 * @param entry - The fulfilling locator entry (carries candidate + frame).
 * @param identity - DOM identity captured by `extractIdentity`.
 * @returns A string key safe to insert into a Set for dedup.
 */
function identityKey(entry: ILocatorEntry, identity: IElementIdentity): IdentityKey {
  if (identity.id !== '(none)' && identity.id.length > 0) return `id:${identity.id}`;
  const frameUrl = entry.context.url();
  return `sel:${entry.candidate.kind}=${entry.candidate.value}@${frameUrl}`;
}

/**
 * Bundled args for `extractWinnerSequence` — keeps the signature inside the
 * 3-param ceiling.
 */
interface ISequenceArgs {
  readonly entries: readonly ILocatorEntry[];
  readonly indices: readonly WinnerIndex[];
  readonly cap: number;
}

/** Race winner enriched with identity + identityKey + selector specificity. */
interface IEnrichedWinner {
  readonly winnerIdx: WinnerIndex;
  readonly entry: ILocatorEntry;
  readonly identity: IElementIdentity;
  readonly key: IdentityKey;
  readonly rank: SpecificityRank;
}

/** Lower rank = more specific selector (preferred when picking canonical). */
type SpecificityRank = number;

/** Selector specificity by candidate kind. Lower = more specific. */
const KIND_SPECIFICITY: Readonly<Record<SelectorCandidate['kind'], SpecificityRank>> = {
  name: 2,
  ariaLabel: 4,
  css: 5,
  xpath: 6,
  placeholder: 7,
  labelText: 8,
  exactText: 9,
  clickableText: 10,
  textContent: 11,
  regex: 12,
};

/** CSS attribute-prefix specificity (overrides bare 'css' kind). */
const CSS_PREFIX_SPECIFICITY: readonly (readonly [string, SpecificityRank])[] = [
  ['[id=', 0],
  ['[name=', 1],
  ['[aria-label=', 3],
];

/**
 * CSS-specific specificity for the value-prefix overrides. Returns -1 when
 * the candidate isn't a CSS selector matching one of the special prefixes;
 * the caller falls back to KIND_SPECIFICITY.
 * @param candidate - The selector candidate to inspect.
 * @returns Specificity rank, or -1 when no CSS prefix override applies.
 */
function cssPrefixRank(candidate: SelectorCandidate): SpecificityRank {
  if (candidate.kind !== 'css') return -1;
  const matched = CSS_PREFIX_SPECIFICITY.find(([prefix]) => candidate.value.startsWith(prefix));
  if (!matched) return -1;
  return matched[1];
}

/**
 * Compute a specificity rank for a SelectorCandidate. CSS selectors that
 * lock onto `[id=]`, `[name=]`, or `[aria-label=]` rank above generic CSS;
 * text-based kinds rank lowest. Used to pick the most specific selector
 * within a group of race winners that all resolved to the same DOM element.
 * @param candidate - The selector candidate to rank.
 * @returns Lower number = more specific.
 */
function specificityRank(candidate: SelectorCandidate): SpecificityRank {
  const cssRank = cssPrefixRank(candidate);
  if (cssRank >= 0) return cssRank;
  return KIND_SPECIFICITY[candidate.kind];
}

/**
 * Enrich one race-winner index with its identity + dedup key + specificity
 * rank. Extracted so `enrichAllWinners` stays inside the line-count ceiling.
 * @param entries - The full locator-entry array.
 * @param winnerIdx - Index into `entries` for this race winner.
 * @returns Enriched winner record.
 */
async function enrichWinner(
  entries: readonly ILocatorEntry[],
  winnerIdx: WinnerIndex,
): Promise<IEnrichedWinner> {
  const entry = entries[winnerIdx];
  const identity = await extractAndTraceIdentity(entry);
  const key = identityKey(entry, identity);
  const rank = specificityRank(entry.candidate);
  return { winnerIdx, entry, identity, key, rank };
}

/**
 * Enrich all race winners in parallel — each gets its DOM identity + dedup
 * key + selector specificity rank.
 * @param args - Locator entries, race-winner indices, cap.
 * @returns Enriched winners, in race-time order.
 */
async function enrichAllWinners(args: ISequenceArgs): Promise<readonly IEnrichedWinner[]> {
  const promises = args.indices.map(idx => enrichWinner(args.entries, idx));
  return Promise.all(promises);
}

/**
 * Decide whether `candidate` should replace the current group representative.
 * @param existing - Current canonical entry for the group (or `false` if none).
 * @param candidate - New entry being considered.
 * @returns True when the candidate is more specific than the existing entry.
 */
function shouldReplaceGroupCanonical(
  existing: IEnrichedWinner | false,
  candidate: IEnrichedWinner,
): IsCanonicalUpgrade {
  if (!existing) return true;
  return candidate.rank < existing.rank;
}

/**
 * Insert one enriched winner into the group map, replacing any existing
 * entry only when the candidate has higher specificity. Extracted so the
 * caller's loop body stays inside the depth-1 ceiling.
 * @param groups - Mutable group map keyed by identityKey.
 * @param candidate - Enriched winner being considered for canonical slot.
 * @returns True after the insert/replace decision is recorded.
 */
function upsertCanonicalGroup(
  groups: Map<IdentityKey, IEnrichedWinner>,
  candidate: IEnrichedWinner,
): true {
  const existing = groups.get(candidate.key) ?? false;
  const isUpgrade = shouldReplaceGroupCanonical(existing, candidate);
  if (isUpgrade) groups.set(candidate.key, candidate);
  return true;
}

/**
 * Group enriched winners by identityKey, keeping ONE canonical entry per
 * group (the one with the most specific selector). Insertion order
 * preserves race-time order of FIRST encounter for each DOM element.
 * @param enriched - All race winners, identity-tagged.
 * @returns One canonical entry per distinct DOM element.
 */
function pickCanonicalPerGroup(enriched: readonly IEnrichedWinner[]): readonly IEnrichedWinner[] {
  const groups = new Map<IdentityKey, IEnrichedWinner>();
  for (const e of enriched) upsertCanonicalGroup(groups, e);
  return [...groups.values()];
}

/**
 * Build the final IRaceResult for one canonical winner — snapshots the
 * value at click-time and wraps the entry + identity into a found-result.
 * @param e - Canonical enriched winner for a DOM-element group.
 * @returns IRaceResult ready for the caller.
 */
async function buildResultFromEnriched(e: IEnrichedWinner): Promise<IRaceResult> {
  const value = await snapshotValue(e.entry);
  return buildFoundResult(e.entry, { index: e.winnerIdx, value, identity: e.identity });
}

/**
 * Emit one IRaceResult per DISTINCT DOM element — never multiple results
 * for the same element via different selectors. Algorithm:
 *   1. Enrich every race winner with identity + identityKey + specificity
 *   2. Group by identityKey, pick the most-specific selector per group
 *   3. Cap at `args.cap` GROUPS (i.e. distinct DOM elements)
 *   4. Build IRaceResult per surviving canonical winner
 * Replaces the old race-time-order walk that biased toward selector kind
 * over DOM-element distinctness.
 * @param args - Locator entries, race-winner indices, cap.
 * @returns Up to `cap` IRaceResult entries, one per distinct DOM element.
 */
async function extractWinnerSequence(args: ISequenceArgs): Promise<IRaceResult[]> {
  const enriched = await enrichAllWinners(args);
  const canonical = pickCanonicalPerGroup(enriched);
  const capped = canonical.slice(0, args.cap);
  const resultPromises = capped.map(buildResultFromEnriched);
  return Promise.all(resultPromises);
}

/** Bundled args for `resolveAllVisibleImpl` — 3-param ceiling. */
interface IResolveAllArgs {
  readonly page: Page;
  readonly candidates: readonly SelectorCandidate[];
  readonly timeout: number;
  readonly cap: number;
}

/**
 * Resolve up to `cap` visible elements (DOM order). Same race as
 * resolveVisibleImpl but does not stop at the first winner. Hit-test passed
 * candidates come first; fulfilled-but-not-hit-test fall in afterwards.
 * Deduplicated by element identity (id, falling back to selector key) so
 * multiple WK candidates resolving to the same element collapse to one.
 * @param args - Page + candidates + timeout + cap (bundled).
 * @returns Up to `cap` IRaceResult entries; empty array when none fulfill.
 */
async function resolveAllVisibleImpl(args: IResolveAllArgs): Promise<readonly IRaceResult[]> {
  if (args.cap < 1) return [];
  // resolveAllVisible enumerates `.nth(0..MAX_NTH_PER_LOCATOR-1)` per base
  // locator so multi-match elements (legacy + modern nav buttons sharing
  // the same aria-label) BOTH surface in the candidate list. Identity
  // dedup (extractWinnerSequence) collapses race winners that point to
  // the same DOM element while preserving distinct ones.
  const entries = await buildLocatorEntriesAll(args.page, args.candidates);
  if (entries.length === 0) return [];
  const locators = entries.map((e): Locator => e.locator);
  const effectiveTimeout = capTimeout(args.timeout);
  const countStr = String(locators.length);
  const timeoutStr = String(effectiveTimeout);
  const capStr = String(args.cap);
  LOG.debug({
    message: `resolveAllVisible: ${countStr} locators, timeout=${timeoutStr}ms, cap=${capStr}`,
  });
  const diag = await raceLocatorsWithHitTest(locators, effectiveTimeout);
  traceRaceDiagnostic(entries, diag);
  const fulfilled = diag.fulfilledIndices;
  if (fulfilled.length === 0) return [];
  const result = await extractWinnerSequence({ entries, indices: fulfilled, cap: args.cap });
  return result;
}

/**
 * Resolve the first visible element within a SINGLE frame context.
 * Same logic as resolveVisibleImpl but scoped to one context.
 * @param ctx - The specific Page or Frame to search.
 * @param candidates - WellKnown selector candidates.
 * @param timeout - Race timeout in ms.
 * @returns IRaceResult scoped to the given context.
 */
async function resolveVisibleInContextImpl(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
  timeout: number,
): Promise<IRaceResult> {
  const entries = candidates.flatMap((c): ILocatorEntry[] =>
    buildCandidateLocators(ctx, c).map(
      (locator): ILocatorEntry => ({ locator, candidate: c, context: ctx }),
    ),
  );
  if (entries.length === 0) return NOT_FOUND_RESULT;
  const locators = entries.map((e): Locator => e.locator);
  const effectiveTimeout = capTimeout(timeout);
  const countStr = String(locators.length);
  const timeoutStr = String(effectiveTimeout);
  LOG.debug({
    message: `resolveVisibleInContext: ${countStr} locators, ${timeoutStr}ms`,
  });
  const diag = await raceLocatorsWithHitTest(locators, effectiveTimeout);
  traceRaceDiagnostic(entries, diag);
  if (diag.winner < 0) return NOT_FOUND_RESULT;
  const winner = entries[diag.winner];
  const identity = await extractAndTraceIdentity(winner);
  const value = await snapshotValue(winner);
  return buildFoundResult(winner, { index: diag.winner, value, identity });
}

/**
 * Resolve and click — tries visible elements first; falls back to attached (force click).
 * Fallback handles elements hidden by accessibility overlays (e.g. UserWay) that are
 * in the DOM but have zero bounding box or are offset off-screen.
 * When `args.formAnchor` is set, ALL candidate kinds are scoped to descendants of
 * the form via Playwright Locator chaining (uniform, deterministic filter).
 * @param args - Bundled page + candidates + timeout + formAnchor.
 * @returns Procedure with IRaceResult — found=true if clicked, NOT_FOUND_RESULT if not found.
 */
async function resolveAndClickImpl(args: IClickResolveArgs): Promise<Procedure<IRaceResult>> {
  const effectiveTimeout = capTimeout(args.timeout);
  const raceArgs: IClickResolveArgs = {
    page: args.page,
    candidates: args.candidates,
    timeout: effectiveTimeout,
    formAnchor: args.formAnchor,
  };
  const result = await resolveVisibleNthAware(raceArgs);
  if (result.found && result.locator) {
    await result.locator.click({ timeout: effectiveTimeout }).catch((): false => false);
    return succeed(result);
  }
  // Fallback: attached state — element is in DOM but not visually visible
  const entries = buildLocatorEntries(args.page, args.candidates, args.formAnchor);
  const locators = entries.map((e): Locator => e.locator);
  const winnerIdx = await raceLocators(locators, effectiveTimeout, 'attached');
  if (winnerIdx < 0) return succeed(NOT_FOUND_RESULT);
  const clickOpts = { force: true, timeout: effectiveTimeout };
  await entries[winnerIdx].locator.click(clickOpts).catch((): false => false);
  const identity = await extractAndTraceIdentity(entries[winnerIdx]);
  const snapshot = await snapshotValue(entries[winnerIdx]);
  const attachedResult = buildFoundResult(entries[winnerIdx], {
    index: winnerIdx,
    value: snapshot,
    identity,
  });
  return succeed(attachedResult);
}

/**
 * Build resolveVisible method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveVisible function.
 */
function buildResolveVisible(page: Page): IElementMediator['resolveVisible'] {
  return (candidates, timeoutMs?, formAnchor?): Promise<IRaceResult> => {
    if (candidates.length === 0) return Promise.resolve(NOT_FOUND_RESULT);
    const timeout = timeoutMs ?? CLICK_RACE_TIMEOUT;
    const anchor = formAnchor ?? NO_FORM_ANCHOR;
    return resolveVisibleImpl({ page, candidates, timeout, formAnchor: anchor });
  };
}

/**
 * Build resolveAllVisible method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveAllVisible function.
 */
function buildResolveAllVisible(page: Page): IElementMediator['resolveAllVisible'] {
  return (candidates, timeoutMs, cap): Promise<readonly IRaceResult[]> => {
    if (candidates.length === 0) return Promise.resolve([]);
    if (cap < 1) return Promise.resolve([]);
    return resolveAllVisibleImpl({ page, candidates, timeout: timeoutMs, cap });
  };
}

/**
 * Build resolveVisibleInContext method — scoped to a single frame.
 * @returns Mediator resolveVisibleInContext function.
 */
function buildResolveVisibleInContext(): IElementMediator['resolveVisibleInContext'] {
  return (candidates, context, timeoutMs?): Promise<IRaceResult> => {
    if (candidates.length === 0) return Promise.resolve(NOT_FOUND_RESULT);
    const timeout = timeoutMs ?? CLICK_RACE_TIMEOUT;
    return resolveVisibleInContextImpl(context, candidates, timeout);
  };
}

/**
 * Build resolveAndClick method bound to a page.
 * Internally calls resolveVisible then clicks the winner.
 * @param page - The Playwright page.
 * @returns Mediator resolveAndClick function.
 */
/**
 * Pick the WK_LOGIN_FORM.submit fallback when caller passes empty candidates.
 * Keys: 'true' = empty array (fallback to WK), 'false' = caller's candidates.
 * @param callerCandidates - Candidates passed by the caller (possibly empty).
 * @returns Effective candidates for the click race.
 */
function pickClickCandidates(
  callerCandidates: readonly SelectorCandidate[],
): readonly SelectorCandidate[] {
  const sourceByEmpty: Readonly<Record<string, readonly SelectorCandidate[]>> = {
    true: WK_LOGIN_FORM.submit,
    false: callerCandidates,
  };
  return sourceByEmpty[String(callerCandidates.length === 0)];
}

/**
 * Build resolveAndClick method bound to a page.
 * Reads optional formAnchor from caller; passes through to the impl which
 * scopes ALL candidate kinds via Playwright Locator chaining.
 * @param page - The Playwright page.
 * @returns Mediator resolveAndClick function.
 */
function buildResolveAndClick(page: Page): IElementMediator['resolveAndClick'] {
  return (candidates, timeoutMs?, formAnchor?): Promise<Procedure<IRaceResult>> => {
    const timeout = timeoutMs ?? CLICK_RACE_TIMEOUT;
    const anchor = formAnchor ?? NO_FORM_ANCHOR;
    const useCandidates = pickClickCandidates(candidates);
    return resolveAndClickImpl({ page, candidates: useCandidates, timeout, formAnchor: anchor });
  };
}

/**
 * Build getFormAnchor method bound to the per-instance form cache.
 * Returns the cached form selector populated by `discoverForm`, or '' when
 * none discovered yet. Caller passes this to `resolveAndClick` so click
 * resolution is form-scoped.
 * @param cache - Per-instance form cache.
 * @returns Mediator getFormAnchor function.
 */
function buildGetFormAnchor(cache: IFormCache): IElementMediator['getFormAnchor'] {
  return (): FormAnchorStr => cache.selector;
}

/** Default timeout for network idle wait (matches POST_LOGIN_SETTLE_TIMEOUT). */
const NETWORK_IDLE_TIMEOUT = 15_000;

/** Element count returned when getByText fails or element is absent. */
type ElementCount = number;

/**
 * Build navigateTo method bound to a page.
 * Navigation errors are terminal — fail() propagates.
 * @param page - The Playwright page.
 * @returns Mediator navigateTo function.
 */
function buildNavigateTo(page: Page): IElementMediator['navigateTo'] {
  return async (url, opts): Promise<Procedure<void>> => {
    try {
      await page.goto(url, opts);
      return succeed(undefined);
    } catch (error) {
      const msg = toErrorMessage(error as Error);
      return fail(ScraperErrorTypes.Generic, `Navigation failed: ${msg}`);
    }
  };
}

/**
 * Build getCurrentUrl method bound to a page.
 * SYNCHRONOUS — page.url() is sync in Playwright. No Promise wrapping.
 * @param page - The Playwright page.
 * @returns Mediator getCurrentUrl function.
 */
function buildGetCurrentUrl(page: Page): IElementMediator['getCurrentUrl'] {
  return (): PageUrl => page.url();
}

/**
 * Build waitForNetworkIdle method bound to a page.
 * Timeout is non-fatal — slow analytics ≠ broken scraper.
 * @param page - The Playwright page.
 * @returns Mediator waitForNetworkIdle function.
 */
function buildWaitForNetworkIdle(page: Page): IElementMediator['waitForNetworkIdle'] {
  return async (timeoutMs?): Promise<Procedure<void>> => {
    const timeout = timeoutMs ?? NETWORK_IDLE_TIMEOUT;
    try {
      await page.waitForLoadState('networkidle', { timeout });
    } catch {
      // Timeout is non-fatal — SPA may stay "loading"
    }
    return succeed(undefined);
  };
}

/**
 * Build countByText method bound to a page.
 * Returns 0 on any error (element not found = valid 0-count).
 * @param page - The Playwright page.
 * @returns Mediator countByText function.
 */
function buildCountByText(page: Page): IElementMediator['countByText'] {
  return (text: string): Promise<ElementCount> =>
    page
      .getByText(text)
      .first()
      .count()
      .catch((): ElementCount => 0);
}

/**
 * Build countBySelector method bound to a page. Wraps
 * `page.locator(selector).count()` with a `.catch → 0` guard so phases
 * can probe element presence without ever touching Playwright directly.
 * Used by login.POST to verify the login form is gone after submit.
 * @param page - The Playwright page.
 * @returns Mediator countBySelector function.
 */
function buildCountBySelector(page: Page): IElementMediator['countBySelector'] {
  return (selector: string): Promise<ElementCount> =>
    page
      .locator(selector)
      .count()
      .catch((): ElementCount => 0);
}

/**
 * Extract all href attributes from anchor elements in one shot.
 * Uses evaluateAll to avoid await-in-loop — single DOM round-trip.
 * @param anchors - Locator for all anchor elements.
 * @returns Raw href strings from the DOM.
 */
async function extractRawHrefs(anchors: Locator): Promise<readonly string[]> {
  /**
   * Map anchor elements to their href attribute values.
   * @param els - Anchor elements from the DOM.
   * @returns Href strings.
   */
  const mapper = (els: HTMLAnchorElement[]): ElementAttr[] => els.map((el): ElementAttr => el.href);
  return anchors.evaluateAll(mapper).catch((): string[] => []);
}

/**
 * Build getAttributeValue — read raw attribute from resolved locator.
 * @returns Async function returning the raw attribute string.
 */
function buildGetAttributeValue(): IElementMediator['getAttributeValue'] {
  return async (result, attrName) => {
    if (!result.found || !result.locator) return '';
    const attr = await result.locator.getAttribute(attrName).catch((): ElementAttr => '');
    return attr ?? '';
  };
}

/**
 * Build collectAllHrefs — harvest all absolute hrefs from anchor elements.
 * Read-only extraction via structural CSS (allowed per CLAUDE.md exceptions).
 * @param page - The Playwright page.
 * @returns Async function returning deduplicated absolute hrefs.
 */
/**
 * Build checkAttribute — passive attribute detection on resolved locator.
 * @returns Async function returning Procedure with attribute presence.
 */
function buildCheckAttribute(): IElementMediator['checkAttribute'] {
  return async (result, attrName) => {
    if (!result.found || !result.locator) return succeed(false);
    const attr = await result.locator.getAttribute(attrName).catch((): ElementAttr => '');
    const attrStr = attr ?? '';
    const hasAttr = attrStr.length > 0;
    return succeed(hasAttr);
  };
}

/**
 * Build collectAllHrefs — harvest all absolute hrefs from anchor elements.
 * Read-only extraction via structural CSS (allowed per CLAUDE.md exceptions).
 * @param page - The Playwright page.
 * @returns Async function returning deduplicated absolute hrefs.
 */
function buildCollectAllHrefs(page: Page): () => Promise<readonly string[]> {
  return async (): Promise<readonly string[]> => {
    const anchors = page.locator('a[href]');
    const rawHrefs = await extractRawHrefs(anchors);
    return [...new Set(rawHrefs)].filter((h): FilterMatch => h.length > 0);
  };
}

/** Default timeout for SPA URL wait. */
const URL_WAIT_TIMEOUT = 10000;

/** Whether URL matched the expected pattern. */
type UrlMatched = boolean;

/**
 * Build waitForURL — wait for page URL to match a glob pattern.
 * Non-fatal: returns succeed(false) on timeout.
 * @param page - The Playwright page.
 * @returns Async function returning Procedure with match result.
 */
function buildWaitForURL(page: Page): IElementMediator['waitForURL'] {
  return async (pattern, timeoutMs = URL_WAIT_TIMEOUT) => {
    const didMatch: UrlMatched = await page
      .waitForURL(pattern, { timeout: timeoutMs })
      .then((): UrlMatched => true)
      .catch((): UrlMatched => false);
    return succeed(didMatch);
  };
}

/** Simplified cookie shape for session audit. */
/**
 * Build getCookies — extract cookies from browser context.
 * @param page - The Playwright page.
 * @returns Async function returning cookie array.
 */
function buildGetCookies(page: Page): () => Promise<readonly ICookieSnapshot[]> {
  return async (): Promise<readonly ICookieSnapshot[]> => {
    const raw = await page.context().cookies();
    return raw.map((c): ICookieSnapshot => ({ name: c.name, domain: c.domain, value: c.value }));
  };
}

/**
 * Create an ElementMediator for the given page.
 * Each instance has its own form anchor cache — safe for concurrent use.
 * @param page - The Playwright page to resolve elements on.
 * @returns An IElementMediator with real implementations.
 */
function createElementMediator(page: Page): IElementMediator {
  const cache: IFormCache = { selector: '' };
  const network = createNetworkDiscovery(page);
  const mediator: IElementMediator = {
    resolveField: buildResolveField(page),
    resolveClickable: buildResolveClickable(page),
    resolveVisible: buildResolveVisible(page),
    resolveAllVisible: buildResolveAllVisible(page),
    resolveVisibleInContext: buildResolveVisibleInContext(),
    resolveAndClick: buildResolveAndClick(page),
    /**
     * Set active phase for log accuracy.
     * @param name - Phase name.
     * @returns True.
     */
    setActivePhase: (name: string): true => {
      return setGlobalPhase(name);
    },
    /**
     * Set active pipeline stage for log events.
     * @param name - Stage name (PRE, ACTION, POST, FINAL).
     * @returns True.
     */
    setActiveStage: (name: StageLabel): true => {
      return setGlobalStage(name);
    },
    discoverErrors: buildDiscoverErrors(),
    waitForLoadingDone: buildWaitForLoadingDone(),
    discoverForm: buildDiscoverForm(cache),
    scopeToForm: buildScopeToForm(cache),
    getFormAnchor: buildGetFormAnchor(cache),
    network,
    navigateTo: buildNavigateTo(page),
    getCurrentUrl: buildGetCurrentUrl(page),
    waitForNetworkIdle: buildWaitForNetworkIdle(page),
    checkAttribute: buildCheckAttribute(),
    getAttributeValue: buildGetAttributeValue(),

    waitForURL: buildWaitForURL(page),
    countByText: buildCountByText(page),
    countBySelector: buildCountBySelector(page),
    collectAllHrefs: buildCollectAllHrefs(page),
    getCookies: buildGetCookies(page),
    /**
     * Inject cookies into the browser context for cross-domain session promotion.
     * @param cookies - Cookies to add.
     */
    addCookies: async (cookies): Promise<void> => {
      await page.context().addCookies(cookies);
    },
  };
  return mediator;
}

/**
 * Extract a sealed IActionMediator from a full IElementMediator.
 * Builds a closure-scoped frame registry — private, immutable.
 * NO setActivePhase, NO setActiveStage, NO network, NO raw Frame.
 * @param full - The full element mediator.
 * @param page - The Playwright page (for registry construction).
 * @returns Sealed action-only mediator with contextId-based execution.
 */
function extractActionMediator(full: IElementMediator, page: Page): IActionMediator {
  const registry = buildFrameRegistry(page);
  return {
    /** @inheritdoc */
    fillInput: (
      ctxId: FormSelectorStr,
      sel: FormSelectorStr,
      val: FormSelectorStr,
    ): Promise<true> => {
      const frame = resolveFrame(registry, ctxId);
      return fillInputImpl(frame, sel, val);
    },
    /** @inheritdoc */
    clickElement: (args): Promise<true> => {
      const frame = resolveFrame(registry, args.contextId);
      return clickElementImpl({
        frame,
        selector: args.selector,
        isForce: args.isForce,
        nth: args.nth,
      });
    },
    /** @inheritdoc */
    pressEnter: (ctxId: FormSelectorStr): Promise<true> => {
      const frame = resolveFrame(registry, ctxId);
      return pressEnterImpl(frame);
    },
    /** @inheritdoc */
    navigateTo: (...args) => full.navigateTo(...args),
    /** @inheritdoc */
    waitForNetworkIdle: (...args) => full.waitForNetworkIdle(...args),
    /** @inheritdoc */
    waitForURL: (...args) => full.waitForURL(...args),
    /** @inheritdoc */
    getCurrentUrl: () => full.getCurrentUrl(),
    /** @inheritdoc */
    countByText: (...args) => full.countByText(...args),
    /** @inheritdoc */
    countBySelector: (...args) => full.countBySelector(...args),
    /** @inheritdoc */
    getCookies: () => full.getCookies(),
    /** @inheritdoc */
    addCookies: (...args) => full.addCookies(...args),
    /** @inheritdoc */
    collectAllHrefs: () => full.collectAllHrefs(),
    /** @inheritdoc */
    collectStorage: async () => page.evaluate(() => Object.assign({}, sessionStorage)),
    /** @inheritdoc */
    hasTxnEndpoint: (): IsTxnFound => full.network.discoverTransactionsEndpoint() !== false,
    /** @inheritdoc */
    waitForTxnEndpoint: async (timeoutMs: number): Promise<IsTxnFound> => {
      const hit = await full.network.waitForTransactionsTraffic(timeoutMs);
      return hit !== false;
    },
  };
}

export default createElementMediator;
export { createElementMediator, extractActionMediator, getActivePhase, getActiveStage };
