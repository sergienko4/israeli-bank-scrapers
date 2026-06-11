/**
 * Loading-indicator wait orchestration for IElementMediator — builds
 * the `waitForLoadingDone` method that callers invoke between page
 * actions to absorb spinner/skeleton transitions before the next
 * interaction. Uses the WK_DASHBOARD.LOADING candidate list as the
 * "is loading visible" probe.
 *
 * Public surface (consumed by the parent mediator's cluster
 * assembler, `buildResolveCluster`):
 *   - `buildWaitForLoadingDone` — returns the mediator method that
 *     polls up to three attempts (with ELEMENTS_LOADING_DELAY_MS
 *     between attempts) and resolves true once no loading indicator
 *     is visible — or after the third attempt regardless.
 *
 * Private helpers (per-frame visibility probe + single-attempt body)
 * stay encapsulated — no callers outside this cluster.
 *
 * Extracted from CreateElementMediator.ts (Phase 12a §7).
 */

import type { Frame, Page } from 'playwright-core';

import { WK_DASHBOARD } from '../../../Registry/WK/DashboardWK.js';
import { getDebug } from '../../../Types/Debug.js';
import { isOk, type Procedure, succeed } from '../../../Types/Procedure.js';
import { ELEMENTS_LOADING_DELAY_MS } from '../ActionExecutors.js';
import type { IElementMediator } from '../ElementMediator.js';

const LOG = getDebug(import.meta.url);

/**
 * Re-export the inter-attempt polling delay so the wait cluster owns
 * its tuning knob. The constant still lives in ActionExecutors (other
 * action callers share the same delay), but its only OTHER consumer
 * (the parent mediator) has migrated to importing it from here.
 */
export { ELEMENTS_LOADING_DELAY_MS };

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
export function buildWaitForLoadingDone(): IElementMediator['waitForLoadingDone'] {
  return async (frame: Page | Frame): Promise<Procedure<true>> => {
    const done1 = await waitOnceForLoading(frame, 1);
    if (isOk(done1) && done1.value) return succeed(true);
    const done2 = await waitOnceForLoading(frame, 2);
    if (isOk(done2) && done2.value) return succeed(true);
    await waitOnceForLoading(frame, 3);
    return succeed(true);
  };
}
