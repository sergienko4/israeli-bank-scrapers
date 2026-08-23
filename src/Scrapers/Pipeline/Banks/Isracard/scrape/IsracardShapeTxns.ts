/**
 * Isracard scrape shape — transactions helpers. GetTransactionsList is
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
 * IsracardShapeHelpers.ts for the 150-LOC cap. Grounded in the Isracard
 * network trace (billingMonth "01/06/2026", companyCode 11).
 */

import {
  billingMonthAt,
  lastOffset,
  nextCursorOf,
  offsetOf,
} from '../../../Phases/ApiDirectScrape/CardIssuer/CardIssuerShapeTxns.js';
import type {
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { mergeIsracardRows } from './IsracardShapeExtract.js';
import { type IIsracardCard, ISRACARD_API } from './IsracardShapeHelpers.js';

/**
 * Assemble the GetTransactionsList body from its resolved parts.
 * @param card4Number - Card last-4 (sent as card4Number).
 * @param companyCode - Numeric per-card brand code.
 * @param billingMonth - Composite first-of-month `01/MM/YYYY`.
 * @returns Request body.
 */
function isracardTxnBody(card4Number: string, companyCode: number, billingMonth: string): VarsMap {
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
 * @param card - Isracard card.
 * @param cursor - Cursor (false on first call).
 * @param ctx - Action context (carries startDate + futureMonths).
 * @returns Request body.
 */
export function txnsVars(
  card: IIsracardCard,
  cursor: number | false,
  ctx: IActionContext,
): VarsMap {
  const offset = offsetOf(cursor);
  const billingMonth = billingMonthAt(ctx, offset);
  const companyCode = Number(card.companyCode);
  return isracardTxnBody(card.cardSuffix, companyCode, billingMonth);
}

/**
 * Transactions URL — the static GetTransactionsList endpoint.
 * @returns Literal Isracard transactions URL.
 */
export function txnsUrl(): WKUrlOrLiteral {
  return literalUrl(`${ISRACARD_API}/ocp/transactions/DigitalV3.Transactions/GetTransactionsList`);
}

/**
 * Extract one month's transactions page + the next month cursor. Isracard
 * declares no open-cycle floor, so `lastOffset` takes no floor argument.
 * @param args - Bundle carrying the unwrapped body + cursor + ctx.
 * @returns Page rows + next cursor.
 */
export function txnsExtractPage(
  args: IExtractPageArgs<IIsracardCard, number>,
): IPage<object, number> {
  const rows = mergeIsracardRows(args.body);
  const offset = offsetOf(args.cursor);
  const ceiling = lastOffset(args.ctx);
  const nextCursor = nextCursorOf(offset, ceiling);
  return { items: rows, nextCursor };
}
