/**
 * VisaCal scrape shape — transactions helpers. The CAL transactions
 * endpoint is per-card, per-month: one POST
 * /Transactions/api/transactionsDetails/getCardTransactionsDetails call
 * for each billing month in the scrape window, body {cardUniqueId, month,
 * year} (all strings, mirroring BillingFallbackStrategy). The cursor is a
 * 0-based month offset from the window start; the driver advances it
 * until the last in-window month, then stops. Early/incomplete months
 * return `result: null` (statusCode -1) and are tolerated as empty pages.
 *
 * Raw card-transaction rows flow downstream to the field-mapping Data
 * Mapper unchanged. Split from VisaCalShapeHelpers.ts for the 150-LOC cap.
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
import { CAL_API, type IVisaCalCard } from './VisaCalShapeHelpers.js';

type VisaCalTxn = Record<string, unknown>;

interface IRawDebitDay {
  readonly transactions?: readonly VisaCalTxn[];
}
interface IRawImmediateDebits {
  readonly debitDays?: readonly IRawDebitDay[];
}
interface IRawBankAccount {
  readonly debitDates?: readonly IRawDebitDay[];
  readonly immidiateDebits?: IRawImmediateDebits;
}
interface ITxnsResp {
  readonly result?: { readonly bankAccounts?: readonly IRawBankAccount[] } | null;
}

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
 * now + futureMonthsToScrape (inclusive of the future cycle).
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
 * Target billing month for a given offset.
 * @param ctx - Action context.
 * @param offset - 0-based month offset.
 * @returns Moment for the target month.
 */
function monthAt(ctx: IActionContext, offset: number): moment.Moment {
  return startMonth(ctx).add(offset, 'months');
}

/**
 * Build txns POST body for one card-month: {cardUniqueId, month, year}
 * (all strings, per the CAL contract).
 * @param card - VisaCal card.
 * @param cursor - Cursor (false on first call).
 * @param ctx - Action context (carries startDate + futureMonths).
 * @returns Request body.
 */
export function txnsVars(card: IVisaCalCard, cursor: number | false, ctx: IActionContext): VarsMap {
  const offset = offsetOf(cursor);
  const m = monthAt(ctx, offset);
  const monthNum = m.month() + 1;
  const yearNum = m.year();
  return { cardUniqueId: card.cardUniqueId, month: String(monthNum), year: String(yearNum) };
}

/**
 * Transactions URL — the static getCardTransactionsDetails endpoint.
 * @returns Literal CAL transactions URL.
 */
export function txnsUrl(): WKUrlOrLiteral {
  return literalUrl(`${CAL_API}/Transactions/api/transactionsDetails/getCardTransactionsDetails`);
}

/**
 * Transactions of one debit-day block (a regular billing date or an
 * immediate-debit day).
 * @param d - Raw debit-day block.
 * @returns Debit-day transaction rows (empty when absent).
 */
function dayTxns(d: IRawDebitDay): readonly VisaCalTxn[] {
  return d.transactions ?? [];
}

/**
 * Regular billing dates + immediate-debit days of one bank-account.
 * @param a - Raw bank-account block.
 * @returns All debit-day blocks (regular first, then immediate).
 */
function accountDebitDays(a: IRawBankAccount): readonly IRawDebitDay[] {
  return [...(a.debitDates ?? []), ...(a.immidiateDebits?.debitDays ?? [])];
}

/**
 * Transactions of one bank-account block (all debit days).
 * @param a - Raw bank-account block.
 * @returns Flattened debit-day transaction rows.
 */
function accountTxns(a: IRawBankAccount): readonly VisaCalTxn[] {
  return accountDebitDays(a).flatMap(dayTxns);
}

/**
 * Flatten result.bankAccounts[].debitDates[].transactions[] plus
 * result.bankAccounts[].immidiateDebits.debitDays[].transactions[] —
 * tolerates the `result: null` incomplete-cycle response by yielding no
 * rows. Mirrors the upstream CAL contract + the generic pipeline's own
 * TxnShape BFS (result.bankAccounts[].debitDates[].transactions[]).
 * @param resp - Unwrapped transactions response.
 * @returns All transaction rows for the month.
 */
function flattenTxns(resp: ITxnsResp): readonly VisaCalTxn[] {
  return (resp.result?.bankAccounts ?? []).flatMap(accountTxns);
}

/**
 * Next cursor — advance one month until the last in-window month, then
 * stop. Driven by offset (not row count), so empty months keep the walk
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
export function txnsExtractPage(
  args: IExtractPageArgs<IVisaCalCard, number>,
): IPage<object, number> {
  const resp = args.body as unknown as ITxnsResp;
  const rows = flattenTxns(resp);
  const offset = offsetOf(args.cursor);
  return { items: rows, nextCursor: nextCursorOf(offset, args.ctx) };
}
