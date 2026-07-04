/**
 * Max scrape shape — transactions helpers. getTransactionsAndGraphs is a
 * single monthly GET (firstCallCardIndex=-1 returns ALL cards merged); the
 * driver calls it once per account per month, and extractPage filters the
 * merged rows to the account's card (MaxShapeExtract.filterMaxRows). The
 * cursor is a 0-based month offset from the window start; the driver advances
 * it until the last in-window month, then stops. Empty months yield no rows.
 *
 * filterData carries the Max "show all cards" object
 * ({userIndex:-1,cardIndex:-1,monthView:true,date:"YYYY-M-01",…}),
 * URL-encoded; the version param rides via withVersion. Split from
 * MaxShapeHelpers.ts for the 150-LOC cap.
 */

import moment from 'moment';

import type { IExtractPageArgs } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { getFutureMonths } from '../../../Types/ScraperDefaults.js';
import { filterMaxRows } from './MaxShapeExtract.js';
import { clientVersionOf, type IMaxCard, MAX_API, withVersion } from './MaxShapeHelpers.js';

/**
 * First transaction month of the scrape window (from ScraperOptions.startDate).
 * @param ctx - Action context.
 * @returns Start-of-month moment for the window start.
 */
function startMonth(ctx: IActionContext): moment.Moment {
  return moment(ctx.options.startDate).startOf('month');
}

/**
 * Highest in-window month offset — months from the start month to
 * now + futureMonthsToScrape (inclusive of the upcoming cycle).
 * @param ctx - Action context.
 * @returns Last 0-based month offset.
 */
function lastOffset(ctx: IActionContext): number {
  const future = getFutureMonths(ctx.options);
  const end = moment().add(future, 'months').startOf('month');
  const start = startMonth(ctx);
  return end.diff(start, 'months');
}

/**
 * Resolve the 0-based month offset for this round (0 on the first call).
 * @param cursor - Incoming cursor (false on first call).
 * @returns Month offset.
 */
function offsetOf(cursor: number | false): number {
  return cursor === false ? 0 : cursor;
}

/**
 * Target transaction month for a given offset.
 * @param ctx - Action context.
 * @param offset - 0-based month offset.
 * @returns Moment for the target month.
 */
function monthAt(ctx: IActionContext, offset: number): moment.Moment {
  return startMonth(ctx).add(offset, 'months');
}

/**
 * getTransactionsAndGraphs "show all cards" filterData template — the exact
 * object Max's API requires (userIndex/cardIndex -1, monthView, a YYYY-M-01
 * `date`, all-cards bankAccount). Mirrors upstream max.ts getTransactionsUrl
 * and the generic pipeline's FILTER_DATA_TEMPLATE; the simplified
 * {month,year} form is rejected with result:null, returnCode:10.
 */
const MAX_FILTER_DATA = {
  userIndex: -1,
  cardIndex: -1,
  monthView: true,
  date: '{date}',
  dates: { startDate: '0', endDate: '0' },
  bankAccount: { bankAccountIndex: -1, cards: null },
} as const;

/**
 * URL-encoded filterData for the target month — the full show-all object with
 * `date` slotted as YYYY-M-01 (1-based month, no zero-pad, per the Max
 * contract).
 * @param m - Target month moment.
 * @returns Encoded filterData query value.
 */
function filterDataParam(m: moment.Moment): string {
  const year = m.year();
  const month = m.month() + 1;
  const dateStr = `${String(year)}-${String(month)}-01`;
  const json = JSON.stringify(MAX_FILTER_DATA).replace('{date}', dateStr);
  return encodeURIComponent(json);
}

/**
 * Assemble the getTransactionsAndGraphs base URL (all cards) for a month.
 * @param filter - URL-encoded filterData value.
 * @returns Base URL with filterData + firstCallCardIndex (no version).
 */
function txnsBase(filter: string): string {
  const path = `${MAX_API}/transactionDetails/getTransactionsAndGraphs`;
  return `${path}?filterData=${filter}&firstCallCardIndex=-1`;
}

/**
 * Transactions URL — getTransactionsAndGraphs for one month, all cards
 * (firstCallCardIndex=-1), version-tagged. `acct` is unused here (the monthly
 * call is card-agnostic); per-card filtering happens in extractPage.
 * @param _acct - Max card (unused — the monthly call returns all cards).
 * @param cursor - Cursor (false on first call).
 * @param ctx - Action context (carries startDate + client version).
 * @returns Literal Max transactions URL.
 */
export function txnsUrl(
  _acct: IMaxCard,
  cursor: number | false,
  ctx: IActionContext,
): WKUrlOrLiteral {
  const offset = offsetOf(cursor);
  const month = monthAt(ctx, offset);
  const filter = filterDataParam(month);
  const base = txnsBase(filter);
  const version = clientVersionOf(ctx);
  const url = withVersion(base, version);
  return literalUrl(url);
}

/**
 * Next cursor — advance one month until the last in-window month, then stop.
 * Driven by offset (not row count), so empty months keep the walk going.
 * @param offset - Offset just fetched.
 * @param ctx - Action context.
 * @returns Next cursor, or false when the window is exhausted.
 */
function nextCursorOf(offset: number, ctx: IActionContext): number | false {
  return offset < lastOffset(ctx) ? offset + 1 : false;
}

/**
 * Extract one month's transactions for the account's card + the next month
 * cursor. The monthly call returns all cards; rows are filtered by last-4.
 * @param args - Bundle carrying the unwrapped body + cursor + acct + ctx.
 * @returns Page rows + next cursor.
 */
export function txnsExtractPage(args: IExtractPageArgs<IMaxCard, number>): IPage<object, number> {
  const rows = filterMaxRows(args.body, args.acct.last4);
  const offset = offsetOf(args.cursor);
  return { items: rows, nextCursor: nextCursorOf(offset, args.ctx) };
}
