/**
 * Dashboard API context builder — auto-discover endpoints from network traffic.
 * Extracted from DashboardNavigation.ts to respect max-lines.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts, IFetchStrategy, PostData } from '../../Strategy/Fetch/FetchStrategy.js';
import type { IApiFetchContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { INetworkDiscovery } from '../Network/NetworkDiscovery.js';

/**
 * Extract URL from a discovered endpoint, or false.
 * @param hit - Discovered endpoint or false.
 * @returns URL string or false.
 */
function urlOrFalse(hit: { url: string } | false): string | false {
  if (!hit) return false;
  return hit.url;
}

/**
 * Discover all endpoint URLs from network traffic.
 * @param network - Network discovery.
 * @returns Discovered URLs object.
 */
function discoverUrls(
  network: INetworkDiscovery,
): Pick<IApiFetchContext, 'accountsUrl' | 'transactionsUrl' | 'balanceUrl' | 'pendingUrl'> {
  const acctHit = network.discoverAccountsEndpoint();
  const txnHit = network.discoverTransactionsEndpoint();
  const balHit = network.discoverBalanceEndpoint();
  const pendHit = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.pending);
  return {
    accountsUrl: urlOrFalse(acctHit),
    transactionsUrl: urlOrFalse(txnHit),
    balanceUrl: urlOrFalse(balHit),
    pendingUrl: urlOrFalse(pendHit),
  };
}

/**
 * Create a POST fetcher bound to discovered headers.
 * @param strategy - Fetch strategy.
 * @param opts - Discovered fetch options.
 * @returns Bound POST function.
 */
function createBoundPost(
  strategy: IFetchStrategy,
  opts: IFetchOpts,
): IApiFetchContext['fetchPost'] {
  return <T>(url: string, body: PostData): Promise<Procedure<T>> =>
    strategy.fetchPost<T>(url, body, opts);
}

/**
 * Create a GET fetcher bound to discovered headers.
 * @param strategy - Fetch strategy.
 * @param opts - Discovered fetch options.
 * @returns Bound GET function.
 */
function createBoundGet(strategy: IFetchStrategy, opts: IFetchOpts): IApiFetchContext['fetchGet'] {
  return <T>(url: string): Promise<Procedure<T>> => strategy.fetchGet<T>(url, opts);
}

/**
 * Build auto-discovered API fetch context from network traffic.
 * @param network - Network discovery.
 * @param strategy - Base fetch strategy.
 * @returns API fetch context with discovered endpoints.
 */
async function buildApiContext(
  network: INetworkDiscovery,
  strategy: IFetchStrategy,
): Promise<IApiFetchContext> {
  const opts = await network.buildDiscoveredHeaders();
  const urls = discoverUrls(network);
  const fetchPost = createBoundPost(strategy, opts);
  const fetchGet = createBoundGet(strategy, opts);
  return { fetchPost, fetchGet, ...urls };
}

export default buildApiContext;
export { buildApiContext };
