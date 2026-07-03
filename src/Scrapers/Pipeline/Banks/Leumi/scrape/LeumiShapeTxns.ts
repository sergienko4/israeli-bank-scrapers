/**
 * Leumi scrape shape — transactions helpers. A single `UC_SO_27` call
 * with the dated variant (RequestType 'OpersB', PeriodType '3', an
 * RFC-1123 `FromDateUTC`/`ToDateUTC` range) returns the whole window, so
 * there is no pagination cursor (`TCursor = never`).
 *
 * `extractPage` returns the raw `HistoryTransactionsItems` (completed)
 * rows verbatim; they normalise downstream via the field-mapping Data
 * Mapper (`DateUTC` → date, `ReferenceNumberLong` → identifier). Same-day
 * `TodayTransactionsItems` (pending) is out of scope for the hard model —
 * the driver marks every row Completed — and is `null` in every captured
 * sample. Split from `LeumiShapeHelpers.ts` to respect the 150-LOC cap.
 */

import moment from 'moment';

import type {
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { parseJsonResp } from './LeumiShapeEnvelope.js';
import type { ILeumiAcct } from './LeumiShapeHelpers.js';
import { type IUcSo27Variant, ucSo27Vars } from './LeumiShapeUcSo27.js';

interface ITxnsResp {
  readonly HistoryTransactionsItems?: readonly object[];
}

/**
 * Scrape-window start as an RFC-1123 UTC string (the wire format the WCF
 * `FromDateUTC` field expects — e.g. `Fri, 04 Jul 2025 21:00:00 GMT`).
 * @param ctx - Action context (carries startDate).
 * @returns RFC-1123 start date.
 */
function startDateOf(ctx: IActionContext): string {
  return moment(ctx.options.startDate).toDate().toUTCString();
}

/**
 * Dated transactions variant — 'OpersB' request over the scrape window.
 * @param ctx - Action context.
 * @returns UC_SO_27 dated variant.
 */
function txnVariant(ctx: IActionContext): IUcSo27Variant {
  return {
    requestType: 'OpersB',
    fromDateUtc: startDateOf(ctx),
    toDateUtc: new Date().toUTCString(),
    periodType: '3',
  };
}

/**
 * Transactions-step vars — shared UC_SO_27 builder, dated variant.
 * @param acct - Leumi account.
 * @param _cursor - Unused (single-page date range).
 * @param ctx - Action context (carries startDate).
 * @returns Envelope vars map.
 */
export function txnsVars(acct: ILeumiAcct, _cursor: false, ctx: IActionContext): VarsMap {
  const variant = txnVariant(ctx);
  return ucSo27Vars(acct.accountIndex, ctx, variant);
}

/**
 * Extract the single transactions page — raw completed rows, no next
 * cursor (the dated call returns the whole window).
 * @param args - Bundle carrying the raw WCF response body.
 * @returns Page rows + terminal cursor.
 */
export function txnsExtractPage(args: IExtractPageArgs<ILeumiAcct, never>): IPage<object, never> {
  const resp = parseJsonResp(args.body) as unknown as ITxnsResp;
  const rows = resp.HistoryTransactionsItems ?? [];
  return { items: rows, nextCursor: false };
}
