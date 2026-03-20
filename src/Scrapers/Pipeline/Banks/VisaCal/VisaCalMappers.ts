/**
 * VisaCal transaction mappers — pure functions, no side effects.
 * Maps raw API responses to ITransaction format.
 */

import moment from 'moment';

import {
  type ITransaction,
  TransactionStatuses,
  TransactionTypes,
} from '../../../../Transactions.js';
import { isOk, type Procedure } from '../../Types/Procedure.js';

/** Completed transaction from /transactions. */
export interface IRawTxn {
  readonly trnIntId: string;
  readonly trnPurchaseDate: string;
  readonly debCrdDate: string;
  readonly trnAmt: number;
  readonly amtBeforeConvAndIndex: number;
  readonly trnCurrencySymbol: string;
  readonly debCrdCurrencySymbol: string;
  readonly merchantName: string;
  readonly transTypeCommentDetails: string;
  readonly branchCodeDesc: string;
  readonly trnTypeCode: number;
  readonly numOfPayments: number;
  readonly curPaymentNum: number;
}

/** Pending transaction from /pending. */
export interface IRawPendingTxn {
  readonly trnPurchaseDate: string;
  readonly trnAmt: number;
  readonly trnCurrencySymbol: string;
  readonly merchantName: string;
  readonly transTypeCommentDetails: string;
  readonly branchCodeDesc: string;
  readonly trnTypeCode: number;
  readonly numberOfPayments: number;
}

/** Type codes. */
const TRN_REGULAR = 5;
const TRN_CREDIT = 6;
const TRN_STANDING = 9;

/** Lookup: type code → amount sign (credit = positive, rest = negative). */
const AMOUNT_SIGN: Record<number, number> = { [TRN_CREDIT]: 1 };

/** Lookup: type code → TransactionType (regular/standing = Normal, rest = Installments). */
const TXN_TYPE: Record<number, TransactionTypes> = {
  [TRN_REGULAR]: TransactionTypes.Normal,
  [TRN_STANDING]: TransactionTypes.Normal,
};

/**
 * Map completed transaction amounts.
 * @param txn - Raw completed transaction.
 * @returns Amount fields for ITransaction.
 */
function mapCompletedAmounts(txn: IRawTxn): Pick<ITransaction, 'originalAmount' | 'chargedAmount'> {
  const sign = AMOUNT_SIGN[txn.trnTypeCode] ?? -1;
  return {
    originalAmount: txn.trnAmt * sign,
    chargedAmount: txn.amtBeforeConvAndIndex * -1,
  };
}

/**
 * Map a completed transaction.
 * @param txn - Raw transaction from API.
 * @returns Mapped ITransaction.
 */
export function mapCompleted(txn: IRawTxn): ITransaction {
  const txnType = TXN_TYPE[txn.trnTypeCode] ?? TransactionTypes.Installments;
  const amounts = mapCompletedAmounts(txn);
  return {
    identifier: txn.trnIntId,
    type: txnType,
    status: TransactionStatuses.Completed,
    date: moment(txn.trnPurchaseDate).toISOString(),
    processedDate: new Date(txn.debCrdDate).toISOString(),
    ...amounts,
    originalCurrency: txn.trnCurrencySymbol,
    chargedCurrency: txn.debCrdCurrencySymbol,
    description: txn.merchantName,
    memo: txn.transTypeCommentDetails,
    category: txn.branchCodeDesc,
    ...(txn.numOfPayments && {
      installments: { number: txn.curPaymentNum, total: txn.numOfPayments },
    }),
  };
}

/**
 * Map a pending transaction.
 * @param txn - Raw pending transaction.
 * @returns Mapped ITransaction.
 */
export function mapPending(txn: IRawPendingTxn): ITransaction {
  const date = moment(txn.trnPurchaseDate).toISOString();
  return {
    type: TransactionTypes.Normal,
    status: TransactionStatuses.Pending,
    date,
    processedDate: date,
    originalAmount: txn.trnAmt * -1,
    originalCurrency: txn.trnCurrencySymbol,
    chargedAmount: txn.trnAmt * -1,
    description: txn.merchantName,
    memo: txn.transTypeCommentDetails,
    category: txn.branchCodeDesc,
  };
}

/**
 * Extract mapped pending transactions from a Procedure result.
 * @param result - Procedure with pending transactions or failure.
 * @returns Mapped pending transactions, or empty array on failure.
 */
export function mapPendingResults(result: Procedure<readonly IRawPendingTxn[]>): ITransaction[] {
  if (!isOk(result)) return [];
  return result.value.map(mapPending);
}
