/**
 * Proxy discovery + replay strategy — signature-based template matching.
 * Phase 17: Zero-Registry Discovery, Phase 23: Lifecycle-Separated Scrape.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import { resolveDateTokens } from '../../../Mediator/Dashboard/DateResolver.js';
import type { IDiscoveredEndpoint } from '../../../Mediator/Network/NetworkDiscovery.js';
import { extractTransactions } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import { ACCOUNT_SIGNATURE_KEYS, TXN_SIGNATURE_KEYS } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { some } from '../../../Types/Option.js';
import type { IPipelineContext, IScrapeDiscovery } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IsSignatureKey, JsonNode } from '../JsonTraversalStrategy.js';
import { bodyHasSignature, extractMatchingKeys } from '../JsonTraversalStrategy.js';
import { applyGlobalDateFilter, rateLimitPause } from '../ScrapeDataActions.js';

/** Proxy handler URL signature — matches any .ashx proxy endpoint. */
const PROXY_SIGNATURE = /ProxyRequestHandler\.ashx/i;

type DiscoveredReqName = string;
type ProxyCardId = string;
type HasProxy = boolean;
/** Encoded query parameter for URL construction. */
type QueryParam = string;

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
      event: 'generic-trace',
      phase: 'scrape',
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
      event: 'generic-trace',
      phase: 'scrape',
      message:
        '[DISCOVERY] Identified Transaction Template ' +
        `via Signature Keys: [${maskVisibleText(keyStr)}]`,
    });
  }
  return match ?? false;
}

/**
 * Check if proxy scraping is available via LOGIN.FINAL signal.
 * @param ctx - Pipeline context with diagnostics.apiStrategy.
 * @returns True if apiStrategy is PROXY.
 */
function hasProxyStrategy(ctx: IPipelineContext): HasProxy {
  return ctx.diagnostics.apiStrategy === 'PROXY';
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
  readonly templateBody: Record<string, unknown>;
  readonly txnUrl: DiscoveredReqName;
  readonly strategy: IReplayStrategy;
  readonly cardId: ProxyCardId;
}

