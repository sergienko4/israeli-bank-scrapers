/**
 * Generic auto-scrape strategy — zero bank code path.
 * Uses ctx.api + WellKnown for organic endpoint discovery.
 */

import moment from 'moment';

import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../Mediator/Network/NetworkDiscovery.js';
import {
  extractAccountIds,
  extractAccountRecords,
  findFieldValue,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../Registry/WK/ScrapeWK.js';
import { scrapeAllAccounts } from '../../Strategy/Scrape/Account/ScrapeDispatch.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import type { IApiFetchContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { hasProxyStrategy, proxyScrape } from './Proxy/ProxyScrapeReplayStrategy.js';
import { applyGlobalDateFilter, parseStartDate, rateLimitPause } from './ScrapeDataActions.js';
import type { ApiPayload, IAccountFetchCtx, IFetchAllAccountsCtx } from './ScrapeTypes.js';

/** Internal account ID used for billing API calls. */
type FallbackAccountId = string;
/** URL origin string for SPA/API host comparison. */
type OriginStr = string;
/** Whether the SPA pivot navigation completed (or was skipped). */
type PivotDone = boolean;

const LOG = createLogger('scrape-phase');

/** Timeout for SPA pivot navigation (ms). */
const SPA_PIVOT_TIMEOUT_MS = 15_000;

/**
 * Load data using the discovered endpoint's method (buffered or re-fetch).
 * @param api - API fetch context with headers.
 * @param endpoint - Discovered endpoint.
 * @returns Procedure with response body.
 */
async function loadDiscovered<T>(
  api: IApiFetchContext,
  endpoint: IDiscoveredEndpoint,
): Promise<Procedure<T>> {
  if (endpoint.responseBody) {
    LOG.debug('[SCRAPE] Using buffered response from NetworkStore (0ms network cost)');
    return succeed(endpoint.responseBody as T);
  }
  LOG.debug('[SCRAPE] Re-loading %s %s', endpoint.method, endpoint.url);
  if (endpoint.method === 'POST') {
    const rawBody = endpoint.postData || '{}';
    const body = JSON.parse(rawBody) as Record<string, string>;
    return api.fetchPost<T>(endpoint.url, body);
  }
  return api.fetchGet<T>(endpoint.url);
}

/**
 * Discover accounts endpoint and load raw data.
 * @param api - Unwrapped API fetch context.
 * @param network - Unwrapped network discovery.
 * @returns Raw accounts Procedure or failure.
 */
async function discoverAndLoadAccounts(
  api: IApiFetchContext,
  network: INetworkDiscovery,
): Promise<Procedure<ApiPayload>> {
  const endpoint = network.discoverAccountsEndpoint();
  if (!endpoint) return succeed({});
  return loadDiscovered<ApiPayload>(api, endpoint);
}

/** Parsed POST body with account info for fallback. */
interface IPostBodyFallback {
  readonly accountId: FallbackAccountId;
  readonly record: ApiPayload;
}

/**
 * Extract card ID from a nested cards array in a POST body.
 * @param body - Parsed POST body.
 * @returns Card ID string or false.
 */
function extractCardIdFromArray(body: Record<string, unknown>): string | false {
  const cards = body.cards ?? body.Cards;
  if (!Array.isArray(cards) || cards.length === 0) return false;
  const first = cards[0] as Record<string, unknown>;
  const cardId = findFieldValue(first, WK.queryId);
  if (!cardId) return false;
  return String(cardId);
}

/**
 * Resolve account ID from parsed POST body (card array or top-level).
 * @param body - Parsed POST body.
 * @returns Account ID and record, or false.
 */
function resolveAccountFromBody(body: ApiPayload): IPostBodyFallback | false {
  const cardId = extractCardIdFromArray(body);
  if (cardId) {
    LOG.debug('account fallback: cardId=%s from cards array', cardId);
    return { accountId: cardId, record: body };
  }
  const rawId = findFieldValue(body, WK.queryId);
  if (!rawId) return false;
  const accountId = String(rawId);
  LOG.debug('account fallback: accountId=%s from top level', accountId);
  return { accountId, record: body };
}

/**
 * Extract account ID from captured POST body when accounts endpoint returns 0.
 * @param postData - Captured POST body string.
 * @returns Account record or false.
 */
function extractAccountFromPostBody(postData: string): IPostBodyFallback | false {
  try {
    const body = JSON.parse(postData) as ApiPayload;
    return resolveAccountFromBody(body);
  } catch {
    return false;
  }
}

/**
 * Try POST body fallback when no accounts found from endpoint.
 * @param txnEndpoint - Transaction endpoint.
 * @returns Fallback IDs and records, or false.
 */
function tryPostBodyFallback(
  txnEndpoint: IDiscoveredEndpoint | false,
): { readonly ids: string[]; readonly records: ApiPayload[] } | false {
  if (!txnEndpoint || !txnEndpoint.postData) return false;
  const fallback = extractAccountFromPostBody(txnEndpoint.postData);
  if (!fallback) return false;
  LOG.debug('account fallback from POST body: %s', fallback.accountId);
  return { ids: [fallback.accountId], records: [fallback.record] };
}

/**
 * Log discovered transaction endpoint info.
 * @param ep - Endpoint or false.
 * @returns The same endpoint passthrough.
 */
function logTxnEndpoint(ep: IDiscoveredEndpoint | false): IDiscoveredEndpoint | false {
  if (ep) {
    LOG.debug('autoScrape: txnEndpoint=%s method=%s', ep.url, ep.method);
    return ep;
  }
  LOG.debug('autoScrape: txnEndpoint=NONE method=NONE');
  return ep;
}

/**
 * Build fetch-all context from unwrapped dependencies.
 * @param fc - Account fetch context.
 * @param network - Network discovery.
 * @param rawAccounts - Raw accounts response data.
 * @returns Bundled fetch-all context.
 */
function buildLoadAllCtx(
  fc: IAccountFetchCtx,
  network: INetworkDiscovery,
  rawAccounts: Record<string, unknown>,
): IFetchAllAccountsCtx {
  let ids = extractAccountIds(rawAccounts);
  let records = extractAccountRecords(rawAccounts);
  const txnEndpoint = network.discoverTransactionsEndpoint();
  logTxnEndpoint(txnEndpoint);
  const hasMissingData = ids.length === 0 || records.length === 0;
  const fallback = hasMissingData && tryPostBodyFallback(txnEndpoint);
  if (fallback) {
    ids = fallback.ids;
    records = fallback.records;
  }
  return { fc, ids, records, txnEndpoint };
}

/**
 * Apply credential-based fallback when account IDs are empty but txn buffer exists.
 * @param loadCtx - The load-all context from buildLoadAllCtx.
 * @param ctx - Pipeline context with credentials.
 * @returns Updated context with credential-based ID, or unchanged.
 */
function applyCredentialFallback(
  loadCtx: IFetchAllAccountsCtx,
  ctx: IPipelineContext,
): IFetchAllAccountsCtx {
  if (loadCtx.ids.length > 0) return loadCtx;
  if (!loadCtx.txnEndpoint || !loadCtx.txnEndpoint.responseBody) return loadCtx;
  const creds = ctx.credentials as Record<string, string>;
  const cardId = creds.card6Digits || 'default';
  LOG.debug('[SCRAPE] ids empty — using credential card6Digits=%s', cardId);
  const records = [loadCtx.txnEndpoint.responseBody as Record<string, unknown>];
  return { ...loadCtx, ids: [cardId], records };
}

/**
 * Check if the current page already hosts the transaction endpoint.
 * @param network - Network discovery.
 * @param currentOrigin - Current page origin.
 * @returns True if current origin hosts the txn endpoint.
 */
function isTxnHostedOnCurrentOrigin(
  network: INetworkDiscovery,
  currentOrigin: OriginStr,
): PivotDone {
  const txnEndpoint = network.discoverTransactionsEndpoint();
  if (!txnEndpoint) return false;
  return new URL(txnEndpoint.url).origin === currentOrigin;
}

/**
 * SPA pivot: navigate to the SPA origin if the API traffic came from a different domain.
 * @param mediator - Element mediator for navigation and URL access.
 * @param network - Network discovery with captured traffic.
 * @returns True after pivot check completes.
 */
async function pivotToSpaIfNeeded(
  mediator: IElementMediator,
  network: INetworkDiscovery,
): Promise<Procedure<boolean>> {
  const spaUrl = network.discoverSpaUrl();
  if (!spaUrl) return succeed(false);
  const currentOrigin = new URL(mediator.getCurrentUrl()).origin;
  const spaOrigin = new URL(spaUrl).origin;
  if (currentOrigin === spaOrigin) return succeed(false);
  if (isTxnHostedOnCurrentOrigin(network, currentOrigin)) {
    LOG.debug('SPA pivot: skip — current origin %s hosts txn endpoint', currentOrigin);
    return succeed(false);
  }
  LOG.debug('SPA pivot: %s → %s', currentOrigin, spaOrigin);
  const opts = { waitUntil: 'domcontentloaded' as const, timeout: SPA_PIVOT_TIMEOUT_MS };
  await mediator.navigateTo(spaUrl, opts);
  return succeed(true);
}

/**
 * Generic auto-scrape — routes to proxy or legacy path.
 * @param ctx - Pipeline context.
 * @returns Updated context with scraped accounts.
 */
async function genericAutoScrape(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (hasProxyStrategy()) return proxyScrape(ctx);
  if (!ctx.api.has) return succeed(ctx);
  if (!ctx.mediator.has) return succeed(ctx);
  if (!ctx.browser.has) return succeed(ctx);
  const api = ctx.api.value;
  const network = ctx.mediator.value.network;
  await pivotToSpaIfNeeded(ctx.mediator.value, network);
  const rawAccounts = await discoverAndLoadAccounts(api, network);
  if (!isOk(rawAccounts)) return rawAccounts;
  await rateLimitPause(500);
  const startDate = moment(ctx.options.startDate).format('YYYYMMDD');
  const fc: IAccountFetchCtx = { api, network, startDate };
  let loadCtx = buildLoadAllCtx(fc, network, rawAccounts.value);
  loadCtx = applyCredentialFallback(loadCtx, ctx);
  const idCount = String(loadCtx.ids.length);
  const recCount = String(loadCtx.records.length);
  process.stderr.write(
    `[SCRAPE.ACTION] GenericAutoScrape: ${idCount} accounts, ${recCount} records\n`,
  );
  const accounts = await scrapeAllAccounts(loadCtx);
  const startMs = parseStartDate(startDate).getTime();
  applyGlobalDateFilter(accounts, startMs);
  const acctCount = String(accounts.length);
  const totalTxns = accounts.reduce((sum, a) => sum + a.txns.length, 0);
  const txnCount = String(totalTxns);
  process.stderr.write(`[SCRAPE.ACTION] Result: ${acctCount} accounts, ${txnCount} txns\n`);
  return succeed({ ...ctx, scrape: some({ accounts: [...accounts] }) });
}

export { genericAutoScrape, loadDiscovered };
