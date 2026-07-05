/**
 * Dashboard helpers — traffic counting, strategy resolution, probes.
 * Href extraction in DashboardHrefExtraction.ts.
 * Date candidates in DashboardDateCandidates.ts.
 * Navigation in DashboardNavigation.ts.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Network/NetworkDiscovery.js';
import { hasTxnArray } from '../Scrape/TxnShape.js';
import {
  DASHBOARD_REVEAL_TIMEOUT_MS,
  DASHBOARD_SUCCESS_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';
import { buildDateCandidates } from './DashboardDateCandidates.js';

export { resolveAbsoluteHref, resolveHrefFromRaw } from './DashboardHref.js';
export { extractTransactionHref, NO_HREF } from './DashboardHrefExtraction.js';

/**
 * Filter endpoints that arrived after a given timestamp.
 * @param network - Network discovery.
 * @param sinceMs - Epoch ms (0 = all time).
 * @returns Recent endpoints.
 */
function recentEndpoints(
  network: INetworkDiscovery,
  sinceMs: number,
): readonly IDiscoveredEndpoint[] {
  return network.getAllEndpoints().filter((ep): boolean => ep.timestamp > sinceMs);
}

/**
 * Count WK transaction endpoints that carry a real txn-shape response.
 * Tightened gate (Option B): require URL match AND body to hold a
 * non-empty array under a WK.txnContainers key. Summary endpoints
 * whose URL matches but whose body is only metadata no longer count.
 * @param network - Network discovery.
 * @param sinceMs - Epoch ms (0 = all time).
 * @returns Count of endpoints with real txn data.
 */
function countTxnTraffic(network: INetworkDiscovery, sinceMs: number): number {
  const recent = recentEndpoints(network, sinceMs);
  const matched = recent.filter((ep): boolean =>
    PIPELINE_WELL_KNOWN_API.transactions.some((p): boolean => p.test(ep.url)),
  );
  const withBody = matched.filter(
    (ep): boolean => ep.responseBody !== undefined && ep.responseBody !== null,
  );
  return withBody.filter((ep): boolean => hasTxnArray(ep.responseBody)).length;
}

/** Lowercased URL schemes rejected by `resolveAbsoluteHref` and the
 *  absolute-href builder now live in the dependency-free leaf
 *  DashboardHref.ts (imported below) so DashboardNavigation can reuse
 *  them without forming an import cycle back to this module. */

/**
 * Probe WK.LOGIN.POST.SUCCESS indicators.
 * @param mediator - Active mediator.
 * @returns Human-readable match summary.
 */
async function probeSuccessIndicators(mediator: IElementMediator): Promise<string> {
  const successCandidates = WK_DASHBOARD.SUCCESS as unknown as readonly SelectorCandidate[];
  const result = await mediator
    .resolveVisible(successCandidates, DASHBOARD_SUCCESS_TIMEOUT_MS)
    .catch((): false => false);
  if (result === false) return 'no indicator';
  if (!result.found || !result.candidate) return 'no indicator';
  return `matched: ${result.candidate.value}`;
}

/**
 * Build candidate list for REVEAL probe.
 * @returns Combined static + date candidates.
 */
function buildRevealCandidates(): readonly SelectorCandidate[] {
  const staticC = WK_DASHBOARD.REVEAL as unknown as readonly SelectorCandidate[];
  return [...staticC, ...buildDateCandidates()];
}

/**
 * Safely resolve visible candidates, returning false on error.
 * @param mediator - Element mediator.
 * @param candidates - Candidates to resolve.
 * @param timeout - Timeout in ms.
 * @returns Resolve result or false.
 */
async function safeResolveVisible(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
  timeout: number,
): Promise<Awaited<ReturnType<IElementMediator['resolveVisible']>> | false> {
  return mediator.resolveVisible(candidates, timeout).catch((): false => false);
}

/**
 * LOGIN.SIGNAL — probe WK.DASHBOARD.REVEAL + runtime dates.
 * @param mediator - Active mediator.
 * @returns Human-readable match summary.
 */
async function probeDashboardReveal(mediator: IElementMediator): Promise<string> {
  const allCandidates = buildRevealCandidates();
  const result = await safeResolveVisible(mediator, allCandidates, DASHBOARD_REVEAL_TIMEOUT_MS);
  if (result === false) return 'no reveal';
  if (!result.found || !result.candidate) return 'no reveal';
  return `reveal: ${result.candidate.value}`;
}

/**
 * Validate traffic gate — check that ANY endpoints were captured.
 * No strategy dependency — DASHBOARD is pure navigation.
 * @param network - Network discovery.
 * @param logger - Optional logger.
 * @returns True if endpoints exist, false if dashboard captured nothing.
 */
function validateTrafficGate(network: INetworkDiscovery, logger?: ScraperLogger): boolean {
  const allEndpoints = network.getAllEndpoints();
  if (allEndpoints.length > 0) return true;
  logger?.debug({ message: 'trafficPrimed=false (endpoints=0)' });
  return false;
}

export { buildApiContext, triggerOrganicDashboard } from './DashboardNavigation.js';

export {
  buildRevealCandidates,
  countTxnTraffic,
  probeDashboardReveal,
  probeSuccessIndicators,
  validateTrafficGate,
};
