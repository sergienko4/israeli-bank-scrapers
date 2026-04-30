/**
 * Proxy discovery + replay strategy — signature-based template matching.
 * Phase 17: Zero-Registry Discovery, Phase 23: Lifecycle-Separated Scrape.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import { resolveDateTokens } from '../../../Mediator/Dashboard/DateResolver.js';
import type { IDiscoveredEndpoint } from '../../../Mediator/Network/NetworkDiscovery.js';
import { createFrozenNetwork } from '../../../Mediator/Network/NetworkDiscovery.js';
import type { IsSignatureKey, JsonNode } from '../../../Mediator/Scrape/JsonTraversal.js';
import { bodyHasSignature, extractMatchingKeys } from '../../../Mediator/Scrape/JsonTraversal.js';
import {
  extractTransactions,
  extractTransactionsForCard,
} from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import { ACCOUNT_SIGNATURE_KEYS, TXN_SIGNATURE_KEYS } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { some } from '../../../Types/Option.js';
import type { IActionContext, IScrapeDiscovery } from '../../../Types/PipelineContext.js';
import { API_STRATEGY } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import { fetchAndMergePending } from '../Account/PendingStrategy.js';
import { applyGlobalDateFilter, rateLimitPause } from '../ScrapeDataActions.js';
import { withTrace } from '../ScrapeTraceWrapper.js';

/** Proxy handler URL signature — matches any .ashx proxy endpoint. */
const PROXY_SIGNATURE = /ProxyRequestHandler\.ashx/i;

type DiscoveredReqName = string;
type ProxyCardId = string;
type HasProxy = boolean;
/** Encoded query parameter for URL construction. */
type QueryParam = string;
/** Raw API response body. */
type ApiResponseBody = Record<string, unknown>;

const LOG = createLogger('scrape-phase');

/**
 * Filter proxy endpoints from captured traffic.
 * @param endpoints - All captured endpoints.
 * @returns Only .ashx proxy endpoints.
 */
function filterProxyEndpoints(
  endpoints: readonly IDiscoveredEndpoint[],
): readonly IDiscoveredEndpoint[] {
  return endpoints.filter((ep): IsSignatureKey => PROXY_SIGNATURE.test(ep.url));
}

/**
 * Find the proxy endpoint whose response matches the ACCOUNT signature.
 * @param endpoints - All captured endpoints (pre-filtered or raw).
 * @returns The account template endpoint, or false.
 */
function findProxyAccountTemplate(
  endpoints: readonly IDiscoveredEndpoint[],
): IDiscoveredEndpoint | false {
  /**
   * Check if endpoint has account signature.
   * @param ep - Endpoint to check.
   * @returns True if signature found.
   */
  const isAcct = (ep: IDiscoveredEndpoint): IsSignatureKey =>
    bodyHasSignature(ep.responseBody as JsonNode, ACCOUNT_SIGNATURE_KEYS);
  const proxies = filterProxyEndpoints(endpoints);
  const proxyMatch = proxies.find(isAcct);
  const match = proxyMatch ?? endpoints.find(isAcct);
  if (match) {
    const acctBody = match.responseBody as JsonNode;
    const sigKeys = extractMatchingKeys(acctBody, ACCOUNT_SIGNATURE_KEYS);
    const sigKeysRaw = String(sigKeys);
    const sigKeysStr = maskVisibleText(sigKeysRaw);
    LOG.debug({
      message: `[DISCOVERY] Identified Account Template via Signature Keys: [${sigKeysStr}]`,
    });
  }
  return match ?? false;
}

/**
 * Check if endpoint matches transaction signature.
 * @param ep - Endpoint to check.
 * @returns True if matches.
 */
function isTxnEndpoint(ep: IDiscoveredEndpoint): IsSignatureKey {
  return bodyHasSignature(ep.responseBody as JsonNode, TXN_SIGNATURE_KEYS);
}

/**
 * Check if endpoint has a replayable POST body with date params.
 * @param ep - Endpoint to check.
 * @returns True if POST body contains billingMonth or date-like key.
 */
function hasDateParam(ep: IDiscoveredEndpoint): IsSignatureKey {
  return ep.postData.includes('billingMonth') || ep.postData.includes('billingDate');
}

/**
 * Find the proxy endpoint whose response matches the TRANSACTION signature.
 * @param endpoints - All captured endpoints (pre-filtered or raw).
 * @returns The transaction template endpoint, or false.
 */
