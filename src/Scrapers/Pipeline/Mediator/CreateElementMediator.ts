/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor + FormErrorDiscovery.
 * Black box for ALL HTML resolution — scrapers describe WHAT, mediator finds HOW.
 * Each mediator instance has its own form anchor cache (no shared mutable state).
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../../Common/Debug.js';
import {
  discoverFormAnchor,
  type IFormAnchor,
  scopeCandidates,
} from '../../../Common/FormAnchor.js';
import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { PIPELINE_WELL_KNOWN_DASHBOARD } from '../Registry/PipelineWellKnown.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import { none, type Option, some } from '../Types/Option.js';
import { fail, type Procedure, succeed } from '../Types/Procedure.js';
import type { IElementMediator } from './ElementMediator.js';
import {
  checkFrameForErrors,
  discoverFormErrors,
  type IFormErrorScanResult,
} from './FormErrorDiscovery.js';
import { resolveFieldPipeline } from './PipelineFieldResolver.js';

const LOG = getDebug('element-mediator');

/** Per-instance mutable cache for the form anchor selector. */
interface IFormCache {
  selector: string;
}

/**
 * Build resolveField method bound to a page.
 * Searches main page + all child iframes via resolveFieldPipeline.
 * @param page - The Playwright page.
 * @returns Mediator resolveField function.
 */
/** Options for resolveFieldToProcedure. */
interface IResolveOpts {
  readonly page: Page;
  readonly fieldKey: string;
  readonly candidates: readonly SelectorCandidate[];
  readonly notFoundMsg: string;
}

/**
 * Resolve a field and convert to Procedure — no try/catch (caller handles).
 * @param opts - Resolution options.
 * @returns Success or failure Procedure.
 */
async function resolveFieldToProcedure(opts: IResolveOpts): Promise<Procedure<IFieldContext>> {
  const ctx = await resolveFieldPipeline(opts.page, opts.fieldKey, opts.candidates);
  if (ctx.isResolved) return succeed<IFieldContext>(ctx);
  return fail(ScraperErrorTypes.Generic, opts.notFoundMsg);
}

/**
 * Build resolveField method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveField function.
 */
function buildResolveField(page: Page): IElementMediator['resolveField'] {
  return (fieldKey, candidates): Promise<Procedure<IFieldContext>> => {
    const notFoundMsg = `Field not found: ${fieldKey} on ${page.url()}`;
    const opts = { page, fieldKey, candidates, notFoundMsg };
    /**
     * Catch resolution errors and return failure Procedure.
     * @param error - Thrown error.
     * @returns Failure Procedure.
     */
    const handleError = (error: Error): Procedure<IFieldContext> => {
      const msg = toErrorMessage(error);
      return fail(ScraperErrorTypes.Generic, msg);
    };
    return resolveFieldToProcedure(opts).catch(handleError);
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
    const opts = { page, fieldKey: '__submit__', candidates, notFoundMsg: 'Clickable not found' };
    /**
     * Catch resolution errors and return failure Procedure.
     * @param error - Thrown error.
     * @returns Failure Procedure.
     */
    const handleError = (error: Error): Procedure<IFieldContext> => {
      const msg = toErrorMessage(error);
      return fail(ScraperErrorTypes.Generic, msg);
    };
    return resolveFieldToProcedure(opts).catch(handleError);
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
  const candidates = PIPELINE_WELL_KNOWN_DASHBOARD.loadingIndicator;
  const checks = candidates.map((c): Promise<boolean> => {
    const locator = frame.getByText(c.value).first();
    return locator.isVisible().catch((): boolean => false);
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
 * Build discoverForm method with per-instance cache.
 * Uses resolvedContext.context (not root page) so iframe form anchors are found correctly.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator discoverForm function.
 */
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
    discoverErrors: buildDiscoverErrors(),
    waitForLoadingDone: buildWaitForLoadingDone(),
    discoverForm: buildDiscoverForm(cache),
    scopeToForm: buildScopeToForm(cache),
  };
  return mediator;
}

export default createElementMediator;
export { createElementMediator };
