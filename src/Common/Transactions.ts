import _ from 'lodash';
import moment, { type Moment } from 'moment';

import { type ITransaction, TransactionTypes } from '../Transactions.js';

/**
 * Check whether a transaction is a normal (non-installment) type.
 * @param txn - The transaction to check.
 * @returns True if the transaction is normal.
 */
function isNormalTransaction(txn: ITransaction): boolean {
  return txn.type === TransactionTypes.Normal;
}

/**
 * Check whether a transaction is an installment type.
 * @param txn - The transaction to check.
 * @returns True if the transaction is an installment.
 */
function isInstallmentTransaction(txn: ITransaction): boolean {
  return txn.type === TransactionTypes.Installments;
}

/**
 * Check whether a transaction is a non-initial installment (number > 1).
 * @param txn - The transaction to check.
 * @returns True if the transaction is a non-initial installment.
 */
function isNonInitialInstallmentTransaction(txn: ITransaction): boolean {
  return isInstallmentTransaction(txn) && !!txn.installments && txn.installments.number > 1;
}

/**
 * Check whether a transaction is the first installment (number === 1).
 * @param txn - The transaction to check.
 * @returns True if the transaction is the initial installment.
 */
function isInitialInstallmentTransaction(txn: ITransaction): boolean {
  return isInstallmentTransaction(txn) && !!txn.installments && txn.installments.number === 1;
}

/**
 * Fix installment transaction dates by adding months based on installment number.
 * @param txns - The array of transactions to fix.
 * @returns A new array with corrected installment dates.
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
 * Sort transactions by date ascending.
 * @param txns - The transactions to sort.
 * @returns A new array of transactions sorted by date.
 */
export function sortTransactionsByDate(txns: ITransaction[]): ITransaction[] {
  return _.sortBy(txns, ['date']);
}

/**
 * Filter out transactions older than the start date.
 * @param txns - The transactions to filter.
 * @param startMoment - The earliest allowed transaction date.
 * @param shouldCombineInstallments - Whether to combine installment transactions.
 * @returns Filtered transactions within the date range.
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
 * Recursively remove null, undefined, empty string, and empty array values.
 * @param value - The value to clean (object, array, or primitive).
 * @returns A cleaned copy with empty values removed.
 */
function removeEmptyValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value as object[]).map(item => removeEmptyValues(item)) as T;
  }

  if (value && typeof value === 'object') {
    const rawEntries = Object.entries(value as Record<string, T>);
    const entries = rawEntries
      .filter(([, fieldValue]) => {
        if (!fieldValue && fieldValue !== 0 && fieldValue !== false) return false;
        if (Array.isArray(fieldValue) && fieldValue.length === 0) return false;
        return true;
      })
      .map(([key, fieldValue]) => [key, removeEmptyValues(fieldValue)]);

    return Object.fromEntries(entries) as T;
  }

  return value;
}

/** Raw bank data — can be an object, primitive, or array of such values. */
type RawBankData = string | number | boolean | object;

/** Result type for raw transaction data — either a single value or array. */
type RawTransactionResult = RawBankData | RawBankData[];

/**
 * Add/extend raw transaction data with new raw data.
 * Cleans the data to remove null/undefined/empty-string keys.
 * @param data - The new raw transaction data to add.
 * @param transaction - Optional existing transaction to extend.
 * @param transaction.rawTransaction - The existing raw transaction data.
 * @returns Cleaned raw transaction data, merged with existing if present.
 */
export function getRawTransaction(
  data: RawBankData,
  transaction?: Pick<ITransaction, 'rawTransaction'>,
): RawTransactionResult {
  const current = transaction?.rawTransaction as RawBankData | RawBankData[] | undefined;
  const cleaned = removeEmptyValues(data);

  if (!current) {
    return cleaned;
  }

  if (Array.isArray(current)) {
    const currentArray = current as RawBankData[];
    return [...currentArray, cleaned];
  }

  return [current, cleaned];
}
