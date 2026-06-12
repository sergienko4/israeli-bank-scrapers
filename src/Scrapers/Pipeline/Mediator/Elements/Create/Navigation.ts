/**
 * Navigation cluster — URL / networkidle gating methods plus the
 * `buildNavCluster` aggregator. The networkidle budget is reused from
 * `ElementsTimingConfig` (`ELEMENTS_NETWORK_IDLE_TIMEOUT_MS`) so the
 * R-NO-FIXED-WAIT-15S architecture rule only has one owner for that
 * constant — duplicating it here as a private `NETWORK_IDLE_TIMEOUT`
 * bypassed the `_TIMEOUT_MS` guard regex via the missing `_MS` suffix.
 *
 * Notes:
 *   - `buildNavCluster` constructs `waitForNetworkIdle` once and
 *     reuses the same reference inside `raceWithNetworkIdle` — the
 *     historic single-source-of-truth invariant from the original
 *     factory; identity preserved.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import { fail, type Procedure, succeed } from '../../../Types/Procedure.js';
import { ELEMENTS_NETWORK_IDLE_TIMEOUT_MS } from '../../Timing/ElementsTimingConfig.js';
import { type IElementMediator } from '../ElementMediator.js';

/** Default timeout for SPA URL wait. */
const URL_WAIT_TIMEOUT_MS = 10_000;

/**
 * Map a thrown navigation error to a Generic-typed `fail()` procedure so
 * the caller's body stays at the goto-then-succeed rhythm and the LoC cap
 * stays satisfied.
 * @param error - Caught error from `page.goto`.
 * @returns `fail()` procedure carrying the navigation message.
 */
function makeNavigationFailure(error: unknown): Procedure<void> {
  const msg = toErrorMessage(error as Error);
  return fail(ScraperErrorTypes.Generic, `Navigation failed: ${msg}`);
}

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
      return makeNavigationFailure(error);
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
 * Wait for `networkidle` and swallow timeouts — slow analytics ≠ broken
 * scraper. Extracted so {@link buildWaitForNetworkIdle} stays at the
 * "default-timeout-then-await-then-succeed" rhythm and the LoC cap holds.
 * @param page - The Playwright page.
 * @param timeout - Wait budget in ms.
 */
async function awaitNetworkIdleNonFatal(page: Page, timeout: number): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // Timeout is non-fatal — SPA may stay "loading"
  }
}

/**
 * Build waitForNetworkIdle method bound to a page.
 * Timeout is non-fatal — slow analytics ≠ broken scraper.
 * @param page - The Playwright page.
 * @returns Mediator waitForNetworkIdle function.
 */
function buildWaitForNetworkIdle(page: Page): IElementMediator['waitForNetworkIdle'] {
  return async (timeoutMs?): Promise<Procedure<void>> => {
    const timeout = timeoutMs ?? ELEMENTS_NETWORK_IDLE_TIMEOUT_MS;
    await awaitNetworkIdleNonFatal(page, timeout);
    return succeed(undefined);
  };
}

/**
 * Race promises and swallow rejection. Observed state above decides
 * outcome — both racers are best-effort signals, neither rejection
 * invalidates the pool. Extracted so {@link buildRaceWithNetworkIdle}
 * stays inside the LoC cap.
 * @param racers - Pair of best-effort settle signals.
 */
async function raceWithCatch(racers: readonly Promise<unknown>[]): Promise<void> {
  try {
    await Promise.race(racers);
  } catch {
    // Observed state below decides outcome — both racers are
    // best-effort signals, neither rejection invalidates the pool.
  }
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
    await raceWithCatch([customWait, waitForNetworkIdle(budgetMs)]);
    return true as const;
  };
}

/**
 * Build waitForURL — wait for page URL to match a glob pattern.
 * Non-fatal: returns succeed(false) on timeout.
 * @param page - The Playwright page.
 * @returns Async function returning Procedure with match result.
 */
function buildWaitForURL(page: Page): IElementMediator['waitForURL'] {
  return async (pattern, timeoutMs = URL_WAIT_TIMEOUT_MS) => {
    const didMatch: boolean = await page
      .waitForURL(pattern, { timeout: timeoutMs })
      .then((): boolean => true)
      .catch((): boolean => false);
    return succeed(didMatch);
  };
}

/** Navigation primitives — URL + networkidle gating. */
export type NavBundle = Pick<
  IElementMediator,
  'navigateTo' | 'getCurrentUrl' | 'waitForNetworkIdle' | 'raceWithNetworkIdle' | 'waitForURL'
>;

/**
 * Build the 5-method navigation cluster. Internally constructs the
 * single `waitForNetworkIdle` primitive once and reuses it inside
 * `raceWithNetworkIdle` — preserves the historic single-source-of-truth
 * invariant from the original factory.
 * @param page - The Playwright page to bind nav methods to.
 * @returns Navigation method bundle.
 */
export function buildNavCluster(page: Page): NavBundle {
  const wfni = buildWaitForNetworkIdle(page);
  return {
    navigateTo: buildNavigateTo(page),
    getCurrentUrl: buildGetCurrentUrl(page),
    waitForNetworkIdle: wfni,
    raceWithNetworkIdle: buildRaceWithNetworkIdle(wfni),
    waitForURL: buildWaitForURL(page),
  };
}
