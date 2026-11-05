/**
 * Matrix Loop Strategy — additive monthly endpoint iteration.
 * Activates ONLY when NetworkDiscovery finds a monthly-pattern endpoint.
 *
 * SOLID (OCP): extends scrape capabilities without modifying existing code.
 *
 * <p>Pulls its dedup/assembly helpers from the concrete `ScrapeData/*`
 * siblings, NOT from the `ScrapeDataActions` barrel — that barrel re-exports
 * `ScrapeChunking`, so routing helper imports through it would couple this
 * strategy to the chunking module (and its transitive graph) for no reason.
 * Keep these imports direct.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { getDebug } from '../../Logging/Debug.js';
import { parseFreshResponse } from '../../Mediator/Dashboard/TxnParser.js';
import type { IBankMonth } from '../../Mediator/Scrape/BankMonth.js';
import { bankMonthBounds, bankMonthOfLabel } from '../../Mediator/Scrape/BankMonth.js';
import { MAX_MONTH_REQUESTS } from '../../Mediator/Scrape/MonthRangeBudget.js';
import {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { applyDateRangeAndAppend } from '../../Mediator/Scrape/UrlDateRange.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk } from '../../Types/Procedure.js';
import buildAccountResult from './ScrapeData/ScrapeDataAssembly.js';
import {
  deduplicateTxns,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
  rateLimitPause,
} from './ScrapeData/ScrapeDataDedup.js';
import { withTrace } from './ScrapeTraceWrapper.js';
import {
  EMPTY_TXN_ENDPOINT,
  type IAccountAssemblyCtx,
  type IAccountFetchCtx,
} from './ScrapeTypes.js';

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

/** Generated chunk surface needed to recover its named month. */
interface IMonthChunkName {
  /** Label carrying a YYYY-MM prefix. */
  readonly start: string;
}

/**
 * Fetch one month chunk via the discovered monthly endpoint.
 * @param ctx - Chunk fetch context.
 * @param named - Bank-calendar month to fetch.
 * @returns Extracted transactions for this chunk.
 */
async function fetchMatrixChunk(
  ctx: IChunkFetchArgs,
  named: IBankMonth,
): Promise<readonly ITransaction[]> {
  const monthNum = named.month;
  const yearNum = named.year;
  const month = `${String(monthNum)}/${String(yearNum)}`;
  const bounds = bankMonthBounds(named);
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
    const patchedUrl = applyDateRangeAndAppend(ctx.txnUrl, {
      fromDate: bounds.start,
      toDate: bounds.end,
      windowParams: ctx.args.fc.dateWindowParams ?? [],
    });
    const raw = await ctx.args.fc.api.fetchPost<Record<string, unknown>>(patchedUrl, body);
    if (!isOk(raw)) return [];
    const fieldMap = (ctx.args.fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT).fieldMap;
    return parseFreshResponse(raw.value, fieldMap);
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
  // Phase 7f: SCRAPE consumes the slim ITxnEndpoint DASHBOARD.FINAL
  // committed via ctx.txnEndpoint (plumbed onto fc by SCRAPE.PRE).
  // No network discovery here. `templatePostData` is the typed slim
  // field; `false` means GET method (matrix loop is POST-only).
  const txnEndpoint = args.fc.txnEndpoint;
  if (!txnEndpoint || txnEndpoint.url === '') return false;
  const template = txnEndpoint.templatePostData;
  if (template === false || template === '') return false;
  if (!isMonthlyEndpoint(template)) return false;
  const postDataLen = template.length;
  LOG.debug({
    message:
      `MatrixLoop: activated — url=${maskVisibleText(txnEndpoint.url)} ` +
      `postData=${String(postDataLen)} chars`,
  });
  const chunks = resolveChunkPlan(args.fc);
  if (chunks === false) {
    return fail(
      ScraperErrorTypes.Generic,
      `MatrixLoop: invalid or oversized month plan (limit ${String(MAX_MONTH_REQUESTS)})`,
    );
  }
  LOG.debug({
    message: `MatrixLoop: chunks=${String(chunks.length)} startDate=${args.fc.startDate}`,
  });
  const ctx: IChunkFetchArgs = { args, txnUrl: txnEndpoint.url, template };
  const allTxns = await collectChunkTxns(ctx, chunks);
  // Phase F (2026-05-13): every cycle's response can echo the bank's
  // pending / out-of-statement rows (Isracard approvedTransactions,
  // israelAbroadVouchers.outOfStatementChargeDateVouchers). Without
  // this call the concatenated `allTxns` carried N copies of each
  // pending row — one per iterated chunk — into `account.txns[]`.
  const startMs = parseStartDate(args.fc.startDate).getTime();
  const keyFields = args.fc.dedupKeyFields ?? FALLBACK_DEDUP_KEY_FIELDS;
  const unique = deduplicateTxns(allTxns, startMs, keyFields);
  LOG.debug({ accounts: 1, rawTxns: allTxns.length, uniqueTxns: unique.length });
  const assembly: IAccountAssemblyCtx = {
    fc: args.fc,
    accountId: args.accountId,
    displayId: args.displayId,
  };
  return buildAccountResult(assembly, unique);
}

