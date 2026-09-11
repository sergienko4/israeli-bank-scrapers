/**
 * Matrix Loop Strategy — additive monthly endpoint iteration.
 * Activates ONLY when NetworkDiscovery finds a monthly-pattern endpoint.
 * Does NOT modify the legacy billing fallback used by Discount/VisaCal.
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
import {
  bankMonthBounds,
  bankMonthOfLabel,
  bankMonthOfSlashedLabel,
} from '../../Mediator/Scrape/BankMonth.js';
import {
  fitsMonthRequestBudget,
  MAX_MONTH_REQUESTS,
} from '../../Mediator/Scrape/MonthRangeBudget.js';
import {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { applyDateRangeAndAppend } from '../../Mediator/Scrape/UrlDateRange.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IBillingCycle } from '../../Types/PipelineContext.js';
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
      `MatrixLoop: cycle catalog exceeds ${String(MAX_MONTH_REQUESTS)}-request budget`,
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
 * Resolve the per-card month-iteration plan from the most
 * authoritative source available — the bank-reported cycle catalog
 * when present, the blind month-chunk fallback otherwise.
 *
 * <p>Catalog-driven iteration covers the OPEN cycle the blind
 * month-chunk plan can miss (the bank's billing date may fall in a
 * future month outside the `futureMonths` window). Non-cycling
 * banks (Hapoalim / Beinleumi / Discount / OneZero / Pepper) carry
 * no catalog — fallback path keeps current behaviour.
 *
 * @param fc - Per-account fetch context plumbed by SCRAPE.PRE.
 * @returns Ordered month chunks for {@link collectChunkTxns}.
 */
function resolveChunkPlan(fc: IAccountFetchCtx): readonly IBankMonth[] | false {
  const catalog = fc.billingCycleCatalog;
  const hasCatalog = catalog !== undefined && catalog.cycles.length > 0;
  if (!hasCatalog) {
    const startDate = parseStartDate(fc.startDate);
    const chunks = generateMonthChunks(startDate, new Date(), fc.futureMonths);
    return chunks.flatMap(chunkToMonth);
  }
  const cycleCount = catalog.cycles.length;
  LOG.debug({
    message: `MatrixLoop: catalog-driven — cycles=${String(cycleCount)}`,
  });
  const chunks = catalog.cycles.flatMap(cycleToMonth);
  if (fitsMonthRequestBudget(chunks)) return chunks;
  LOG.warn({ message: 'MatrixLoop: rejected oversized cycle catalog' });
  return false;
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
 * Project one canonical billing cycle onto its named bank month.
 * Invalid provider labels are rejected rather than redirected to another month.
 *
 * @param cycle - One canonical cycle from the catalog.
 * @returns One validated month, or empty for an invalid provider label.
 */
function cycleToMonth(cycle: IBillingCycle): readonly IBankMonth[] {
  const parsed = parseCycleMonth(cycle.billingDate);
  if (parsed !== false) return [parsed];
  LOG.warn({ message: 'MatrixLoop: skipped invalid billing-cycle label' });
  return [];
}

/**
 * Parse every known billing-date shape into a bank month.
 *
 * @param raw - Raw billing-date string.
 * @returns Named month, or false for an invalid provider label.
 */
function parseCycleMonth(raw: string): IBankMonth | false {
  const fromBackbase = bankMonthOfSlashedLabel(raw);
  if (fromBackbase !== false) return fromBackbase;
  const fromIso = bankMonthOfLabel(raw);
  if (fromIso !== false) return fromIso;
  return false;
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
