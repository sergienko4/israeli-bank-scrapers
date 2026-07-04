/**
 * Isracard scrape shape — response row extraction. One GetTransactionsList
 * response carries transaction rows across two containers:
 * data.approvals.approvedTransactions[] (pending authorisations) and
 * data.israelAbroadVouchers.vouchers.israelAbroadVouchersList[] (settled
 * charges + installments). data.currentTransactionsList is NOT a row list —
 * it is a per-currency cycle-summary object
 * (currentTransactionsBillingMonth[].totalTransactionsCurrency[] = totals
 * only), so it is intentionally excluded (grounded in the Isracard scrape
 * trace 0111). Rows are merged untouched; the downstream Data Mapper
 * normalises fields (purchaseDate, ilsBillingAmount/billingAmount,
 * seqVoucherNumber…). Split from IsracardShapeTxns.ts for the 150-LOC cap.
 * Isracard and Amex share the DigitalV3 backbone (base-isracard-amex), so
 * the response shape matches.
 */

type IsracardTxn = Record<string, unknown>;

interface IApprovals {
  readonly approvedTransactions?: readonly IsracardTxn[];
}
interface IVouchers {
  readonly israelAbroadVouchersList?: readonly IsracardTxn[];
}
interface IIsraelAbroadVouchers {
  readonly vouchers?: IVouchers | null;
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
function approvedRows(data: ITxnsData): readonly IsracardTxn[] {
  return data.approvals?.approvedTransactions ?? [];
}

/**
 * Settled voucher rows
 * (data.israelAbroadVouchers.vouchers.israelAbroadVouchersList[]).
 * @param data - Unwrapped response data.
 * @returns Voucher rows (empty when absent).
 */
function voucherRows(data: ITxnsData): readonly IsracardTxn[] {
  return data.israelAbroadVouchers?.vouchers?.israelAbroadVouchersList ?? [];
}

/**
 * Merge both transaction containers from one GetTransactionsList response
 * into a single row list. Tolerates a null/absent data block.
 * @param body - Raw GetTransactionsList response body.
 * @returns Merged transaction rows.
 */
export function mergeIsracardRows(body: object): readonly object[] {
  const data = (body as ITxnsResp).data;
  if (!data) return [];
  const approved = approvedRows(data);
  const vouchers = voucherRows(data);
  return [...approved, ...vouchers];
}

export default mergeIsracardRows;
