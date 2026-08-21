/**
 * Hapoalim scrape shape — transactions helpers. A single full-window
 * POST against `current-account/transactions` (all params ride the query
 * string; the body is an empty container). Raw rows flow downstream to
 * the field-mapping Data Mapper unchanged. Split from
 * HapoalimShapeHelpers.ts to respect the 150-LOC ceiling.
 *
 * Anti-replay contract (upstream `fetchPoalimXSRFWithinPage` + captured
 * trace 0073): Hapoalim rejects the POST unless the request echoes the
 * `XSRF-TOKEN` cookie as the `X-XSRF-TOKEN` header, carries the fixed
 * `pageUuid`, a fresh `uuid`, and the exact `content-type`. The
 * `@cookie:` sentinel is resolved from the live login session by
 * BrowserFetchStrategy at dispatch time.
 *
 * Paging note: this endpoint is date-windowed, not offset-paged, and the bank
 * caps a response SERVER-SIDE at its own `numItemsPerPage` — it ignores the
 * larger size asked for below and returns the most RECENT N rows, silently
 * dropping everything older in the requested window. So the cursor is a date:
 * each full page is followed by another whose window ends ON the oldest day
 * just seen, inclusively, walking backwards until a short page arrives or the
 * caller's start date is reached. The bound is inclusive because the cap counts
 * ROWS, not days — a busy day can be cut in half by it, so excluding that day
 * would drop the untold remainder of it. Re-served rows are removed downstream
 * by the overlap multiset difference.
 *
 * Wire body note: the SPA POSTs `[]` (empty array); the hard-model
 * dispatch path is object-typed, so it sends `{}`. Both serialise to an
 * empty JSON container and the endpoint reads every parameter from the
 * query string, so the two are equivalent for this call.
 */

import { randomUUID } from 'node:crypto';

import moment from 'moment';

