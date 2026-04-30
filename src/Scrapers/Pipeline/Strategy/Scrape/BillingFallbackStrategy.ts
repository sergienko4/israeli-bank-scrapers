/**
 * Billing fallback — monthly billing API for card transaction history.
 * Extracted from ScrapeAccountHelpers.ts to respect max-lines.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IMonthChunk } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import {
  extractTransactions,
  generateMonthChunks,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { applyDateRangeToUrl } from '../../Mediator/Scrape/UrlDateRange.js';
import {
  PIPELINE_WELL_KNOWN_API,
  PIPELINE_WELL_KNOWN_BILLING as WK_BILLING,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK_TXN,
} from '../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk } from '../../Types/Procedure.js';
import {
  buildAccountResult,
  deduplicateTxns,
  parseStartDate,
  rateLimitPause,
} from './ScrapeDataActions.js';
import type {
  IAccountAssemblyCtx,
  IAccountFetchCtx,
  IBillingChunkCtx,
  IPostFetchCtx,
} from './ScrapeTypes.js';

const LOG = createLogger('scrape-billing');
const RATE_LIMIT_MS = 300;

type BillingApiUrl = string;
type MonthStr = string;

/** URL matched an existing WK.transactions pattern. */
type PatternMatched = boolean;
/** Post-body carries a card-unique identifier (billing-endpoint signal). */
type CarriesCardId = boolean;

/**
 * Check whether the captured POST body mentions any WK.queryId alias
 * (cardUniqueId, cardUniqueID, accountId …). Banks use these identifiers
 * to scope the billing POST per-card; its presence distinguishes the
 * billing endpoint from other WK.transactions-matching endpoints that
 * return shared filtered-transaction views.
 * @param postData - Captured POST body string.
 * @returns True when any WK.queryId alias appears in the body.
 */
function bodyCarriesCardId(postData: RawPostBody): CarriesCardId {
  if (!postData) return false;
  return WK_TXN.queryId.some((alias): CarriesCardId => postData.includes(alias));
}

/** Raw POST body string from a captured endpoint. */
type RawPostBody = string;

/** Probe of a single captured endpoint for billing-fallback fitness. */
interface ICandidateProbe {
  readonly url: BillingApiUrl;
  readonly postData: RawPostBody;
}

/**
 * URL matches WK.transactions AND POST body carries a card identifier.
 * @param probe - Captured endpoint (url + postData).
 * @param patterns - WK.transactions regex list.
 * @returns True when both conditions hold.
 */
function isBillingCandidate(probe: ICandidateProbe, patterns: readonly RegExp[]): PatternMatched {
  const isUrlMatch = patterns.some((p): PatternMatched => p.test(probe.url));
  if (!isUrlMatch) return false;
  return bodyCarriesCardId(probe.postData);
}

/**
 * Build the canonical billing URL under a discovered API origin using
 * WK.billing path fragments. No hostname hardcoded — the origin comes
 * from whatever endpoint the bank's own SPA already touched.
 * @param anyCapturedUrl - Any URL already captured on the target host.
 * @returns Full billing URL.
 */
function buildBillingUrlFromOrigin(anyCapturedUrl: BillingApiUrl): BillingApiUrl {
  const origin = new URL(anyCapturedUrl).origin;
  return `${origin}${WK_BILLING.apiPrefix}/${WK_BILLING.pathFragment}/${WK_BILLING.actionName}`;
}

/**
 * Find the billing fallback target URL.
 * Priority:
 *   1. A captured URL already under WK_BILLING.pathFragment — use it directly.
 *   2. A captured WK.transactions URL whose POST body carries a WK.queryId
 *      alias (card-scoped endpoint) — build canonical billing URL from its
 *      origin using WK_BILLING path fragments.
 *   3. No match — return false (bank doesn't expose the billing family).
 * Zero hardcoded full URLs; zero hostname knowledge.
 * @param fc - Fetch context exposing network.getAllEndpoints().
 * @returns Captured/built URL or false when family isn't present.
 */
function findCapturedBillingUrl(fc: IAccountFetchCtx): BillingApiUrl | false {
  const patterns = PIPELINE_WELL_KNOWN_API.transactions;
  const captured = fc.network.getAllEndpoints();
  const directHit = captured.find((ep): PatternMatched => ep.url.includes(WK_BILLING.pathFragment));
  if (directHit) return buildBillingUrlFromOrigin(directHit.url);
  const shaped = captured.find((ep): PatternMatched => isBillingCandidate(ep, patterns));
  if (shaped) return buildBillingUrlFromOrigin(shaped.url);
  return false;
}

/**
 * Extract month and year strings from a chunk start date.
 * @param chunk - Month chunk with start date.
 * @returns Month and year as strings.
 */
