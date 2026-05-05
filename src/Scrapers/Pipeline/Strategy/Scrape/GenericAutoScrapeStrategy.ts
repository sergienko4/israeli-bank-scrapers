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
import { harvestAccountsFromStorage } from '../../Mediator/Scrape/AccountBootstrap.js';
import {
  extractAccountIds,
  extractAccountRecords,
  findContainerArray,
  findFieldValue,
  isUsableIdentifier,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { waitUntil } from '../../Mediator/Timing/Waiting.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../Registry/WK/ScrapeWK.js';
import { scrapeAllAccounts } from '../../Strategy/Scrape/Account/ScrapeDispatch.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import { redactAccount } from '../../Types/PiiRedactor.js';
import type { IApiFetchContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { getFutureMonths } from '../../Types/ScraperDefaults.js';
import { applyGlobalDateFilter, parseStartDate, rateLimitPause } from './ScrapeDataActions.js';
import type { ApiPayload, IAccountFetchCtx, IFetchAllAccountsCtx } from './ScrapeTypes.js';

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
    LOG.debug({
      message: 'Using buffered response (0ms network cost)',
    });
    return succeed(endpoint.responseBody as T);
  }
  LOG.debug({
    message: `Re-loading ${endpoint.method} ${maskVisibleText(endpoint.url)}`,
  });
  if (endpoint.method === 'POST') {
    const rawBody = endpoint.postData || '{}';
    const body = JSON.parse(rawBody) as Record<string, string>;
    return api.fetchPost<T>(endpoint.url, body);
  }
  return api.fetchGet<T>(endpoint.url);
}

/**
 * Returns the captured endpoint whose responseBody carries a non-empty
 * named-container of account-shaped records (cardsList / cards /
 * accounts / bankAccounts), or false. Used as a fallback when the
 * URL-pattern match (e.g. accountSummary) returns a body that lacks the
 * primary account list — Beinleumi's accountSummary holds linked credit
 * cards and a recent-txn preview, while the real account list lives on
 * a separate userData endpoint.
 * @param network - frozen or live network discovery.
 * @returns endpoint with a usable account container, or false.
 */
function findEndpointWithAccountContainer(network: INetworkDiscovery): IDiscoveredEndpoint | false {
  const endpoints = network.getAllEndpoints();
  const hit = endpoints.find((ep): boolean => {
    if (!ep.responseBody) return false;
    const body = ep.responseBody as ApiPayload;
    const records = findContainerArray(body, [...WK.accountContainers]);
    return records.length > 0;
  });
  return hit ?? false;
}

/**
 * Returns true when a captured response body holds a non-empty
 * `WK.accountContainers` array of account-shaped records.
 * @param body - parsed response body.
 * @returns true when an account container is present.
 */
function bodyHasAccountContainer(body: ApiPayload): boolean {
  const records = findContainerArray(body, [...WK.accountContainers]);
  return records.length > 0;
}

/** Maximum time the post-fast-path poll waits before giving up. */
const ACCOUNTS_POLL_BUDGET_MS = 3000;
/** Delay between poll iterations during the post-fast-path wait. */
const ACCOUNTS_POLL_INTERVAL_MS = 500;
/** Terminal-state sentinel: container endpoint discovered within the budget. */
const POLL_SUCCESS = 'success';
/** Terminal-state sentinel: budget exhausted without a container hit. */
const POLL_TIMEOUT = 'timeout';
/** Outcome marker carried on the poll result. */
type PollOutcome = typeof POLL_SUCCESS | typeof POLL_TIMEOUT;

/** Result returned by {@link pollForAccountEndpoint}. */
interface IPollResult {
  readonly outcome: PollOutcome;
  /** The discovered endpoint when {@link outcome} is {@link POLL_SUCCESS}. */
  readonly endpoint: IDiscoveredEndpoint | false;
  /** Wall-clock ms from poll start to terminal state. */
  readonly waitedMs: number;
}

