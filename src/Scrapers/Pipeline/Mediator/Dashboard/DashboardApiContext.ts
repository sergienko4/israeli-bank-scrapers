/**
 * Dashboard API context builder — auto-discover endpoints from network traffic.
 * Extracted from DashboardNavigation.ts to respect max-lines.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts, IFetchStrategy, PostData } from '../../Strategy/Fetch/FetchStrategy.js';
import { getDebug } from '../../Types/Debug.js';
import { redactUrlFull } from '../../Types/PiiRedactor.js';
import type { IApiFetchContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { INetworkDiscovery } from '../Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';

const LOG = getDebug(import.meta.url);

/** Sentinel emitted on the `api.context` log when no endpoint was bound. */
const NO_CAPTURE_INDEX = 0;

/**
 * PII-safe URL hint for `api.context` log events. Returns the
 * `redactUrlFull` view of a discovered URL, or `'none'` when
 * discovery yielded nothing — keeps the structured field type
 * stable so log queries don't have to handle `false`.
 * @param url - URL string or `false`.
 * @returns Redacted URL or 'none'.
 */
function urlHint(url: string | false): string {
  if (!url) return 'none';
  return redactUrlFull(url);
}

/**
 * Read the per-endpoint `captureIndex` for the `api.context` log.
 * Pulled out of the log-builder to keep the decision branch out of a
 * ternary (the project lints ternaries as a forbidden form). Returns
 * `NO_CAPTURE_INDEX` for both "no endpoint matched" and "endpoint
 * matched but was synthesised without a dump".
 * @param hit - Discovered endpoint or false.
 * @returns The `captureIndex` value, or `NO_CAPTURE_INDEX`.
 */
function captureIndexOf(hit: IDiscoveredEndpoint | false): number {
  if (!hit) return NO_CAPTURE_INDEX;
  return hit.captureIndex ?? NO_CAPTURE_INDEX;
}

/**
 * Extract URL from a discovered endpoint, or false.
 * @param hit - Discovered endpoint or false.
 * @returns URL string or false.
 */
function urlOrFalse(hit: { url: string } | false): string | false {
  if (!hit) return false;
  return hit.url;
}

/** Discovered URL fields in API context (transactions / balance / pending). */
type DiscoveredUrls = Pick<IApiFetchContext, 'transactionsUrl' | 'balanceUrl' | 'pendingUrl'>;

/** Bundled txn-side endpoint discovery hits. */
interface IRawDiscoveryHits {
  readonly txnHit: IDiscoveredEndpoint | false;
  readonly balHit: IDiscoveredEndpoint | false;
  readonly pendHit: IDiscoveredEndpoint | false;
}

/**
 * Probe the network discovery for the three txn-side endpoints.
 * Extracted so {@link discoverUrls} stays inside the LoC cap.
 * @param network - Network discovery.
 * @returns Raw discovery hits for transactions / balance / pending.
 */
function probeDiscoveryHits(network: INetworkDiscovery): IRawDiscoveryHits {
  return {
    txnHit: network.discoverTransactionsEndpoint(),
    balHit: network.discoverBalanceEndpoint(),
    pendHit: network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.pending),
  };
}

/**
 * Build the URL-hint slice of the `api.context` log line.
 * @param urls - URLs derived from discovery hits.
 * @returns Logged URL fields.
 */
function buildUrlHintFields(urls: DiscoveredUrls): Record<string, string> {
  return {
    transactionsUrl: urlHint(urls.transactionsUrl),
    balanceUrl: urlHint(urls.balanceUrl),
    pendingUrl: urlHint(urls.pendingUrl),
  };
}

/**
 * Build the capture-index slice of the `api.context` log line.
 * @param hits - Raw discovery hits.
 * @returns Logged capture-index fields.
 */
function buildCaptureIndexFields(hits: IRawDiscoveryHits): Record<string, number> {
  return {
    transactionsCapture: captureIndexOf(hits.txnHit),
    balanceCapture: captureIndexOf(hits.balHit),
    pendingCapture: captureIndexOf(hits.pendHit),
  };
}

/**
 * Emit the structured `api.context` log line for a set of raw hits +
 * the URLs they resolved to. Pulled out so {@link discoverUrls} keeps
 * to the ≤10 LoC body cap.
 * @param hits - Raw discovery hits.
 * @param urls - URLs (or false) derived from those hits.
 * @returns Always true — the log call returns void.
 */
function logApiContextDiscovery(hits: IRawDiscoveryHits, urls: DiscoveredUrls): true {
  LOG.debug({
    event: 'api.context',
    ...buildUrlHintFields(urls),
    ...buildCaptureIndexFields(hits),
  });
  return true;
}

/**
 * Discovers transaction-side endpoint URLs from captured traffic.
 *
 * <p>Phase 7c removed the `accountsUrl` field from
 * {@link IApiFetchContext}: account discovery is owned by
 * ACCOUNT-RESOLVE, so DASHBOARD's API context publishes only the
 * txn-side URLs (transactions, balance, pending). The structured
 * `api.context` log mirrors the surviving fields.
 *
 * @param network - Network discovery.
 * @returns Discovered URLs object.
 */
function discoverUrls(network: INetworkDiscovery): DiscoveredUrls {
  const hits = probeDiscoveryHits(network);
  const urls: DiscoveredUrls = {
    transactionsUrl: urlOrFalse(hits.txnHit),
    balanceUrl: urlOrFalse(hits.balHit),
    pendingUrl: urlOrFalse(hits.pendHit),
  };
  logApiContextDiscovery(hits, urls);
  return urls;
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
/**
 * Resolve a config transaction path to a full URL.
 * @param baseUrl - Bank base URL.
 * @param path - API path.
 * @returns Full URL.
 */
function resolveConfigTxnPath(baseUrl: string, path: string): string {
  if (path.startsWith('http')) return path;
  return `${baseUrl}${path}`;
}

/** Config override for transaction path fallback. */
interface IConfigOverride {
  readonly baseUrl: string;
  readonly transactionsPath?: string;
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
 * Resolve the optional config-fallback transactions URL from an
 * {@link IConfigOverride}. Returns `false` when no override is
 * provided or `transactionsPath` is empty.
 * @param configOverride - Optional config fallback.
 * @returns Resolved URL or false.
 */
function resolveConfigTxnUrl(configOverride?: IConfigOverride): string | false {
  if (!configOverride?.transactionsPath) return false;
  return resolveConfigTxnPath(configOverride.baseUrl, configOverride.transactionsPath);
}

/**
 * Compose the bound fetcher pair (GET + POST) that share the
 * supplied late-binding header provider.
 * @param strategy - Fetch strategy.
 * @param headerProvider - Late-binding header provider.
 * @returns Pair of bound fetcher functions for the API context.
 */
function composeBoundFetchers(
  strategy: IFetchStrategy,
  headerProvider: HeaderProvider,
): Pick<IApiFetchContext, 'fetchGet' | 'fetchPost'> {
  return {
    fetchPost: createBoundPost(strategy, headerProvider),
    fetchGet: createBoundGet(strategy, headerProvider),
  };
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
  const fetchers = composeBoundFetchers(strategy, headerProvider);
  const configTxnUrl = resolveConfigTxnUrl(configOverride);
  const ctx: IApiFetchContext = { ...fetchers, ...urls, configTransactionsUrl: configTxnUrl };
  return Promise.resolve(ctx);
}

export default buildApiContext;
export { buildApiContext };