/**
 * Parse the compact requested start without inventing a usable day.
 * @param fc - Per-account fetch context.
 * @returns Parsed date, or false when the label is unreadable.
 */
function readableStartDate(fc: IAccountFetchCtx): Date | false {
  const startDate = parseStartDate(fc.startDate);
  const startMs = startDate.getTime();
  return Number.isFinite(startMs) ? startDate : false;
}

/**
 * Resolve the per-card month-iteration plan: one generated month chunk
 * per bank month from the requested start through `futureMonths`.
 *
 * @param fc - Per-account fetch context plumbed by SCRAPE.PRE.
 * @returns Ordered month chunks for {@link collectChunkTxns}, or false
 *   for an unreadable start or an oversized request.
 */
function resolveChunkPlan(fc: IAccountFetchCtx): readonly IBankMonth[] | false {
  const startDate = readableStartDate(fc);
  if (startDate === false) return false;
  const chunks = generateMonthChunks(startDate, new Date(), fc.futureMonths);
  return chunks === false ? false : chunks.flatMap(chunkToMonth);
}

/**
 * Read one generated chunk's named month.
 * @param chunk - Generated month chunk.
 * @returns One validated month, or empty on an impossible invalid label.
 */
function chunkToMonth(chunk: IMonthChunkName): readonly IBankMonth[] {
  const named = bankMonthOfLabel(chunk.start);
  if (named !== false) return [named];
  LOG.warn({ message: 'MatrixLoop: skipped invalid generated month label' });
  return [];
}

/**
 * Sequentially fetch every chunk, rate-limiting between calls so
 * the bank's per-card endpoint cannot trigger anti-bot throttling.
 *
 * @param ctx - Chunk-fetch context.
 * @param chunks - Ordered chunks resolved by {@link resolveChunkPlan}.
 * @returns Concatenated transactions across all chunks.
 */
async function collectChunkTxns(
  ctx: IChunkFetchArgs,
  chunks: readonly IBankMonth[],
): Promise<readonly ITransaction[]> {
  const allTxns: ITransaction[] = [];
  const seed = Promise.resolve(true as const);
  const chain = chunks.reduce(
    (prev, named): Promise<true> =>
      prev.then(async (): Promise<true> => {
        const txns = await fetchMatrixChunk(ctx, named);
        allTxns.push(...txns);
        return rateLimitPause(MATRIX_RATE_LIMIT_MS);
      }),
    seed,
  );
  await chain;
  return allTxns;
}

export default tryMatrixLoop;
export type { IMatrixLoopArgs };
export { tryMatrixLoop };
