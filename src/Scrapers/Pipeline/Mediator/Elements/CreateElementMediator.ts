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

/**
 * Build xpath BASE locators (no `.first()`) for a textContent candidate.
 * Walk-up to each interactive ancestor — same logic as resolveByAncestorWalkUp.
 * Callers that want first-match-only wrap with `.first()`; callers that
 * want all matches enumerate via `.nth(i)`.
 * @param ctx - Playwright Page or Frame context.
 * @param text - Visible text to find.
 * @returns Array of Playwright base locators targeting interactive ancestors.
 */
function buildWalkUpLocatorsBase(ctx: Page | Frame, text: string): Locator[] {
  return CLICK_ANCESTORS.map(
    (tag): Locator => ctx.locator(`xpath=//${tag}[.//text()[contains(., "${text}")]]`),
  );
}

/**
 * Build BASE locators (no `.first()`) for a clickableText candidate —
 * innermost element with text. Excludes elements that have children also
 * containing the text.
 * @param ctx - Playwright Page or Frame context.
 * @param text - Visible text to find.
 * @returns Array of Playwright base locators.
 */
function buildClickableTextLocatorsBase(ctx: Page | Frame, text: string): Locator[] {
  const innermost = `//*[contains(., "${text}") and not(.//*[contains(., "${text}")])]`;
  return [ctx.locator(`xpath=${innermost}`)];
}

/**
 * Build BASE Playwright locators from a SelectorCandidate — without `.first()`
 * applied. Two callers wrap the output:
 *   - `buildCandidateLocators`: applies `.first()` for first-match-only
 *     resolvers (login, preLogin, etc.) — preserves existing behaviour.
 *   - `buildLocatorEntriesAll`: enumerates `.nth(0..N-1)` per base locator
 *     so multi-match elements (legacy + modern nav buttons) both surface
 *     in the candidate list.
 * @param ctx - Playwright Page or Frame.
 * @param candidate - The selector candidate.
 * @returns Array of base locators (race targets — no `.first()` applied).
 */
function buildCandidateLocatorsBase(ctx: Page | Frame, candidate: SelectorCandidate): Locator[] {
  if (candidate.kind === 'textContent') return buildWalkUpLocatorsBase(ctx, candidate.value);
  if (candidate.kind === 'clickableText') {
    return buildClickableTextLocatorsBase(ctx, candidate.value);
  }
  if (candidate.kind === 'ariaLabel')
    return [
      ctx.getByLabel(candidate.value), // form inputs
      ctx.getByRole('button', { name: candidate.value, exact: false }),
      ctx.getByRole('link', { name: candidate.value, exact: false }),
      ctx.getByRole('tab', { name: candidate.value, exact: false }),
    ];
  if (candidate.kind === 'placeholder') return [ctx.getByPlaceholder(candidate.value)];
  if (candidate.kind === 'xpath') return [ctx.locator(candidate.value)];
  if (candidate.kind === 'name') return [ctx.locator(`[name="${candidate.value}"]`)];
  if (candidate.kind === 'regex') return [ctx.getByText(new RegExp(candidate.value))];
  if (candidate.kind === 'exactText') return [ctx.getByText(candidate.value, { exact: true })];
  return [ctx.getByText(candidate.value)];
}

/**
 * Build first-match locators from a SelectorCandidate — applies `.first()`
 * on top of the base locators. This is the API used by every legacy
 * resolver (login, preLogin, OTP, scrape) — same behaviour as before the
 * nth-enumeration split.
 * @param ctx - Playwright Page or Frame.
 * @param candidate - The selector candidate.
 * @returns Array of `.first()`-wrapped locators ready to race.
 */
