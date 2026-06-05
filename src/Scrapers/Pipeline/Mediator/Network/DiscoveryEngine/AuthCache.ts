/**
 * DiscoveryEngine / AuthCache — the closure-backed 3-tier auth
 * discovery cache shared by the live `INetworkDiscovery` instance.
 * Extracted from `DiscoveryEngine.ts` per PR #276 review-fix so the
 * composer fits the Section 11 150 eff-LoC file cap.
 */

import type { Page } from 'playwright-core';

import type { IFetchOpts } from '../../../Strategy/Fetch/FetchStrategy.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { discoverAuthThreeTier } from '../AuthDiscovery.js';
import buildDiscoveredHeadersFromCapture from '../DiscoveryHeaders/DiscoveryHeaders.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

const LOG = getDebug(import.meta.url);

/** Length of the cached-auth token preview emitted to trace logs. */
const TOKEN_PREVIEW_LENGTH = 20;

/** Auth-cache shared state used by the closure helpers. */
interface IAuthCacheState {
  cached: string | false;
  discovered: boolean;
}

/** Auth-cache method bundle returned by {@link buildAuthCache}. */
interface IAuthCacheHandle {
  readonly cacheAuthToken: () => Promise<string | false>;
  readonly discoverAuthToken: () => Promise<string | false>;
  readonly buildDiscoveredHeaders: () => Promise<IFetchOpts>;
}

/**
 * Refresh the cached token via the 3-tier auth discovery.
 * @param page - Playwright page.
 * @param captured - Captured endpoint pool.
 * @param state - Mutable cache state (updated in place).
 * @returns The freshly discovered token (or false).
 */
async function refreshAuthState(
  page: Page,
  captured: readonly IDiscoveredEndpoint[],
  state: IAuthCacheState,
): Promise<string | false> {
  state.cached = await discoverAuthThreeTier(captured, page);
  state.discovered = true;
  return state.cached;
}

/**
 * Read the cached token, refreshing on first call.
 * @param refresh - Closure that performs a refresh.
 * @param state - Mutable cache state.
 * @returns Cached or freshly discovered token (or false).
 */
async function readAuthState(
  refresh: () => Promise<string | false>,
  state: IAuthCacheState,
): Promise<string | false> {
  if (state.discovered) return state.cached;
  const token = await refresh();
  return token;
}

/**
 * Emit the masked auth-token preview when a token was found.
 * @param token - Discovered token (or false on miss).
 * @returns True when a log entry was emitted, false on miss.
 */
function logCachedAuth(token: string | false): boolean {
  if (!token) return false;
  const head = token.slice(0, TOKEN_PREVIEW_LENGTH);
  const preview = maskVisibleText(head);
  LOG.trace({ message: preview });
  return true;
}

/**
 * Refresh + log preview shared helper (top-level so `buildAuthCache`
 * can use `.bind(null, refresh)` instead of an inline arrow).
 * @param refresh - Closure that performs a refresh.
 * @returns Freshly discovered token (or false).
 */
async function cacheAuthTokenFn(refresh: () => Promise<string | false>): Promise<string | false> {
  const token = await refresh();
  logCachedAuth(token);
  return token;
}

/**
 * Build header bag using the cached auth via the shared helper.
 * @param captured - Captured endpoint pool.
 * @param read - Cached-auth reader closure.
 * @returns Fetch options with merged auth + Origin + Site-Id headers.
 */
async function buildHeadersFn(
  captured: readonly IDiscoveredEndpoint[],
  read: () => Promise<string | false>,
): Promise<IFetchOpts> {
  const auth = await read();
  return buildDiscoveredHeadersFromCapture(captured, auth);
}

/**
 * Build the auth-cache method bundle. The cache stores BOTH positive
 * and negative results so banks whose auth lives in cookies (not
 * sessionStorage) don't pay `pollForAuthModule`'s 10 s timeout on
 * every scrape iteration.
 * @param page - Playwright page (passed through to discovery).
 * @param captured - Captured endpoint pool.
 * @returns Auth-cache handle.
 */
function buildAuthCache(page: Page, captured: readonly IDiscoveredEndpoint[]): IAuthCacheHandle {
  const state: IAuthCacheState = { cached: false, discovered: false };
  /**
   * Run the 3-tier auth discovery and update the shared cache.
   * @returns Freshly discovered token (or false).
   */
  const refresh = (): Promise<string | false> => refreshAuthState(page, captured, state);
  /**
   * Read the cached token, refreshing on first call.
   * @returns Cached or freshly discovered token (or false).
   */
  const read = (): Promise<string | false> => readAuthState(refresh, state);
  return {
    cacheAuthToken: cacheAuthTokenFn.bind(null, refresh),
    discoverAuthToken: read,
    buildDiscoveredHeaders: buildHeadersFn.bind(null, captured, read),
  };
}

export default buildAuthCache;
export type { IAuthCacheHandle };
