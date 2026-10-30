/**
 * Ring scrape shape — response row extraction. One GatewayV2
 * GetTransactionsList response carries transaction rows across THREE
 * containers:
 * data.approvals.approvedTransactions[] (pending authorisations),
 * data.israelAbroadVouchers.vouchers.israelAbroadVouchersList[] (settled
 * charges + installments), and
 * data.israelAbroadVouchers.outOfStatementChargeDateVouchers[]
 *   .immediateVouchersCurrencyDate[] — charges posting OUTSIDE the current
 * statement cycle, which is where recurring international online merchants
 * land. data.currentTransactionsList is NOT a row list —
 * it is a per-currency cycle-summary object
 * (currentTransactionsBillingMonth[].totalTransactionsCurrency[] = totals
 * only), so it is intentionally excluded (grounded in the Isracard scrape
 * trace 0111). Rows are merged untouched; the downstream Data Mapper
 * normalises fields (purchaseDate, ilsBillingAmount/billingAmount,
 * seqVoucherNumber…). Every ring issuer (Isracard, Amex) answers with this
 * one response shape, so the merge is shared.
 */

import type { IDeclaredRowSpec } from '../../../Mediator/Scrape/CoverageAudit/DeclaredRows.js';

type RingTxn = Record<string, unknown>;

/**
 * The one container that states its own row count next to its rows:
 * `totalVouchersCurrencyDate.countImmediateVouchers` beside
 * `immediateVouchersCurrencyDate[]`. Verified against captured traffic — the
 * declared and carried counts agree on 41 of 41 groups across Isracard and
 * Amex, so any disagreement is real loss rather than provider noise.
 *
 * Declaring it here means the omission this file was fixed for could not have
 * shipped silently: reading zero of a container that says it holds twelve
 * warns on the first run.
 */
export const RING_DECLARED_ROWS: readonly IDeclaredRowSpec[] = [
  {
    groups: 'data.israelAbroadVouchers.outOfStatementChargeDateVouchers',
    rows: 'immediateVouchersCurrencyDate',
    count: 'totalVouchersCurrencyDate.countImmediateVouchers',
  },
];

interface IApprovals {
  readonly approvedTransactions?: readonly RingTxn[];
}
interface IVouchers {
  readonly israelAbroadVouchersList?: readonly RingTxn[];
}
/**
 * One out-of-statement group. The rows sit a level deeper than the settled
 * list, under a per-currency-date wrapper, but carry the identical row shape
 * (seqVoucherNumber, billingAmount, businessName, purchaseDate…).
 */
interface IOutOfStatementGroup {
  readonly immediateVouchersCurrencyDate?: readonly RingTxn[] | null;
}
interface IIsraelAbroadVouchers {
  readonly vouchers?: IVouchers | null;
  readonly outOfStatementChargeDateVouchers?: readonly IOutOfStatementGroup[] | null;
}
interface ITxnsData {
  readonly approvals?: IApprovals | null;
  readonly israelAbroadVouchers?: IIsraelAbroadVouchers | null;
}
interface ITxnsResp {
  readonly data?: ITxnsData | null;
}

/**
 * Pending authorisation rows (data.approvals.approvedTransactions[]).
 * @param data - Unwrapped response data.
 * @returns Approved-transaction rows (empty when absent).
 */
function approvedRows(data: ITxnsData): readonly RingTxn[] {
  return data.approvals?.approvedTransactions ?? [];
}

/**
 * Settled voucher rows
 * (data.israelAbroadVouchers.vouchers.israelAbroadVouchersList[]).
 * @param data - Unwrapped response data.
 * @returns Voucher rows (empty when absent).
 */
function voucherRows(data: ITxnsData): readonly RingTxn[] {
  return data.israelAbroadVouchers?.vouchers?.israelAbroadVouchersList ?? [];
}

/**
 * Charges whose charge-date falls outside the current statement
 * (data.israelAbroadVouchers.outOfStatementChargeDateVouchers[]
 *  .immediateVouchersCurrencyDate[]).
 *
 * Omitting this silently dropped real spend rather than erroring: recurring
 * international online merchants post here almost exclusively, so the loss
 * looked like a quiet month rather than a bug. Verified against 16 live
 * responses — 77 rows, sharing NO seqVoucherNumber with the settled list, so
 * merging cannot double-count.
 *
 * @param data - Unwrapped response data.
 * @returns Out-of-statement rows (empty when absent).
 */
function outOfStatementRows(data: ITxnsData): readonly RingTxn[] {
  const groups = data.israelAbroadVouchers?.outOfStatementChargeDateVouchers ?? [];
  return groups.flatMap(group => group.immediateVouchersCurrencyDate ?? []);
}

/**
 * Merge every transaction container from one GetTransactionsList response
 * into a single row list. Tolerates a null/absent data block.
 * @param body - Raw GetTransactionsList response body.
 * @returns Merged transaction rows.
 */
export function mergeRingRows(body: object): readonly object[] {
  const data = (body as ITxnsResp).data;
  if (!data) return [];
  const approved = approvedRows(data);
  const vouchers = voucherRows(data);
  const outOfStatement = outOfStatementRows(data);
  return [...approved, ...vouchers, ...outOfStatement];
}

export default mergeRingRows;