function findProxyTxnTemplate(
  endpoints: readonly IDiscoveredEndpoint[],
): IDiscoveredEndpoint | false {
  const proxies = filterProxyEndpoints(endpoints);
  const replayable = endpoints.filter(isTxnEndpoint).filter(hasDateParam);
  let replayMatch: IDiscoveredEndpoint | false = false;
  if (replayable.length > 0) {
    replayMatch = replayable[replayable.length - 1];
  }
  const reversed = [...endpoints].reverse();
  const proxyReversed = [...proxies].reverse();
  const proxyMatch = proxyReversed.find(isTxnEndpoint);
  const fallbackMatch = proxyMatch ?? reversed.find(isTxnEndpoint);
  const match = replayMatch || fallbackMatch;
  if (match) {
    const responseBody = match.responseBody as JsonNode;
    const sigKeys = extractMatchingKeys(responseBody, TXN_SIGNATURE_KEYS);
    const keyStr = sigKeys.join(', ');
    LOG.debug({
      message:
        '[DISCOVERY] Identified Transaction Template ' +
        `via Signature Keys: [${maskVisibleText(keyStr)}]`,
    });
  }
  return match ?? false;
}

/**
 * Check if proxy scraping is available via LOGIN.FINAL signal.
 * @param ctx - Context with diagnostics.apiStrategy (IActionContext or IPipelineContext).
 * @returns True if apiStrategy is PROXY.
 */
function hasProxyStrategy(ctx: Pick<IActionContext, 'diagnostics'>): HasProxy {
  return ctx.diagnostics.apiStrategy === API_STRATEGY.PROXY;
}

/** Strategy type for replay fetchPost calls. */
interface IReplayStrategy {
  /** POST via browser session with optional headers. */
  readonly fetchPost: <T>(
    url: string,
    data: Record<string, string>,
    opts: { extraHeaders: Record<string, string> },
  ) => Promise<Procedure<T>>;
  /** GET via browser session with optional headers. */
  readonly fetchGet: <T>(
    url: string,
    opts: { extraHeaders: Record<string, string> },
  ) => Promise<Procedure<T>>;
}

/** Bundled context for replaying one month chunk. */
interface IReplayChunkCtx {
  readonly templateBody: ApiResponseBody;
  readonly txnUrl: DiscoveredReqName;
  readonly strategy: IReplayStrategy;
  readonly cardId: ProxyCardId;
}

/**
 * Replay one month chunk for a card.
 * @param rCtx - Replay chunk context.
 * @param month - Billing month string (DD/MM/YYYY).
 * @returns Extracted transactions.
 */
async function replayOneMonth(
  rCtx: IReplayChunkCtx,
  month: string,
): Promise<readonly ITransaction[]> {
  const body = { ...rCtx.templateBody, card4Number: rCtx.cardId, billingMonth: month };
  /**
   * POST fetch for one month chunk.
   * @returns Extracted transactions.
   */
  const fetch = async (): Promise<readonly ITransaction[]> => {
    const result = await rCtx.strategy.fetchPost<ApiResponseBody>(rCtx.txnUrl, body, {
      extraHeaders: { 'Content-Type': 'application/json' },
    });
    if (!isOk(result)) return [];
    return extractTransactions(result.value);
  };
  return withTrace(rCtx.cardId, month, fetch);
}

/**
 * Replay all months for one card via sequential chain.
 * @param rCtx - Replay context.
 * @param months - Billing month strings.
 * @returns All transactions for the card.
 */
async function replayCardMonths(
  rCtx: IReplayChunkCtx,
  months: readonly string[],
): Promise<readonly ITransaction[]> {
  const all: ITransaction[] = [];
  const seed = Promise.resolve(true as const);
  const chain = months.reduce(
    (prev, month): Promise<true> =>
      prev.then(async (): Promise<true> => {
        const txns = await replayOneMonth(rCtx, month);
        all.push(...txns);
        return rateLimitPause(500);
      }),
    seed,
  );
  await chain;
  return all;
}

/**
 * Parse a billing month string (DD/MM/YYYY) into a Date.
 * @param month - Billing month string.
 * @returns Parsed Date.
 */
function parseBillingMonth(month: string): Date {
  const parts = month.split('/');
  const day = Number(parts[0]);
  const mon = Number(parts[1]) - 1;
  const year = Number(parts[2]);
  return new Date(year, mon, day);
}