/**
 * Returns the first captured endpoint that satisfies any of the four
 * discovery tiers (URL match, container match, URL fallback, content
 * match). Shared between the fast path and the post-wait retry so both
 * apply identical match rules.
 * @param network - Live or frozen network discovery.
 * @returns The matched endpoint, or `false` when no tier hits.
 */
function tryDiscoverAccounts(network: INetworkDiscovery): IDiscoveredEndpoint | false {
  const byUrl = network.discoverAccountsEndpoint();
  if (byUrl && bodyHasAccountContainer(byUrl.responseBody as ApiPayload)) return byUrl;
  const byContainer = findEndpointWithAccountContainer(network);
  if (byContainer) return byContainer;
  if (byUrl) return byUrl;
  const byContent = network.discoverEndpointByContent([...WK.accountId]);
  if (byContent) return byContent;
  return false;
}

/**
 * Returns a predicate suitable for {@link waitUntil} that retries
 * {@link tryDiscoverAccounts} on each tick. Emits a per-tick log line so
 * the race window between scrape.PRE entry and late-arriving SPA
 * captures is visible in pipeline.log.
 * @param network - Live network discovery.
 * @returns Predicate that resolves with a hit or `false` to keep polling.
 */
function buildPollPredicate(
  network: INetworkDiscovery,
): () => Promise<IDiscoveredEndpoint | false> {
  return (): Promise<IDiscoveredEndpoint | false> => {
    const endpointCount = network.getAllEndpoints().length;
    const hit = tryDiscoverAccounts(network);
    LOG.debug({
      message: 'auto-discover: poll-tick',
      endpointCount,
      hit: hit !== false,
    });
    return Promise.resolve(hit);
  };
}

/**
 * Waits for an account-bearing endpoint to appear in the live network
 * feed, bounded by {@link ACCOUNTS_POLL_BUDGET_MS}. Generic across banks:
 * delegates to the cross-bank {@link waitUntil} primitive and the
 * cross-bank `WK.accountContainers` dictionary — no per-bank
 * configuration.
 * @param network - Live network discovery; must NOT be frozen.
 * @returns Outcome + endpoint (when found) + wall-clock waitedMs.
 */
async function pollForAccountEndpoint(network: INetworkDiscovery): Promise<IPollResult> {
  const startMs = Date.now();
  const predicate = buildPollPredicate(network);
  const result = await waitUntil(predicate, 'auto-discover poll', {
    timeout: ACCOUNTS_POLL_BUDGET_MS,
    interval: ACCOUNTS_POLL_INTERVAL_MS,
  })
    .then(
      (endpoint: IDiscoveredEndpoint | false): IPollResult => ({
        outcome: POLL_SUCCESS,
        endpoint,
        waitedMs: Date.now() - startMs,
      }),
    )
    .catch(
      (): IPollResult => ({
        outcome: POLL_TIMEOUT,
        endpoint: false,
        waitedMs: Date.now() - startMs,
      }),
    );
  return result;
}

/**
 * Resolves the accounts-bearing endpoint and returns its parsed body.
 *
 * <p>Tries the fast path first. On a fast-path miss with a non-empty
 * capture set, polls the live network for up to
 * {@link ACCOUNTS_POLL_BUDGET_MS} for a container endpoint to arrive —
 * fixes the race where `api/registered/*` responses land just after
 * scrape.PRE entry on slower CI runners.
 *
 * <p>Each terminal state emits a single log line so triage is possible
 * from pipeline.log alone:
 * <ul>
 *   <li>`auto-discover: fast-path hit`     — already captured</li>
 *   <li>`auto-discover: zero captures`     — prior phase broken</li>
 *   <li>`auto-discover: poll succeeded`    — race resolved</li>
 *   <li>`auto-discover: poll timed out`    — escalate elsewhere</li>
 * </ul>
 *
 * @param api - API fetch context.
 * @param network - Live network discovery; freeze happens in the caller.
 * @returns Parsed accounts body, or `succeed({})` when nothing matches.
 */
