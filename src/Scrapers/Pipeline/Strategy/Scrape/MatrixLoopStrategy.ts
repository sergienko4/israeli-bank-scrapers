/**
 * Matrix Loop Strategy — additive monthly endpoint iteration.
 * Activates ONLY when NetworkDiscovery finds a monthly-pattern endpoint.
 * Does NOT modify the legacy billing fallback used by Discount/VisaCal.
 *
 * SOLID (OCP): extends scrape capabilities without modifying existing code.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import {
  buildMonthBody,
  extractTransactions,
  generateMonthChunks,
  isMonthlyEndpoint,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { applyDateRangeToUrl } from '../../Mediator/Scrape/UrlDateRange.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import { buildAccountResult, parseStartDate, rateLimitPause } from './ScrapeDataActions.js';
import { withTrace } from './ScrapeTraceWrapper.js';
import type { IAccountAssemblyCtx, IAccountFetchCtx } from './ScrapeTypes.js';

const LOG = getDebug(import.meta.url);

/** Rate limit between monthly chunk fetches. */
const MATRIX_RATE_LIMIT_MS = 300;

/** Account record passed through for shape-aware body substitution. */
type AccountRecord = Readonly<Record<string, unknown>>;

/** Bundled args for the Matrix Loop. */
interface IMatrixLoopArgs {
  readonly fc: IAccountFetchCtx;
  readonly accountId: string;
  readonly displayId: string;
  /**
   * Per-card raw record from the discovered accounts endpoint. When
   * provided, buildMonthBody applies shape-aware substitution so per-card
   * scalar fields (companyCode, cardStatus, isPartner, …) reflect the
   * iterated card. Optional — banks with no per-card extras can omit it.
   */
  readonly accountRecord?: AccountRecord;
}

/** Bundled args for fetching one month chunk. */
interface IChunkFetchArgs {
  readonly args: IMatrixLoopArgs;
  readonly txnUrl: string;
  readonly template: string;
}

/**
 * Fetch one month chunk via the discovered monthly endpoint.
 * @param ctx - Chunk fetch context.
 * @param chunkStart - ISO start date of the chunk.
 * @returns Extracted transactions for this chunk.
 */
async function fetchMatrixChunk(
  ctx: IChunkFetchArgs,
  chunkStart: string,
): Promise<readonly ITransaction[]> {
  const chunkDate = new Date(chunkStart);
  const monthNum = chunkDate.getMonth() + 1;
  const yearNum = chunkDate.getFullYear();
  const month = `${String(monthNum)}/${String(yearNum)}`;
  /**
   * POST fetch for one matrix chunk.
   * @returns Extracted transactions.
   */
  const fetch = async (): Promise<readonly ITransaction[]> => {
    const opts = {
      template: ctx.template,
      accountId: ctx.args.accountId,
      month: monthNum,
      year: yearNum,
      accountRecord: ctx.args.accountRecord,
    };
    const body = buildMonthBody(opts) as Record<string, string | object>;
    const monthEnd = new Date(yearNum, monthNum, 0);
    const patchedUrl = applyDateRangeToUrl(ctx.txnUrl, chunkDate, monthEnd);
    const raw = await ctx.args.fc.api.fetchPost<Record<string, unknown>>(patchedUrl, body);
    if (!isOk(raw)) return [];
    return extractTransactions(raw.value);
  };
  return withTrace(ctx.args.accountId, month, fetch);
}

/**
 * Iterates the discovered monthly endpoint across `card × month`
 * chunks. Returns false only when no monthly endpoint applies — an
 * iterated empty card resolves to an account with 0 txns so the caller
 * does NOT fall through to scrapePostDirect (whose un-templated body
 * would echo the captured leading card's txns onto every sibling).
 * @param args - bundled matrix-loop arguments.
 * @returns account Procedure, or false when not applicable.
 */
async function tryMatrixLoop(
  args: IMatrixLoopArgs,
): Promise<Procedure<ITransactionsAccount> | false> {
  const txnEndpoint = args.fc.network.discoverTransactionsEndpoint();
  if (!txnEndpoint) return false;
  if (!txnEndpoint.postData) return false;
  if (!isMonthlyEndpoint(txnEndpoint.postData)) return false;
  const postDataLen = txnEndpoint.postData.length;
  LOG.debug({
    message:
      `MatrixLoop: activated — url=${maskVisibleText(txnEndpoint.url)} ` +
      `postData=${String(postDataLen)} chars`,
  });
  const startDate = parseStartDate(args.fc.startDate);
  const chunks = generateMonthChunks(startDate, new Date(), args.fc.futureMonths);
  LOG.debug({
    message: `MatrixLoop: chunks=${String(chunks.length)} startDate=${args.fc.startDate}`,
  });
  const ctx: IChunkFetchArgs = { args, txnUrl: txnEndpoint.url, template: txnEndpoint.postData };
  const allTxns: ITransaction[] = [];
  const seed = Promise.resolve(true as const);
  const chain = chunks.reduce(
    (prev, chunk): Promise<true> =>
      prev.then(async (): Promise<true> => {
        const txns = await fetchMatrixChunk(ctx, chunk.start);
        allTxns.push(...txns);
        return rateLimitPause(MATRIX_RATE_LIMIT_MS);
      }),
    seed,
  );
  await chain;
  LOG.debug({ accounts: 1, txns: allTxns.length });
  const assembly: IAccountAssemblyCtx = {
    fc: args.fc,
    accountId: args.accountId,
    displayId: args.displayId,
  };
  return buildAccountResult(assembly, allTxns);
}

export default tryMatrixLoop;
export type { IMatrixLoopArgs };
export { tryMatrixLoop };
