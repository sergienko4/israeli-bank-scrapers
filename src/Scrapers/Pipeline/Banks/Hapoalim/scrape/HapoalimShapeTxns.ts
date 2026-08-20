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
 * each full page is followed by another whose window ends the day before the
 * oldest row just seen, walking backwards until a short page arrives or the
 * caller's start date is reached.
 *
 * Wire body note: the SPA POSTs `[]` (empty array); the hard-model
 * dispatch path is object-typed, so it sends `{}`. Both serialise to an
 * empty JSON container and the endpoint reads every parameter from the
 * query string, so the two are equivalent for this call.
 */

import { randomUUID } from 'node:crypto';

import moment from 'moment';

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
 * (Rule #15), and minted only by {@link dayBeforeOldest}.
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
 * Retrieval end date (YYYYMMDD — today, upstream parity).
 * @returns Formatted retrievalEndDate.
 */
function endOf(): string {
  return moment().format(HAPOALIM_DATE_FMT);
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
  const base = `${HAPOALIM_API}/current-account/transactions`;
  const endDate = cursor === false ? endOf() : cursor;
  const range = `retrievalEndDate=${endDate}&retrievalStartDate=${startOf(ctx)}`;
  const paging = `numItemsPerPage=${TXN_PAGE_SIZE}&sortCode=1`;
  const tail = `accountId=${acct.composite}&lang=he`;
  return literalUrl(`${base}?${paging}&${range}&${tail}`);
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
 * The day before the oldest row on this page, as the next window's end.
 *
 * Exclusive on purpose. An inclusive bound would re-fetch every row sharing
 * that date and emit them twice, and this library must not hand a consumer the
 * same purchase under two rows.
 *
 * @param rows - Rows on the current page.
 * @returns Next end date (YYYYMMDD), or false when no row carried a date.
 */
function dayBeforeOldest(rows: readonly HapoalimTxn[]): HapoalimCursor | false {
  const dates = rows
    .map((row): unknown => row[ROW_DATE_FIELD])
    .filter((value): value is number | string => value !== undefined && value !== null)
    .map((value): string => String(value));
  if (dates.length === 0) return false;
  const oldest = dates.reduce((a, b): string => (a < b ? a : b));
  const previousDay = moment(oldest, HAPOALIM_DATE_FMT).subtract(1, 'day');
  return previousDay.format(HAPOALIM_DATE_FMT) as HapoalimCursor;
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

  const nextEnd = dayBeforeOldest(rows);
  // A full page whose rows carry no usable date cannot be walked backwards.
  // Stopping keeps the rows already gathered; recursing would repeat this page
  // forever.
  if (nextEnd === false) return { items: rows, nextCursor: false };
  // Walked past the window the caller asked for — done, not truncated.
  if (nextEnd < startOf(args.ctx)) return { items: rows, nextCursor: false };
  return { items: rows, nextCursor: nextEnd };
}

/**
 * No-op variables builder — the POST body is an empty container; all
 * params ride the URL query string.
 * @returns Empty variables map.
 */
export function txnsVars(): VarsMap {
  return {};
}
