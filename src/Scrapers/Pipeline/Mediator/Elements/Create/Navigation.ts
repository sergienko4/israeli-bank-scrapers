/**
 * Navigation cluster — URL / networkidle gating methods plus the
 * `buildNavCluster` aggregator. Owns the two navigation-budget
 * constants (`NETWORK_IDLE_TIMEOUT`, `URL_WAIT_TIMEOUT`) so any
 * future tuning lives next to the consumers, not in the façade.
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
import { type IElementMediator } from '../ElementMediator.js';

/** Default timeout for network idle wait (matches POST_LOGIN_SETTLE_TIMEOUT). */
const NETWORK_IDLE_TIMEOUT = 15_000;

/** Default timeout for SPA URL wait. */
const URL_WAIT_TIMEOUT = 10_000;

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
