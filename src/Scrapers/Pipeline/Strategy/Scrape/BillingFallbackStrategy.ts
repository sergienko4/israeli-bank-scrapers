/**
 * Billing fallback — monthly billing API for card transaction history.
 * Extracted from ScrapeAccountHelpers.ts to respect max-lines.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { parseFreshResponse } from '../../Mediator/Dashboard/TxnParser.js';
import type { IMonthChunk } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { generateMonthChunks } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { applyDateRangeAndAppend } from '../../Mediator/Scrape/UrlDateRange.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk } from '../../Types/Procedure.js';
import {
  buildAccountResult,
  deduplicateTxns,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
  rateLimitPause,
} from './ScrapeDataActions.js';
import {
  EMPTY_TXN_ENDPOINT,
  type IAccountAssemblyCtx,
  type IAccountFetchCtx,
  type IBillingChunkCtx,
  type IPostFetchCtx,
} from './ScrapeTypes.js';

const LOG = createLogger('scrape-billing');
const RATE_LIMIT_MS = 300;

// Phase 7e R-API: bodyCarriesCardId / isBillingCandidate /
// buildBillingUrlFromOrigin / findCapturedBillingUrl removed. The
// billing URL is pre-resolved by DASHBOARD.FINAL via WK_BILLING +
// WK_API.transactions patterns and committed to
// `ctx.txnEndpoint.billingUrl`. SCRAPE consumes the resolved URL —
// zero WK_API / WK_BILLING / WK_ACCT imports remain in this file.

/**
 * Extract month and year strings from a chunk start date.
 * @param chunk - Month chunk with start date.
 * @returns Month and year as strings.
 */
function chunkMonthYear(chunk: IMonthChunk): { readonly month: string; readonly year: string } {
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
  const patchedUrl = applyDateRangeAndAppend(ctx.billingUrl, {
    fromDate: chunkStart,
    toDate: chunkEnd,
    windowParams: ctx.fc.dateWindowParams ?? [],
  });
  const maskedUrl = maskVisibleText(patchedUrl);
  LOG.debug({
    message: `billing chunk m=${month} y=${year} url=${maskedUrl}`,
  });
  const raw = await ctx.fc.api.fetchPost<Record<string, unknown>>(patchedUrl, body);
  if (!isOk(raw)) return [];
  const fieldMap = (ctx.fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT).fieldMap;
  const txns = parseFreshResponse(raw.value, fieldMap);
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
  const keyFields = ctx.fc.dedupKeyFields ?? FALLBACK_DEDUP_KEY_FIELDS;
  const unique = deduplicateTxns(allTxns, startMs, keyFields);
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
  const billingUrl = fc.txnEndpoint?.billingUrl ?? false;
  if (billingUrl === false) {
    LOG.debug({ message: 'billing skipped — no billing URL pre-resolved by DASHBOARD.FINAL' });
    return fail(ScraperErrorTypes.Generic, 'Billing: endpoint not captured, skipping');
  }
  LOG.debug({ message: `billing url=${maskVisibleText(billingUrl)}` });
  const startDate = parseStartDate(fc.startDate);
  const chunks = generateMonthChunks(startDate, new Date(), fc.futureMonths);
  const ctx: IBillingChunkCtx = { fc, billingUrl, accountId: post.accountId };
  const allTxns = await collectBillingChunks(ctx, chunks);
  if (allTxns.length === 0) return fail(ScraperErrorTypes.Generic, 'Billing: 0 txns');
  return buildBillingResult({ fc, post, startDate }, allTxns);
}

export default tryBillingFallback;
export { tryBillingFallback };