function chunkMonthYear(chunk: IMonthChunk): { readonly month: MonthStr; readonly year: MonthStr } {
  const d = new Date(chunk.start);
  const rawMonth = d.getMonth() + 1;
  const rawYear = d.getFullYear();
  const month = String(rawMonth);
  const year = String(rawYear);
  return { month, year };
}

/**
 * Scrape one billing chunk for a month.
 * @param ctx - Billing chunk context.
 * @param chunk - Month chunk.
 * @returns Extracted transactions.
 */
async function scrapeOneBillingChunk(
  ctx: IBillingChunkCtx,
  chunk: IMonthChunk,
): Promise<readonly ITransaction[]> {
  const { month, year } = chunkMonthYear(chunk);
  const body = { cardUniqueId: ctx.accountId, month, year };
  const chunkStart = new Date(chunk.start);
  const chunkEnd = new Date(chunk.end);
  const patchedUrl = applyDateRangeToUrl(ctx.billingUrl, chunkStart, chunkEnd);
  const maskedUrl = maskVisibleText(patchedUrl);
  LOG.debug({
    message: `billing chunk m=${month} y=${year} url=${maskedUrl}`,
  });
  const raw = await ctx.fc.api.fetchPost<Record<string, unknown>>(patchedUrl, body);
  if (!isOk(raw)) return [];
  const txns = extractTransactions(raw.value);
  LOG.debug({
    card: ctx.accountId,
    month: `${month}/${year}`,
    txnCount: txns.length,
  });
  return txns;
}

/**
 * Process one billing chunk (loop body).
 * @param ctx - Billing context.
 * @param chunk - Month chunk.
 * @param out - Accumulator.
 * @returns True when done.
 */
async function processBillingChunk(
  ctx: IBillingChunkCtx,
  chunk: IMonthChunk,
  out: ITransaction[],
): Promise<true> {
  const txns = await scrapeOneBillingChunk(ctx, chunk);
  out.push(...txns);
  return rateLimitPause(RATE_LIMIT_MS);
}

/**
 * Collect all billing chunks via sequential promise chain.
 * @param ctx - Billing context.
 * @param chunks - Month chunks.
 * @returns All transactions.
 */
async function collectBillingChunks(
  ctx: IBillingChunkCtx,
  chunks: readonly IMonthChunk[],
): Promise<readonly ITransaction[]> {
  const all: ITransaction[] = [];
  const seed = Promise.resolve(true as const);
  await chunks.reduce(
    (prev, chunk): Promise<true> =>
      prev.then((): Promise<true> => processBillingChunk(ctx, chunk, all)),
    seed,
  );
  return all;
}

/** Bundled params for billing result assembly. */
interface IBillingResultCtx {
  readonly fc: IAccountFetchCtx;
  readonly post: IPostFetchCtx;
  readonly startDate: Date;
}

/**
 * Build billing fallback result with dedup.
 * @param ctx - Billing result context.
 * @param allTxns - Raw billing transactions.
 * @returns Account Procedure.
 */
async function buildBillingResult(
  ctx: IBillingResultCtx,
  allTxns: readonly ITransaction[],
): Promise<Procedure<ITransactionsAccount>> {
  const startMs = ctx.startDate.getTime();
  const unique = deduplicateTxns(allTxns, startMs);
  const assembly: IAccountAssemblyCtx = {
    fc: ctx.fc,
    accountId: ctx.post.accountId,
    displayId: ctx.post.displayId,
  };
  return buildAccountResult(assembly, unique);
}

/**
 * Try monthly billing fallback for a card. The target URL is whatever
 * the bank's own SPA hit matching WK.transactions — nothing hardcoded.
 * @param fc - Fetch context.
 * @param post - POST params with accountId + displayId.
 * @returns Account with transactions, or failure.
 */
async function tryBillingFallback(
  fc: IAccountFetchCtx,
  post: IPostFetchCtx,
): Promise<Procedure<ITransactionsAccount>> {
  const billingUrl = findCapturedBillingUrl(fc);
  if (billingUrl === false) {
    LOG.debug({ message: 'billing skipped — no WK.transactions endpoint was captured' });
    return fail(ScraperErrorTypes.Generic, 'Billing: endpoint not captured, skipping');
  }
  LOG.debug({ message: `billing url=${billingUrl}` });
  const startDate = parseStartDate(fc.startDate);
  const chunks = generateMonthChunks(startDate, new Date(), fc.futureMonths);
  const ctx: IBillingChunkCtx = { fc, billingUrl, accountId: post.accountId };
  const allTxns = await collectBillingChunks(ctx, chunks);
  if (allTxns.length === 0) return fail(ScraperErrorTypes.Generic, 'Billing: 0 txns');
  return buildBillingResult({ fc, post, startDate }, allTxns);
}

export default tryBillingFallback;
export { tryBillingFallback };
