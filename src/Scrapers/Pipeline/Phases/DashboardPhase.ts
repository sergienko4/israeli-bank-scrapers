/**
 * DASHBOARD phase — generic wait for dashboard readiness after login.
 * Uses mediator.resolveAndClick with WellKnown dashboard indicators.
 * Searches main page + ALL iframes (may be in iframe or main HTML).
 * Same flow for ALL banks — no bank-specific code.
 *
 * pre:    mediator scans for WellKnown dashboardIndicator (30s timeout)
 * action: mark dashboard as ready, store page URL
 * post:   check for changePassword indicators
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import {
  PIPELINE_WELL_KNOWN_API,
  PIPELINE_WELL_KNOWN_DASHBOARD,
} from '../Registry/PipelineWellKnown.js';
import type { IFetchStrategy, PostData } from '../Strategy/FetchStrategy.js';
import { some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type {
  IApiFetchContext,
  IDashboardState,
  IPipelineContext,
} from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';

/** Timeout for waiting for dashboard indicator (30s for SPA auth flows). */
const DASHBOARD_TIMEOUT = 30000;

/**
 * Probe for change-password indicators when dashboard is not found.
 * @param mediator - Element mediator.
 * @returns True if change-password indicator is visible.
 */
async function probeChangePassword(mediator: IElementMediator): Promise<boolean> {
  return mediator
    .resolveAndClick(PIPELINE_WELL_KNOWN_DASHBOARD.changePasswordIndicator)
    .catch((): boolean => false);
}

/**
 * Scan for dashboard readiness via mediator.
 * @param mediator - Element mediator.
 * @returns True if any dashboard indicator is visible.
 */
async function probeDashboard(mediator: IElementMediator): Promise<boolean> {
  return mediator
    .resolveAndClick(PIPELINE_WELL_KNOWN_DASHBOARD.dashboardIndicator, DASHBOARD_TIMEOUT)
    .catch((): boolean => false);
}

/**
 * Extract URL from a discovered endpoint, or false if not found.
 * @param hit - Discovered endpoint or false.
 * @returns URL string or false.
 */
function urlOrFalse(hit: IDiscoveredEndpoint | false): string | false {
  if (!hit) return false;
  return hit.url;
}

/**
 * Discover all endpoint URLs from network traffic.
 * @param network - Network discovery.
 * @returns Discovered URLs (false if not found).
 */
function discoverUrls(
  network: INetworkDiscovery,
): Pick<IApiFetchContext, 'accountsUrl' | 'transactionsUrl' | 'balanceUrl' | 'pendingUrl'> {
  const accountsHit = network.discoverAccountsEndpoint();
  const txnHit = network.discoverTransactionsEndpoint();
  const balanceHit = network.discoverBalanceEndpoint();
  const pendingHit = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.pending);
  return {
    accountsUrl: urlOrFalse(accountsHit),
    transactionsUrl: urlOrFalse(txnHit),
    balanceUrl: urlOrFalse(balanceHit),
    pendingUrl: urlOrFalse(pendingHit),
  };
}

/**
 * Build auto-discovered API fetch context from network traffic.
 * @param network - Network discovery with captured traffic.
 * @param strategy - Base fetch strategy from INIT.
 * @returns API fetch context with discovered endpoints + authenticated fetch.
 */
function buildApiContext(network: INetworkDiscovery, strategy: IFetchStrategy): IApiFetchContext {
  const headers = network.buildDiscoveredHeaders();
  const urls = discoverUrls(network);
  return {
    /**
     * Fetch POST with discovered headers.
     * @param url - Endpoint URL.
     * @param body - POST body.
     * @returns Procedure with response.
     */
    fetchPost: <T>(url: string, body: PostData): Promise<Procedure<T>> =>
      strategy.fetchPost<T>(url, body, headers),
    /**
     * Fetch GET with discovered headers.
     * @param url - Endpoint URL.
     * @returns Procedure with response.
     */
    fetchGet: <T>(url: string): Promise<Procedure<T>> => strategy.fetchGet<T>(url, headers),
    ...urls,
  };
}

/**
 * Execute the DASHBOARD phase: wait for dashboard via mediator.
 * ALL via mediator — searches main page + iframes with resolveAndClick.
 * @param _ctx - Pipeline context (unused, matches step signature).
 * @param input - Pipeline context with browser + mediator.
 * @returns Updated context with dashboard state, or failure.
 */
async function executeDashboard(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for DASHBOARD');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD');
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  const hasDashboard = await probeDashboard(mediator);
  const hasChangePass = !hasDashboard && (await probeChangePassword(mediator));
  if (hasChangePass) return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
  const dashState: IDashboardState = { isReady: hasDashboard, pageUrl: page.url() };
  if (!input.fetchStrategy.has) return succeed({ ...input, dashboard: some(dashState) });
  const apiCtx = buildApiContext(mediator.network, input.fetchStrategy.value);
  return succeed({ ...input, dashboard: some(dashState), api: some(apiCtx) });
}

/** DASHBOARD phase step — generic wait for dashboard readiness. */
const DASHBOARD_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'dashboard',
  execute: executeDashboard,
};

export default DASHBOARD_STEP;
export { DASHBOARD_STEP };