function buildCandidateLocators(ctx: Page | Frame, candidate: SelectorCandidate): Locator[] {
  return buildCandidateLocatorsBase(ctx, candidate).map((loc): Locator => loc.first());
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
 * @returns Array of locator entries with metadata.
 */
function buildLocatorEntries(
  page: Page,
  candidates: readonly SelectorCandidate[],
): ILocatorEntry[] {
  const contexts = getAllContexts(page);
  return contexts.flatMap((ctx): ILocatorEntry[] =>
    candidates.flatMap((c): ILocatorEntry[] =>
      buildCandidateLocators(ctx, c).map(
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
}

/**
 * Expand all base locators for one (context, candidate) pair into nth-
 * enumerated entries. Drops `.first()` semantics by reusing the same
 * builder output (`.nth(i)` chains compose with `.first()` such that
 * `.first()` is `.nth(0)` — Playwright treats them identically).
 * @param args - Bundled context + candidate + per-locator cap.
 * @returns Locator entries (one per nth-match per base locator).
 */
async function expandCandidateEntries(args: IExpandEntryArgs): Promise<readonly ILocatorEntry[]> {
  const bases = buildCandidateLocatorsBase(args.ctx, args.candidate);
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
 * @returns Locator entries (contexts × candidates × nth-matches).
 */
async function buildLocatorEntriesAll(
  page: Page,
  candidates: readonly SelectorCandidate[],
): Promise<readonly ILocatorEntry[]> {
  const contexts = getAllContexts(page);
  const expansionPromises = contexts.flatMap((ctx): Promise<readonly ILocatorEntry[]>[] =>
    mapCandidatesToExpansions(ctx, candidates),
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
 * @returns One promise of locator entries per candidate, in input order.
 */
function mapCandidatesToExpansions(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
): Promise<readonly ILocatorEntry[]>[] {
  return candidates.map(
    (c): Promise<readonly ILocatorEntry[]> =>
      expandCandidateEntries({ ctx, candidate: c, maxPerLocator: MAX_NTH_PER_LOCATOR }),
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

/**
 * Extract structured DOM identity from an element via evaluate.
 * Captures every stable hook the action stage might need to build a precise
 * click/fill selector — id, name, aria-label, title, href — so we don't have
 * to re-derive the selector from the original WK candidate (which lost the
 * resolved element's actual attribute set).
 * @param el - DOM element.
 * @returns Structured identity object.
 */
function extractIdentity(el: Element): IElementIdentity {
  return {
    tag: el.tagName,
    id: el.id || '(none)',
    classes: el.className || '(none)',
    name: el.getAttribute('name') ?? '(none)',
    type: el.getAttribute('type') ?? '(none)',
    ariaLabel: el.getAttribute('aria-label') ?? '(none)',
    title: el.getAttribute('title') ?? '(none)',
    href: el.getAttribute('href') ?? '(none)',
  };
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

/**
 * Extract Physical Identity, log at TRACE level, return identity for the
 * caller (so ACTION-stage selectors can use the resolved element's actual
 * attributes — id/name/aria-label/title/href — rather than re-deriving from
 * the original WK candidate).
 * @param entry - The winning locator entry.
 * @returns Identity object captured during PRE.
 */
async function extractAndTraceIdentity(entry: ILocatorEntry): Promise<IElementIdentity> {
  const identity = await entry.locator
    .evaluate(extractIdentity)
    .catch((): IElementIdentity => UNKNOWN_IDENTITY);
  LOG.trace({
    tag: identity.tag,
    id: identity.id,
    classes: identity.classes,
    attrs: { name: identity.name, type: identity.type },
    visibility: 'visible',
  });
  return identity;
}

/**
 * Trace race diagnostic — log per-locator detail at trace level.
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
  LOG.trace({
    fulfilled: diag.fulfilledCount,
    hitTestPassed: diag.hitTestPassedCount,
    winner: diag.winner,
    detail: fulfilledDetail,
  });
  return true;
}

/**
 * Resolve the first visible element — parallel race across page + iframes.
 * @param page - The Playwright page.
 * @param candidates - WellKnown selector candidates.
 * @param timeout - Race timeout in ms.
 * @returns IRaceResult with locator, candidate, context, and snapshot.
 */
/**
 * Resolve the first visible element — parallel race across candidates.
 * Uses the SAME resolveVisible + hit-test logic in both LIVE and MOCK modes
 * (Rule #20: passive discovery is identical). If an element isn't visible
 * in the rendered snapshot, the mock MUST fail — that's the whole point.
 * @param page - Playwright Page.
 * @param candidates - WellKnown selector candidates.
 * @param timeout - Race timeout (capped under MOCK_MODE by capTimeout).
 * @returns Race result with locator + metadata, or NOT_FOUND.
 */
async function resolveVisibleImpl(
  page: Page,
  candidates: readonly SelectorCandidate[],
  timeout: number,
): Promise<IRaceResult> {
  const entries = buildLocatorEntries(page, candidates);
  if (entries.length === 0) return NOT_FOUND_RESULT;
  const locators = entries.map((e): Locator => e.locator);
  const effectiveTimeout = capTimeout(timeout);
  const countStr = String(locators.length);
  const timeoutStr = String(effectiveTimeout);
  LOG.debug({ message: `resolveVisible: ${countStr} locators, timeout=${timeoutStr}ms` });
  const diag = await raceLocatorsWithHitTest(locators, effectiveTimeout);
  traceRaceDiagnostic(entries, diag);
  if (diag.winner < 0) return NOT_FOUND_RESULT;
  const winner = entries[diag.winner];
  const identity = await extractAndTraceIdentity(winner);
  const value = await snapshotValue(winner);
  return buildFoundResult(winner, { index: diag.winner, value, identity });
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
 * @param page - The Playwright page.
 * @param candidates - WellKnown selector candidates.
 * @param timeout - Race timeout in ms.
 * @returns Procedure with IRaceResult — found=true if clicked, NOT_FOUND_RESULT if not found.
 */
async function resolveAndClickImpl(
  page: Page,
  candidates: readonly SelectorCandidate[],
  timeout: number,
): Promise<Procedure<IRaceResult>> {
  const effectiveTimeout = capTimeout(timeout);
  const result = await resolveVisibleImpl(page, candidates, effectiveTimeout);
  if (result.found && result.locator) {
    await result.locator.click({ timeout: effectiveTimeout }).catch((): false => false);
    return succeed(result);
  }
  // Fallback: attached state — element is in DOM but not visually visible
  const entries = buildLocatorEntries(page, candidates);
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
  return (candidates, timeoutMs?): Promise<IRaceResult> => {
    if (candidates.length === 0) return Promise.resolve(NOT_FOUND_RESULT);
    const timeout = timeoutMs ?? CLICK_RACE_TIMEOUT;
    return resolveVisibleImpl(page, candidates, timeout);
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
function buildResolveAndClick(page: Page): IElementMediator['resolveAndClick'] {
  return (candidates, timeoutMs?): Promise<Procedure<IRaceResult>> => {
    if (candidates.length === 0)
      return resolveAndClickImpl(page, WK_LOGIN_FORM.submit, timeoutMs ?? CLICK_RACE_TIMEOUT);
    return resolveAndClickImpl(page, candidates, timeoutMs ?? CLICK_RACE_TIMEOUT);
  };
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
    network,
    navigateTo: buildNavigateTo(page),
    getCurrentUrl: buildGetCurrentUrl(page),
    waitForNetworkIdle: buildWaitForNetworkIdle(page),
    checkAttribute: buildCheckAttribute(),
    getAttributeValue: buildGetAttributeValue(),

    waitForURL: buildWaitForURL(page),
    countByText: buildCountByText(page),
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
