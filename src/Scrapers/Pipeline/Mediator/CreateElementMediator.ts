/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor + FormErrorDiscovery.
 * Black box for ALL HTML resolution — scrapers describe WHAT, mediator finds HOW.
 * Each mediator instance has its own form anchor cache (no shared mutable state).
 */

import type { Frame, Locator, Page } from 'playwright-core';

import { getDebug } from '../../../Common/Debug.js';
import {
  discoverFormAnchor,
  type IFormAnchor,
  scopeCandidates,
} from '../../../Common/FormAnchor.js';
import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { WK } from '../Registry/PipelineWellKnown.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import { none, type Option, some } from '../Types/Option.js';
import { fail, type Procedure, succeed } from '../Types/Procedure.js';
import { type IElementMediator, type IRaceResult, NOT_FOUND_RESULT } from './ElementMediator.js';
import {
  checkFrameForErrors,
  discoverFormErrors,
  type IFormErrorScanResult,
} from './FormErrorDiscovery.js';
import { createNetworkDiscovery } from './NetworkDiscovery.js';
import { resolveFieldPipeline } from './PipelineFieldResolver.js';

const LOG = getDebug('element-mediator');

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
  return ((
    ...args: Parameters<IElementMediator['resolveField']>
  ): Promise<Procedure<IFieldContext>> => {
    const [fieldKey, candidates, scopeContext, formSelector] = args;
    const opts: IResolveOpts = { page, fieldKey, candidates, scopeContext, formSelector };
    return resolveFieldForPage(opts);
  }) as IElementMediator['resolveField'];
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
 * @returns True if a loading indicator is visible.
 */