/**
 * Build the GET URL for one month with resolved date params.
 * @param baseUrl - Proxy endpoint URL.
 * @param txnParams - Date token params.
 * @param month - Billing month string (DD/MM/YYYY).
 * @returns Fully resolved URL.
 */
function buildMonthGetUrl(
  baseUrl: string,
  txnParams: Readonly<Record<string, string>>,
  month: string,
): DiscoveredReqName {
  const targetDate = parseBillingMonth(month);
  const resolved = resolveDateTokens(txnParams, targetDate);
  const paramStr = Object.entries(resolved)
    .map(([k, v]): QueryParam => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const suffixMap: Record<string, string> = { true: `&${paramStr}`, false: '' };
  return `${baseUrl}${suffixMap[String(paramStr.length > 0)]}`;
}

/**
 * Fetch one month's raw response via GET — shared across all cards.
 * @param strategy - Fetch strategy.
 * @param url - Fully resolved GET URL.
 * @returns Raw API response or false on failure.
 */
async function fetchMonthRaw(
  strategy: IReplayStrategy,
  url: string,
): Promise<ApiResponseBody | false> {
  LOG.trace({ method: 'GET', url: maskVisibleText(url) });
  const emptyHeaders = { extraHeaders: {} };
  const result = await strategy.fetchGet<ApiResponseBody>(url, emptyHeaders);
  if (!isOk(result)) return false;
  return result.value;
}

/**
 * Split one month's raw response into per-card transactions.
 * @param raw - Raw API response body.
 * @param cards - All qualified card IDs.
 * @returns Map of cardId → transactions.
 */
function splitResponsePerCard(
  raw: ApiResponseBody,
  cards: readonly string[],
): ReadonlyMap<string, readonly ITransaction[]> {
  const result = new Map<string, readonly ITransaction[]>();
  for (const cardId of cards) {
    const txns = extractTransactionsForCard(raw, cardId);
    result.set(cardId, txns);
  }
  return result;
}

/** Bundled context for month-first GET replay. */
interface IMonthFirstCtx {
  readonly txnUrl: DiscoveredReqName;
  readonly txnParams: ApiResponseBody;
  readonly strategy: IReplayStrategy;
  readonly cards: readonly string[];
  readonly months: readonly string[];
}

/**
 * Month-first GET replay — fetch once per month, split per card.
 * @param mCtx - Month-first replay context.
 * @returns Per-card transaction accumulator map.
 */
async function replayMonthFirst(
  mCtx: IMonthFirstCtx,
): Promise<ReadonlyMap<string, readonly ITransaction[]>> {
  const accum = new Map<string, ITransaction[]>();
  for (const cardId of mCtx.cards) accum.set(cardId, []);
  const params = mCtx.txnParams as Readonly<Record<string, string>>;
  const seed = Promise.resolve(true as const);
  const chain = mCtx.months.reduce(
    (prev, month): Promise<true> =>
      prev.then(async (): Promise<true> => {
        const url = buildMonthGetUrl(mCtx.txnUrl, params, month);
        const raw = await fetchMonthRaw(mCtx.strategy, url);
        if (!raw) return rateLimitPause(500);
        const perCard = splitResponsePerCard(raw, mCtx.cards);
        mergeCardTxns(accum, perCard);
        logMonthSplit(month, perCard);
        return rateLimitPause(500);
      }),
    seed,
  );
  await chain;
  return accum;
}

/**
 * Merge per-card transactions from one month into the accumulator.
 * @param accum - Mutable accumulator map.
 * @param perCard - Card-to-txn map from one month.
 * @returns True after merging.
 */
function mergeCardTxns(
  accum: Map<string, ITransaction[]>,
  perCard: ReadonlyMap<string, readonly ITransaction[]>,
): true {
  for (const [cardId, txns] of perCard) {
    const existing = accum.get(cardId) ?? [];
    existing.push(...txns);
  }
  return true;
}

/**
 * Log per-card split results for one month.
 * @param month - Billing month.
 * @param perCard - Card-to-txn map.
 * @returns True after logging.
 */
function logMonthSplit(month: string, perCard: ReadonlyMap<string, readonly ITransaction[]>): true {
  const parts: string[] = [];
  for (const [cardId, txns] of perCard) {
    parts.push(`card=${cardId}:${String(txns.length)}`);
  }
  LOG.debug({
    message: `month=${month} → ${parts.join(', ')}`,
  });
  return true;
}

/**
 * Build a replay chunk context for one card.
 * @param disc - Scrape discovery data.
 * @param disc.txnTemplateBody - Captured POST body template.
 * @param disc.txnTemplateUrl - Transaction endpoint URL.
 * @param strategy - Replay strategy.
 * @param cardId - Card to replay.
 * @returns Bundled replay chunk context.
 */
function buildReplayChunkCtx(
  disc: { txnTemplateBody: ApiResponseBody; txnTemplateUrl: string },
  strategy: IReplayStrategy,
  cardId: ProxyCardId,
): IReplayChunkCtx {
  return {
    templateBody: disc.txnTemplateBody,
    txnUrl: disc.txnTemplateUrl,
    strategy,
    cardId,
  };
}

/**
 * Resolve display name for a card — cardNumber from DashboardMonth, or cardIndex fallback.
 * @param cardId - cardIndex string.
 * @param displayMap - cardIndex → cardNumber map from qualification.
 * @returns Display name (e.g. "4580-1234") or cardIndex.
 */
function resolveAccountName(
  cardId: ProxyCardId,
  displayMap: ReadonlyMap<string, string> | false,
): ProxyCardId {
  if (!displayMap) return cardId;
  return displayMap.get(cardId) ?? cardId;
}

/** Bundled args for replaying one card. */
interface IReplayCardArgs {
  readonly ctx: IActionContext;
  readonly disc: IScrapeDiscovery;
  readonly strategy: IReplayStrategy;
  readonly cardId: ProxyCardId;
}

/**
 * Replay one card via POST — card ID injected into body per request.
 * @param args - Bundled replay card arguments.
 * @returns Transactions for the card.
 */
async function replayOneCardPost(args: IReplayCardArgs): Promise<readonly ITransaction[]> {
  const rCtx = buildReplayChunkCtx(args.disc, args.strategy, args.cardId);
  return replayCardMonths(rCtx, args.disc.billingMonths);
}

/**
 * POST-path scrape — per-card sequential replay.
 * @param disc - Scrape discovery.
 * @param strategy - Fetch strategy.
 * @param ctx - Action context.
 * @returns Per-card accounts.
 */
async function scrapePerCardPost(
  disc: IScrapeDiscovery,
  strategy: IReplayStrategy,
  ctx: IActionContext,
): Promise<readonly ITransactionsAccount[]> {
  const accounts: ITransactionsAccount[] = [];
  const seed = Promise.resolve(true as const);
  const chain = disc.qualifiedCards.reduce(
    (prev: Promise<true>, cardId: string): Promise<true> =>
      prev.then(async (): Promise<true> => {
        LOG.debug({ card: cardId, month: 'START', txnCount: 0 });
        const txns = await replayOneCardPost({ ctx, disc, strategy, cardId });
        LOG.debug({ card: cardId, month: 'DONE', txnCount: txns.length });
        const displayMap = disc.cardDisplayMap ?? false;
        const acctName = resolveAccountName(cardId, displayMap);
        if (txns.length > 0) {
          accounts.push({ accountNumber: acctName, txns: [...txns], balance: 0 });
        }
        return true as const;
      }),
    seed,
  );
  await chain;
  return accounts;
}

/**
 * Convert card-to-txn map into account array, logging per-card counts.
 * @param cardMap - Map of cardId → transactions.
 * @param displayMap - cardIndex → cardNumber map, or false.
 * @returns Accounts with non-empty transaction lists.
 */
function cardMapToAccounts(
  cardMap: ReadonlyMap<string, readonly ITransaction[]>,
  displayMap: ReadonlyMap<string, string> | false,
): readonly ITransactionsAccount[] {
  const entries = [...cardMap.entries()];
  for (const [cardId, txns] of entries) {
    LOG.debug({ card: cardId, month: 'DONE', txnCount: txns.length });
  }
  return entries
    .filter(([, txns]): HasProxy => txns.length > 0)
    .map(
      ([cardId, txns]): ITransactionsAccount => ({
        accountNumber: resolveAccountName(cardId, displayMap),
        txns: [...txns],
        balance: 0,
      }),
    );
}

/**
 * GET-path scrape — month-first, one fetch per month, split per card.
 * @param disc - Scrape discovery.
 * @param strategy - Fetch strategy.
 * @returns Per-card accounts.
 */
async function scrapeMonthFirstGet(
  disc: IScrapeDiscovery,
  strategy: IReplayStrategy,
): Promise<readonly ITransactionsAccount[]> {
  const mCtx: IMonthFirstCtx = {
    txnUrl: disc.txnTemplateUrl,
    txnParams: disc.txnTemplateBody,
    strategy,
    cards: disc.qualifiedCards,
    months: disc.billingMonths,
  };
  const cardMap = await replayMonthFirst(mCtx);
  return cardMapToAccounts(cardMap, disc.cardDisplayMap ?? false);
}

/**
 * Dispatch scrape strategy — GET (month-first) or POST (per-card).
 * @param ctx - Action context with diagnostics.apiStrategy.
 * @param disc - Scrape discovery.
 * @param strategy - Fetch strategy.
 * @returns Per-card accounts.
 */
async function dispatchScrapeStrategy(
  ctx: IActionContext,
  disc: IScrapeDiscovery,
  strategy: IReplayStrategy,
): Promise<readonly ITransactionsAccount[]> {
  const isProxy = ctx.diagnostics.apiStrategy === API_STRATEGY.PROXY;
  if (isProxy) return scrapeMonthFirstGet(disc, strategy);
  return scrapePerCardPost(disc, strategy, ctx);
}

/**
 * Merge pending/open-cycle txns into proxy-scraped accounts.
 * No-op if ctx lacks api (guard for contexts without DASHBOARD api).
 * Network is reconstructed from the frozen discovery snapshot — identical
 * pattern to FrozenScrapeAction.ts:75,82 and respects the sealed
 * IActionContext (no live mediator access per Rule #20/#21).
 * @param ctx - Sealed action context.
 * @param disc - Scrape discovery with frozenEndpoints + rawAccountRecords.
 * @param accounts - Accounts returned from dispatchScrapeStrategy.
 * @returns Accounts with pending txns merged (unchanged when unavailable).
 */
async function mergePendingIntoProxyAccounts(
  ctx: IActionContext,
  disc: IScrapeDiscovery,
  accounts: readonly ITransactionsAccount[],
): Promise<readonly ITransactionsAccount[]> {
  if (!ctx.api.has) return accounts;
  const network = createFrozenNetwork(disc.frozenEndpoints ?? [], disc.cachedAuth ?? false);
  return fetchAndMergePending({
    api: ctx.api.value,
    network,
    accounts,
    accountRecords: disc.rawAccountRecords ?? [],
  });
}

/**
 * Scrape.Action() — 90-day replay for qualified cards.
 * GET strategy: month-first (one fetch, split per card).
 * POST strategy: per-card sequential replay.
 * @param ctx - Sealed action context with scrapeDiscovery.
 * @returns Updated action context with scraped accounts.
 */
async function proxyScrape(ctx: IActionContext): Promise<Procedure<IActionContext>> {
  if (!ctx.fetchStrategy.has) return succeed(ctx);
  if (!ctx.scrapeDiscovery.has) {
    LOG.debug({
      message: '[SCRAPE.ACTION] no scrapeDiscovery — skipping',
    });
    return succeed(ctx);
  }
  const disc = ctx.scrapeDiscovery.value;
  if (disc.qualifiedCards.length === 0) {
    LOG.debug({
      message: '[SCRAPE.ACTION] no qualified cards',
    });
    return succeed(ctx);
  }
  const strategy = ctx.fetchStrategy.value;
  const qualStr = disc.qualifiedCards.join(', ');
  const cardCount = String(disc.qualifiedCards.length);
  LOG.debug({
    message: `replaying ${cardCount} cards: [${qualStr}]`,
  });
  const accounts = await dispatchScrapeStrategy(ctx, disc, strategy);
  const withPending = await mergePendingIntoProxyAccounts(ctx, disc, accounts);
  const filterMs = new Date(ctx.options.startDate).getTime();
  applyGlobalDateFilter(withPending, filterMs);
  let totalTxns = 0;
  for (const acct of withPending) totalTxns += acct.txns.length;
  LOG.debug({ accounts: withPending.length, txns: totalTxns });
  return succeed({ ...ctx, scrape: some({ accounts: withPending }) });
}

export { generateBillingMonths } from '../../../Mediator/Scrape/JsonTraversal.js';
export type { IReplayStrategy, IsSignatureKey };
export { findProxyAccountTemplate, findProxyTxnTemplate, hasProxyStrategy, proxyScrape };