import { scrapeWindowEnd } from '../../../Mediator/Scrape/ScrapeWindowEnd.js';
import type {
  HeaderMap,
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import { COOKIE_HEADER_SENTINEL_PREFIX } from '../../../Strategy/Fetch/CookieHeaderSentinel.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { Brand } from '../../../Types/Brand.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { HAPOALIM_API, type IHapoalimAcct } from './HapoalimShapeHelpers.js';

/** Retrieval date format (YYYYMMDD, no separators). */
const HAPOALIM_DATE_FMT = 'YYYYMMDD';
/** Page size asked for. The bank caps below this and says so in its own
 *  `numItemsPerPage`, which is what {@link pageWasCapped} reads. */
const TXN_PAGE_SIZE = '1000';
/** Field the bank reports its OWN effective page size in. */
const SERVER_PAGE_SIZE_FIELD = 'numItemsPerPage';
/** Row field carrying the transaction's date (YYYYMMDD as a number). */
const ROW_DATE_FIELD = 'eventDate';
/** A usable date token: exactly eight digits, matching {@link HAPOALIM_DATE_FMT}. */
const DATE_TOKEN = /^\d{8}$/;
/** Fixed anti-replay pageUuid (upstream fetchPoalimXSRFWithinPage). */
const TXN_PAGE_UUID = '/current-account/transactions';
/** X-XSRF-TOKEN header value — cookie-echo sentinel resolved at dispatch. */
const XSRF_HEADER_VALUE = `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN`;

type HapoalimTxn = Record<string, unknown>;

interface ITxnsResp {
  readonly transactions?: readonly HapoalimTxn[];
  /** The bank's OWN effective page size, which can be lower than requested. */
  readonly [SERVER_PAGE_SIZE_FIELD]?: number;
}

/**
 * Cursor: the `retrievalEndDate` (YYYYMMDD) for the next page, walking back.
 * Branded so it cannot be confused with any other string this shape handles
 * (Rule #15), and minted only by {@link oldestDay}.
 */
export type HapoalimCursor = Brand<string, 'HapoalimRetrievalEndDate'>;

/**
 * Retrieval start date (YYYYMMDD from ScraperOptions.startDate).
 * @param ctx - Action context.
 * @returns Formatted retrievalStartDate.
 */
function startOf(ctx: IActionContext): string {
  return moment(ctx.options.startDate).format(HAPOALIM_DATE_FMT);
}

/**
 * Retrieval end date (YYYYMMDD) — the window's upper bound, narrowed during a
 * coverage backfill and otherwise today (upstream parity).
 * @param ctx - Action context.
 * @returns Formatted retrievalEndDate.
 */
function endOf(ctx: IActionContext): string {
  const windowEnd = scrapeWindowEnd(ctx);
  return moment(windowEnd).format(HAPOALIM_DATE_FMT);
}

/**
 * The query string for one transactions page.
 * @param acct - Hapoalim account.
 * @param endDate - End date this page asks for.
 * @param ctx - Action context (carries startDate).
 * @returns Encoded query string, without the leading `?`.
 */
function txnsQuery(acct: IHapoalimAcct, endDate: string, ctx: IActionContext): string {
  const paging = `numItemsPerPage=${TXN_PAGE_SIZE}&sortCode=1`;
  const range = `retrievalEndDate=${endDate}&retrievalStartDate=${startOf(ctx)}`;
  return `${paging}&${range}&accountId=${acct.composite}&lang=he`;
}

/**
 * Transactions URL — one date window against current-account/transactions.
 * @param acct - Hapoalim account.
 * @param cursor - End date for this page, or false for the first (today).
 * @param ctx - Action context (carries startDate).
 * @returns Literal transactions URL.
 */
export function txnsUrl(
  acct: IHapoalimAcct,
  cursor: HapoalimCursor | false,
  ctx: IActionContext,
): WKUrlOrLiteral {
  const endDate = cursor === false ? endOf(ctx) : cursor;
  const query = txnsQuery(acct, endDate, ctx);
  return literalUrl(`${HAPOALIM_API}/current-account/transactions?${query}`);
}

/**
 * Anti-replay header set — cookie-echo XSRF token, fixed pageUuid, fresh
 * uuid, and the exact content-type Hapoalim requires for the POST.
 * @returns Per-call header map.
 */
export function txnsHeaders(): HeaderMap {
  return {
    'content-type': 'application/json;charset=UTF-8',
    'X-XSRF-TOKEN': XSRF_HEADER_VALUE,
    pageUuid: TXN_PAGE_UUID,
    uuid: randomUUID(),
  };
}

/**
 * Whether the bank truncated this page at its own cap.
 *
 * The request asks for {@link TXN_PAGE_SIZE}; the response states the size the
 * bank actually applied. A page holding exactly that many rows is the shape of
 * a truncation, and older rows in the window were dropped.
 *
 * @param resp - Unwrapped response body.
 * @param rowCount - Rows this page carried.
 * @returns True when the page is full at the bank's own limit.
 */
function pageWasCapped(resp: ITxnsResp, rowCount: number): boolean {
  const serverPageSize = resp[SERVER_PAGE_SIZE_FIELD];
  if (typeof serverPageSize !== 'number' || serverPageSize <= 0) return false;
  return rowCount >= serverPageSize;
}

/**
 * The oldest day on this page, as the next window's end.
 *
 * <p>Inclusive of that day. The bank caps a page by **row count**
 * ({@link pageWasCapped}), not by date, so the cut lands part-way through a day
 * whenever that day holds more rows than the page budget left. Resuming at
 * `oldest - 1` would step over the rows the cap withheld and lose them with no
 * trace — the silent loss this walk exists to prevent. Re-asking the same day
 * re-serves rows already held, and the step declares `pagesMayOverlap` so the
 * paginator drops them by raw row identity.
 *
 * <p>The walk still terminates: a day that cannot be split — one holding more
 * rows than the cap — derives this same cursor again, and the paginator halts
 * on a repeated cursor rather than recursing.
 *
 * <p>Only well-formed tokens are considered. A row carrying `0`, an empty
 * string, or a differently-formatted date is not a dated transaction, and
 * `String` renders each of those below every real `YYYYMMDD` token. Letting one
 * through would win the minimum, read as older than the caller's start, and end
 * the walk with the rest of the window unasked for — silently.
 *
 * @param rows - Rows on the current page.
 * @returns Next end date (YYYYMMDD), or false when no row carried a usable date.
 */
function oldestDay(rows: readonly HapoalimTxn[]): HapoalimCursor | false {
  const dates = rows
    .map((row): unknown => row[ROW_DATE_FIELD])
    .map(String)
    .filter((value): boolean => DATE_TOKEN.test(value));
  if (dates.length === 0) return false;
  const [firstDate] = dates;
  const oldest = dates.reduce((a, b): string => (a < b ? a : b), firstDate);
  return oldest as HapoalimCursor;
}

/**
 * The end date the next page should ask for, or false when none is owed.
 *
 * Two distinct reasons return false, and both must keep the rows already
 * gathered rather than fail: a full page whose rows carry no usable date
 * cannot be walked backwards (recursing would re-ask the same window forever),
 * and a page that reached past the caller's start date is finished, not
 * truncated.
 *
 * @param rows - Rows the capped page returned.
 * @param ctx - Action context (carries startDate).
 * @returns The next window's end date, or false to stop.
 */
function nextEndFor(rows: readonly HapoalimTxn[], ctx: IActionContext): HapoalimCursor | false {
  const nextEnd = oldestDay(rows);
  if (nextEnd === false) return false;
  return nextEnd < startOf(ctx) ? false : nextEnd;
}

/**
 * Extract one transactions page and say whether another is owed.
 *
 * @param args - Bundle carrying the unwrapped response body and the context.
 * @returns Page rows, plus the next window's end date when the bank truncated.
 */
export function txnsExtractPage(
  args: IExtractPageArgs<IHapoalimAcct, HapoalimCursor>,
): IPage<object, HapoalimCursor> {
  const resp = args.body as unknown as ITxnsResp;
  const rows = resp.transactions ?? [];
  if (!pageWasCapped(resp, rows.length)) return { items: rows, nextCursor: false };
  return { items: rows, nextCursor: nextEndFor(rows, args.ctx) };
}

/**
 * No-op variables builder — the POST body is an empty container; all
 * params ride the URL query string.
 * @returns Empty variables map.
 */
export function txnsVars(): VarsMap {
  return {};
}
