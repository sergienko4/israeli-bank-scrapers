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
  ELEMENTS_LOADING_DELAY_MS,
  fillInputImpl,
  type FrameRegistryMap,
  pressEnterImpl,
  resolveFrame,
} from './ActionExecutors.js';
import {
  buildCandidateLocators,
  buildLocatorEntries,
  buildLocatorEntriesAll,
  CLICK_RACE_TIMEOUT,
  enrichWinnerToResult,
  extractWinnerSequence,
  getActivePhase,
  getActiveStage,
  type ILocatorEntry,
  NO_FORM_ANCHOR,
  raceEntriesToResult,
  raceLocators,
  raceLocatorsWithHitTest,
  setActivePhase as setGlobalPhase,
  setActiveStage as setGlobalStage,
  setupAllVisibleRace,
  traceRaceDiagnostic,
} from './Create/index.js';
import {
  type IActionMediator,
  type ICookieSnapshot,
  type IElementMediator,
  type IRaceResult,
  NOT_FOUND_RESULT,
} from './ElementMediator.js';

export { getActivePhase, getActiveStage };

const LOG = getDebug(import.meta.url);

/** Per-instance mutable cache for the form anchor selector. */
interface IFormCache {
  selector: string;
}

/** Options for field resolution — bundled to satisfy max-params. */
interface IResolveOpts {
  readonly page: Page;
  readonly fieldKey: string;
  readonly candidates: readonly SelectorCandidate[];
  readonly scopeContext?: Page | Frame;
  readonly formSelector?: string;
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
    return locator.isVisible().catch((): boolean => false);
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
  const delayStr = String(ELEMENTS_LOADING_DELAY_MS);
  const attemptStr = String(attempt);
  LOG.debug({
    message: `loading indicator visible, waiting ${delayStr}ms (attempt ${attemptStr})`,
  });
  await frame.waitForTimeout(ELEMENTS_LOADING_DELAY_MS);
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
 * Catch form discovery errors — non-fatal, returns none.
 * @param error - Thrown error.
 * @returns None option.
 */
function handleDiscoverFormError(error: Error): Option<IFormAnchor> {
  const truncated = toErrorMessage(error).slice(0, 60);
  LOG.debug({ message: `discoverForm failed (non-fatal): ${truncated}` });
  return none();
}

/**
 * Build discoverForm method with per-instance cache.
 * Uses resolvedContext.context (not root page) so iframe form anchors are found correctly.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator discoverForm function.
 */
function buildDiscoverForm(cache: IFormCache): IElementMediator['discoverForm'] {
  return (resolvedContext: IFieldContext): Promise<Option<IFormAnchor>> =>
    discoverFormCore(cache, resolvedContext).catch(handleDiscoverFormError);
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

/** Bundled args for `resolveAllVisibleImpl` — 3-param ceiling. */
interface IResolveAllArgs {
  readonly page: Page;
  readonly candidates: readonly SelectorCandidate[];
  readonly timeout: number;
  readonly cap: number;
}

/**
 * Resolve all visible elements matching any of the candidate selectors —
 * enumerates `.nth(0..MAX_NTH_PER_LOCATOR-1)` per base locator so multi-match
 * elements (legacy + modern nav buttons sharing the same aria-label) BOTH
 * surface in the candidate list. Identity dedup (`extractWinnerSequence`)
 * collapses race winners that point to the same DOM element.
 * @param args - Bundled page + candidates + timeout + cap.
 * @returns Up to `args.cap` race-result entries; empty when none fulfill.
 */
async function resolveAllVisibleImpl(args: IResolveAllArgs): Promise<readonly IRaceResult[]> {
  if (args.cap < 1) return [];
  const setup = await setupAllVisibleRace(args.page, args.candidates, args.timeout);
  if (setup.entries.length === 0) return [];
  const probeLabel = `resolveAllVisible (cap=${String(args.cap)})`;
  logResolveProbe(probeLabel, setup.locators.length, setup.timeout);
  const diag = await raceLocatorsWithHitTest(setup.locators, setup.timeout);
  traceRaceDiagnostic(setup.entries, diag);
  if (diag.fulfilledIndices.length === 0) return [];
  const indices = diag.fulfilledIndices;
  return extractWinnerSequence({ entries: setup.entries, indices, cap: args.cap });
}

/**
 * Build IRaceResult entries from a list of WK selector candidates within a
 * SINGLE Page or Frame context. Each candidate may produce multiple base
 * locators; the result list pairs every locator with its source candidate
 * and the context it was bound to.
 * @param ctx - The Playwright Page or Frame to resolve against.
 * @param candidates - WellKnown selector candidates to expand.
 * @returns Flat list of ILocatorEntry — one per base locator.
 */
function buildContextEntries(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
): readonly ILocatorEntry[] {
  return candidates.flatMap((c): ILocatorEntry[] =>
    buildCandidateLocators(ctx, c).map(
      (locator): ILocatorEntry => ({ locator, candidate: c, context: ctx }),
    ),
  );
}

/**
 * Emit a structured "N locators racing with Tms budget" debug log used by
 * every resolveImpl variant so log output is uniform.
 * @param label - Label naming the caller (e.g. `resolveVisibleInContext`).
 * @param count - Locator count.
 * @param timeoutMs - Effective race timeout (post-capTimeout).
 * @returns Sentinel `true` once the log has been emitted.
 */
function logResolveProbe(label: string, count: number, timeoutMs: number): true {
  LOG.debug({ message: `${label}: ${String(count)} locators, ${String(timeoutMs)}ms` });
  return true;
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
  const entries = buildContextEntries(ctx, candidates);
  if (entries.length === 0) return NOT_FOUND_RESULT;
  const locators = entries.map((e): Locator => e.locator);
  const effectiveTimeout = capTimeout(timeout);
  logResolveProbe('resolveVisibleInContext', locators.length, effectiveTimeout);
  const diag = await raceLocatorsWithHitTest(locators, effectiveTimeout);
  traceRaceDiagnostic(entries, diag);
  if (diag.winner < 0) return NOT_FOUND_RESULT;
  return enrichWinnerToResult(entries[diag.winner], diag.winner);
}

/**
 * Force-click the winner of an attached race. Returns whether the click
 * actually fired — the caller propagates NOT_FOUND_RESULT on failure
 * instead of silently claiming success. Extracted so the parent body
 * stays ≤10 LoC while keeping the click-outcome check explicit.
 * @param locator - Winner locator from the attached race.
 * @param timeoutMs - Force-click timeout in milliseconds.
 * @returns True when the click resolved without throwing.
 */
async function tryForceClick(locator: Locator, timeoutMs: number): Promise<boolean> {
  return locator
    .click({ force: true, timeout: timeoutMs })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Fallback path for resolveAndClickImpl when no element passed the
 * "visible" hit-test race: try a force-click against the FIRST attached
 * candidate. Extracted so the parent body stays ≤10 LoC.
 * @param args - Bundled page + candidates + formAnchor.
 * @param effectiveTimeout - Already-capped race timeout (ms).
 * @returns Procedure wrapping the attached IRaceResult (or NOT_FOUND).
 */
async function tryAttachedClickFallback(
  args: IClickResolveArgs,
  effectiveTimeout: number,
): Promise<Procedure<IRaceResult>> {
  const entries = buildLocatorEntries(args.page, args.candidates, args.formAnchor);
  const locators = entries.map((e): Locator => e.locator);
  const winnerIdx = await raceLocators(locators, effectiveTimeout, 'attached');
  if (winnerIdx < 0) return succeed(NOT_FOUND_RESULT);
  const didClick = await tryForceClick(entries[winnerIdx].locator, effectiveTimeout);
  if (!didClick) return succeed(NOT_FOUND_RESULT);
  return succeed(await enrichWinnerToResult(entries[winnerIdx], winnerIdx));
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
  const raceArgs: IClickResolveArgs = { ...args, timeout: effectiveTimeout };
  const result = await resolveVisibleNthAware(raceArgs);
  if (result.found && result.locator) {
    await result.locator.click({ timeout: effectiveTimeout }).catch((): false => false);
    return succeed(result);
  }
  return tryAttachedClickFallback(args, effectiveTimeout);
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
  return (): string => cache.selector;
}

/** Default timeout for network idle wait (matches POST_LOGIN_SETTLE_TIMEOUT). */
const NETWORK_IDLE_TIMEOUT = 15_000;

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
  return (): string => page.url();
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
 * Build raceWithNetworkIdle method. Composes the caller's custom
 * wait promise with the mediator's own `waitForNetworkIdle` — single
 * source of truth for "wait until either side settles, then let the
 * caller decide outcome from observed state". Used by ACCOUNT-RESOLVE
 * and DASHBOARD (PR #234).
 * @param waitForNetworkIdle - The mediator's networkidle method.
 * @returns Mediator raceWithNetworkIdle function.
 */
function buildRaceWithNetworkIdle(
  waitForNetworkIdle: IElementMediator['waitForNetworkIdle'],
): IElementMediator['raceWithNetworkIdle'] {
  return async (customWait, budgetMs): Promise<true> => {
    try {
      await Promise.race([customWait, waitForNetworkIdle(budgetMs)]);
    } catch {
      // Observed state below decides outcome — both racers are
      // best-effort signals, neither rejection invalidates the pool.
    }
    return true as const;
  };
}

/**
 * Build countByText method bound to a page.
 * Returns 0 on any error (element not found = valid 0-count).
 * @param page - The Playwright page.
 * @returns Mediator countByText function.
 */
function buildCountByText(page: Page): IElementMediator['countByText'] {
  return (text: string): Promise<number> =>
    page
      .getByText(text)
      .first()
      .count()
      .catch((): number => 0);
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
  return (selector: string): Promise<number> =>
    page
      .locator(selector)
      .count()
      .catch((): number => 0);
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
  const mapper = (els: HTMLAnchorElement[]): string[] => els.map((el): string => el.href);
  return anchors.evaluateAll(mapper).catch((): string[] => []);
}

/**
 * Build getAttributeValue — read raw attribute from resolved locator.
 * @returns Async function returning the raw attribute string.
 */
function buildGetAttributeValue(): IElementMediator['getAttributeValue'] {
  return async (result, attrName) => {
    if (!result.found || !result.locator) return '';
    const attr = await result.locator.getAttribute(attrName).catch((): string => '');
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
    const attr = await result.locator.getAttribute(attrName).catch((): string => '');
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
    return [...new Set(rawHrefs)].filter((h): boolean => h.length > 0);
  };
}

/** Default timeout for SPA URL wait. */
const URL_WAIT_TIMEOUT = 10000;

/**
 * Build waitForURL — wait for page URL to match a glob pattern.
 * Non-fatal: returns succeed(false) on timeout.
 * @param page - The Playwright page.
 * @returns Async function returning Procedure with match result.
 */
function buildWaitForURL(page: Page): IElementMediator['waitForURL'] {
  return async (pattern, timeoutMs = URL_WAIT_TIMEOUT) => {
    const didMatch: boolean = await page
      .waitForURL(pattern, { timeout: timeoutMs })
      .then((): boolean => true)
      .catch((): boolean => false);
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
 * Build addCookies — inject cookies into the browser context for
 * cross-domain session promotion. Extracted from the historic inline
 * arrow inside `createElementMediator` so the factory body stays ≤10 LoC.
 * @param page - The Playwright page (provides the context).
 * @returns Async function that accepts a cookie array.
 */
function buildAddCookies(page: Page): IElementMediator['addCookies'] {
  return async (cookies): Promise<void> => {
    await page.context().addCookies(cookies);
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Cluster-bundle TYPE aliases — let each cluster builder return a tightly
// scoped slice of IElementMediator. Spreading the slices inside the
// factory keeps `createElementMediator` body ≤ 10 LoC while preserving
// identity (each method is the same function reference produced by the
// underlying `buildXxx(page)` helper).
// ─────────────────────────────────────────────────────────────────────────

/** Resolver methods — locator + click resolution surfaces. */
type ResolveBundle = Pick<
  IElementMediator,
  | 'resolveField'
  | 'resolveClickable'
  | 'resolveVisible'
  | 'resolveAllVisible'
  | 'resolveVisibleInContext'
  | 'resolveAndClick'
>;

/** Phase / stage / discovery primitives — page-independent state hooks. */
type PhaseControlsBundle = Pick<
  IElementMediator,
  'setActivePhase' | 'setActiveStage' | 'discoverErrors' | 'waitForLoadingDone'
>;

/** Form-anchor cache surfaces — bound to a per-instance IFormCache. */
type FormBundle = Pick<IElementMediator, 'discoverForm' | 'scopeToForm' | 'getFormAnchor'>;

/** Navigation primitives — URL + networkidle gating. */
type NavBundle = Pick<
  IElementMediator,
  'navigateTo' | 'getCurrentUrl' | 'waitForNetworkIdle' | 'raceWithNetworkIdle' | 'waitForURL'
>;

/** Attribute read surfaces — page-independent locator wrappers. */
type AttrBundle = Pick<IElementMediator, 'checkAttribute' | 'getAttributeValue'>;

/** Counting + href-collection surfaces. */
type CountBundle = Pick<IElementMediator, 'countByText' | 'countBySelector' | 'collectAllHrefs'>;

/** Cookie I/O — get + add against the browser context. */
type CookieBundle = Pick<IElementMediator, 'getCookies' | 'addCookies'>;

/** Stateless surfaces merged — keeps the aggregator's spread count ≤ 6. */
type StaticBundle = PhaseControlsBundle & AttrBundle;

/**
 * Build the 6-method locator resolver cluster.
 * @param page - The Playwright page to bind resolvers to.
 * @returns Locator/click resolver method bundle.
 */
function buildResolveCluster(page: Page): ResolveBundle {
  return {
    resolveField: buildResolveField(page),
    resolveClickable: buildResolveClickable(page),
    resolveVisible: buildResolveVisible(page),
    resolveAllVisible: buildResolveAllVisible(page),
    resolveVisibleInContext: buildResolveVisibleInContext(),
    resolveAndClick: buildResolveAndClick(page),
  };
}

/**
 * Build the 4-method phase / stage / discovery cluster. Page-independent
 * (state hooks delegate to ActiveState module singletons).
 * @returns Phase-control method bundle.
 */
function buildPhaseControls(): PhaseControlsBundle {
  return {
    setActivePhase: setGlobalPhase,
    setActiveStage: setGlobalStage,
    discoverErrors: buildDiscoverErrors(),
    waitForLoadingDone: buildWaitForLoadingDone(),
  };
}

/**
 * Build the 3-method form-anchor cluster. Binds to per-instance cache so
 * concurrent ElementMediator instances do not share form-anchor state.
 * @param cache - The per-instance form-anchor cache.
 * @returns Form-anchor method bundle.
 */
function buildFormCluster(cache: IFormCache): FormBundle {
  return {
    discoverForm: buildDiscoverForm(cache),
    scopeToForm: buildScopeToForm(cache),
    getFormAnchor: buildGetFormAnchor(cache),
  };
}

/**
 * Build the 5-method navigation cluster. Internally constructs the
 * single `waitForNetworkIdle` primitive once and reuses it inside
 * `raceWithNetworkIdle` — preserves the historic single-source-of-truth
 * invariant from the original factory.
 * @param page - The Playwright page to bind nav methods to.
 * @returns Navigation method bundle.
 */
function buildNavCluster(page: Page): NavBundle {
  const wfni = buildWaitForNetworkIdle(page);
  return {
    navigateTo: buildNavigateTo(page),
    getCurrentUrl: buildGetCurrentUrl(page),
    waitForNetworkIdle: wfni,
    raceWithNetworkIdle: buildRaceWithNetworkIdle(wfni),
    waitForURL: buildWaitForURL(page),
  };
}

/**
 * Build the 2-method attribute-read cluster. Page-independent — returns
 * locator-bound wrappers (the locator carries its own Page reference).
 * @returns Attribute-read method bundle.
 */
function buildAttrCluster(): AttrBundle {
  return {
    checkAttribute: buildCheckAttribute(),
    getAttributeValue: buildGetAttributeValue(),
  };
}

/**
 * Build the 3-method counting + href-collection cluster.
 * @param page - The Playwright page to count/collect against.
 * @returns Count / href method bundle.
 */
function buildCountCluster(page: Page): CountBundle {
  return {
    countByText: buildCountByText(page),
    countBySelector: buildCountBySelector(page),
    collectAllHrefs: buildCollectAllHrefs(page),
  };
}

/**
 * Build the 2-method cookie I/O cluster.
 * @param page - The Playwright page (provides the browser context).
 * @returns Cookie I/O method bundle.
 */
function buildCookieCluster(page: Page): CookieBundle {
  return {
    getCookies: buildGetCookies(page),
    addCookies: buildAddCookies(page),
  };
}

/**
 * Merge the two stateless clusters (phase controls + attribute reads)
 * into one bundle. Lets `assembleElementMediator` spread 6 sources
 * instead of 7 so the aggregator body stays ≤ 10 LoC.
 * @returns Static (page-independent) method bundle.
 */
function buildStaticCluster(): StaticBundle {
  return { ...buildPhaseControls(), ...buildAttrCluster() };
}

/**
 * Compose the full method bundle for IElementMediator (everything
 * except `network`, which the factory inserts directly). Each spread
 * preserves function identity — methods are the same references the
 * underlying `buildXxx(page)` helpers returned.
 * @param page - The Playwright page.
 * @param cache - The per-instance form-anchor cache.
 * @returns Method bundle covering every IElementMediator surface except `network`.
 */
function assembleElementMediator(page: Page, cache: IFormCache): Omit<IElementMediator, 'network'> {
  return {
    ...buildResolveCluster(page),
    ...buildStaticCluster(),
    ...buildFormCluster(cache),
    ...buildNavCluster(page),
    ...buildCountCluster(page),
    ...buildCookieCluster(page),
  };
}

/**
 * Create an ElementMediator for the given page.
 * Each instance has its own form anchor cache — safe for concurrent use.
 * Production path: defer `page.on(...)` attachment until the
 * network-trace lifecycle interceptor flips the boundary gate ON
 * (post-AUTH phase). Keeps the HOME / WAF-check window listener-free
 * (see I-3 deferred-listener experiment 2026-05-13).
 * @param page - The Playwright page to resolve elements on.
 * @returns An IElementMediator with real implementations.
 */
function createElementMediator(page: Page): IElementMediator {
  const cache: IFormCache = { selector: '' };
  const network = createNetworkDiscovery(page, { isDeferAttach: true });
  return { ...assembleElementMediator(page, cache), network };
}

/**
 * Snapshot sessionStorage into a plain object inside the browser context.
 * Iterates by index because Storage instances do not survive structured-clone
 * via spread, and Sonar S6661 forbids the historic Object.assign pattern.
 * @returns Plain key/value snapshot of sessionStorage.
 */
function snapshotSessionStorage(): Record<string, string> {
  const total = sessionStorage.length;
  const indices = Array.from({ length: total }, (_v, i): number => i);
  const pairs: readonly (readonly [string, string])[] = indices
    .map((i): readonly [string, string] => [sessionStorage.key(i) ?? '', i.toString()])
    .filter(([k]): boolean => k.length > 0)
    .map(([k]): readonly [string, string] => [k, sessionStorage.getItem(k) ?? '']);
  return Object.fromEntries(pairs);
}

// ─────────────────────────────────────────────────────────────────────────
// Action-mediator cluster builders — same spread-builders pattern as
// createElementMediator (Phase 2a C1). Each method is produced by a small
// named `buildXxx` helper so the cluster body is a flat property table
// of function-call expressions (no inline arrows, no nested calls). The
// pass-through wrappers use destructuring shorthand which preserves
// function identity against the backing IElementMediator.
// ─────────────────────────────────────────────────────────────────────────

/** Frame-bound action methods — fillInput + clickElement + pressEnter. */
type FrameActionBundle = Pick<IActionMediator, 'fillInput' | 'clickElement' | 'pressEnter'>;

/** Navigation pass-through surfaces — bound to the full mediator. */
type ActionNavBundle = Pick<
  IActionMediator,
  'navigateTo' | 'waitForNetworkIdle' | 'waitForURL' | 'getCurrentUrl'
>;

/** Cookie + count + href pass-through surfaces — bound to the full mediator. */
type ActionDataBundle = Pick<
  IActionMediator,
  'getCookies' | 'addCookies' | 'countByText' | 'countBySelector' | 'collectAllHrefs'
>;

/** Combined pass-through bundle — nav + data merged. */
type ActionPassThroughBundle = ActionNavBundle & ActionDataBundle;

/** sessionStorage snapshot surface — page.evaluate wrapper. */
type ActionStorageBundle = Pick<IActionMediator, 'collectStorage'>;

/** Network-derived ACTION surfaces — read-only views over full.network. */
type ActionNetworkBundle = Pick<
  IActionMediator,
  'hasTxnEndpoint' | 'waitForTxnEndpoint' | 'markDashboardClickAt'
>;

/**
 * Build fillInput — resolves the target frame, then delegates to impl.
 * @param registry - The immutable frame registry.
 * @returns Bound fillInput handler.
 */
function buildFillInput(registry: FrameRegistryMap): IActionMediator['fillInput'] {
  return (ctxId, sel, val): Promise<true> => {
    const frame = resolveFrame(registry, ctxId);
    return fillInputImpl(frame, sel, val);
  };
}

/**
 * Build clickElement — destructures IClickElementArgs and forwards to the
 * impl with a resolved frame.
 * @param registry - The immutable frame registry.
 * @returns Bound clickElement handler.
 */
function buildClickElement(registry: FrameRegistryMap): IActionMediator['clickElement'] {
  return (args): Promise<true> => {
    const frame = resolveFrame(registry, args.contextId);
    return clickElementImpl({
      frame,
      selector: args.selector,
      isForce: args.isForce,
      nth: args.nth,
    });
  };
}

/**
 * Build pressEnter — resolves the target frame, then delegates to impl.
 * @param registry - The immutable frame registry.
 * @returns Bound pressEnter handler.
 */
function buildPressEnter(registry: FrameRegistryMap): IActionMediator['pressEnter'] {
  return (ctxId): Promise<true> => {
    const frame = resolveFrame(registry, ctxId);
    return pressEnterImpl(frame);
  };
}

/**
 * Build the 3-method frame-bound execution cluster. Each method is a
 * function-call expression — no inline arrows.
 * @param registry - The immutable frame registry.
 * @returns Frame-action method bundle.
 */
function buildFrameActionCluster(registry: FrameRegistryMap): FrameActionBundle {
  return {
    fillInput: buildFillInput(registry),
    clickElement: buildClickElement(registry),
    pressEnter: buildPressEnter(registry),
  };
}

/**
 * Build the 4-method navigation pass-through cluster. Wraps the matching
 * methods on `full` so the cluster shape stays a flat property table.
 * @param full - The backing full IElementMediator.
 * @returns Navigation pass-through bundle.
 */
function buildActionNavCluster(full: IElementMediator): ActionNavBundle {
  return {
    /** @inheritdoc */
    navigateTo: (...args) => full.navigateTo(...args),
    /** @inheritdoc */
    waitForNetworkIdle: (...args) => full.waitForNetworkIdle(...args),
    /** @inheritdoc */
    waitForURL: (...args) => full.waitForURL(...args),
    /** @inheritdoc */
    getCurrentUrl: () => full.getCurrentUrl(),
  };
}

/**
 * Build the 5-method cookie + count + href pass-through cluster.
 * Wraps the matching methods on `full` so the cluster shape stays a flat
 * property table.
 * @param full - The backing full IElementMediator.
 * @returns Data-surface pass-through bundle.
 */
function buildActionDataCluster(full: IElementMediator): ActionDataBundle {
  return {
    /** @inheritdoc */
    getCookies: () => full.getCookies(),
    /** @inheritdoc */
    addCookies: (...args) => full.addCookies(...args),
    /** @inheritdoc */
    countByText: (...args) => full.countByText(...args),
    /** @inheritdoc */
    countBySelector: (...args) => full.countBySelector(...args),
    /** @inheritdoc */
    collectAllHrefs: () => full.collectAllHrefs(),
  };
}

/**
 * Build the 9-method pass-through cluster — merges nav + data sub-clusters.
 * Identity-preserving (same function references as the backing `full`).
 * @param full - The backing full IElementMediator.
 * @returns Action pass-through method bundle.
 */
function buildActionPassThroughCluster(full: IElementMediator): ActionPassThroughBundle {
  return { ...buildActionNavCluster(full), ...buildActionDataCluster(full) };
}

/**
 * Build collectStorage — snapshots sessionStorage via page.evaluate.
 * @param page - The Playwright page that will execute the snapshot.
 * @returns Bound collectStorage handler.
 */
function buildCollectStorage(page: Page): IActionMediator['collectStorage'] {
  return async (): Promise<Readonly<Record<string, string>>> =>
    page.evaluate(snapshotSessionStorage);
}

/**
 * Build the 1-method sessionStorage snapshot cluster.
 * @param page - The Playwright page that will execute the snapshot.
 * @returns Storage-collection method bundle.
 */
function buildActionStorageCluster(page: Page): ActionStorageBundle {
  return { collectStorage: buildCollectStorage(page) };
}

/**
 * Build hasTxnEndpoint — reports whether the transactions endpoint has
 * been discovered yet on `full.network`.
 * @param full - The backing full IElementMediator (for `full.network`).
 * @returns Bound hasTxnEndpoint handler.
 */
function buildHasTxnEndpoint(full: IElementMediator): IActionMediator['hasTxnEndpoint'] {
  return (): boolean => full.network.discoverTransactionsEndpoint() !== false;
}

/**
 * Build waitForTxnEndpoint — awaits the transactions traffic on
 * `full.network` and normalises the result to a boolean.
 * @param full - The backing full IElementMediator (for `full.network`).
 * @returns Bound waitForTxnEndpoint handler.
 */
function buildWaitForTxnEndpoint(full: IElementMediator): IActionMediator['waitForTxnEndpoint'] {
  return async (timeoutMs): Promise<boolean> => {
    const hit = await full.network.waitForTransactionsTraffic(timeoutMs);
    return hit !== false;
  };
}

/**
 * Build markDashboardClickAt — forwards the click timestamp into
 * `full.network` to seed the post-AUTH transactions watcher.
 * @param full - The backing full IElementMediator (for `full.network`).
 * @returns Bound markDashboardClickAt handler.
 */
function buildMarkDashboardClickAt(
  full: IElementMediator,
): IActionMediator['markDashboardClickAt'] {
  return (timestampMs): true => full.network.markDashboardClickAt(timestampMs);
}

/**
 * Build the 3-method network-derived ACTION cluster. Each method reads or
 * mutates the closure-scoped `full.network` discovery state without
 * exposing the full discovery surface to ACTION callers.
 * @param full - The backing full IElementMediator (for `full.network`).
 * @returns Network-bound action method bundle.
 */
function buildActionNetworkCluster(full: IElementMediator): ActionNetworkBundle {
  return {
    hasTxnEndpoint: buildHasTxnEndpoint(full),
    waitForTxnEndpoint: buildWaitForTxnEndpoint(full),
    markDashboardClickAt: buildMarkDashboardClickAt(full),
  };
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
    ...buildFrameActionCluster(registry),
    ...buildActionPassThroughCluster(full),
    ...buildActionStorageCluster(page),
    ...buildActionNetworkCluster(full),
  };
}

export default createElementMediator;
export { createElementMediator, extractActionMediator };
