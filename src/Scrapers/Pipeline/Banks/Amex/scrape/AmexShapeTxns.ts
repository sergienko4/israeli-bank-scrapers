/**
 * Amex scrape shape — transactions helpers. GetTransactionsList is
 * per-card, per-billing-month: one POST
 * /ocp/transactions/DigitalV3.Transactions/GetTransactionsList per month in
 * the scrape window, body {card4Number, isNextBillingDate:true,
 * cardStatus:0, billingMonth:"01/MM/YYYY", companyCode, isPartner:false}.
 * The cursor is a 0-based month offset from the window start; the driver
 * advances it until the last in-window month, then stops. Empty months
 * return no rows and are tolerated as empty pages.
 *
 * `isNextBillingDate` is held true for every month (matching the proven
 * captured request shape); `billingMonth` alone selects the cycle. Raw
 * rows flow downstream to the Data Mapper unchanged. Split from
 * AmexShapeHelpers.ts for the 150-LOC cap.
 */

import moment from 'moment';

import type {
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { getFutureMonths } from '../../../Types/ScraperDefaults.js';
import { mergeAmexRows } from './AmexShapeExtract.js';
import { AMEX_API, type IAmexCard } from './AmexShapeHelpers.js';

/**
 * First billing month of the scrape window (from ScraperOptions.startDate).
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
 * Amex composite billing month `01/MM/YYYY` (first-of-month) for an offset.
 * @param ctx - Action context.
 * @param offset - 0-based month offset.
 * @returns billingMonth string.
 */
function billingMonthAt(ctx: IActionContext, offset: number): string {
  const mm = startMonth(ctx).add(offset, 'months').format('MM/YYYY');
  return `01/${mm}`;
}

/**
 * Assemble the GetTransactionsList body from its resolved parts.
 * @param card4Number - Card last-4 (sent as card4Number).
 * @param companyCode - Numeric per-card brand code.
 * @param billingMonth - Composite first-of-month `01/MM/YYYY`.
 * @returns Request body.
 */
function amexTxnBody(card4Number: string, companyCode: number, billingMonth: string): VarsMap {
  return {
    card4Number,
    isNextBillingDate: true,
    cardStatus: 0,
    billingMonth,
    companyCode,
    isPartner: false,
  };
}

/**
 * Build txns POST body for one card-month. `card4Number`←cardSuffix,
 * `companyCode` is the numeric per-card brand code, `billingMonth` is the
 * first-of-month composite; `isNextBillingDate` stays true (proven shape).
 * @param card - Amex card.
 * @param cursor - Cursor (false on first call).
 * @param ctx - Action context (carries startDate + futureMonths).
 * @returns Request body.
 */
export function txnsVars(card: IAmexCard, cursor: number | false, ctx: IActionContext): VarsMap {
  const offset = offsetOf(cursor);
  const billingMonth = billingMonthAt(ctx, offset);
  const companyCode = Number(card.companyCode);
  return amexTxnBody(card.cardSuffix, companyCode, billingMonth);
}

/**
 * Transactions URL — the static GetTransactionsList endpoint.
 * @returns Literal Amex transactions URL.
 */
export function txnsUrl(): WKUrlOrLiteral {
  return literalUrl(`${AMEX_API}/ocp/transactions/DigitalV3.Transactions/GetTransactionsList`);
}

/**
 * Next cursor — advance one month until the last in-window month, then
 * stop. Driven by offset (not row count) so empty months keep the walk
 * going until the window is exhausted.
 * @param offset - Offset just fetched.
 * @param ctx - Action context.
 * @returns Next cursor, or false when the window is exhausted.
 */
function nextCursorOf(offset: number, ctx: IActionContext): number | false {
  return offset < lastOffset(ctx) ? offset + 1 : false;
}

/**
 * Extract one month's transactions page + the next month cursor.
 * @param args - Bundle carrying the unwrapped body + cursor + ctx.
 * @returns Page rows + next cursor.
 */
export function txnsExtractPage(args: IExtractPageArgs<IAmexCard, number>): IPage<object, number> {
  const rows = mergeAmexRows(args.body);
  const offset = offsetOf(args.cursor);
  return { items: rows, nextCursor: nextCursorOf(offset, args.ctx) };
}
