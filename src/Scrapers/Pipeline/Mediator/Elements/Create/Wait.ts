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

import type { Frame, Locator, Page } from 'playwright-core';

import { WK_DASHBOARD } from '../../../Registry/WK/DashboardWK.js';
import { getDebug } from '../../../Types/Debug.js';
import { isOk, type Procedure, succeed } from '../../../Types/Procedure.js';
import { ELEMENTS_LOADING_DELAY_MS } from '../ActionExecutors.js';
import type { IElementMediator } from '../ElementMediator.js';
import { buildCandidateLocators } from './Locators.js';
import { NO_FORM_ANCHOR } from './Scope.js';

const LOG = getDebug(import.meta.url);

/**
 * Re-export the inter-attempt polling delay so the wait cluster owns
 * its tuning knob. The constant still lives in ActionExecutors (other
 * action callers share the same delay), but its only OTHER consumer
 * (the parent mediator) has migrated to importing it from here.
 */
export { ELEMENTS_LOADING_DELAY_MS };

/**
 * Map a single locator to a non-rejecting "is visible" probe.
 * Returns `false` on every error so Promise.all never rejects.
 * @param locator - Playwright locator under test.
 * @returns Visibility flag (false when the probe throws).
 */
function probeLocatorVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch((): boolean => false);
}

/**
 * Check if any WellKnown loading indicator is currently visible.
 * Expands every WK_DASHBOARD.LOADING candidate through `buildCandidateLocators`
 * so BOTH `KIND_TEXT_CONTENT` AND `KIND_ARIA_LABEL` entries are honoured —
 * the previous direct `getByText(c.value)` skipped ARIA-labelled spinners
 * entirely, leaving the post-click drainer racing against a still-visible
 * "טוען" indicator on banks that ship aria-labelled loaders.
 * @param frame - Page or Frame to check.
 * @returns succeed(true) if any candidate visible, succeed(false) if clear.
 */
async function isAnyLoadingVisible(frame: Page | Frame): Promise<Procedure<boolean>> {
  const locators = WK_DASHBOARD.LOADING.flatMap((c): Locator[] =>
    buildCandidateLocators(frame, c, NO_FORM_ANCHOR),
  );
  const probes = locators.map(probeLocatorVisible);
  const results = await Promise.all(probes);
  const hasLoading = results.some(Boolean);
  return succeed(hasLoading);
}

/**
 * Emit the structured `pipeline.wait.loading.retry` debug event. Stays
 * inside the CLAUDE.md 10-LoC hard cap so the orchestrator
 * {@link logLoadingAndDelay} can remain a thin two-call composition
 * (CR #339 cycle 6 N3 follow-up — was 11 LoC inline).
 * @param attempt - Current attempt number (for logging).
 * @returns `true` once the structured event is enqueued (no-void contract).
 */
function logLoadingRetry(attempt: number): boolean {
  const delayStr = String(ELEMENTS_LOADING_DELAY_MS);
  const attemptStr = String(attempt);
  LOG.debug({
    event: 'pipeline.wait.loading.retry',
    attempt,
    delayMs: ELEMENTS_LOADING_DELAY_MS,
    message: `loading indicator visible, waiting ${delayStr}ms (attempt ${attemptStr})`,
  });
  return true;
}

/**
 * Log retry and pause one inter-attempt cycle while a loading
 * indicator is visible. Extracted so {@link waitOnceForLoading} keeps
 * the early-return short-circuit and stays inside the LoC cap.
 * Delegates the LOG.debug payload to {@link logLoadingRetry}.
 * @param frame - Page or Frame currently showing a loading indicator.
 * @param attempt - Current attempt number (for logging).
 * @returns `true` after the inter-attempt delay completes (no-void contract).
 */
async function logLoadingAndDelay(frame: Page | Frame, attempt: number): Promise<boolean> {
  logLoadingRetry(attempt);
  await frame.waitForTimeout(ELEMENTS_LOADING_DELAY_MS);
  return true;
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
  await logLoadingAndDelay(frame, attempt);
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
