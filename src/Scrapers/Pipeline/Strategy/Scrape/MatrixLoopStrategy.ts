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
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import { buildAccountResult, parseStartDate, rateLimitPause } from './ScrapeDataActions.js';
import { withTrace } from './ScrapeTraceWrapper.js';
import type { IAccountAssemblyCtx, IAccountFetchCtx } from './ScrapeTypes.js';

const LOG = getDebug('matrix-loop');

/** Rate limit between monthly chunk fetches. */
const MATRIX_RATE_LIMIT_MS = 300;

/** Account identifier for API queries. */
type AccountNum = string;
/** User-facing display identifier (last 4 digits). */
type DisplayLabel = string;
/** URL of a discovered API endpoint. */
type EndpointUrl = string;
/** Raw POST body template string. */
type BodyTemplate = string;

/** Bundled args for the Matrix Loop. */
interface IMatrixLoopArgs {
  readonly fc: IAccountFetchCtx;
  readonly accountId: AccountNum;
  readonly displayId: DisplayLabel;
}

/** Bundled args for fetching one month chunk. */
interface IChunkFetchArgs {
  readonly args: IMatrixLoopArgs;
  readonly txnUrl: EndpointUrl;
  readonly template: BodyTemplate;
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
    };
    const body = buildMonthBody(opts) as Record<string, string | object>;
    const raw = await ctx.args.fc.api.fetchPost<Record<string, unknown>>(ctx.txnUrl, body);
    if (!isOk(raw)) return [];
    return extractTransactions(raw.value);
  };
  return withTrace(ctx.args.accountId, month, fetch);
}

/**
 * Try Matrix Loop — iterate discovered monthly endpoint × month chunks.
 * Triggers ONLY if the discovered txn endpoint has monthly WK fields.
 * Returns false if not applicable — caller falls through to legacy billing.
 * @param args - Bundled matrix loop arguments.
 * @returns Account with transactions, or false if not a monthly endpoint.
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
    event: 'generic-trace',
    phase: 'scrape',
    message:
      `MatrixLoop: activated — url=${maskVisibleText(txnEndpoint.url)} ` +
      `postData=${String(postDataLen)} chars`,
  });
  const startDate = parseStartDate(args.fc.startDate);
  const chunks = generateMonthChunks(startDate, new Date());
  LOG.debug({
    event: 'generic-trace',
    phase: 'scrape',
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
  LOG.debug({ event: 'scrape-result', accounts: 1, txns: allTxns.length });
  if (allTxns.length === 0) return false;
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