async function isAnyLoadingVisible(frame: Page | Frame): Promise<boolean> {
  const candidates = WK.DASHBOARD.LOADING;
  const checks = candidates.map((c): Promise<boolean> => {
    const locator = frame.getByText(c.value).first();
    return locator.isVisible().catch((): IsVisible => false);
  });
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

/**
 * Wait once for loading indicators to disappear, then re-check.
 * @param frame - Page or Frame.
 * @param attempt - Current attempt number (for logging).
 * @returns True if loading is gone, false if still present.
 */
async function waitOnceForLoading(frame: Page | Frame, attempt: number): Promise<boolean> {
  const isLoading = await isAnyLoadingVisible(frame);
  if (!isLoading) return true;
  LOG.debug('loading indicator visible, waiting %dms (attempt %d)', LOADING_DELAY_MS, attempt);
  await frame.waitForTimeout(LOADING_DELAY_MS);
  return false;
}

/**
 * Build waitForLoadingDone method.
 * Checks WellKnown loadingIndicator candidates, waits up to 2×2s for them to disappear.
 * Uses recursive check instead of await-in-loop.
 * @returns Mediator waitForLoadingDone function.
 */
function buildWaitForLoadingDone(): IElementMediator['waitForLoadingDone'] {
  return async (frame: Page | Frame): Promise<boolean> => {
    const isDone1 = await waitOnceForLoading(frame, 1);
    if (isDone1) return true;
    const isDone2 = await waitOnceForLoading(frame, 2);
    if (isDone2) return true;
    const isDone3 = await waitOnceForLoading(frame, 3);
    return isDone3;
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
      LOG.debug('discoverForm failed (non-fatal): %s', truncated);
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
 * Build xpath locators for a textContent candidate.
 * Walk-up to each interactive ancestor — same logic as resolveByAncestorWalkUp.
 * @param ctx - Playwright Page or Frame context.
 * @param text - Visible text to find.
 * @returns Array of Playwright Locators targeting interactive ancestors.
 */
function buildWalkUpLocators(ctx: Page | Frame, text: string): Locator[] {
  return CLICK_ANCESTORS.map(
    (tag): Locator => ctx.locator(`xpath=//${tag}[.//text()[contains(., "${text}")]]`).first(),
  );
}

/**
 * Build a Playwright locator from a SelectorCandidate.
 * Handles textContent (walk-up), ariaLabel, placeholder, xpath, name kinds.
 * Works on both Page and Frame (for iframe search).
 * @param ctx - Playwright Page or Frame.
 * @param candidate - The selector candidate.
 * @returns Array of locators to race (textContent produces multiple walk-up targets).
 */
function buildCandidateLocators(ctx: Page | Frame, candidate: SelectorCandidate): Locator[] {
  if (candidate.kind === 'textContent') return buildWalkUpLocators(ctx, candidate.value);
  if (candidate.kind === 'ariaLabel')
    return [
      ctx.getByLabel(candidate.value).first(), // form inputs
      ctx.getByRole('button', { name: candidate.value, exact: false }).first(), // accessible buttons
      ctx.getByRole('link', { name: candidate.value, exact: false }).first(), // accessible links
    ];
  if (candidate.kind === 'placeholder') return [ctx.getByPlaceholder(candidate.value).first()];
  if (candidate.kind === 'xpath') return [ctx.locator(candidate.value).first()];
  if (candidate.kind === 'name') return [ctx.locator(`[name="${candidate.value}"]`).first()];
  if (candidate.kind === 'regex') return [ctx.getByText(new RegExp(candidate.value)).first()];
  return [ctx.getByText(candidate.value).first()];
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

/**
 * Snapshot the element value immediately to prevent stale-element errors.
 * For target:'href' candidates, captures the href attribute.
 * Otherwise captures innerText.
 * @param entry - The winning locator entry.
 * @returns The captured text or href value.
 */
async function snapshotValue(entry: ILocatorEntry): Promise<string> {
  const target = entry.candidate.target ?? 'self';
  if (target === 'href') {
    const href = await entry.locator.getAttribute('href').catch((): ElementAttr => '');
    return href ?? '';
  }
  return entry.locator.innerText().catch((): ElementAttr => '');
}

/**
 * Build a successful IRaceResult from a winning entry.
 * @param entry - The winning locator entry.
 * @param index - The index of the winner.
 * @param value - Snapshot value captured from the element.
 * @returns A found IRaceResult.
 */
function buildFoundResult(entry: ILocatorEntry, index: number, value: string): IRaceResult {
  const { locator, candidate, context } = entry;
  return { found: true, locator, candidate, context, index, value };
}

/**
 * Resolve the first visible element WITHOUT clicking — Identify → Inspect → Act.
 * Parallel race across main page + iframes. Captures a value snapshot immediately.
 * @param page - The Playwright page.
 * @param candidates - WellKnown selector candidates.
 * @param timeout - Race timeout in ms.
 * @returns IRaceResult with locator, candidate, context, and snapshot value.
 */
async function resolveVisibleImpl(
  page: Page,
  candidates: readonly SelectorCandidate[],
  timeout: number,
): Promise<IRaceResult> {
  const entries = buildLocatorEntries(page, candidates);
  if (entries.length === 0) return NOT_FOUND_RESULT;
  const locators = entries.map((e): Locator => e.locator);
  LOG.debug('resolveVisible: %d locators, timeout=%dms', locators.length, timeout);
  const winnerIdx = await raceLocators(locators, timeout);
  if (winnerIdx < 0) return NOT_FOUND_RESULT;
  const value = await snapshotValue(entries[winnerIdx]);
  return buildFoundResult(entries[winnerIdx], winnerIdx, value);
}

/**
 * Resolve and click — tries visible elements first; falls back to attached (force click).
 * Fallback handles elements hidden by accessibility overlays (e.g. UserWay) that are
 * in the DOM but have zero bounding box or are offset off-screen.
 * @param page - The Playwright page.
 * @param candidates - WellKnown selector candidates.
 * @param timeout - Race timeout in ms.
 * @returns True if element found and clicked.
 */
async function resolveAndClickImpl(
  page: Page,
  candidates: readonly SelectorCandidate[],
  timeout: number,
): Promise<boolean> {
  const result = await resolveVisibleImpl(page, candidates, timeout);
  if (result.found && result.locator) {
    await result.locator.click({ force: true });
    return true;
  }
  // Fallback: attached state — element is in DOM but not visually visible
  const entries = buildLocatorEntries(page, candidates);
  const locators = entries.map((e): Locator => e.locator);
  const winnerIdx = await raceLocators(locators, timeout, 'attached');
  if (winnerIdx < 0) return false;
  await entries[winnerIdx].locator.click({ force: true });
  return true;
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
 * Build resolveAndClick method bound to a page.
 * Internally calls resolveVisible then clicks the winner.
 * @param page - The Playwright page.
 * @returns Mediator resolveAndClick function.
 */
function buildResolveAndClick(page: Page): IElementMediator['resolveAndClick'] {
  return (candidates, timeoutMs?): Promise<boolean> => {
    if (candidates.length === 0) return Promise.resolve(false);
    const timeout = timeoutMs ?? CLICK_RACE_TIMEOUT;
    return resolveAndClickImpl(page, candidates, timeout);
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
  const mediator: IElementMediator = {
    resolveField: buildResolveField(page),
    resolveClickable: buildResolveClickable(page),
    resolveVisible: buildResolveVisible(page),
    resolveAndClick: buildResolveAndClick(page),
    discoverErrors: buildDiscoverErrors(),
    waitForLoadingDone: buildWaitForLoadingDone(),
    discoverForm: buildDiscoverForm(cache),
    scopeToForm: buildScopeToForm(cache),
    network: createNetworkDiscovery(page),
  };
  return mediator;
}

export default createElementMediator;
export { createElementMediator };
