/**
 * Proxy discovery + replay strategy — signature-based template matching.
 * Phase 17: Zero-Registry Discovery, Phase 23: Lifecycle-Separated Scrape.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import type { IDiscoveredEndpoint } from '../../../Mediator/Network/NetworkDiscovery.js';
import { extractTransactions } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import { ACCOUNT_SIGNATURE_KEYS, TXN_SIGNATURE_KEYS } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { some } from '../../../Types/Option.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
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
    LOG.debug('[DISCOVERY] Identified Account Template via Signature Keys: [%s]', sigKeys);
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
    LOG.debug('[DISCOVERY] Identified Transaction Template via Signature Keys: [%s]', keyStr);
  }
  return match ?? false;
}

/**
 * Check if proxy scraping is available — deferred to network discovery.
 * @returns False (proxy detection via config removed).
 */
function hasProxyStrategy(): HasProxy {
  return false;
}

/** Strategy type for replay fetchPost calls. */
interface IReplayStrategy {
  /** POST via browser session with optional headers. */
  readonly fetchPost: <T>(
    url: string,
    data: Record<string, string>,
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
  const bodyStr = JSON.stringify(body);
  LOG.debug('[REPLAY] card=%s month=%s body=%s', rCtx.cardId, month, bodyStr);
  const result = await rCtx.strategy.fetchPost<Record<string, unknown>>(
    rCtx.txnUrl,
    body as unknown as Record<string, string>,
    { extraHeaders: { 'Content-Type': 'application/json' } },
  );
  if (!isOk(result)) return [];
  const respPreview = JSON.stringify(result.value).slice(0, 200);
  LOG.debug('[REPLAY] response=%s', respPreview);
  const txns = extractTransactions(result.value);
  const txnCount = String(txns.length);
  LOG.debug('[REPLAY] card=%s month=%s → %s txns', rCtx.cardId, month, txnCount);
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
async function proxyScrape(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!ctx.fetchStrategy.has) return succeed(ctx);
  if (!ctx.scrapeDiscovery.has) {
    LOG.debug('[SCRAPE.ACTION] no scrapeDiscovery — skipping');
    return succeed(ctx);
  }
  const disc = ctx.scrapeDiscovery.value;
  if (disc.qualifiedCards.length === 0) {
    LOG.debug('[SCRAPE.ACTION] no qualified cards');
    return succeed(ctx);
  }
  const strategy = ctx.fetchStrategy.value;
  const qualStr = disc.qualifiedCards.join(', ');
  const cardCount = String(disc.qualifiedCards.length);
  LOG.debug('[SCRAPE.ACTION] replaying %s qualified cards: [%s]', cardCount, qualStr);
  const accounts: ITransactionsAccount[] = [];
  const seed = Promise.resolve(true as const);
  const chain = disc.qualifiedCards.reduce(
    (prev: Promise<true>, cardId: string): Promise<true> =>
      prev.then(async (): Promise<true> => {
        const rCtx = buildReplayChunkCtx(disc, strategy, cardId);
        const cardTxns = await replayCardMonths(rCtx, disc.billingMonths);
        if (cardTxns.length > 0) {
          accounts.push({ accountNumber: cardId, txns: [...cardTxns], balance: 0 });
        }
        const totalStr = String(cardTxns.length);
        LOG.debug('[REPLAY] card=%s total=%s txns', cardId, totalStr);
        return true as const;
      }),
    seed,
  );
  await chain;
  const acctCount = String(accounts.length);
  LOG.debug('[SCRAPE.ACTION] total accounts=%s', acctCount);
  const filterMs = new Date(ctx.options.startDate).getTime();
  applyGlobalDateFilter(accounts, filterMs);
  return succeed({ ...ctx, scrape: some({ accounts }) });
}

export { generateBillingMonths } from '../JsonTraversalStrategy.js';

export { findProxyAccountTemplate, findProxyTxnTemplate, hasProxyStrategy, proxyScrape };

export type { IReplayStrategy, IsSignatureKey };
