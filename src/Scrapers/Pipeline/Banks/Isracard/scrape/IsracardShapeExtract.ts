/**
 * Isracard scrape shape — response row extraction. One GetTransactionsList
 * response carries rows across three containers:
 * data.approvals.approvedTransactions[] (pending authorisations),
 * data.israelAbroadVouchers.vouchers.israelAbroadVouchersList[] (settled
 * charges + installments), and data.currentTransactionsList (usually null).
 * Rows are merged untouched; the downstream Data Mapper normalises fields
 * (purchaseDate, ilsBillingAmount/billingAmount, seqVoucherNumber…). Split
 * from IsracardShapeTxns.ts for the 150-LOC cap. Isracard and Amex share the
 * DigitalV3 backbone (base-isracard-amex), so the response shape matches.
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
  readonly currentTransactionsList?: readonly IsracardTxn[] | null;
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
 * Current-cycle rows (data.currentTransactionsList — usually null).
 * @param data - Unwrapped response data.
 * @returns Current rows (empty when null/absent).
 */
function currentRows(data: ITxnsData): readonly IsracardTxn[] {
  return data.currentTransactionsList ?? [];
}

/**
 * Merge all three transaction containers from one GetTransactionsList
 * response into a single row list. Tolerates a null/absent data block.
 * @param body - Raw GetTransactionsList response body.
 * @returns Merged transaction rows.
 */
export function mergeIsracardRows(body: object): readonly object[] {
  const data = (body as ITxnsResp).data;
  if (!data) return [];
  const approved = approvedRows(data);
  const vouchers = voucherRows(data);
  const current = currentRows(data);
  return [...approved, ...vouchers, ...current];
}

export default mergeIsracardRows;
