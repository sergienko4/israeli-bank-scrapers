/**
 * Network Polling — shared timing primitives used by both live and
 * frozen INetworkDiscovery surfaces. Two flavours:
 *
 *   • `awaitFirstId` — recursive poll over a live capture array,
 *     consulting a caller-supplied predicate every
 *     `NETWORK_WAIT_FIRST_ID_POLL_MS` ms until the deadline elapses.
 *
 *   • `awaitTraffic` — Playwright-native, event-driven wait for a
 *     response URL matching any WK regex pattern, with an immediate
 *     fast-path against the existing capture pool.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 2/9) to isolate
 * the polling/wait machinery from filter/parse/discovery logic.
 */

import type { Page, Response } from 'playwright-core';

import { createPromise } from '../../Timing/TimingActions.js';
import { NETWORK_WAIT_FIRST_ID_POLL_MS } from '../../Timing/TimingConfig.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

/** Predicate signature — caller-owned shape detector. */
type FirstIdPredicate = (pool: readonly IDiscoveredEndpoint[]) => IDiscoveredEndpoint | false;

/** Args bundle for the recursive id-wait poll. */
interface IPollFirstIdArgs {
  readonly captured: readonly IDiscoveredEndpoint[];
  readonly deadline: number;
  readonly predicate: FirstIdPredicate;
}

/**
 * Wait one poll-interval tick. Uses `createPromise` (Reflect-built
 * Promise) so the no-`new Promise` lint rule stays satisfied and the
 * sleep-ban (`sleep()` keyword forbidden by the project lint set)
 * doesn't apply to the local helper.
 * @returns Resolved promise after `NETWORK_WAIT_FIRST_ID_POLL_MS` ms.
 */
function pollTick(): Promise<true> {
  /**
   * Schedule the resolve via setTimeout (callback returns true).
   * @param resolve - Promise resolver.
   * @returns True after the timer is armed.
   */
  const arm = (resolve: (value: true) => boolean): boolean => {
    /**
     * Timer callback — resolves the promise.
     * @returns True to satisfy the typed resolver signature.
     */
    const fire = (): boolean => resolve(true);
    globalThis.setTimeout(fire, NETWORK_WAIT_FIRST_ID_POLL_MS);
    return true;
  };
  return createPromise<true>(arm);
}

/**
 * Recursive poll for the first id-bearing capture — replaces the
 * banned `while + await-in-loop` pattern. Each tick inspects the
 * live capture array by reference; additions made by the page
 * listener between ticks are visible on the next call.
 * @param args - Captured pool (by reference) + absolute deadline ms.
 * @returns First id-bearing endpoint or false on timeout.
 */
async function pollFirstId(args: IPollFirstIdArgs): Promise<IDiscoveredEndpoint | false> {
  const hit = args.predicate(args.captured);
  if (hit !== false) return hit;
  if (Date.now() >= args.deadline) return false;
  await pollTick();
  return pollFirstId(args);
}

/**
 * Block until `predicate(captured)` yields a match or the budget
 * elapses. Captures are inspected by reference so additions made
 * by the page listener while we sleep are visible on the next
 * iteration. The predicate is caller-supplied (typically
 * AccountResolve's wrapper around `discoverAccountsInPool`) so
 * Network has zero AccountResolve knowledge.
 *
 * @param captured - Live capture array (read by reference each tick).
 * @param timeoutMs - Max wait budget in ms.
 * @param predicate - Caller-owned shape detector.
 * @returns First matching endpoint or false on timeout.
 */
function awaitFirstId(
  captured: readonly IDiscoveredEndpoint[],
  timeoutMs: number,
  predicate: FirstIdPredicate,
): Promise<IDiscoveredEndpoint | false> {
  const deadline = Date.now() + timeoutMs;
  return pollFirstId({ captured, deadline, predicate });
}

/** Bundled args for traffic waiting. */
interface ITrafficWaitArgs {
  readonly page: Page;
  readonly captured: readonly IDiscoveredEndpoint[];
  readonly patterns: readonly RegExp[];
}

/**
 * True when the captured endpoint has a body AND its URL matches one
 * of the WK traffic patterns. Bound by {@link findTrafficHit}.
 * @param patterns - WK regex patterns.
 * @param ep - Captured endpoint.
 * @returns True when the endpoint counts as a traffic hit.
 */
function isTrafficMatch(patterns: readonly RegExp[], ep: IDiscoveredEndpoint): boolean {
  if (ep.responseBody === undefined || ep.responseBody === null) return false;
  return patterns.some((p): boolean => p.test(ep.url));
}

/**
 * Check if any captured endpoint matches the patterns.
 * @param captured - Live captured endpoints.
 * @param patterns - WellKnown regex patterns.
 * @returns First matching endpoint or false.
 */
function findTrafficHit(
  captured: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const matcher = isTrafficMatch.bind(null, patterns);
  const hit = captured.find(matcher);
  return hit ?? false;
}

/**
 * True when the response URL matches any of the WK patterns. Bound
 * by {@link awaitTraffic}'s `page.waitForResponse` adapter.
 * @param patterns - WK regex patterns.
 * @param response - Playwright response.
 * @returns True when URL matches a pattern.
 */
function matchUrlPredicate(patterns: readonly RegExp[], response: Response): boolean {
  const url = response.url();
  return patterns.some((p): boolean => p.test(url));
}

/**
 * Wait for a response matching WellKnown patterns via Playwright.
 * Non-polling: uses Playwright's native event-driven response matching.
 * @param args - Page, captured endpoints, and patterns.
 * @param timeoutMs - Max wait time.
 * @returns First matching endpoint or false on timeout.
 */
async function awaitTraffic(
  args: ITrafficWaitArgs,
  timeoutMs: number,
): Promise<IDiscoveredEndpoint | false> {
  const immediate = findTrafficHit(args.captured, args.patterns);
  if (immediate) return immediate;
  const matchUrl = matchUrlPredicate.bind(null, args.patterns);
  await args.page.waitForResponse(matchUrl, { timeout: timeoutMs }).catch((): false => false);
  return findTrafficHit(args.captured, args.patterns);
}

export type { FirstIdPredicate, IPollFirstIdArgs, ITrafficWaitArgs };
export { awaitFirstId, awaitTraffic, findTrafficHit, pollFirstId, pollTick };
