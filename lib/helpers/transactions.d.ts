import { type Moment } from 'moment';
import { type Transaction } from '../transactions';
export declare function fixInstallments(txns: Transaction[]): Transaction[];
export declare function sortTransactionsByDate(txns: Transaction[]): Transaction[];
export declare function filterOldTransactions(txns: Transaction[], startMoment: Moment, combineInstallments: boolean): Transaction[];
/**
 * Add/extend raw transaction data with new raw data.
 * - Cleans the data to remove null/undefined/empty-string keys.
 * - When called with one argument: returns cleaned data (common case for setting new raw transaction).
 * - When called with two arguments and transaction has rawTransaction: extends existing raw transaction.
 */
export declare function getRawTransaction(data: unknown, transaction?: {
    rawTransaction?: unknown;
}): unknown;
