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
/** Discovered URL fields in API context. */
type DiscoveredUrls = Pick<
  IApiFetchContext,
  'accountsUrl' | 'transactionsUrl' | 'balanceUrl' | 'pendingUrl' | 'proxyUrl'
>;

/**
 * Discover all endpoint URLs from network traffic.
 * @param network - Network discovery.
 * @returns Discovered URLs object.
 */
function discoverUrls(network: INetworkDiscovery): DiscoveredUrls {
  const acctHit = network.discoverAccountsEndpoint();
  const txnHit = network.discoverTransactionsEndpoint();
  const balHit = network.discoverBalanceEndpoint();
  const pendHit = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.pending);
  const proxyUrl = network.discoverProxyEndpoint();
  return {
    accountsUrl: urlOrFalse(acctHit),
    transactionsUrl: urlOrFalse(txnHit),
    balanceUrl: urlOrFalse(balHit),
    pendingUrl: urlOrFalse(pendHit),
    proxyUrl,
  };
}

/** Late-binding header provider — resolves headers on each call. */
type HeaderProvider = () => Promise<IFetchOpts>;

/**
 * Create a POST fetcher with late-binding headers.
 * @param strategy - Fetch strategy.
 * @param getOpts - Header provider function.
 * @returns Bound POST function.
 */
function createBoundPost(
  strategy: IFetchStrategy,
  getOpts: HeaderProvider,
): IApiFetchContext['fetchPost'] {
  return async <T>(url: string, body: PostData): Promise<Procedure<T>> => {
    const opts = await getOpts();
    return strategy.fetchPost<T>(url, body, opts);
  };
}

/**
 * Create a GET fetcher with late-binding headers.
 * @param strategy - Fetch strategy.
 * @param getOpts - Header provider function.
 * @returns Bound GET function.
 */
function createBoundGet(
  strategy: IFetchStrategy,
  getOpts: HeaderProvider,
): IApiFetchContext['fetchGet'] {
  return async <T>(url: string): Promise<Procedure<T>> => {
    const opts = await getOpts();
    return strategy.fetchGet<T>(url, opts);
  };
}

/**
 * Resolve a config transaction path to a full URL.
 * Absolute paths (https://...) are returned as-is.
 * Relative paths are prepended with the base URL.
 * @param baseUrl - Bank base URL from config.
 * @param path - Transaction API path (absolute or relative).
 * @returns Full transaction URL.
 */
/** Bank URL string. */
type BankUrlStr = string;

/**
 * Resolve a config transaction path to a full URL.
 * @param baseUrl - Bank base URL.
 * @param path - API path.
 * @returns Full URL.
 */
function resolveConfigTxnPath(baseUrl: BankUrlStr, path: BankUrlStr): BankUrlStr {
  if (path.startsWith('http')) return path;
  return `${baseUrl}${path}`;
}

/** Config override for transaction path fallback. */
interface IConfigOverride {
  readonly baseUrl: BankUrlStr;
  readonly transactionsPath?: BankUrlStr;
}

/**
 * Create a late-binding header provider from a network discovery instance.
 * @param network - Network discovery.
 * @returns Header provider function.
 */
function createHeaderProvider(network: INetworkDiscovery): HeaderProvider {
  return (): Promise<IFetchOpts> => network.buildDiscoveredHeaders();
}

/**
 * Build auto-discovered API fetch context from network traffic.
 * @param network - Network discovery.
 * @param strategy - Base fetch strategy.
 * @param configOverride - Optional config fallback for transactionsPath.
 * @returns API fetch context with discovered endpoints.
 */
function buildApiContext(
  network: INetworkDiscovery,
  strategy: IFetchStrategy,
  configOverride?: IConfigOverride,
): Promise<IApiFetchContext> {
  const headerProvider = createHeaderProvider(network);
  const urls = discoverUrls(network);
  const fetchPost = createBoundPost(strategy, headerProvider);
  const fetchGet = createBoundGet(strategy, headerProvider);
  const hasConfigPath = Boolean(configOverride?.transactionsPath);
  const resolvedPath = resolveConfigTxnPath(
    configOverride?.baseUrl ?? '',
    configOverride?.transactionsPath ?? '',
  );
  const configUrlMap: Record<string, string | false> = {
    true: resolvedPath,
    false: false as const,
  };
  const configTxnUrl = configUrlMap[String(hasConfigPath)];
  const ctx: IApiFetchContext = {
    fetchPost,
    fetchGet,
    ...urls,
    configTransactionsUrl: configTxnUrl,
  };
  return Promise.resolve(ctx);
}

export default buildApiContext;
export { buildApiContext };
