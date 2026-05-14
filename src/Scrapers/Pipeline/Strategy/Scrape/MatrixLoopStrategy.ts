/**
 * Matrix Loop Strategy — additive monthly endpoint iteration.
 * Activates ONLY when NetworkDiscovery finds a monthly-pattern endpoint.
 * Does NOT modify the legacy billing fallback used by Discount/VisaCal.
 *
 * SOLID (OCP): extends scrape capabilities without modifying existing code.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { parseFreshResponse } from '../../Mediator/Dashboard/TxnParser.js';
import {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
} from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { applyDateRangeToUrl } from '../../Mediator/Scrape/UrlDateRange.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IBillingCycle } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import {
  buildAccountResult,
  deduplicateTxns,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
  rateLimitPause,
} from './ScrapeDataActions.js';
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
function resolveChunkPlan(fc: IAccountFetchCtx): readonly IMonthChunkLike[] {
  const catalog = fc.billingCycleCatalog;
  const hasCatalog = catalog !== undefined && catalog.cycles.length > 0;
  if (!hasCatalog) {
    const startDate = parseStartDate(fc.startDate);
    return generateMonthChunks(startDate, new Date(), fc.futureMonths);
  }
  const cycleCount = catalog.cycles.length;
  LOG.debug({
    message: `MatrixLoop: catalog-driven — cycles=${String(cycleCount)}`,
  });
  return catalog.cycles.map(cycleToChunk);
}

/**
 * Project one canonical {@link IBillingCycle} onto the
 * {@link IMonthChunkLike} shape consumed by {@link fetchMatrixChunk}.
 * The chunk start is parsed from the cycle's `billingDate` (Backbase
 * `MM/YYYY`, Max ISO, VisaCal ISO). Unparseable dates fall back to
 * the current month so the iteration still emits SOMETHING and the
 * fail-loud guard at SCRAPE.POST catches a true regression.
 *
 * @param cycle - One canonical cycle from the catalog.
 * @returns Month-chunk with ISO `start` consumed by the fetcher.
 */
function cycleToChunk(cycle: IBillingCycle): IMonthChunkLike {
  const parsed = parseCycleDate(cycle.billingDate);
  return { start: parsed.toISOString() };
}

/**
 * Parse a cycle billing-date across all known per-bank shapes —
 * Backbase `MM/YYYY`, Max ISO `YYYY-MM-DD`, VisaCal ISO same.
 * Returns the first-of-month derived from the parsed value so the
 * fetcher's `getMonth()` / `getFullYear()` reads land on the right
 * cycle. Falls back to the current month-start on parse failure.
 *
 * @param raw - Raw billing-date string.
 * @returns Parsed first-of-month Date.
 */
function parseCycleDate(raw: string): Date {
  const fromBackbase = tryParseBackbase(raw);
  if (fromBackbase !== false) return fromBackbase;
  const fromIso = tryParseIso(raw);
  if (fromIso !== false) return fromIso;
  return currentMonthStart();
}

/** Lower bound for a calendar month, used by {@link tryParseBackbase}. */
const MIN_CALENDAR_MONTH = 1;
/** Upper bound for a calendar month, used by {@link tryParseBackbase}. */
const MAX_CALENDAR_MONTH = 12;

/**
 * Parse the Backbase `MM/YYYY` shape with strict month-range
 * validation. Values like `00/2026` or `13/2026` reject so callers
 * fall through to ISO parse or the deterministic month-start
 * fallback instead of silently shifting into adjacent years.
 *
 * @param raw - Raw cycle billing-date string.
 * @returns First-of-month Date on success; `false` on miss.
 */
function tryParseBackbase(raw: string): Date | false {
  const match = /^(\d{2})\/(\d{4})$/.exec(raw);
  if (match === null) return false;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < MIN_CALENDAR_MONTH || month > MAX_CALENDAR_MONTH) return false;
  return new Date(year, month - 1, 1);
}

/**
 * Parse the ISO-shape billing date Max + VisaCal emit.
 *
 * <p>Extracts year and month directly from the leading `YYYY-MM`
 * fragment instead of going through `new Date(raw)` — the latter
 * parses date-only strings (`2026-06-02`) as UTC midnight, then
 * `getMonth()` reads LOCAL time, which silently rolls back the
 * month in negative-UTC zones (UTC-5, UTC-8…). The regex path is
 * timezone-independent: a string carrying `2026-06-02` always
 * resolves to June 2026 regardless of the runner's locale.
 *
 * @param raw - Raw cycle billing-date string (date-only or full
 *   ISO 8601 with time component).
 * @returns First-of-month Date on success; `false` on miss.
 */
function tryParseIso(raw: string): Date | false {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(raw);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < MIN_CALENDAR_MONTH || month > MAX_CALENDAR_MONTH) return false;
  return new Date(year, month - 1, 1);
}

/**
 * Deterministic fallback — the first day of the current month —
 * used when neither Backbase nor ISO parsing claims the input.
 *
 * @returns First-of-current-month Date.
 */
function currentMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
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
  chunks: readonly IMonthChunkLike[],
): Promise<readonly ITransaction[]> {
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
  return allTxns;
}

/** Minimal chunk shape — only the `start` field {@link fetchMatrixChunk} reads. */
interface IMonthChunkLike {
  readonly start: string;
}

export default tryMatrixLoop;
export type { IMatrixLoopArgs };
export { tryMatrixLoop };
