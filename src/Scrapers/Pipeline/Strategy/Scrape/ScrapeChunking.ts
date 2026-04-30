/**
 * Scrape chunking — monthly chunk fetch, dedup, date filter, assembly.
 * Extracted from ScrapeFetchHelpers.ts to respect max-lines.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import type { IMonthChunk } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import {
  extractTransactions,
  generateMonthChunks,
  replaceField,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonRecord } from '../../Mediator/Scrape/ScrapeReplayAction.js';
import { applyDateRangeToUrl } from '../../Mediator/Scrape/UrlDateRange.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../Registry/WK/ScrapeWK.js';
import {
  buildAccountResult,
  deduplicateTxns,
  parseStartDate,
  rateLimitPause,
} from '../../Strategy/Scrape/ScrapeDataActions.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import type { IAccountAssemblyCtx, IChunkingCtx } from './ScrapeTypes.js';

/** Whether a transaction date is after the start date. */
type IsAfterDate = boolean;

const RATE_LIMIT_MS = 300;

/**
 * Scrape one monthly chunk via POST.
 * @param ctx - Chunking context.
 * @param chunk - Month chunk with start/end dates.
 * @returns Extracted transactions.
 */
async function scrapeOneChunk(
  ctx: IChunkingCtx,
  chunk: IMonthChunk,
): Promise<readonly ITransaction[]> {
  const cloned = JSON.stringify(ctx.baseBody);
  const body = JSON.parse(cloned) as Record<string, unknown>;
  replaceField(body as JsonRecord, WK.fromDate, chunk.start);
  replaceField(body as JsonRecord, WK.toDate, chunk.end);
  const chunkStart = new Date(chunk.start);
  const chunkEnd = new Date(chunk.end);
  const patchedUrl = applyDateRangeToUrl(ctx.url, chunkStart, chunkEnd);
  const raw = await ctx.fc.api.fetchPost<Record<string, unknown>>(
    patchedUrl,
    body as Record<string, string | object>,
  );
  if (!isOk(raw)) return [];
  return extractTransactions(raw.value);
}

/**
 * Process one chunk with rate limiting.
 * @param ctx - Chunking context.
 * @param chunk - Month chunk.
 * @param out - Accumulator array.
 * @returns True when done.
 */
async function processChunk(
  ctx: IChunkingCtx,
  chunk: IMonthChunk,
  out: ITransaction[],
): Promise<true> {
  const txns = await scrapeOneChunk(ctx, chunk);
  out.push(...txns);
  return rateLimitPause(RATE_LIMIT_MS);
}

/**
 * Scrape all monthly chunks sequentially via promise chain.
 * @param ctx - Chunking context.
 * @param chunks - Month chunks.
 * @returns All transactions.
 */
async function scrapeAllChunks(
  ctx: IChunkingCtx,
  chunks: readonly IMonthChunk[],
): Promise<readonly ITransaction[]> {
  const all: ITransaction[] = [];
  const seed = Promise.resolve(true as const);
  const chain = chunks.reduce(
    (prev, chunk): Promise<true> => prev.then((): Promise<true> => processChunk(ctx, chunk, all)),
    seed,
  );
  await chain;
  return all;
}

/**
 * Scrape with monthly chunking and deduplication.
 * @param ctx - Chunking context.
 * @returns Account with all monthly transactions.
 */
async function scrapeWithMonthlyChunking(
  ctx: IChunkingCtx,
): Promise<Procedure<ITransactionsAccount>> {
  const startDate = parseStartDate(ctx.fc.startDate);
  const chunks = generateMonthChunks(startDate, new Date(), ctx.fc.futureMonths);
  const allTxns = await scrapeAllChunks(ctx, chunks);
  const startMs = startDate.getTime();
  const unique = deduplicateTxns(allTxns, startMs);
  const assembly: IAccountAssemblyCtx = {
    fc: ctx.fc,
    accountId: ctx.accountId,
    displayId: ctx.displayId,
  };
  return buildAccountResult(assembly, unique);
}

/**
 * Check if a transaction is after start date.
 * @param txn - Transaction.
 * @param startMs - Start epoch ms.
 * @returns True if valid and after start.
 */
function isAfterStart(txn: ITransaction, startMs: number): IsAfterDate {
  const txnMs = new Date(txn.date).getTime();
  return !Number.isNaN(txnMs) && txnMs >= startMs;
}

/**
 * Apply global date filter to all accounts.
 * @param accounts - Scraped accounts.
 * @param startMs - Start date as epoch ms.
 * @returns The filtered accounts.
 */
function applyGlobalDateFilter(
  accounts: readonly ITransactionsAccount[],
  startMs: number,
): readonly ITransactionsAccount[] {
  for (const account of accounts) {
    account.txns = account.txns.filter((t): IsAfterDate => isAfterStart(t, startMs));
  }
  return accounts;
}

export { applyGlobalDateFilter, scrapeWithMonthlyChunking };
