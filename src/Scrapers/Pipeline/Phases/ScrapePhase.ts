/**
 * Scrape phase — fetches accounts + transactions.
 * Supports three modes:
 *   1. GenericAutoScrape — no bank code: uses ctx.api + WellKnown
 *   2. IScrapeConfig — bank provides URLs + mappers
 *   3. CustomScrapeFn — bank provides full function
 */

import moment from 'moment';

import type { IElementMediator } from '../Mediator/ElementMediator.js';
import {
  extractAccountIds,
  extractAccountRecords,
  findFieldValue,
} from '../Mediator/GenericScrapeStrategy.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../Registry/PipelineWellKnown.js';
import { getDebug } from '../Types/Debug.js';
import { some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IApiFetchContext, IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { isOk, succeed } from '../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfig } from '../Types/ScrapeConfig.js';
import { SimplePhase } from '../Types/SimplePhase.js';
import { fetchAllAccounts } from './ScrapeAccountHelpers.js';
import { executeScrape } from './ScrapeExecutor.js';
import { applyGlobalDateFilter, parseStartDate, rateLimitPause } from './ScrapeFetchHelpers.js';
import type { ApiPayload, IAccountFetchCtx, IFetchAllAccountsCtx } from './ScrapeTypes.js';

/** Internal account ID used for billing API calls. */
type FallbackAccountId = string;
/** URL origin string for SPA/API host comparison. */
type OriginStr = string;
/** Whether the SPA pivot navigation completed (or was skipped). */
type PivotDone = boolean;

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
  let ids = extractAccountIds(rawAccounts);
  let records = extractAccountRecords(rawAccounts);
  const txnEndpoint = network.discoverTransactionsEndpoint();
  logTxnEndpoint(txnEndpoint);
  const fallback = records.length === 0 && tryPostBodyFallback(txnEndpoint);
  if (fallback) {
    ids = fallback.ids;
    records = fallback.records;
  }
  return { fc, ids, records, txnEndpoint };
}

/** Parsed POST body with account info for fallback. */
interface IPostBodyFallback {
  readonly accountId: FallbackAccountId;
  readonly record: ApiPayload;
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
 * Extract card ID from a nested cards array in a POST body.
 * Handles pattern: { cards: [{ cardUniqueID: "..." }] }
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

/** Timeout for SPA pivot navigation (ms). */
const SPA_PIVOT_TIMEOUT_MS = 15_000;

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
 * This ensures page.evaluate(fetch) has the right cookies + CORS context.
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
 * Generic auto-scrape — discovers accounts + transactions.
 * @param ctx - Pipeline context with ctx.api injected.
 * @returns Updated context with scraped accounts.
 */
async function genericAutoScrape(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!ctx.api.has) return succeed(ctx);
  if (!ctx.mediator.has) return succeed(ctx);
  if (!ctx.browser.has) return succeed(ctx);
  const api = ctx.api.value;
  const network = ctx.mediator.value.network;
  await pivotToSpaIfNeeded(ctx.mediator.value, network);
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
    execute: async (_ctx, input): Promise<Procedure<IPipelineContext>> =>
      await executeScrape(input, config),
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

// ── PRE/POST steps for phase structure ────────────────────

/**
 * SCRAPE PRE step — validate dependencies + update diagnostics.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.
 */
/**
 * SCRAPE PRE step — pure diagnostics. DASHBOARD already primed the pump.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.
 */
function scrapePreDiagnostics(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const nowMs = Date.now();
  const fetchStartMs = some(nowMs);
  const updatedDiag = { ...input.diagnostics, fetchStartMs, lastAction: 'scrape-pre' };
  const result = succeed({ ...input, diagnostics: updatedDiag });
  return Promise.resolve(result);
}

/** SCRAPE PRE step. */
const SCRAPE_PRE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape-pre',
  execute: scrapePreDiagnostics,
};

/**
 * SCRAPE POST step — update diagnostics after scraping.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context after scraping.
 * @returns Updated context with diagnostics.
 */
function scrapePostDiagnostics(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const accountCount = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const countStr = String(accountCount);
  const updatedDiag = { ...input.diagnostics, lastAction: `scrape-post (${countStr} accounts)` };
  const result = succeed({ ...input, diagnostics: updatedDiag });
  return Promise.resolve(result);
}

/** SCRAPE POST step. */
const SCRAPE_POST_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape-post',
  execute: scrapePostDiagnostics,
};

/**
 * Create the full SCRAPE phase as a BasePhase with PRE/ACTION/POST.
 * @param actionExec - Optional custom action execute function (default: auto-scrape).
 * @returns ScrapePhase extending SimplePhase with pre/post overrides.
 */
function createScrapePhase(
  actionExec: IPipelineStep<IPipelineContext, IPipelineContext>['execute'] = autoScrapeExecute,
): SimplePhase {
  /** Scrape phase with PRE and POST diagnostics hooks. */
  class ScrapePhaseImpl extends SimplePhase {
    /**
     * PRE: validate dependencies + update diagnostics.
     * @param _ctx - Unused.
     * @param input - Pipeline context.
     * @returns Updated context.
     */
    public async pre(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return scrapePreDiagnostics(_ctx, input);
    }

    /**
     * POST: update diagnostics after scraping.
     * @param _ctx - Unused.
     * @param input - Pipeline context.
     * @returns Updated context.
     */
    public async post(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return scrapePostDiagnostics(_ctx, input);
    }

    /**
     * FINAL: stamp account count into diagnostics for audit trail.
     * Does NOT fail on zero accounts — some date ranges legitimately return empty.
     * @param _ctx - Unused.
     * @param input - Pipeline context with scrape state.
     * @returns Updated context with lastAction diagnostic.
     */
    public final(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      const count = (input.scrape.has && input.scrape.value.accounts.length) || 0;
      const label = `scrape-final (${String(count)} accounts)`;
      const updatedDiag = { ...input.diagnostics, lastAction: label };
      const result = succeed({ ...input, diagnostics: updatedDiag });
      return Promise.resolve(result);
    }
  }
  return new ScrapePhaseImpl('scrape', actionExec);
}

export type { CustomScrapeFn } from '../Types/ScrapeConfig.js';
export default SCRAPE_STEP;
export {
  createConfigScrapeStep,
  createCustomScrapeStep,
  createScrapePhase,
  genericAutoScrape,
  SCRAPE_POST_STEP,
  SCRAPE_PRE_STEP,
  SCRAPE_STEP,
};