async function discoverAndLoadAccounts(
  api: IApiFetchContext,
  network: INetworkDiscovery,
): Promise<Procedure<ApiPayload>> {
  const fast = tryDiscoverAccounts(network);
  if (fast) {
    LOG.debug({
      message: 'auto-discover: fast-path hit',
      endpoint: maskVisibleText(fast.url),
    });
    return loadDiscovered<ApiPayload>(api, fast);
  }
  const epsAtStart = network.getAllEndpoints().length;
  if (epsAtStart === 0) {
    LOG.warn({
      message: 'auto-discover: zero captures — prior phase issue, skipping wait',
    });
    return succeed({});
  }
  LOG.debug({
    message: 'auto-discover: container not yet captured — polling',
    endpointsAtStart: epsAtStart,
    budgetMs: ACCOUNTS_POLL_BUDGET_MS,
  });
  const polled = await pollForAccountEndpoint(network);
  if (polled.outcome === POLL_SUCCESS && polled.endpoint) {
    LOG.debug({
      message: 'auto-discover: poll succeeded',
      endpoint: maskVisibleText(polled.endpoint.url),
      waitedMs: polled.waitedMs,
    });
    return loadDiscovered<ApiPayload>(api, polled.endpoint);
  }
  LOG.warn({
    message: 'auto-discover: poll timed out — falling through to credential default',
    waitedMs: polled.waitedMs,
  });
  return succeed({});
}

/** Parsed POST body with account info for fallback. */
interface IPostBodyFallback {
  readonly accountId: string;
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
    LOG.debug({
      message: `account fallback: cardId=${cardId} from cards array`,
    });
    return { accountId: cardId, record: body };
  }
  const rawId = findFieldValue(body, WK.queryId);
  if (!rawId) return false;
  const accountId = String(rawId);
  const acctLabel = redactAccount(accountId);
  LOG.debug({
    message: `account fallback: account=${acctLabel} from top level`,
  });
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
  if (txnEndpoint === false) return false;
  if (!txnEndpoint.postData) return false;
  const fallback = extractAccountFromPostBody(txnEndpoint.postData);
  if (!fallback) return false;
  const acctLabel = redactAccount(fallback.accountId);
  LOG.debug({
    message: `account fallback from POST body: ${acctLabel}`,
  });
  return { ids: [fallback.accountId], records: [fallback.record] };
}

/**
 * Log discovered transaction endpoint info.
 * @param ep - Endpoint or false.
 * @returns The same endpoint passthrough.
 */
function logTxnEndpoint(ep: IDiscoveredEndpoint | false): IDiscoveredEndpoint | false {
  if (ep) {
    LOG.debug({
      message: `autoScrape: txnEndpoint=${maskVisibleText(ep.url)} method=${ep.method}`,
    });
    return ep;
  }
  LOG.debug({
    message: 'autoScrape: txnEndpoint=NONE method=NONE',
  });
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
 * Promote a usable `creds.card6Digits` into the load context when
 * extraction produced no identifiers. Returns the context unchanged
 * (ids stay empty) when the credential is missing or doesn't pass
 * {@link isUsableIdentifier} — downstream callers must then fail-fast
 * rather than silently scrape with a sentinel like `'default'`, which
 * always produces 0-txn results and a misleading `success: true`.
 *
 * @param loadCtx - Load-all context from {@link buildLoadAllCtx}.
 * @param ctx - Pipeline context (carries credentials).
 * @returns Context with credential-promoted id, or the original
 *   context with ids still empty.
 */
function applyCredentialFallback(
  loadCtx: IFetchAllAccountsCtx,
  ctx: IPipelineContext,
): IFetchAllAccountsCtx {
  if (loadCtx.ids.length > 0) return loadCtx;
  if (loadCtx.txnEndpoint === false) return loadCtx;
  if (!loadCtx.txnEndpoint.responseBody) return loadCtx;
  const creds = ctx.credentials as Record<string, string>;
  const cardId = creds.card6Digits;
  if (typeof cardId !== 'string' || !isUsableIdentifier(cardId)) {
    LOG.warn({
      message: 'ids empty + no usable card6Digits credential — caller must fail-fast',
    });
    return loadCtx;
  }
  LOG.debug({
    message: `ids empty — using credential card6Digits=${cardId}`,
  });
  const records = [loadCtx.txnEndpoint.responseBody as Record<string, unknown>];
  return { ...loadCtx, ids: [cardId], records };
}

/**
 * Check if the current page already hosts the transaction endpoint.
 * @param network - Network discovery.
 * @param currentOrigin - Current page origin.
 * @returns True if current origin hosts the txn endpoint.
 */
function isTxnHostedOnCurrentOrigin(network: INetworkDiscovery, currentOrigin: string): boolean {
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
    LOG.debug({
      message:
        'SPA pivot: skip — current origin ' +
        `${maskVisibleText(currentOrigin)} hosts txn endpoint`,
    });
    return succeed(false);
  }
  LOG.debug({
    message: `SPA pivot: ${maskVisibleText(currentOrigin)} → ${maskVisibleText(spaOrigin)}`,
  });
  const opts = { waitUntil: 'domcontentloaded' as const, timeout: SPA_PIVOT_TIMEOUT_MS };
  await mediator.navigateTo(spaUrl, opts);
  return succeed(true);
}

