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

import type moment from 'moment';

import {
  lastOffset,
  monthAt,
  nextCursorOf,
  offsetOf,
} from '../../../Phases/ApiDirectScrape/CardIssuer/CardIssuerShapeTxns.js';
import type { IExtractPageArgs } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { filterMaxRows } from './MaxShapeExtract.js';
import { clientVersionOf, type IMaxCard, MAX_API, withVersion } from './MaxShapeHelpers.js';

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
 * Extract one month's transactions for the account's card + the next month
 * cursor. The monthly call returns all cards; rows are filtered by last-4.
 * Max declares no open-cycle floor, so `lastOffset` takes no floor argument.
 * @param args - Bundle carrying the unwrapped body + cursor + acct + ctx.
 * @returns Page rows + next cursor.
 */
export function txnsExtractPage(args: IExtractPageArgs<IMaxCard, number>): IPage<object, number> {
  const rows = filterMaxRows(args.body, args.acct.last4);
  const offset = offsetOf(args.cursor);
  const ceiling = lastOffset(args.ctx);
  const nextCursor = nextCursorOf(offset, ceiling);
  return { items: rows, nextCursor };
}