/** Bundled context for GET-based proxy replay. */
interface IReplayGetCtx {
  readonly txnUrl: DiscoveredReqName;
  readonly strategy: IReplayStrategy;
  readonly cardId: ProxyCardId;
  readonly txnParams: Record<string, unknown>;
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
  LOG.trace({ event: 'scrape-card', card: rCtx.cardId, month, txnCount: 0 });
  const result = await rCtx.strategy.fetchPost<Record<string, unknown>>(
    rCtx.txnUrl,
    body as unknown as Record<string, string>,
    { extraHeaders: { 'Content-Type': 'application/json' } },
  );
  if (!isOk(result)) return [];
  const respPreview = JSON.stringify(result.value).slice(0, 200);
  LOG.debug({
    event: 'generic-trace',
    phase: 'scrape',
    message: `[REPLAY] response=${maskVisibleText(respPreview)}`,
  });
  const txns = extractTransactions(result.value);
  LOG.trace({ event: 'scrape-card', card: rCtx.cardId, month, txnCount: txns.length });
  return txns;
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
 * Replay one month via GET with resolved date params.
 * @param gCtx - GET replay context.
 * @param month - Billing month string (DD/MM/YYYY).
 * @returns Extracted transactions.
 */
async function replayOneMonthGet(
  gCtx: IReplayGetCtx,
  month: string,
): Promise<readonly ITransaction[]> {
  const targetDate = parseBillingMonth(month);
  const tokenParams = gCtx.txnParams as Readonly<Record<string, string>>;
  const resolved = resolveDateTokens(tokenParams, targetDate);
  const paramStr = Object.entries(resolved)
    .map(([k, v]): QueryParam => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  /** Param suffix lookup: has params → append, else empty. */
  const suffixMap: Record<string, string> = { true: `&${paramStr}`, false: '' };
  const hasSuffix = String(paramStr.length > 0);
  const fullUrl = `${gCtx.txnUrl}${suffixMap[hasSuffix]}`;
  LOG.trace({ event: 'scrape-card', card: gCtx.cardId, month, txnCount: 0 });
  const emptyHeaders = { extraHeaders: {} };
  const result = await gCtx.strategy.fetchGet<Record<string, unknown>>(fullUrl, emptyHeaders);
  if (!isOk(result)) return [];
  const txns = extractTransactions(result.value);
  LOG.trace({ event: 'scrape-card', card: gCtx.cardId, month, txnCount: txns.length });
  return txns;
}

/**
 * Replay all months for one card via GET — sequential chain.
 * @param gCtx - GET replay context.
 * @param months - Billing month strings.
 * @returns All transactions for the card.
 */
async function replayCardMonthsGet(
  gCtx: IReplayGetCtx,
  months: readonly string[],
): Promise<readonly ITransaction[]> {
  const all: ITransaction[] = [];
  const seed = Promise.resolve(true as const);
  const chain = months.reduce(
    (prev, month): Promise<true> =>
      prev.then(async (): Promise<true> => {
        const txns = await replayOneMonthGet(gCtx, month);
        all.push(...txns);
        return rateLimitPause(500);
      }),
    seed,
  );
  await chain;
  return all;
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
  disc: { txnTemplateBody: Record<string, unknown>; txnTemplateUrl: string },
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
 * Scrape.Action() — Clean 90-day replay for qualified cards only.
 * @param ctx - Pipeline context with scrapeDiscovery.
 * @returns Updated context with scraped accounts.
 */
/** Bundled args for replaying one card. */
interface IReplayCardArgs {
  readonly ctx: IPipelineContext;
  readonly disc: IScrapeDiscovery;
  readonly strategy: IReplayStrategy;
  readonly cardId: ProxyCardId;
}

/**
 * Replay one card — dispatches GET or POST based on apiStrategy.
 * @param args - Bundled replay card arguments.
 * @returns Transactions for the card.
 */
async function replayOneCard(args: IReplayCardArgs): Promise<readonly ITransaction[]> {
  const isProxyGet = args.ctx.diagnostics.apiStrategy === 'PROXY';
  if (isProxyGet) {
    const gCtx: IReplayGetCtx = {
      txnUrl: args.disc.txnTemplateUrl,
      strategy: args.strategy,
      cardId: args.cardId,
      txnParams: args.disc.txnTemplateBody,
    };
    return replayCardMonthsGet(gCtx, args.disc.billingMonths);
  }
  const rCtx = buildReplayChunkCtx(args.disc, args.strategy, args.cardId);
  return replayCardMonths(rCtx, args.disc.billingMonths);
}

/**
 * Scrape.Action() — 90-day replay for qualified cards (GET or POST).
 * @param ctx - Pipeline context with scrapeDiscovery.
 * @returns Updated context with scraped accounts.
 */
async function proxyScrape(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!ctx.fetchStrategy.has) return succeed(ctx);
  if (!ctx.scrapeDiscovery.has) {
    LOG.debug({
      event: 'generic-trace',
      phase: 'scrape',
      message: '[SCRAPE.ACTION] no scrapeDiscovery — skipping',
    });
    return succeed(ctx);
  }
  const disc = ctx.scrapeDiscovery.value;
  if (disc.qualifiedCards.length === 0) {
    LOG.debug({
      event: 'generic-trace',
      phase: 'scrape',
      message: '[SCRAPE.ACTION] no qualified cards',
    });
    return succeed(ctx);
  }
  const strategy = ctx.fetchStrategy.value;
  const qualStr = disc.qualifiedCards.join(', ');
  const cardCount = String(disc.qualifiedCards.length);
  LOG.debug({
    event: 'generic-trace',
    phase: 'scrape',
    message: `replaying ${cardCount} cards: [${qualStr}]`,
  });
  const accounts: ITransactionsAccount[] = [];
  const seed = Promise.resolve(true as const);
  const chain = disc.qualifiedCards.reduce(
    (prev: Promise<true>, cardId: string): Promise<true> =>
      prev.then(async (): Promise<true> => {
        LOG.debug({ event: 'scrape-card', card: cardId, month: 'START', txnCount: 0 });
        const cardTxns = await replayOneCard({ ctx, disc, strategy, cardId });
        LOG.debug({ event: 'scrape-card', card: cardId, month: 'DONE', txnCount: cardTxns.length });
        if (cardTxns.length > 0) {
          accounts.push({ accountNumber: cardId, txns: [...cardTxns], balance: 0 });
        }
        return true as const;
      }),
    seed,
  );
  await chain;
  const filterMs = new Date(ctx.options.startDate).getTime();
  applyGlobalDateFilter(accounts, filterMs);
  const acctCount = String(accounts.length);
  const totalTxns = accounts.reduce((s, a) => s + a.txns.length, 0);
  LOG.debug({ event: 'scrape-result', accounts: Number(acctCount), txns: totalTxns });
  return succeed({ ...ctx, scrape: some({ accounts }) });
}

export { generateBillingMonths } from '../JsonTraversalStrategy.js';
export type { IReplayStrategy, IsSignatureKey };
export { findProxyAccountTemplate, findProxyTxnTemplate, hasProxyStrategy, proxyScrape };
