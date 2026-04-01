/**
 * Dashboard helpers — traffic counting, strategy resolution, probes.
 * Href extraction in DashboardHrefExtraction.ts.
 * Date candidates in DashboardDateCandidates.ts.
 * Navigation in DashboardNavigation.ts.
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import type { IElementMediator } from '../Mediator/Elements/ElementMediator.js';
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../Mediator/Network/NetworkDiscovery.js';
import { WK_DASHBOARD } from '../Registry/WK/DashboardWK.js';
import { WK_LOGIN_SUCCESS } from '../Registry/WK/LoginWK.js';
import { PIPELINE_WELL_KNOWN_API } from '../Registry/WK/ScrapeWK.js';
import { buildDateCandidates } from './DashboardDateCandidates.js';

export { extractTransactionHref, NO_HREF } from './DashboardHrefExtraction.js';

/** Timeout for SUCCESS probe. */
const DASHBOARD_TIMEOUT = 30000;
/** Timeout for REVEAL probe. */
const REVEAL_TIMEOUT_MS = 15000;
type DashboardStrategyKind = 'BYPASS' | 'TRIGGER';
type HasBody = boolean;
type TxnTrafficCount = number;
type IsMatch = boolean;
type PatternMatch = boolean;
/** Resolved absolute URL string. */
type AbsoluteHref = string;

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
  return network.getAllEndpoints().filter((ep): IsMatch => ep.timestamp > sinceMs);
}

/**
 * Count WK transaction endpoints with response body since a timestamp.
 * @param network - Network discovery.
 * @param sinceMs - Epoch ms (0 = all time).
 * @returns Count of matching endpoints.
 */
function countTxnTraffic(network: INetworkDiscovery, sinceMs: number): TxnTrafficCount {
  const recent = recentEndpoints(network, sinceMs);
  const matched = recent.filter(
    (ep): IsMatch => PIPELINE_WELL_KNOWN_API.transactions.some((p): PatternMatch => p.test(ep.url)),
  );
  return matched.filter((ep): HasBody => ep.responseBody !== undefined && ep.responseBody !== null)
    .length;
}

/**
 * Resolve dashboard strategy based on existing traffic.
 * @param network - Network discovery.
 * @returns BYPASS if traffic exists, TRIGGER if not.
 */
function resolveDashboardStrategy(network: INetworkDiscovery): DashboardStrategyKind {
  const existingCount = countTxnTraffic(network, 0);
  if (existingCount > 0) return 'BYPASS';
  return 'TRIGGER';
}

/**
 * Build absolute URL from a relative href.
 * @param href - Relative or absolute href.
 * @param pageUrl - Current page URL for resolution.
 * @returns Absolute URL string, or empty if malformed.
 */
function resolveAbsoluteHref(href: string, pageUrl: string): AbsoluteHref {
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return '';
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return '';
  }
}

/**
 * Probe WK.LOGIN.POST.SUCCESS indicators.
 * @param mediator - Active mediator.
 * @returns Human-readable match summary.
 */
async function probeSuccessIndicators(mediator: IElementMediator): Promise<string> {
  const successCandidates = WK_LOGIN_SUCCESS as unknown as readonly SelectorCandidate[];
  const result = await mediator
    .resolveVisible(successCandidates, DASHBOARD_TIMEOUT)
    .catch((): false => false);
  const hasMatch = result && result.found && result.candidate;
  const candidateValue = (hasMatch && result.candidate.value) || '';
  return (hasMatch && `matched: ${candidateValue}`) || 'no indicator';
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
  const result = await safeResolveVisible(mediator, allCandidates, REVEAL_TIMEOUT_MS);
  const hasMatch = result && result.found && result.candidate;
  const candidateValue = (hasMatch && result.candidate.value) || '';
  return (hasMatch && `reveal: ${candidateValue}`) || 'no reveal';
}

export { buildApiContext, triggerOrganicDashboard } from './DashboardNavigation.js';

export {
  countTxnTraffic,
  probeDashboardReveal,
  probeSuccessIndicators,
  resolveAbsoluteHref,
  resolveDashboardStrategy,
};
