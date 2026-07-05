/**
 * Yahav BaNCS transactions request Payload (call 0033) — a `Transaction_1.0.0`
 * DataEntity keyed by the resolved account (`id` + `iorId`), scoped to the
 * `CURRENT_ACCOUNT` category and bounded by ONE month chunk's OrigDt window.
 *
 * The scrape window `[startDate, today]` is walked month-by-month (reusing the
 * shared `generateMonthChunks`, whose end is capped at today so BaNCS never
 * sees a future to-bound and empties the response — the failure PR #405 fixed
 * for the generic path). Grounded verbatim in the captured trace.
 */

import type { IMonthChunk } from '../../../Mediator/Scrape/ScrapeReplay/MonthChunking.js';
import type { VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { IYahavAcct } from './YahavShapeHelpers.js';
import { refDataList } from './YahavShapePayloads.js';

/**
 * BaNCS calendar-date `{Day,Month,Year}` from an ISO string's date prefix
 * (`YYYY-MM-DD…`), taken verbatim so the month-chunk boundary is preserved.
 * @param iso - Month-chunk ISO timestamp.
 * @returns BaNCS `Date_1.0.0` block.
 */
function isoDatePart(iso: string): VarsMap {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return { Ver: 'Date_1.0.0', Day: Number(day), Month: Number(month), Year: Number(year) };
}

/**
 * One OrigDt bound filter (GTE window-start / LTE window-end).
 * @param iso - Bound ISO timestamp.
 * @param operator - `GREATERTHANOREQUAL` or `LESSTHANOREQUAL`.
 * @returns Transaction-list filter block.
 */
function origDtFilter(iso: string, operator: string): VarsMap {
  return { Ver: 'TransactionListFilter_1.0.0', OrigDt: isoDatePart(iso), Operator: operator };
}

/**
 * AND-filter bounding one month chunk `[chunk.start, chunk.end]`.
 * @param chunk - The month chunk (end already capped at today).
 * @returns Single-element Filters array.
 */
function chunkFilters(chunk: IMonthChunk): VarsMap[] {
  const start = origDtFilter(chunk.start, 'GREATERTHANOREQUAL');
  const end = origDtFilter(chunk.end, 'LESSTHANOREQUAL');
  return [{ Ver: 'ANDFilter_1.0.0', Filters: [start, end] }];
}

/**
 * Transaction DataEntity carrying the resolved account id + iorId.
 * @param acct - Resolved Yahav account.
 * @returns Single-element DataEntity array.
 */
function txnEntity(acct: IYahavAcct): VarsMap[] {
  const acctIds = { BANKACCOUNTID: '' };
  const idBlock = { Ver: 'Identifier_1.0.0', Id: acct.id };
  const head = { Ver: 'AccountIdentifier_1.0.0', AcctIds: acctIds };
  const accountId = { ...head, Id: idBlock, iorId: acct.iorId };
  return [{ Ver: 'Transaction_1.0.0', AccountId: accountId }];
}

/**
 * Transactions request Payload — CURRENT_ACCOUNT rows in one month chunk.
 * @param acct - Resolved Yahav account.
 * @param chunk - The month chunk to fetch.
 * @param ctx - Action context (carries portfolio refs).
 * @returns Transactions `Payload` block.
 */
export function txnsPayload(acct: IYahavAcct, chunk: IMonthChunk, ctx: IActionContext): VarsMap {
  const head = { Ver: 'MessagePayload_1.0.0', DataEntity: txnEntity(acct), Operation: 'INQ' };
  const filters = chunkFilters(chunk);
  const tail = { Category: ['CURRENT_ACCOUNT'], Filters: filters, RefDataList: refDataList(ctx) };
  return { ...head, ...tail };
}

export default txnsPayload;
