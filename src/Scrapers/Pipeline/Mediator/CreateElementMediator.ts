/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor + FormErrorDiscovery.
 * Black box for ALL HTML resolution — scrapers describe WHAT, mediator finds HOW.
 * Each mediator instance has its own form anchor cache (no shared mutable state).
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../../Common/Debug.js';
import { discoverFormAnchor, scopeCandidates } from '../../../Common/FormAnchor.js';
import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { PIPELINE_WELL_KNOWN_DASHBOARD } from '../Registry/PipelineWellKnown.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import { none, some } from '../Types/Option.js';
import { fail, succeed } from '../Types/Procedure.js';
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
function buildResolveField(page: Page): IElementMediator['resolveField'] {
  return async (fieldKey, candidates) => {
    try {
      const ctx = await resolveFieldPipeline(page, fieldKey, candidates);
      if (ctx.isResolved) return succeed<IFieldContext>(ctx);
      const msg = `Field not found: ${fieldKey} on ${page.url()}`;
      return fail(ScraperErrorTypes.Generic, msg);
    } catch (error) {
      const msg = toErrorMessage(error);
      return fail(ScraperErrorTypes.Generic, msg);
    }
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
  return async candidates => {
    try {
      const ctx = await resolveFieldPipeline(page, '__submit__', candidates);
      if (ctx.isResolved) return succeed<IFieldContext>(ctx);
      return fail(ScraperErrorTypes.Generic, 'Clickable not found');
    } catch (error) {
      const msg = toErrorMessage(error);
      return fail(ScraperErrorTypes.Generic, msg);
    }
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
  const checks = candidates.map(c => {
    const locator = frame.getByText(c.value).first();
    return locator.isVisible().catch(() => false);
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
    await waitOnceForLoading(frame, 3);
    return true;
  };
}

/**
 * Build discoverForm method with per-instance cache.
 * Uses resolvedContext.context (not root page) so iframe form anchors are found correctly.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator discoverForm function.
 */
function buildDiscoverForm(cache: IFormCache): IElementMediator['discoverForm'] {
  return async (resolvedContext: IFieldContext) => {
    try {
      const ctx = resolvedContext.context;
      const anchor = await discoverFormAnchor(ctx, resolvedContext.selector);
      if (anchor) {
        cache.selector = anchor.selector;
        return some(anchor);
      }
      return none();
    } catch (error) {
      const msg = toErrorMessage(error).slice(0, 60);
      LOG.debug('discoverForm failed (non-fatal): %s', msg);
      return none();
    }
  };
}

/**
 * Build scopeToForm method with per-instance cache.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator scopeToForm function.
 */
function buildScopeToForm(cache: IFormCache): IElementMediator['scopeToForm'] {
  return (candidates: readonly SelectorCandidate[]) => {
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
  return {
    resolveField: buildResolveField(page),
    resolveClickable: buildResolveClickable(page),
    discoverErrors: buildDiscoverErrors(),
    waitForLoadingDone: buildWaitForLoadingDone(),
    discoverForm: buildDiscoverForm(cache),
    scopeToForm: buildScopeToForm(cache),
  };
}

export default createElementMediator;
export { createElementMediator };
