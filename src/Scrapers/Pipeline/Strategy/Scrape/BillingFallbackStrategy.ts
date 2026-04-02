/**
 * Billing fallback — monthly billing API for card transaction history.
 * Extracted from ScrapeAccountHelpers.ts to respect max-lines.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IDiscoveredEndpoint } from '../../Mediator/Network/NetworkDiscovery.js';
import type { IMonthChunk } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import {
  extractTransactions,
  generateMonthChunks,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
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

/**
 * Build billing URL from an endpoint origin.
 * Uses the WK transaction path pattern from ScrapeWK.
 * @param endpointUrl - Any captured endpoint URL on the API domain.
 * @returns Full billing API URL.
 */
function buildBillingUrl(endpointUrl: BillingApiUrl): BillingApiUrl {
  const apiBase = new URL(endpointUrl).origin;
  const path = '/Transactions/api/transactionsDetails/getCardTransactionsDetails';
  return `${apiBase}${path}`;
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
  LOG.debug({ month, year, cardUniqueId: ctx.accountId, url: ctx.billingUrl }, 'billing chunk');
  const raw = await ctx.fc.api.fetchPost<Record<string, unknown>>(ctx.billingUrl, body);
  if (!isOk(raw)) return [];
  const txns = extractTransactions(raw.value);
  LOG.debug('billing chunk: m=%s y=%s → %d txns', month, year, txns.length);
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
 * Try monthly billing fallback for a card.
 * @param fc - Fetch context.
 * @param post - POST params with accountId + displayId.
 * @param txnEndpoint - Optional discovered endpoint for origin.
 * @returns Account with transactions, or failure.
 */
async function tryBillingFallback(
  fc: IAccountFetchCtx,
  post: IPostFetchCtx,
  txnEndpoint?: IDiscoveredEndpoint | false,
): Promise<Procedure<ITransactionsAccount>> {
  const originEp = txnEndpoint ?? fc.network.discoverAccountsEndpoint();
  const epUrl = originEp && originEp.url;
  const apiOrigin = epUrl || fc.network.discoverApiOrigin();
  if (!apiOrigin) return fail(ScraperErrorTypes.Generic, 'No endpoint for billing origin');
  const billingUrl = buildBillingUrl(apiOrigin);
  process.stderr.write(`[SCRAPE.BILLING] url=${billingUrl}\n`);
  const startDate = parseStartDate(fc.startDate);
  const chunks = generateMonthChunks(startDate, new Date());
  const ctx: IBillingChunkCtx = { fc, billingUrl, accountId: post.accountId };
  const allTxns = await collectBillingChunks(ctx, chunks);
  if (allTxns.length === 0) return fail(ScraperErrorTypes.Generic, 'Billing: 0 txns');
  return buildBillingResult({ fc, post, startDate }, allTxns);
}

export default tryBillingFallback;
export { tryBillingFallback };
