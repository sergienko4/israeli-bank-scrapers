/**
 * Scrape phase — fetches accounts + transactions.
 * Supports three modes:
 *   1. GenericAutoScrape — no bank code: uses ctx.api + WellKnown
 *   2. IScrapeConfig — bank provides URLs + mappers
 *   3. CustomScrapeFn — bank provides full function
 */

import moment from 'moment';

import { getDebug } from '../../../Common/Debug.js';
import { extractAccountIds, extractAccountRecords } from '../Mediator/GenericScrapeStrategy.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import { some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IApiFetchContext, IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { isOk, succeed } from '../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfig } from '../Types/ScrapeConfig.js';
import { fetchAllAccounts } from './ScrapeAccountHelpers.js';
import { executeScrape } from './ScrapeExecutor.js';
import { applyGlobalDateFilter, parseStartDate, rateLimitPause } from './ScrapeFetchHelpers.js';
import type { ApiPayload, IAccountFetchCtx, IFetchAllAccountsCtx } from './ScrapeTypes.js';

const LOG = getDebug('scrape-phase');

// ── Generic Auto-Scrape (ZERO bank code) ─────────────────

/**
 * Fetch using the discovered endpoint's method.
 * @param api - API fetch context with headers.
 * @param endpoint - Discovered endpoint.
 * @returns Procedure with response body.
 */
async function fetchDiscovered<T>(
  api: IApiFetchContext,
  endpoint: IDiscoveredEndpoint,
): Promise<Procedure<T>> {
  if (endpoint.method === 'POST') {
    const rawBody = endpoint.postData || '{}';
    const body = JSON.parse(rawBody) as Record<string, string>;
    return api.fetchPost<T>(endpoint.url, body);
  }
  return api.fetchGet<T>(endpoint.url);
}

/**
 * Discover accounts endpoint and fetch raw data.
 * @param api - Unwrapped API fetch context.
 * @param network - Unwrapped network discovery.
 * @returns Raw accounts Procedure or failure.
 */
async function discoverAndFetchAccounts(
  api: IApiFetchContext,
  network: INetworkDiscovery,
): Promise<Procedure<ApiPayload>> {
  const endpoint = network.discoverAccountsEndpoint();
  if (!endpoint) return succeed({});
  return fetchDiscovered<ApiPayload>(api, endpoint);
}

/**
 * Build fetch-all context from unwrapped dependencies.
 * @param fc - Account fetch context.
 * @param network - Network discovery.
 * @param rawAccounts - Raw accounts response data.
 * @returns Bundled fetch-all context.
 */
function buildFetchAllCtx(
  fc: IAccountFetchCtx,
  network: INetworkDiscovery,
  rawAccounts: Record<string, unknown>,
): IFetchAllAccountsCtx {
  const ids = extractAccountIds(rawAccounts);
  const records = extractAccountRecords(rawAccounts);
  const txnEndpoint = network.discoverTransactionsEndpoint();
  logTxnEndpoint(txnEndpoint);
  return { fc, ids, records, txnEndpoint };
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
 * Generic auto-scrape — discovers accounts + transactions.
 * @param ctx - Pipeline context with ctx.api injected.
 * @returns Updated context with scraped accounts.
 */
async function genericAutoScrape(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!ctx.api.has) return succeed(ctx);
  if (!ctx.mediator.has) return succeed(ctx);
  const api = ctx.api.value;
  const network = ctx.mediator.value.network;
  const rawAccounts = await discoverAndFetchAccounts(api, network);
  if (!isOk(rawAccounts)) return rawAccounts;
  await rateLimitPause(500);
  const startDate = moment(ctx.options.startDate).format('YYYYMMDD');
  const fc: IAccountFetchCtx = { api, network, startDate };
  const fetchCtx = buildFetchAllCtx(fc, network, rawAccounts.value);
  const accounts = await fetchAllAccounts(fetchCtx);
  const startMs = parseStartDate(startDate).getTime();
  applyGlobalDateFilter(accounts, startMs);
  return succeed({ ...ctx, scrape: some({ accounts: [...accounts] }) });
}

// ── Step factories ───────────────────────────────────────

/**
 * Create a scrape step from IScrapeConfig.
 * @param config - The bank's scrape configuration.
 * @returns A pipeline step that fetches transactions.
 */
function createConfigScrapeStep<TA, TT>(
  config: IScrapeConfig<TA, TT>,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => executeScrape(input, config),
  };
}

/**
 * Create a scrape step from a custom function.
 * @param scrapeFn - The bank's custom scrape function.
 * @returns A pipeline step for scraping.
 */
function createCustomScrapeStep(
  scrapeFn: CustomScrapeFn,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => scrapeFn(input),
  };
}

/**
 * Default auto-scrape execute handler.
 * @param _ctx - Unused.
 * @param input - Pipeline context with ctx.api.
 * @returns Updated context with scraped accounts.
 */
function autoScrapeExecute(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  return genericAutoScrape(input);
}

/** Default auto-scrape step. */
const SCRAPE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape',
  execute: autoScrapeExecute,
};

export type { CustomScrapeFn } from '../Types/ScrapeConfig.js';
export default SCRAPE_STEP;
export { createConfigScrapeStep, createCustomScrapeStep, genericAutoScrape, SCRAPE_STEP };
