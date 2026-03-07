import _ from 'lodash';
import moment, { type Moment } from 'moment';

import { type ITransaction, TransactionTypes } from '../Transactions';
import type { PostBody } from './Fetch';

/**
 * Returns true when the transaction is of the Normal type (not an installment).
 *
 * @param txn - the transaction to check
 * @returns true when the transaction type is TransactionTypes.Normal
 */
function isNormalTransaction(txn: ITransaction): boolean {
  return txn.type === TransactionTypes.Normal;
}

/**
 * Returns true when the transaction is of the Installments type.
 *
 * @param txn - the transaction to check
 * @returns true when the transaction type is TransactionTypes.Installments
 */
function isInstallmentTransaction(txn: ITransaction): boolean {
  return txn.type === TransactionTypes.Installments;
}

/**
 * Returns true when the transaction is an installment that is not the first payment (number > 1).
 *
 * @param txn - the transaction to check
 * @returns true when the transaction is an installment with installment number greater than 1
 */
function isNonInitialInstallmentTransaction(txn: ITransaction): boolean {
  return isInstallmentTransaction(txn) && !!txn.installments && txn.installments.number > 1;
}

/**
 * Returns true when the transaction is the first payment of an installment plan (number === 1).
 *
 * @param txn - the transaction to check
 * @returns true when the transaction is an installment with installment number equal to 1
 */
function isInitialInstallmentTransaction(txn: ITransaction): boolean {
  return isInstallmentTransaction(txn) && !!txn.installments && txn.installments.number === 1;
}

/**
 * Adjusts the date of non-initial installment transactions to reflect the actual charge month.
 * For each installment beyond the first, the date is shifted forward by (installmentNumber - 1) months.
 *
 * @param txns - the array of transactions to process
 * @returns a new array with cloned transactions where installment dates have been corrected
 */
export function fixInstallments(txns: ITransaction[]): ITransaction[] {
  return txns.map((txn: ITransaction) => {
    const clonedTxn = { ...txn };

    if (
      isInstallmentTransaction(clonedTxn) &&
      isNonInitialInstallmentTransaction(clonedTxn) &&
      clonedTxn.installments
    ) {
      const dateMoment = moment(clonedTxn.date);
      const actualDateMoment = dateMoment.add(clonedTxn.installments.number - 1, 'month');
      clonedTxn.date = actualDateMoment.toISOString();
    }
    return clonedTxn;
  });
}

/**
 * Sorts a transaction array in ascending chronological order by date.
 *
 * @param txns - the array of transactions to sort
 * @returns a new sorted array of transactions ordered by date ascending
 */
export function sortTransactionsByDate(txns: ITransaction[]): ITransaction[] {
  return _.sortBy(txns, ['date']);
}

/**
 * Filters out transactions that fall before the startMoment cutoff date.
 * When shouldCombineInstallments is true, only normal and initial installment transactions
 * on or after startMoment are kept; non-initial installments are always excluded.
 *
 * @param txns - the array of transactions to filter
 * @param startMoment - the earliest date threshold; transactions before this date are removed
 * @param shouldCombineInstallments - when true, applies installment-aware filtering logic
 * @returns a filtered array containing only transactions on or after the start date
 */
export function filterOldTransactions(
  txns: ITransaction[],
  startMoment: Moment,
  shouldCombineInstallments: boolean,
): ITransaction[] {
  return txns.filter(txn => {
    const shouldCombineNeededAndInitialOrNormal =
      shouldCombineInstallments &&
      (isNormalTransaction(txn) || isInitialInstallmentTransaction(txn));
    return (
      (!shouldCombineInstallments && startMoment.isSameOrBefore(txn.date)) ||
      (shouldCombineNeededAndInitialOrNormal && startMoment.isSameOrBefore(txn.date))
    );
  });
}

/**
 * Recursively removes null, undefined, empty string, and empty array values from objects and arrays.
 * Preserves all other values, including zero numbers and false booleans.
 *
 * @param value - the value to clean; may be an object, array, or primitive
 * @returns a new deeply-cleaned copy of the value with empty/null entries removed
 */
function removeEmptyValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value as unknown[]).map(item => removeEmptyValues(item)) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, PostBody>)
      .filter(([, v]) => {
        if (v === null || v === '') return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      })
      .map(([k, v]) => [k, removeEmptyValues(v)]);

    return Object.fromEntries(entries) as unknown as T;
  }

  return value;
}

/**
 * Adds or extends raw transaction data with new raw data.
 * Cleans the data to remove null/undefined/empty-string keys.
 * When called with one argument, returns cleaned data (common case for setting a new raw transaction).
 * When called with two arguments and the transaction already has rawTransaction, extends it into an array.
 *
 * @param data - the new raw data to clean and attach
 * @param transaction - the existing transaction object to extend, if any
 * @param transaction.rawTransaction - the existing raw transaction value to combine with the new data
 * @returns the cleaned raw data alone, or an array combining existing and new raw data
 */
export function getRawTransaction(
  data: PostBody | object,
  transaction?: { rawTransaction?: PostBody | object },
): PostBody {
  const current = transaction?.rawTransaction as PostBody | undefined;
  const cleaned = removeEmptyValues(data as PostBody);

  if (!current) {
    return cleaned;
  }

  if (Array.isArray(current)) {
    return [...current, cleaned];
  }

  return [current, cleaned];
}