/**
 * Bootstrap account IDs from Init API when 0 accounts discovered.
 * Uses apiOrigin + auth token to call Init, extracts cardUniqueId.
 * @param loadCtx - Current load context with 0 ids.
 * @param api - API fetch context with auth headers.
 * @param network - Network discovery for apiOrigin.
 * @returns Updated context with seeded IDs, or unchanged.
 */
/**
 * Apply Init API bootstrap when 0 accounts discovered.
 * Delegates to Mediator's AccountBootstrap.
 * @param loadCtx - Current load context.
 * @param api - API fetch context.
 * @param network - Network discovery (mediator).
 * @returns Updated context with seeded IDs, or unchanged.
 */
/**
 * Harvest accounts from sessionStorage when all other methods fail.
 * Uses Content-First scan via mediator — generic for all SPAs.
 * @param loadCtx - Current load context with 0 ids.
 * @param ctx - Pipeline context with browser page.
 * @returns Updated context with seeded IDs, or unchanged.
 */
async function applyStorageHarvest(
  loadCtx: IFetchAllAccountsCtx,
  ctx: IPipelineContext,
): Promise<IFetchAllAccountsCtx> {
  if (loadCtx.ids.length > 0) return loadCtx;
  if (!ctx.browser.has) return loadCtx;
  const page = ctx.browser.value.page;
  const result = await harvestAccountsFromStorage(page);
  if (result.ids.length === 0) return loadCtx;
  return { ...loadCtx, ids: [...result.ids], records: [...result.records] };
}

/**
 * Generic auto-scrape — DIRECT path. After .ashx removal there is no
 * PROXY branch; every bank flows through endpoint discovery + matrix
 * loop replay.
 * @param ctx - Pipeline context.
 * @returns Updated context with scraped accounts.
 */
async function genericAutoScrape(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
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
  const futureMonths = getFutureMonths(ctx.options);
  const fc: IAccountFetchCtx = { api, network, startDate, futureMonths };
  let loadCtx = buildLoadAllCtx(fc, network, rawAccounts.value);
  loadCtx = applyCredentialFallback(loadCtx, ctx);
  loadCtx = await applyStorageHarvest(loadCtx, ctx);
  const idCount = String(loadCtx.ids.length);
  const recCount = String(loadCtx.records.length);
  LOG.debug({
    message: `GenericAutoScrape: ${idCount} accounts, ${recCount} records`,
  });
  const accounts = await scrapeAllAccounts(loadCtx);
  const startMs = parseStartDate(startDate).getTime();
  applyGlobalDateFilter(accounts, startMs);
  const acctCount = String(accounts.length);
  const totalTxns = accounts.reduce((sum, a) => sum + a.txns.length, 0);
  LOG.debug({ accounts: Number(acctCount), txns: totalTxns });
  return succeed({ ...ctx, scrape: some({ accounts: [...accounts] }) });
}

export {
  applyCredentialFallback,
  buildLoadAllCtx,
  discoverAndLoadAccounts,
  genericAutoScrape,
  loadDiscovered,
  pivotToSpaIfNeeded,
};
